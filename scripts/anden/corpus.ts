import { promises as fs } from "node:fs";
import path from "node:path";

export const ROOT = process.cwd();
export const CORPUS_DIR = path.join(ROOT, "data", "corpus");
export const KNOWLEDGE_PATH = path.join(CORPUS_DIR, "knowledge.jsonl");
export const ALERTS_PATH = path.join(CORPUS_DIR, "alerts.jsonl");
export const DOCS_PATH = path.join(CORPUS_DIR, "docs.jsonl");
export const LABELS_PATH = path.join(CORPUS_DIR, "labels.jsonl");

export type Kind = "knowledge" | "alert" | "doc";

export interface CorpusEntry {
  id: string;
  title: string;
  text: string;
  source: string;
  kind: Kind;
  first_seen?: string;
  last_seen?: string;
}

export async function readJsonl<T>(file: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        throw new Error(`${path.relative(ROOT, file)}:${index + 1} is not valid JSON`);
      }
    });
}

export async function writeJsonl(file: string, entries: CorpusEntry[]): Promise<void> {
  const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
  const tmp = `${file}.${process.pid}.tmp`;

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, entries.length ? `${body}\n` : "", "utf8");
  await fs.rename(tmp, file);
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface Section {
  level: number;
  title: string;
  path: string[];
  body: string;
}

interface Candidate {
  title: string;
  prefix: string;
  body: string;
}

function parseSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let stack: string[] = [];
  let current: Section | null = null;
  let inFence = false;

  const flush = () => {
    if (!current) return;
    current.body = current.body.trim();
    if (current.body) sections.push(current);
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;

    const heading = inFence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      const title = heading[2].trim();
      stack = [...stack.slice(0, level - 1), title];
      current = { level, title, path: stack, body: "" };
      continue;
    }

    if (current) current.body += `${line}\n`;
  }

  flush();
  return sections;
}

function hardSplit(text: string, max: number): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += max) pieces.push(text.slice(i, i + max));
  return pieces;
}

// split into near-equal pieces so the final piece is not a short leftover
function splitBalanced(body: string, budget: number): string[] {
  const text = body.trim();
  if (!text) return [];
  if (text.length <= budget) return [text];

  const count = Math.ceil(text.length / budget);
  const target = Math.ceil(text.length / count);
  const units: string[] = [];

  for (const paragraph of text.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    for (const sentence of trimmed.split(/(?<=[.!?])\s+/)) {
      const unit = sentence.trim();
      if (!unit) continue;
      if (unit.length > budget) units.push(...hardSplit(unit, budget));
      else units.push(unit);
    }
  }

  const pieces: string[] = [];
  let buffer = "";

  for (const unit of units) {
    if (buffer && buffer.length + 1 + unit.length > budget) {
      pieces.push(buffer);
      buffer = "";
    }
    buffer = buffer ? `${buffer} ${unit}` : unit;
    if (buffer.length >= target) {
      pieces.push(buffer);
      buffer = "";
    }
  }

  if (buffer) pieces.push(buffer);
  return pieces;
}

function rebalance(pieces: string[], budget: number): string[] {
  const out: string[] = [];
  for (const piece of pieces) {
    if (piece.length < 300 && out.length) {
      const merged = `${out[out.length - 1]} ${piece}`;
      if (merged.length <= budget) {
        out[out.length - 1] = merged;
        continue;
      }
      const cutAt = Math.max(merged.lastIndexOf(" ", Math.ceil(merged.length / 2)), 200);
      out[out.length - 1] = merged.slice(0, cutAt).trim();
      out.push(merged.slice(cutAt).trim());
      continue;
    }
    out.push(piece);
  }
  return out.filter(Boolean);
}

function chunkText(candidate: Candidate): string {
  return `${candidate.prefix}\n${candidate.body}`.trim();
}

function appendCandidate(target: Candidate, next: Candidate): string {
  const addition = next.prefix === target.prefix ? next.body : `${next.title}\n${next.body}`;
  return `${target.body}\n\n${addition}`.trim();
}

function mergeShort(candidates: Candidate[], min = 300, max = 900): Candidate[] {
  const out: Candidate[] = [];

  for (const candidate of candidates) {
    const last = out[out.length - 1];
    if (last && chunkText(last).length < min) {
      const body = appendCandidate(last, candidate);
      if (chunkText({ ...last, body }).length <= max) {
        last.body = body;
        continue;
      }
    }
    out.push({ ...candidate });
  }

  for (let i = out.length - 1; i >= 0; i -= 1) {
    if (chunkText(out[i]).length >= min) continue;

    if (i > 0) {
      const body = appendCandidate(out[i - 1], out[i]);
      if (chunkText({ ...out[i - 1], body }).length <= max) {
        out[i - 1].body = body;
        out.splice(i, 1);
        continue;
      }
    }

    if (i + 1 < out.length) {
      const body = appendCandidate(out[i], out[i + 1]);
      const merged = { ...out[i], body };
      if (chunkText(merged).length <= max) {
        out[i] = merged;
        out.splice(i + 1, 1);
      } else {
        const half = Math.ceil(body.length / 2);
        const cut = Math.max(body.lastIndexOf(" ", half), Math.ceil(body.length / 3));
        out.splice(
          i,
          2,
          { ...out[i], body: body.slice(0, cut).trim() },
          { ...out[i], body: body.slice(cut).trim() }
        );
      }
    }
  }

  return out;
}

async function markdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

async function docSources(): Promise<string[]> {
  const rootDocs = ["README.md", "ARCHITECTURE.md"].map((name) => path.join(ROOT, name));
  const nested = await markdownFiles(path.join(ROOT, "docs"));
  return [...rootDocs, ...nested].map((file) => path.relative(ROOT, file));
}

export async function buildDocChunks(): Promise<CorpusEntry[]> {
  const chunks: CorpusEntry[] = [];
  const used = new Set<string>();

  for (const relative of await docSources()) {
    const markdown = await fs.readFile(path.join(ROOT, relative), "utf8");
    const fileSlug = relative
      .replace(/\.md$/, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .toLowerCase();
    const candidates: Candidate[] = [];

    for (const section of parseSections(markdown)) {
      const prefix = section.path.join(" > ");
      const budget = Math.max(200, 900 - prefix.length - 1);
      const pieces = rebalance(splitBalanced(section.body, budget), budget);

      for (const piece of pieces) {
        candidates.push({ title: section.title, prefix, body: piece });
      }
    }

    for (const candidate of mergeShort(candidates)) {
      const text = chunkText(candidate);
      if (text.length < 80) continue;

      const base = `doc:${fileSlug}-${slug(candidate.title)}`.slice(0, 70).replace(/-+$/, "");
      let id = base;
      let suffix = 2;
      while (used.has(id)) id = `${base}-${suffix++}`;
      used.add(id);

      chunks.push({
        id,
        title: candidate.title,
        text,
        source: `repo:${relative}#${slug(candidate.title)}`,
        kind: "doc",
      });
    }
  }

  return chunks;
}
