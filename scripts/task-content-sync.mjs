import path from "node:path";
import { fileMeta, fileSummary, markdownTable, repoPath, writeArtifact, writeJsonArtifact } from "./lib.mjs";
import { walkFiles } from "./lib.mjs";

const researchRoot = repoPath("tuaran-home-page", "research");
const files = await walkFiles(researchRoot, (file) => file.endsWith(".md"));
const metas = await Promise.all(files.map(fileMeta));
const recent = metas.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 12);

function titleFromFilename(file) {
  return path
    .basename(file, ".md")
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .split("-")
    .filter(Boolean)
    .join(" ");
}

const items = [];
for (const meta of recent) {
  const summary = await fileSummary(meta.path);
  const relative = path.relative(repoPath("tuaran-home-page"), meta.path);
  const segment = relative.includes("/companies/") ? "company" : "topic";
  const filenameTitle = titleFromFilename(meta.path);
  const headingTitle = summary.title && !summary.title.endsWith(".md") ? summary.title : "";
  const suggestedTitle = filenameTitle || headingTitle || path.basename(meta.path, ".md");
  const tags = segment === "company" ? ["企业案例", "技术营销", "潜客"] : ["技术研究", "长文", "观点"];
  items.push({
    sourcePath: meta.path,
    sourceRepo: "tuaran-home-page",
    target: "syncblog",
    status: "pending_review",
    segment,
    title: suggestedTitle,
    syncblogTitle: suggestedTitle.length > 34 ? suggestedTitle.slice(0, 34) : suggestedTitle,
    tags,
    excerpt: summary.excerpt,
    updatedAt: meta.mtime
  });
}

const rows = items.map((item, index) => [
  index + 1,
  item.segment,
  item.syncblogTitle,
  item.tags.join(", "),
  item.sourcePath
]);

const report = `# Research to Syncblog Queue

Status: pending_review

Scanned: ${researchRoot}

${markdownTable(["#", "Segment", "Title", "Tags", "Source"], rows)}

## Review Checklist

- Confirm title and platform angle.
- Confirm no private material should be distributed.
- Open the source article, then import the selected Markdown into Syncblog.
- Publish only after manual review.
`;

await writeJsonArtifact("syncblog-queue.json", { generatedAt: new Date().toISOString(), items });
await writeArtifact("syncblog-queue.md", report);
console.log(`Prepared ${items.length} Syncblog queue items.`);
