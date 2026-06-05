import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(ROOT, "data", "launchd");
await mkdir(outDir, { recursive: true });

const file = path.join(outDir, "local.agent-ops.tunnel.plist");
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.agent-ops.tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/cloudflared</string>
    <string>tunnel</string>
    <string>--config</string>
    <string>/Users/tuaran/.cloudflared/agent-ops.yml</string>
    <string>run</string>
    <string>agent-ops</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${ROOT}/data/launchd/tunnel.out.log</string>
  <key>StandardErrorPath</key><string>${ROOT}/data/launchd/tunnel.err.log</string>
</dict>
</plist>
`;

await writeFile(file, plist);
console.log(file);
