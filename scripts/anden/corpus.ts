import { promises as fs } from 'node:fs';
import path from 'node:path';

export const ROOT = process.cwd();
export const CORPUS_DIR = path.join(ROOT, 'data', 'corpus');
export const KNOWLEDGE_PATH = path.join(CORPUS_DIR, 'knowledge.jsonl');
export const ALERTS_PATH = path.join(CORPUS_DIR, 'alerts.jsonl');
export const DOCS_PATH = path.join(CORPUS_DIR, 'docs.jsonl');
export const LABELS_PATH = path.join(CORPUS_DIR, 'labels.jsonl');

export type Kind = 'knowledge' | 'alert' | 'doc';

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
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  return raw
    .split('\n')
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
  const body = entries.map((entry) => JSON.stringify(entry)).join('\n');
  const tmp = `${file}.${process.pid}.tmp`;

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, entries.length ? `${body}\n` : '', 'utf8');
  await fs.rename(tmp, file);
}

export function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface Section {
  level: number;
  title: string;
  path: string[];
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
      current = { level, title, path: stack, body: '' };
      continue;
    }

    if (current) current.body += `${line}\n`;
  }

  flush();
  return sections;
}

function splitSentences(paragraph: string, max: number): string[] {
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const pieces: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    if (buffer && buffer.length + 1 + sentence.length > max) {
      pieces.push(buffer);
      buffer = '';
    }
    if (sentence.length > max) {
      if (buffer) {
        pieces.push(buffer);
        buffer = '';
      }
      for (let i = 0; i < sentence.length; i += max) pieces.push(sentence.slice(i, i + max));
      continue;
    }
    buffer = buffer ? `${buffer} ${sentence}` : sentence;
  }

  if (buffer) pieces.push(buffer);
  return pieces;
}

function splitLong(body: string, max: number): string[] {
  const paragraphs = body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const pieces: string[] = [];
  let buffer = '';

  for (const paragraph of paragraphs) {
    if (buffer && buffer.length + 2 + paragraph.length > max) {
      pieces.push(buffer);
      buffer = '';
    }
    if (paragraph.length > max) {
      if (buffer) {
        pieces.push(buffer);
        buffer = '';
      }
      pieces.push(...splitSentences(paragraph, max));
      continue;
    }
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
  }

  if (buffer) pieces.push(buffer);
  return pieces;
}

async function markdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(full)));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

async function docSources(): Promise<string[]> {
  const rootDocs = ['README.md', 'ARCHITECTURE.md'].map((name) => path.join(ROOT, name));
  const nested = await markdownFiles(path.join(ROOT, 'docs'));
  return [...rootDocs, ...nested].map((file) => path.relative(ROOT, file));
}

export async function buildDocChunks(): Promise<CorpusEntry[]> {
  const chunks: CorpusEntry[] = [];
  const used = new Set<string>();

  for (const relative of await docSources()) {
    const markdown = await fs.readFile(path.join(ROOT, relative), 'utf8');
    const sections = parseSections(markdown);
    const fileSlug = relative.replace(/\.md$/, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();

    let index = 0;
    while (index < sections.length) {
      const first = sections[index];
      let body = first.body;

      // short sections borrow the next heading so chunks stay above 300 chars
      while (body.length < 300 && index + 1 < sections.length) {
        index += 1;
        body += `\n\n${sections[index].title}\n${sections[index].body}`;
      }

      const prefix = first.path.join(' > ');
      // the prefix counts toward the 900 char ceiling
      const budget = Math.max(200, 900 - prefix.length - 1);

      for (const piece of splitLong(body, budget)) {
        const text = `${prefix}\n${piece}`.trim();
        if (text.length < 80) continue;

        const base = `doc:${fileSlug}-${slug(first.title)}`.slice(0, 70).replace(/-+$/, '');
        let id = base;
        let suffix = 2;
        while (used.has(id)) id = `${base}-${suffix++}`;
        used.add(id);

        chunks.push({
          id,
          title: first.title,
          text,
          source: `repo:${relative}#${slug(first.title)}`,
          kind: 'doc',
        });
      }

      index += 1;
    }
  }

  return chunks;
}

export async function mtimeKey(files: string[]): Promise<string> {
  const parts = await Promise.all(
    files.map(async (file) => {
      try {
        const stat = await fs.stat(file);
        return `${stat.mtimeMs}:${stat.size}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
        throw error;
      }
    }),
  );
  return parts.join('|');
}
