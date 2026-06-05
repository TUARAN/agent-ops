import path from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileMeta, markdownTable, repoPath, walkFiles, writeArtifact, writeJsonArtifact } from "./lib.mjs";

const metricsRoot = repoPath("blogger-alliance", "tmp", "metrics");
const files = await walkFiles(metricsRoot, (file) => /\.(md|json|csv|tsv)$/i.test(file));
const metas = (await Promise.all(files.map(fileMeta))).sort((a, b) => b.mtimeMs - a.mtimeMs);

const rows = [];
const highlights = [];
for (const meta of metas.slice(0, 20)) {
  let kind = path.extname(meta.path).slice(1).toLowerCase();
  let signal = "";
  if (kind === "md") {
    const text = await readFile(meta.path, "utf8");
    signal = text.split("\n").find((line) => /^#{1,3}\s+/.test(line))?.replace(/^#+\s+/, "") || "markdown report";
    highlights.push({ file: meta.path, title: signal });
  } else if (kind === "json" && existsSync(meta.path)) {
    try {
      const data = JSON.parse(await readFile(meta.path, "utf8"));
      signal = Array.isArray(data) ? `${data.length} records` : `${Object.keys(data).length} keys`;
    } catch {
      signal = "json parse failed";
    }
  } else {
    const text = await readFile(meta.path, "utf8");
    signal = `${Math.max(0, text.trim().split(/\r?\n/).length - 1)} data rows`;
  }
  rows.push([meta.basename, kind, signal, meta.mtime]);
}

const report = `# Blogger Alliance Metrics Report

Status: pending_review

This run summarizes existing local metric exports. The next evolution should call \`npm run metrics:collect\` with a reviewed links file, then store fresh results here.

${markdownTable(["File", "Type", "Signal", "Updated"], rows)}

## Suggested Actions

- Pick the newest report and convert it into a client-facing summary.
- Refresh \`tmp/metrics/links.csv\` before the next weekly collection.
- Add campaign name, platform, author, publish date, reads, likes, comments, saves, and source URL as normalized fields.
`;

await writeJsonArtifact("blogger-metrics-summary.json", {
  generatedAt: new Date().toISOString(),
  metricsRoot,
  files: metas,
  highlights
});
await writeArtifact("blogger-metrics-summary.md", report);
console.log(`Summarized ${metas.length} metric files.`);
