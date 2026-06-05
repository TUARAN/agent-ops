import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { markdownTable, repoPath, walkFiles, writeArtifact, writeJsonArtifact } from "./lib.mjs";

const root = repoPath("EmployeeHub");

function execCapture(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const [status, branch, packageJsonText] = await Promise.all([
  execCapture("git", ["status", "--short"], root),
  execCapture("git", ["branch", "--show-current"], root),
  readFile(path.join(root, "package.json"), "utf8")
]);

const packageJson = JSON.parse(packageJsonText);
const agentReadmes = await walkFiles(path.join(root, "agents"), (file) => file.endsWith("README.md"));
const docs = await walkFiles(path.join(root, "docs"), (file) => file.endsWith(".md"));

const dirtyLines = status.stdout.trim() ? status.stdout.trim().split("\n") : [];
const agentSummaries = [];
for (const file of agentReadmes) {
  const text = await readFile(file, "utf8");
  agentSummaries.push({
    agent: path.basename(path.dirname(file)),
    file,
    title: text.match(/^#\s+(.+)$/m)?.[1] || path.basename(path.dirname(file)),
    lines: text.trim().split(/\r?\n/).length
  });
}

const safeEvolutionTasks = [
  {
    priority: "P0",
    task: "Define stable Task/Artifact schemas for each existing agent",
    reason: "Expert agents need predictable IO before they can run unattended."
  },
  {
    priority: "P0",
    task: "Add run ledger and artifact viewer to desktop app",
    reason: "Business users need evidence, not raw logs."
  },
  {
    priority: "P1",
    task: "Create a scenario template for audit reconciliation",
    reason: "Auditor is the clearest business wedge and can produce reviewable reports."
  },
  {
    priority: "P1",
    task: "Add router policy tests for task type and sensitivity",
    reason: "Routing mistakes are expensive once agents touch business data."
  },
  {
    priority: "P2",
    task: "Add nightly architecture drift report",
    reason: "The repo is moving fast and needs guardrails before autonomous edits."
  }
];

const report = `# EmployeeHub Evolution Triage

Status: pending_review

Branch: \`${branch.stdout.trim() || "unknown"}\`

Dirty files: ${dirtyLines.length}

## Agents

${markdownTable(["Agent", "Title", "README"], agentSummaries.map((item) => [item.agent, item.title, item.file]))}

## Available Root Scripts

${markdownTable(["Script"], Object.keys(packageJson.scripts || {}).map((script) => [script]))}

## Safe Evolution Backlog

${markdownTable(["Priority", "Task", "Reason"], safeEvolutionTasks.map((item) => [item.priority, item.task, item.reason]))}

## Working Tree Notes

\`\`\`text
${dirtyLines.slice(0, 80).join("\n") || "clean"}
\`\`\`

## Recommendation

Do not let unattended jobs edit this repo while dirty files exist. Use this task to create a reviewable backlog, then run implementation in an isolated branch or worktree.
`;

await writeJsonArtifact("employeehub-triage.json", {
  generatedAt: new Date().toISOString(),
  root,
  branch: branch.stdout.trim(),
  dirtyFiles: dirtyLines,
  scripts: Object.keys(packageJson.scripts || {}),
  agentSummaries,
  docs,
  safeEvolutionTasks
});
await writeArtifact("employeehub-triage.md", report);
console.log(`EmployeeHub dirty files: ${dirtyLines.length}`);
console.log(`EmployeeHub agents: ${agentSummaries.map((item) => item.agent).join(", ")}`);
