import type { Bootstrap, Telemetry } from './types.ts';

const DEFAULT_BASE = 'https://subte-monitor.vercel.app';
const TIMEOUT_MS = 12000;
const BOOTSTRAP_TTL_MS = 10 * 60 * 1000;

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

function env(name: string): string | undefined {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return runtime.process?.env?.[name];
}

function baseUrl(): string {
  return (env('SUBTE_API_BASE')?.trim() || DEFAULT_BASE).replace(/\/+$/, '');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(path: string): Promise<unknown> {
  const base = baseUrl();

  let parsed: URL;
  try {
    parsed = new URL(`${base}${path}`);
  } catch {
    throw new ApiError(`SUBTE_API_BASE is not a valid URL: ${base}`);
  }

  let response: Response | null = null;
  let lastNetworkError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetchWithTimeout(parsed.toString());
      break;
    } catch (error) {
      lastNetworkError = error;
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  if (!response) {
    if (isAbortError(lastNetworkError)) {
      throw new ApiError(`timed out after ${TIMEOUT_MS / 1000}s requesting ${path} from ${base}`);
    }
    const detail = lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError);
    throw new ApiError(`could not reach the subway API at ${base} (${detail}). Check the network or SUBTE_API_BASE.`);
  }

  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      throw new ApiError(`subway API rejected ${path} with HTTP ${response.status}`);
    }
    throw new ApiError(`subway API is failing on ${path} with HTTP ${response.status}`);
  }

  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new ApiError(`subway API returned invalid JSON for ${path}`);
  }
}

let bootstrapCache: { data: Bootstrap; expiresAt: number } | null = null;

export async function getBootstrap(): Promise<Bootstrap> {
  if (bootstrapCache && bootstrapCache.expiresAt > Date.now()) {
    return bootstrapCache.data;
  }

  const raw = (await getJson('/api/bootstrap')) as Bootstrap & { error?: string };
  if (!Array.isArray(raw?.stations) || !Array.isArray(raw?.sequences)) {
    throw new ApiError('subway API returned an unexpected bootstrap payload');
  }
  if (raw.error) {
    throw new ApiError(`subway API could not load reference data: ${raw.error}`);
  }

  bootstrapCache = { data: raw, expiresAt: Date.now() + BOOTSTRAP_TTL_MS };
  return raw;
}

export async function getTelemetry(): Promise<Telemetry> {
  const raw = (await getJson('/api/telemetry')) as Telemetry;
  if (!Array.isArray(raw?.trains) || !Array.isArray(raw?.alerts) || !Array.isArray(raw?.predictions)) {
    throw new ApiError('subway API returned an unexpected telemetry payload');
  }
  return raw;
}
