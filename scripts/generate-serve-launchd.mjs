import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(ROOT, "data", "launchd");
await mkdir(outDir, { recursive: true });

const file = path.join(outDir, "local.agent-ops.serve.plist");
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.agent-ops.serve</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/tuaran/.local/bin/node</string>
    <string>${ROOT}/scripts/agent-ops.mjs</string>
    <string>serve</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${ROOT}/data/launchd/serve.out.log</string>
  <key>StandardErrorPath</key><string>${ROOT}/data/launchd/serve.err.log</string>
</dict>
</plist>
`;

await writeFile(file, plist);
console.log(file);
