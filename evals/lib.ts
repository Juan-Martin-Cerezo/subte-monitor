import { promises as fs } from "node:fs";
import path from "node:path";

export const ROOT = process.cwd();
export const EVALS_DIR = path.join(ROOT, "evals");
export const CASES_PATH = path.join(EVALS_DIR, "cases.jsonl");
export const CONFIG_PATH = path.join(EVALS_DIR, "config.json");
export const RESULTS_PATH = path.join(EVALS_DIR, "results", "latest.json");
export const README_PATH = path.join(ROOT, "README.md");

export const CATEGORIES = [
  "tool_selection",
  "trip_planning",
  "retrieval_citation",
  "abstain",
  "memory",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_COUNTS: Record<Category, number> = {
  tool_selection: 15,
  trip_planning: 10,
  retrieval_citation: 10,
  abstain: 10,
  memory: 5,
};

export const TOTAL_CASES = 50;

export type FactValue = string | number | boolean;

export interface EvalExpect {
  tool?: string;
  first?: boolean;
  no_tool?: boolean;
  args_contains?: Record<string, FactValue>;
  cites?: string[];
  abstained?: boolean;
  uses_fact?: string;
}

export interface EvalCase {
  id: string;
  category: Category;
  question: string;
  user_facts?: Record<string, FactValue>;
  expect: EvalExpect;
  notes: string;
}

export interface EvalConfig {
  currency: string;
  input_per_1m: number;
  output_per_1m: number;
  max_cost_usd: number;
  assumption: string;
}

async function readJsonl<T>(file: string): Promise<T[]> {
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
    .flatMap((line, index) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        throw new Error(`${path.relative(ROOT, file)}:${index + 1} is not valid JSON`);
      }
    });
}

export async function loadCases(file = CASES_PATH): Promise<EvalCase[]> {
  return readJsonl<EvalCase>(file);
}

export async function loadConfig(file = CONFIG_PATH): Promise<EvalConfig> {
  const raw = await fs.readFile(file, "utf8");
  const config = JSON.parse(raw) as EvalConfig;
  for (const key of ["input_per_1m", "output_per_1m", "max_cost_usd"] as const) {
    if (typeof config[key] !== "number" || !Number.isFinite(config[key]) || config[key] < 0) {
      throw new Error(`${path.relative(ROOT, file)}: ${key} must be a non-negative number`);
    }
  }
  return config;
}

export function extractCitations(answer: string): string[] {
  const found: string[] = [];
  const pattern = /\[([^[\]\n]{1,120})\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(answer)) !== null) {
    const id = match[1].trim();
    if (id.includes(":")) found.push(id);
  }
  return [...new Set(found)];
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? 0;
}

export function costOf(
  usage: { prompt_tokens?: number; completion_tokens?: number },
  config: EvalConfig
): number {
  const input = ((usage.prompt_tokens ?? 0) / 1_000_000) * config.input_per_1m;
  const output = ((usage.completion_tokens ?? 0) / 1_000_000) * config.output_per_1m;
  return Number((input + output).toFixed(6));
}

export function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}
