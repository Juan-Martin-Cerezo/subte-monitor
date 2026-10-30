import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tokenize } from './tokenize';

export interface RetrievedSource {
  id: string;
  title: string;
  text: string;
  source: string;
  score: number;
}

interface CorpusEntry {
  id: string;
  title: string;
  text: string;
  source: string;
}

interface IndexedDoc extends CorpusEntry {
  tokens: string[];
  titleTokens: string[];
  termFrequency: Map<string, number>;
  length: number;
}

interface CorpusIndex {
  key: string;
  docs: IndexedDoc[];
  documentFrequency: Map<string, number>;
  averageLength: number;
}

const CORPUS_DIR = path.join(process.cwd(), 'data', 'corpus');
const FILES = ['knowledge.jsonl', 'alerts.jsonl', 'docs.jsonl'].map((name) => path.join(CORPUS_DIR, name));
const K1 = 1.5;
const B = 0.75;

let cached: CorpusIndex | null = null;
let building: Promise<CorpusIndex> | null = null;

function fileKey(files: string[]): Promise<string> {
  return Promise.all(
    files.map(async (file) => {
      try {
        const stat = await fs.stat(file);
        return `${stat.mtimeMs}:${stat.size}`;
      } catch {
        return 'missing';
      }
    }),
  ).then((parts) => parts.join('|'));
}

async function readEntries(file: string): Promise<CorpusEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return [];
  }

  return raw
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        const entry = JSON.parse(line) as Partial<CorpusEntry>;
        return typeof entry.id === 'string' && typeof entry.text === 'string' ? [entry as CorpusEntry] : [];
      } catch {
        return [];
      }
    });
}

async function buildIndex(key: string): Promise<CorpusIndex> {
  const docs: IndexedDoc[] = [];
  const documentFrequency = new Map<string, number>();
  const seen = new Set<string>();
  let totalLength = 0;

  for (const file of FILES) {
    for (const entry of await readEntries(file)) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);

      const titleTokens = tokenize(entry.title ?? '');
      const textTokens = tokenize(entry.text);
      // title terms count twice in both frequency and length
      const tokens = [...titleTokens, ...titleTokens, ...textTokens];
      const termFrequency = new Map<string, number>();
      for (const token of tokens) termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
      for (const token of termFrequency.keys()) {
        documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
      }

      docs.push({ ...entry, tokens, titleTokens, termFrequency, length: tokens.length });
      totalLength += tokens.length;
    }
  }

  return {
    key,
    docs,
    documentFrequency,
    averageLength: docs.length ? totalLength / docs.length : 0,
  };
}

async function getIndex(): Promise<CorpusIndex> {
  const key = await fileKey(FILES);
  if (cached?.key === key) return cached;

  if (!building) {
    building = buildIndex(key).finally(() => {
      building = null;
    });
  }

  cached = await building;
  return cached;
}

function phraseScore(queryTokens: string[], doc: IndexedDoc): number {
  let score = 0;
  if (queryTokens.length > 1) {
    const title = doc.titleTokens.join(' ');
    const text = doc.tokens.join(' ');
    const phrase = queryTokens.join(' ');
    if (title.includes(phrase)) score += 4;
    if (text.includes(phrase)) score += 2;

    const seen = new Set<string>();
    for (let i = 0; i < queryTokens.length - 1; i += 1) {
      const bigram = `${queryTokens[i]} ${queryTokens[i + 1]}`;
      if (seen.has(bigram)) continue;
      seen.add(bigram);
      if (text.includes(bigram)) score += 0.3;
    }
  }
  return Math.min(score, 5);
}

export async function search(query: string, k = 6): Promise<RetrievedSource[]> {
  const queryTokens = [...new Set(tokenize(query))];
  if (!queryTokens.length) return [];

  const index = await getIndex();
  const total = index.docs.length;
  if (!total) return [];

  const scored = index.docs.map((doc) => {
    let score = 0;
    for (const token of queryTokens) {
      const frequency = doc.termFrequency.get(token);
      if (!frequency) continue;

      const df = index.documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      const denominator = frequency + K1 * (1 - B + (B * doc.length) / index.averageLength);
      score += idf * ((frequency * (K1 + 1)) / denominator);
    }
    score += phraseScore(queryTokens, doc);
    return { doc, score };
  });

  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ doc, score }) => ({
      id: doc.id,
      title: doc.title,
      text: doc.text,
      source: doc.source,
      score: Number(score.toFixed(4)),
    }));
}
