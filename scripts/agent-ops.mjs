#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TASKS_PATH = path.join(ROOT, "config", "tasks.json");
const RUNS_DIR = path.join(ROOT, "data", "runs");
const AUTH_PATH = path.join(ROOT, "data", "auth.json");
const SESSION_COOKIE = "agent_ops_session";

function nowIso() {
  return new Date().toISOString();
}

function slugTime() {
  return new Date().toISOString().replaceAll(":", "").replaceAll(".", "-");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function loadAuth() {
  if (existsSync(AUTH_PATH)) {
    return readJson(AUTH_PATH);
  }
  const auth = {
    token: randomBytes(24).toString("base64url"),
    createdAt: nowIso()
  };
  await writeJson(AUTH_PATH, auth);
  console.log(`已生成访问口令：${AUTH_PATH}`);
  return auth;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

async function isAuthenticated(req) {
  const auth = await loadAuth();
  const cookies = parseCookies(req);
  return safeEqual(cookies[SESSION_COOKIE], auth.token);
}

function setSessionCookie(res, token) {
  res.setHeader(
    "set-cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

async function loadConfig() {
  const config = await readJson(TASKS_PATH);
  const defaults = config.defaults ?? {};
  const tasks = (config.tasks ?? []).map((task) => ({ ...defaults, ...task }));
  return { ...config, tasks };
}

async function loadRawConfig() {
  return readJson(TASKS_PATH);
}

async function saveRawConfig(config) {
  await writeJson(TASKS_PATH, config);
}

function taskById(tasks, id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) {
    throw new Error(`Unknown task: ${id}`);
  }
  return task;
}

function dueToday(task) {
  if (!task.enabled) return false;
  const schedule = task.schedule ?? {};
  if (schedule.kind === "daily") return true;
  if (schedule.kind === "weekly") {
    const day = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "Asia/Shanghai"
    })
      .format(new Date())
      .toLowerCase();
    return day === String(schedule.day || "").toLowerCase();
  }
  return false;
}

async function listTasks() {
  const config = await loadConfig();
  for (const task of config.tasks) {
    const state = task.enabled ? "enabled" : "disabled";
    const schedule = task.schedule ? JSON.stringify(task.schedule) : "manual";
    console.log(`${task.id}\t${state}\t${schedule}\t${task.name}`);
  }
}

async function runTask(task) {
  const runId = `${slugTime()}_${task.id}`;
  const runDir = path.join(RUNS_DIR, runId);
  await mkdir(runDir, { recursive: true });

  const startedAt = nowIso();
  const run = {
    id: runId,
    taskId: task.id,
    taskName: task.name,
    status: "running",
    reviewStatus: task.reviewRequired ? "pending_review" : "not_required",
    startedAt,
    finishedAt: null,
    durationMs: null,
    cwd: task.cwd,
    command: task.command,
    runDir,
    artifacts: [],
    exitCode: null,
    error: null
  };
  await writeJson(path.join(runDir, "run.json"), run);

  const [cmd, ...args] = task.command;
  const env = {
    ...process.env,
    AGENT_OPS_ROOT: ROOT,
    AGENT_OPS_RUN_DIR: runDir,
    AGENT_OPS_TASK_ID: task.id
  };
  const child = spawn(cmd, args, {
    cwd: task.cwd || ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const timeoutMs = Number(task.timeoutSeconds || 900) * 1000;
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, timeoutMs);

  const exitCode = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  clearTimeout(timeout);

  await writeFile(path.join(runDir, "stdout.txt"), stdout);
  await writeFile(path.join(runDir, "stderr.txt"), stderr);

  const finishedAt = nowIso();
  const artifactNames = existsSync(runDir) ? await readdir(runDir) : [];
  const artifacts = artifactNames
    .filter((name) => !["run.json", "stdout.txt", "stderr.txt"].includes(name))
    .map((name) => path.join(runDir, name));

  const updated = {
    ...run,
    status: exitCode === 0 ? "success" : "failed",
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    artifacts,
    exitCode,
    error: exitCode === 0 ? null : `Process exited with code ${exitCode}`
  };
  await writeJson(path.join(runDir, "run.json"), updated);
  console.log(`${updated.status}: ${runId}`);
  console.log(`runDir=${runDir}`);
  return updated;
}

async function runOne(id) {
  const config = await loadConfig();
  return runTask(taskById(config.tasks, id));
}

async function runDue() {
  const config = await loadConfig();
  const due = config.tasks.filter(dueToday);
  if (due.length === 0) {
    console.log("No due tasks.");
    return;
  }
  for (const task of due) {
    await runTask(task);
  }
}

async function reviewRun(runId, reviewStatus) {
  const allowed = new Set(["pending_review", "approved", "rejected", "published", "failed"]);
  if (!allowed.has(reviewStatus)) {
    throw new Error(`Invalid review status: ${reviewStatus}`);
  }
  const file = path.join(RUNS_DIR, runId, "run.json");
  const run = await readJson(file);
  const updated = {
    ...run,
    reviewStatus,
    reviewedAt: nowIso()
  };
  await writeJson(file, updated);
  console.log(`${runId} reviewStatus=${reviewStatus}`);
}

async function updateTaskConfig(taskId, fields) {
  const config = await loadRawConfig();
  const tasks = config.tasks ?? [];
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index === -1) throw new Error(`Unknown task: ${taskId}`);
  const current = tasks[index];
  const kind = fields.scheduleKind || current.schedule?.kind || "daily";
  const schedule = {
    kind,
    time: fields.scheduleTime || current.schedule?.time || "03:00"
  };
  if (kind === "weekly") {
    schedule.day = fields.scheduleDay || current.schedule?.day || "monday";
  }
  if (kind === "every_n_days") {
    schedule.days = Math.max(1, Number(fields.scheduleDays || current.schedule?.days || 2));
  }
  tasks[index] = {
    ...current,
    enabled: fields.enabled === "on",
    name: fields.name || current.name,
    description: fields.description || current.description,
    timeoutSeconds: Math.max(1, Number(fields.timeoutSeconds || current.timeoutSeconds || config.defaults?.timeoutSeconds || 900)),
    schedule
  };
  await saveRawConfig(config);
  return tasks[index];
}

async function readRuns() {
  await mkdir(RUNS_DIR, { recursive: true });
  const names = await readdir(RUNS_DIR);
  const runs = [];
  for (const name of names) {
    const file = path.join(RUNS_DIR, name, "run.json");
    if (!existsSync(file)) continue;
    try {
      runs.push(await readJson(file));
    } catch {
      // Ignore partial records.
    }
  }
  runs.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return runs;
}

async function readRun(runId) {
  const file = path.join(RUNS_DIR, runId, "run.json");
  if (!existsSync(file)) return null;
  return readJson(file);
}

async function readRunText(runId, name) {
  const allowed = new Set(["stdout.txt", "stderr.txt"]);
  if (!allowed.has(name)) return "";
  const file = path.join(RUNS_DIR, runId, name);
  if (!existsSync(file)) return "";
  return readFile(file, "utf8");
}

async function readArtifact(runId, artifactName) {
  const run = await readRun(runId);
  if (!run) return null;
  const artifact = (run.artifacts || []).find((item) => path.basename(item) === artifactName);
  if (!artifact || !artifact.startsWith(path.join(RUNS_DIR, runId))) return null;
  if (!existsSync(artifact)) return null;
  const text = await readFile(artifact, "utf8");
  return {
    run,
    path: artifact,
    name: path.basename(artifact),
    ext: path.extname(artifact).slice(1).toLowerCase(),
    text
  };
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function zhStatus(value) {
  const map = {
    running: "运行中",
    success: "成功",
    failed: "失败",
    never_run: "未运行"
  };
  return map[value] || value || "";
}

function zhReview(value) {
  const map = {
    pending_review: "待审核",
    approved: "已通过",
    rejected: "已拒绝",
    published: "已发布",
    failed: "审核失败",
    not_required: "无需审核"
  };
  return map[value] || value || "";
}

function zhScheduleKind(value) {
  const map = {
    daily: "每天",
    weekly: "每周",
    every_n_days: "每 N 天"
  };
  return map[value] || value || "";
}

function zhDay(value) {
  const map = {
    monday: "周一",
    tuesday: "周二",
    wednesday: "周三",
    thursday: "周四",
    friday: "周五",
    saturday: "周六",
    sunday: "周日"
  };
  return map[value] || value || "";
}

function fmtDate(value) {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function fmtDuration(value) {
  if (!value) return "-";
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function scheduleText(task) {
  const schedule = task.schedule || {};
  if (schedule.kind === "daily") return `每天 ${schedule.time || "03:00"}`;
  if (schedule.kind === "weekly") return `每周${zhDay(schedule.day).replace("周", "")} ${schedule.time || "03:00"}`;
  if (schedule.kind === "every_n_days") return `每 ${schedule.days || 2} 天 ${schedule.time || "03:00"}`;
  return "手动";
}

function appShell(title, body, options = {}) {
  const subtitle = options.subtitle || "把本地 Agent、定时任务、审核产物放到同一个工作台。";
  const active = options.active || "dashboard";
  const nav = [
    ["dashboard", "/", "总览"],
    ["tasks", "/#tasks", "任务"],
    ["runs", "/#runs", "运行记录"]
  ];
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(title)} - 自动化控制台</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f3f5f7;
      --panel: #ffffff;
      --ink: #111827;
      --muted: #6b7280;
      --line: #e5e7eb;
      --line-strong: #d1d5db;
      --brand: #155e75;
      --brand-strong: #0e7490;
      --green: #15803d;
      --red: #b91c1c;
      --amber: #b45309;
      --shadow: 0 16px 40px rgba(15, 23, 42, .08);
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; color: var(--ink); background: radial-gradient(circle at top left, #e0f2fe 0, transparent 28rem), var(--bg); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    a { color: var(--brand); text-decoration: none; }
    a:hover { color: var(--brand-strong); }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .layout { display: grid; grid-template-columns: 244px minmax(0, 1fr); min-height: 100vh; }
    .sidebar { position: sticky; top: 0; height: 100vh; padding: 22px 16px; background: #0b1220; color: #dbeafe; }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
    .logo { width: 36px; height: 36px; border-radius: 8px; display: grid; place-items: center; color: #ecfeff; background: linear-gradient(135deg, #0891b2, #1d4ed8); font-weight: 800; }
    .brand-title { font-weight: 800; letter-spacing: .02em; }
    .brand-sub { color: #94a3b8; font-size: 12px; margin-top: 2px; }
    .nav a { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 8px; color: #cbd5e1; margin: 5px 0; }
    .nav a.active, .nav a:hover { background: rgba(148, 163, 184, .14); color: #fff; }
    .side-note { position: absolute; left: 16px; right: 16px; bottom: 18px; padding: 12px; border: 1px solid rgba(148, 163, 184, .22); border-radius: 8px; color: #94a3b8; font-size: 12px; line-height: 1.6; }
    .main { min-width: 0; padding: 28px; }
    .topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 22px; }
    h1 { margin: 0; font-size: 30px; letter-spacing: 0; }
    h2 { margin: 0 0 14px; font-size: 18px; }
    h3 { margin: 0 0 8px; font-size: 15px; }
    .muted { color: var(--muted); }
    .subtitle { margin: 8px 0 0; color: var(--muted); line-height: 1.6; }
    .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    button, .button { border: 1px solid #0f172a; border-radius: 8px; background: #0f172a; color: #fff; padding: 9px 13px; font: inherit; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
    button:hover, .button:hover { background: #1e293b; color: #fff; }
    button.secondary, .button.secondary { border-color: var(--line-strong); background: #fff; color: var(--ink); }
    button.secondary:hover, .button.secondary:hover { background: #f8fafc; color: var(--ink); }
    .inline { display: inline-flex; margin: 0; }
    .grid { display: grid; gap: 16px; }
    .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 18px; }
    .stat { border: 1px solid rgba(209, 213, 219, .9); border-radius: 8px; background: rgba(255,255,255,.86); padding: 16px; box-shadow: var(--shadow); }
    .stat span { color: var(--muted); font-size: 13px; }
    .stat strong { display: block; font-size: 30px; margin-top: 8px; letter-spacing: -.02em; }
    .board { grid-template-columns: minmax(0, 1.15fr) minmax(360px, .85fr); align-items: start; }
    .panel { border: 1px solid rgba(209, 213, 219, .9); border-radius: 8px; background: rgba(255,255,255,.9); padding: 18px; box-shadow: var(--shadow); }
    .task-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .task-card { border: 1px solid var(--line); border-radius: 8px; background: #fff; padding: 14px; min-height: 180px; display: flex; flex-direction: column; gap: 12px; }
    .task-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .task-title { font-weight: 750; margin-bottom: 4px; }
    .task-desc { color: var(--muted); line-height: 1.5; font-size: 13px; }
    .meta { display: flex; flex-wrap: wrap; gap: 7px; margin-top: auto; }
    .pill, .status, .review { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 8px; border: 1px solid var(--line-strong); font-size: 12px; white-space: nowrap; background: #fff; color: #475569; }
    .pill.on { color: #065f46; background: #ecfdf5; border-color: #a7f3d0; }
    .pill.off { color: #64748b; background: #f8fafc; }
    .status.success { color: var(--green); background: #dcfce7; border-color: #86efac; }
    .status.failed { color: var(--red); background: #fee2e2; border-color: #fecaca; }
    .status.running { color: var(--amber); background: #fef3c7; border-color: #fde68a; }
    .status.never_run { color: #475569; background: #f8fafc; }
    .task-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .timeline { display: grid; gap: 10px; }
    .run-item { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 11px; padding: 4px 0; }
    .dot { width: 10px; height: 10px; border-radius: 999px; margin-top: 7px; background: #94a3b8; }
    .dot.success { background: #22c55e; }
    .dot.failed { background: #ef4444; }
    .dot.running { background: #f59e0b; }
    .run-card { border: 1px solid var(--line); border-radius: 8px; background: #fff; padding: 12px; }
    .run-top { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .run-name { font-weight: 700; overflow-wrap: anywhere; }
    .artifacts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
    .artifact { display: inline-flex; border: 1px solid var(--line); border-radius: 7px; padding: 4px 7px; background: #f8fafc; font-size: 12px; color: #334155; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { font-size: 13px; color: #475569; background: #f8fafc; }
    input, textarea, select { width: 100%; border: 1px solid var(--line-strong); border-radius: 8px; padding: 10px; font: inherit; background: #fff; }
    textarea { min-height: 96px; }
    label { display: block; font-size: 13px; color: #475569; margin: 14px 0 6px; }
    pre { white-space: pre-wrap; overflow: auto; background: #0b1220; color: #e5e7eb; padding: 14px; border-radius: 8px; line-height: 1.55; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .checkbox { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
    .checkbox input { width: auto; }
    @media (max-width: 1040px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { position: static; height: auto; }
      .side-note { position: static; margin-top: 20px; }
      .board, .stats { grid-template-columns: 1fr; }
      .task-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 720px) {
      .main { padding: 18px; }
      .topbar { flex-direction: column; }
      .actions { justify-content: flex-start; }
      .form-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <div class="logo">AO</div>
        <div>
          <div class="brand-title">Agent Ops</div>
          <div class="brand-sub">本地自动化中枢</div>
        </div>
      </div>
      <nav class="nav">
        ${nav.map(([key, href, label]) => `<a class="${active === key ? "active" : ""}" href="${href}"><span>${label}</span><span>›</span></a>`).join("")}
      </nav>
      <div class="side-note">受 Cloudflare Access 与本地口令双层保护。服务运行在 <code>127.0.0.1:4179</code>。</div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div>
          <h1>${htmlEscape(title)}</h1>
          <p class="subtitle">${htmlEscape(subtitle)}</p>
        </div>
        <div class="actions">
          ${options.actions || ""}
          <form method="post" action="/logout" class="inline"><button class="secondary" type="submit">退出</button></form>
        </div>
      </div>
      ${body}
    </main>
  </div>
</body>
</html>`;
}

async function renderDashboard() {
  const config = await loadConfig();
  const runs = await readRuns();
  const latestByTask = new Map();
  for (const run of runs) {
    if (!latestByTask.has(run.taskId)) latestByTask.set(run.taskId, run);
  }
  const successCount = runs.filter((run) => run.status === "success").length;
  const failedCount = runs.filter((run) => run.status === "failed").length;
  const reviewCount = runs.filter((run) => run.reviewStatus === "pending_review").length;
  const artifactCount = runs.reduce((sum, run) => sum + (run.artifacts || []).length, 0);
  const taskCards = config.tasks
    .map((task) => {
      const run = latestByTask.get(task.id);
      const status = run ? run.status : "never_run";
      const review = run ? run.reviewStatus : "";
      return `<article class="task-card">
        <div class="task-head">
          <div>
            <div class="task-title">${htmlEscape(task.name)}</div>
            <div><a href="/task?id=${encodeURIComponent(task.id)}"><code>${htmlEscape(task.id)}</code></a></div>
          </div>
          <span class="pill ${task.enabled ? "on" : "off"}">${task.enabled ? "启用" : "停用"}</span>
        </div>
        <div class="task-desc">${htmlEscape(task.description || "暂无描述")}</div>
        <div class="meta">
          <span class="status ${htmlEscape(status)}">${htmlEscape(zhStatus(status))}</span>
          ${review ? `<span class="review">${htmlEscape(zhReview(review))}</span>` : ""}
          <span class="pill">${htmlEscape(scheduleText(task))}</span>
          <span class="pill">最近 ${htmlEscape(fmtDate(run?.startedAt))}</span>
        </div>
        <div class="task-actions">
          <form method="post" action="/run" class="inline">
            <input type="hidden" name="taskId" value="${htmlEscape(task.id)}" />
            <button type="submit">运行</button>
          </form>
          <a class="button secondary" href="/task?id=${encodeURIComponent(task.id)}">编辑</a>
        </div>
      </article>`;
    })
    .join("");
  const runCards = runs
    .slice(0, 14)
    .map((run) => {
      const artifacts = (run.artifacts || [])
        .slice(0, 4)
        .map((item) => `<a class="artifact" href="/artifact?run=${encodeURIComponent(run.id)}&name=${encodeURIComponent(path.basename(item))}">${htmlEscape(path.basename(item))}</a>`)
        .join("");
      return `<div class="run-item">
        <span class="dot ${htmlEscape(run.status)}"></span>
        <article class="run-card">
          <div class="run-top">
            <div>
              <a class="run-name" href="/run?id=${encodeURIComponent(run.id)}">${htmlEscape(run.taskName || run.taskId)}</a>
              <div class="muted"><code>${htmlEscape(run.taskId)}</code> · ${htmlEscape(fmtDate(run.startedAt))} · ${htmlEscape(fmtDuration(run.durationMs))}</div>
            </div>
            <span class="status ${htmlEscape(run.status)}">${htmlEscape(zhStatus(run.status))}</span>
          </div>
          ${artifacts ? `<div class="artifacts">${artifacts}</div>` : ""}
        </article>
      </div>`;
    })
    .join("");

  const actions = `<form method="post" action="/run-due" class="inline"><button type="submit">运行到期任务</button></form>`;
  return appShell(
    "自动化控制台",
    `<section class="grid stats">
      <div class="stat"><span>累计运行</span><strong>${runs.length}</strong></div>
      <div class="stat"><span>成功</span><strong>${successCount}</strong></div>
      <div class="stat"><span>失败</span><strong>${failedCount}</strong></div>
      <div class="stat"><span>待审核</span><strong>${reviewCount}</strong></div>
    </section>
    <section class="grid board">
      <div class="panel" id="tasks">
        <h2>任务编排</h2>
        <div class="task-grid">${taskCards}</div>
      </div>
      <div class="panel" id="runs">
        <h2>最近运行</h2>
        <div class="timeline">${runCards || `<p class="muted">暂无运行记录。</p>`}</div>
      </div>
    </section>
    <p class="muted">已生成产物 ${artifactCount} 个 · 根目录 <code>${htmlEscape(ROOT)}</code></p>`,
    { actions }
  );
}

async function renderTaskDetail(taskId) {
  const raw = await loadRawConfig();
  const defaults = raw.defaults ?? {};
  const task = (raw.tasks ?? []).find((item) => item.id === taskId);
  if (!task) return appShell("未找到任务", `<section class="panel"><p>未找到任务。</p><p><a href="/">返回</a></p></section>`, { active: "tasks" });
  const schedule = task.schedule ?? {};
  const command = JSON.stringify(task.command || [], null, 2);
  return appShell(
    `编辑任务：${task.name}`,
    `<p><a href="/">← 返回控制台</a></p>
  <section class="panel">
    <form method="post" action="/task">
      <input type="hidden" name="taskId" value="${htmlEscape(task.id)}" />
      <div class="checkbox"><input type="checkbox" name="enabled" ${task.enabled ? "checked" : ""} /> <span>启用任务</span></div>
      <label>名称</label>
      <input name="name" value="${htmlEscape(task.name)}" />
      <label>描述</label>
      <textarea name="description">${htmlEscape(task.description || "")}</textarea>
      <div class="row">
        <div>
          <label>调度类型</label>
          <select name="scheduleKind">
            ${["daily", "weekly", "every_n_days"].map((kind) => `<option value="${kind}" ${schedule.kind === kind ? "selected" : ""}>${zhScheduleKind(kind)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>执行时间</label>
          <input name="scheduleTime" value="${htmlEscape(schedule.time || "03:00")}" />
        </div>
      </div>
      <div class="row">
        <div>
          <label>每周几</label>
          <select name="scheduleDay">
            ${["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => `<option value="${day}" ${schedule.day === day ? "selected" : ""}>${zhDay(day)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>每 N 天</label>
          <input name="scheduleDays" type="number" min="1" value="${htmlEscape(schedule.days || 2)}" />
        </div>
      </div>
      <label>超时时间（秒）</label>
      <input name="timeoutSeconds" type="number" min="1" value="${htmlEscape(task.timeoutSeconds || defaults.timeoutSeconds || 900)}" />
      <p><button type="submit">保存任务</button></p>
    </form>
  </section>
  <section class="panel">
    <h2>执行命令</h2>
    <pre>${htmlEscape(command)}</pre>
    <h2>工作目录</h2>
    <pre>${htmlEscape(task.cwd || ROOT)}</pre>
  </section>`,
    {
      active: "tasks",
      subtitle: `任务 ID：${task.id}`
    }
  );
}

async function renderRunDetail(runId) {
  const run = await readRun(runId);
  if (!run) {
    return appShell("未找到运行记录", `<section class="panel"><p>未找到运行记录。</p><p><a href="/">返回</a></p></section>`, { active: "runs" });
  }
  const stdout = await readRunText(runId, "stdout.txt");
  const stderr = await readRunText(runId, "stderr.txt");
  const artifacts = (run.artifacts || [])
    .map((item) => `<li><a href="/artifact?run=${encodeURIComponent(run.id)}&name=${encodeURIComponent(path.basename(item))}"><code>${htmlEscape(path.basename(item))}</code></a> <span class="muted">${htmlEscape(item)}</span></li>`)
    .join("");
  return appShell(
    `运行详情`,
    `<p><a href="/">← 返回控制台</a></p>
  <section class="panel">
    <p>任务：<code>${htmlEscape(run.taskId)}</code></p>
    <p>状态：<code>${htmlEscape(zhStatus(run.status))}</code> · 审核：<code>${htmlEscape(zhReview(run.reviewStatus))}</code></p>
    <p>开始：${htmlEscape(fmtDate(run.startedAt))} · 结束：${htmlEscape(fmtDate(run.finishedAt))} · 耗时：${htmlEscape(fmtDuration(run.durationMs))}</p>
    <form method="post" action="/review"><input type="hidden" name="runId" value="${htmlEscape(run.id)}"><input type="hidden" name="status" value="approved"><button>通过</button></form>
    <form method="post" action="/review"><input type="hidden" name="runId" value="${htmlEscape(run.id)}"><input type="hidden" name="status" value="rejected"><button class="secondary">拒绝</button></form>
    <form method="post" action="/review"><input type="hidden" name="runId" value="${htmlEscape(run.id)}"><input type="hidden" name="status" value="published"><button class="secondary">标记已发布</button></form>
  </section>
  <section class="panel"><h2>产物</h2><ul>${artifacts}</ul></section>
  <section class="panel"><h2>标准输出</h2><pre>${htmlEscape(stdout)}</pre></section>
  <section class="panel"><h2>错误输出</h2><pre>${htmlEscape(stderr)}</pre></section>`,
    {
      active: "runs",
      subtitle: run.id
    }
  );
}

function renderCsvTable(text) {
  const lines = text.trim().split(/\r?\n/).slice(0, 200);
  if (lines.length === 0) return "";
  const rows = lines.map((line) => line.split(",").map((cell) => cell.replace(/^"|"$/g, "").replaceAll('""', '"')));
  return `<table>${rows
    .map((row, index) => `<tr>${row.map((cell) => `<${index === 0 ? "th" : "td"}>${htmlEscape(cell)}</${index === 0 ? "th" : "td"}>`).join("")}</tr>`)
    .join("")}</table>`;
}

async function renderArtifactDetail(runId, artifactName) {
  const artifact = await readArtifact(runId, artifactName);
  if (!artifact) return appShell("未找到产物", `<section class="panel"><p>未找到产物。</p><p><a href="/">返回</a></p></section>`, { active: "runs" });
  const prettyText = artifact.ext === "json" ? JSON.stringify(JSON.parse(artifact.text), null, 2) : artifact.text;
  const body = artifact.ext === "csv" ? renderCsvTable(artifact.text) : `<pre>${htmlEscape(prettyText.slice(0, 200000))}</pre>`;
  return appShell(
    `产物预览`,
    `<p><a href="/run?id=${encodeURIComponent(runId)}">← 返回运行记录</a> · <a href="/">控制台</a></p>
  <section class="panel">
    <h2><code>${htmlEscape(artifact.name)}</code></h2>
    <p class="muted">${htmlEscape(artifact.path)}</p>
    ${body}
  </section>`,
    {
      active: "runs",
      subtitle: artifact.name
    }
  );
}

function parseFormBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(body))));
    req.on("error", reject);
  });
}

function redirect(res, location) {
  res.writeHead(303, { location });
  res.end();
}

function renderLogin(error = "") {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>登录 - 自动化控制台</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; min-height: 100vh; background: radial-gradient(circle at top left, #e0f2fe 0, transparent 30rem), #f3f5f7; color: #111827; }
    main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .login { width: min(920px, 100%); display: grid; grid-template-columns: 1fr 420px; border: 1px solid #dbe4ef; border-radius: 8px; overflow: hidden; background: rgba(255,255,255,.92); box-shadow: 0 20px 60px rgba(15, 23, 42, .12); }
    .intro { background: #0b1220; color: #dbeafe; padding: 34px; min-height: 420px; display: flex; flex-direction: column; justify-content: space-between; }
    .logo { width: 44px; height: 44px; border-radius: 8px; display: grid; place-items: center; color: #ecfeff; background: linear-gradient(135deg, #0891b2, #1d4ed8); font-weight: 800; margin-bottom: 18px; }
    .intro h1 { margin: 0; font-size: 34px; line-height: 1.15; }
    .intro p { color: #94a3b8; line-height: 1.7; }
    .panel { padding: 34px; display: flex; flex-direction: column; justify-content: center; }
    .panel h2 { margin: 0 0 10px; font-size: 24px; }
    label { display: block; font-size: 13px; color: #475569; margin: 18px 0 7px; }
    input { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; font: inherit; background: #fff; }
    button { width: 100%; border: 1px solid #0f172a; border-radius: 8px; background: #0f172a; color: #fff; padding: 12px; font: inherit; cursor: pointer; margin-top: 16px; }
    button:hover { background: #1e293b; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .muted { color: #64748b; font-size: 13px; line-height: 1.6; }
    .path { padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; overflow-wrap: anywhere; }
    .error { color: #991b1b; background: #fee2e2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px; margin: 12px 0; }
    @media (max-width: 780px) { .login { grid-template-columns: 1fr; } .intro { min-height: 260px; } }
  </style>
</head>
<body>
<main>
  <div class="login">
    <section class="intro">
      <div>
        <div class="logo">AO</div>
        <h1>Agent Ops<br />自动化控制台</h1>
        <p>这里负责调度本地任务、收集运行日志、预览产物并做人工审核。</p>
      </div>
      <p>第一层由 Cloudflare Access 保护，第二层使用本机访问口令。</p>
    </section>
    <section class="panel">
      <h2>本地口令登录</h2>
      <p class="muted">请输入本机访问口令。口令保存在：</p>
      <p class="path"><code>${htmlEscape(AUTH_PATH)}</code></p>
      ${error ? `<div class="error">${htmlEscape(error)}</div>` : ""}
      <form method="post" action="/login">
        <label>访问口令</label>
        <input name="token" type="password" autofocus autocomplete="current-password" />
        <button type="submit">登录</button>
      </form>
    </section>
  </div>
</main>
</body>
</html>`;
}

async function serve() {
  const port = Number(process.env.PORT || 4179);
  await loadAuth();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      if (req.method === "GET" && url.pathname === "/login") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderLogin(url.searchParams.get("error") ? "口令不正确。" : ""));
        return;
      }
      if (req.method === "POST" && url.pathname === "/login") {
        const form = await parseFormBody(req);
        const auth = await loadAuth();
        if (safeEqual(form.token, auth.token)) {
          setSessionCookie(res, auth.token);
          redirect(res, "/");
          return;
        }
        redirect(res, "/login?error=1");
        return;
      }
      if (req.method === "POST" && url.pathname === "/logout") {
        clearSessionCookie(res);
        redirect(res, "/login");
        return;
      }
      if (!(await isAuthenticated(req))) {
        redirect(res, "/login");
        return;
      }
      if (req.method === "POST" && url.pathname === "/run") {
        const form = await parseFormBody(req);
        await runOne(form.taskId);
        redirect(res, "/");
        return;
      }
      if (req.method === "POST" && url.pathname === "/run-due") {
        await runDue();
        redirect(res, "/");
        return;
      }
      if (req.method === "POST" && url.pathname === "/review") {
        const form = await parseFormBody(req);
        await reviewRun(form.runId, form.status);
        redirect(res, `/run?id=${encodeURIComponent(form.runId)}`);
        return;
      }
      if (req.method === "POST" && url.pathname === "/task") {
        const form = await parseFormBody(req);
        await updateTaskConfig(form.taskId, form);
        redirect(res, `/task?id=${encodeURIComponent(form.taskId)}`);
        return;
      }
      if (req.method === "GET" && url.pathname === "/run") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(await renderRunDetail(url.searchParams.get("id")));
        return;
      }
      if (req.method === "GET" && url.pathname === "/task") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(await renderTaskDetail(url.searchParams.get("id")));
        return;
      }
      if (req.method === "GET" && url.pathname === "/artifact") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(await renderArtifactDetail(url.searchParams.get("run"), url.searchParams.get("name")));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(await renderDashboard());
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(error.stack || String(error));
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`自动化控制台: http://127.0.0.1:${port}`);
  });
}

async function renderHtmlFile() {
  const file = path.join(ROOT, "data", "dashboard.html");
  await writeFile(file, await renderDashboard());
  console.log(file);
}

const [command, arg, arg2] = process.argv.slice(2);
try {
  if (command === "list") await listTasks();
  else if (command === "run") await runOne(arg);
  else if (command === "run-due") await runDue();
  else if (command === "review") await reviewRun(arg, arg2);
  else if (command === "render-html") await renderHtmlFile();
  else if (command === "serve") await serve();
  else {
    console.log("Usage: node scripts/agent-ops.mjs <list|run TASK_ID|run-due|review RUN_ID STATUS|render-html|serve>");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.stack || String(error));
  process.exitCode = 1;
}
