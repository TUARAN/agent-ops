import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const runDir = process.env.AGENT_OPS_RUN_DIR || process.cwd();

export async function writeArtifact(name, content) {
  await mkdir(runDir, { recursive: true });
  const file = path.join(runDir, name);
  await writeFile(file, content);
  return file;
}

export async function writeJsonArtifact(name, data) {
  return writeArtifact(name, `${JSON.stringify(data, null, 2)}\n`);
}

export async function walkFiles(root, predicate, limit = 10000) {
  const out = [];
  async function walk(dir) {
    if (out.length >= limit) return;
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (!predicate || predicate(full)) out.push(full);
      if (out.length >= limit) return;
    }
  }
  await walk(root);
  return out;
}

export async function fileSummary(file, maxChars = 600) {
  const text = await readFile(file, "utf8");
  const title = text.match(/^#\s+(.+)$/m)?.[1] || path.basename(file);
  const body = text
    .replace(/^---[\s\S]*?---/, "")
    .replace(/^#\s+.+$/m, "")
    .trim()
    .replace(/\s+/g, " ");
  return {
    title,
    excerpt: body.slice(0, maxChars),
    chars: text.length
  };
}

export async function fileMeta(file) {
  const info = await stat(file);
  return {
    path: file,
    basename: path.basename(file),
    mtimeMs: info.mtimeMs,
    mtime: info.mtime.toISOString(),
    size: info.size
  };
}

export function markdownTable(headers, rows) {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replaceAll("\n", " ")).join(" | ")} |`);
  return [head, sep, ...body].join("\n");
}

export function repoPath(...parts) {
  return path.join("/Users/tuaran/Documents/GitHub", ...parts);
}
