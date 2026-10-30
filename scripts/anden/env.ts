import { readFileSync } from 'node:fs';

// Loads ANDEN_LLM_* from .env.local for the CLI scripts. The Next app does not
// need this: it reads .env.local on its own.
export function loadEnv(file = process.env.ANDEN_LLM_ENV ?? `${process.cwd()}/.env.local`): void {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key]) continue;
    process.env[key] = value.replace(/^["']|["']$/g, '').trim();
  }
}
