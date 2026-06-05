#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const home = process.env.HOME || "/Users/tuaran";
const configPath = path.join(home, ".cloudflared", "agent-ops.yml");

function checkCommand(command) {
  const result = spawnSync("zsh", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

async function exists(file) {
  try {
    await access(file, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

const cloudflaredPath = checkCommand("cloudflared");
console.log(`cloudflared: ${cloudflaredPath || "未安装"}`);

if (cloudflaredPath) {
  const version = spawnSync("cloudflared", ["--version"], { encoding: "utf8" });
  console.log((version.stdout || version.stderr || "").trim());
}

const hasConfig = await exists(configPath);
console.log(`配置文件: ${hasConfig ? configPath : "未创建 ~/.cloudflared/agent-ops.yml"}`);

if (hasConfig) {
  const config = await readFile(configPath, "utf8");
  const hasHost = config.includes("ops.2aran.com");
  const hasLocalService = config.includes("127.0.0.1:4179");
  const hasPlaceholder = config.includes("<TUNNEL_UUID>");
  console.log(`域名配置: ${hasHost ? "ok" : "缺失 ops.2aran.com"}`);
  console.log(`本地服务: ${hasLocalService ? "ok" : "缺失 127.0.0.1:4179"}`);
  console.log(`Tunnel UUID: ${hasPlaceholder ? "仍是占位符" : "已填写"}`);
}

const lsof = spawnSync("zsh", ["-lc", "lsof -iTCP:4179 -sTCP:LISTEN"], { encoding: "utf8" });
console.log(`Agent Ops 本地服务: ${lsof.status === 0 ? "运行中" : "未监听 4179"}`);
