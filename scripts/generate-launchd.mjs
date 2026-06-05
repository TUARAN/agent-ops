import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(path.join(ROOT, "config", "tasks.json"), "utf8")));
const outDir = path.join(ROOT, "data", "launchd");
await mkdir(outDir, { recursive: true });

function plistForTask(task) {
  const schedule = task.schedule || {};
  const [hour, minute] = String(schedule.time || "03:00").split(":").map(Number);
  const calendar = [`<key>Hour</key><integer>${hour}</integer>`, `<key>Minute</key><integer>${minute}</integer>`];
  if (schedule.kind === "weekly" && schedule.day) {
    const days = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6
    };
    calendar.push(`<key>Weekday</key><integer>${days[String(schedule.day).toLowerCase()] ?? 1}</integer>`);
  }
  const label = `local.agent-ops.${task.id}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>npm</string>
    <string>run</string>
    <string>run</string>
    <string>--</string>
    <string>${task.id}</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>StartCalendarInterval</key>
  <dict>
    ${calendar.join("\n    ")}
  </dict>
  <key>StandardOutPath</key><string>${ROOT}/data/launchd/${task.id}.out.log</string>
  <key>StandardErrorPath</key><string>${ROOT}/data/launchd/${task.id}.err.log</string>
</dict>
</plist>
`;
}

for (const task of config.tasks || []) {
  if (!task.enabled) continue;
  const file = path.join(outDir, `local.agent-ops.${task.id}.plist`);
  await writeFile(file, plistForTask(task));
  console.log(file);
}
