import { neon } from '@neondatabase/serverless';
import type { AndenStore, Fact, FactKey, FactValue, Trace, TraceStep, TraceSummary, Turn } from './types';

interface FactRow {
  user_id: string;
  key: string;
  value: FactValue;
  updated_at: string;
  expires_at: string;
}

interface TurnRow {
  user_id: string;
  question: string;
  answer: string;
  created_at: string;
}

interface TraceRow {
  trace_id: string;
  user_id: string;
  question: string;
  steps: TraceStep[] | string;
  total_ms: number;
  tokens: number;
  cost_usd: number | string;
  ok: boolean;
  truncated: boolean;
  model: string;
  prompt_hash: string;
  params: string;
  created_at: string;
}

function parseSteps(raw: TraceStep[] | string): TraceStep[] {
  if (Array.isArray(raw)) return raw;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as TraceStep[]) : [];
  } catch {
    return [];
  }
}

function toTrace(row: TraceRow): Trace {
  return {
    traceId: row.trace_id,
    userId: row.user_id,
    question: row.question,
    steps: parseSteps(row.steps),
    totalMs: Number(row.total_ms),
    tokens: Number(row.tokens),
    costUsd: Number(row.cost_usd),
    ok: row.ok === true,
    truncated: row.truncated === true,
    model: row.model,
    promptHash: row.prompt_hash,
    params: row.params,
    createdAt: row.created_at,
  };
}

const TURN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TURNS = 8;
const MAX_TURN_TEXT = 500;

export class PostgresStore implements AndenStore {
  private readonly sql;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.sql = neon(connectionString);
  }

  async init(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.sql`CREATE TABLE IF NOT EXISTS anden_facts (
          user_id TEXT NOT NULL, key TEXT NOT NULL, value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
          PRIMARY KEY (user_id, key))`;
        await this.sql`CREATE TABLE IF NOT EXISTS anden_turns (
          id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, question TEXT NOT NULL,
          answer TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)`;
        await this.sql`CREATE INDEX IF NOT EXISTS anden_turns_user ON anden_turns (user_id, created_at DESC)`;
        await this.sql`CREATE TABLE IF NOT EXISTS anden_traces (
          trace_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, question TEXT NOT NULL,
          steps JSONB NOT NULL, total_ms INT NOT NULL, tokens INT NOT NULL,
          cost_usd DOUBLE PRECISION NOT NULL, ok BOOLEAN NOT NULL, truncated BOOLEAN NOT NULL,
          model TEXT NOT NULL, prompt_hash TEXT NOT NULL, params TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL)`;
        await this.sql`CREATE INDEX IF NOT EXISTS anden_traces_user ON anden_traces (user_id, created_at DESC)`;
      })();
    }
    return this.ready;
  }

  async putFact(fact: Fact): Promise<void> {
    await this.sql`INSERT INTO anden_facts (user_id, key, value, updated_at, expires_at)
      VALUES (${fact.userId}, ${fact.key}, ${JSON.stringify(fact.value)}::jsonb, ${fact.updatedAt}, ${fact.expiresAt})
      ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value,
        updated_at = excluded.updated_at, expires_at = excluded.expires_at`;
  }

  async listFacts(userId: string): Promise<Fact[]> {
    await this.sql`DELETE FROM anden_facts WHERE expires_at <= now()`;
    const rows = (await this.sql`SELECT user_id, key, value, updated_at, expires_at
      FROM anden_facts WHERE user_id = ${userId} ORDER BY key`) as unknown as FactRow[];
    return rows.map((row) => ({
      userId: row.user_id,
      key: row.key as FactKey,
      value: row.value,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    }));
  }

  async deleteFact(userId: string, key: string): Promise<boolean> {
    const rows = (await this.sql`DELETE FROM anden_facts WHERE user_id = ${userId} AND key = ${key}
      RETURNING key`) as unknown as { key: string }[];
    return rows.length > 0;
  }

  async deleteAll(userId: string): Promise<number> {
    const facts = (await this.sql`WITH removed AS (
        DELETE FROM anden_facts WHERE user_id = ${userId} RETURNING 1
      ) SELECT count(*)::int AS n FROM removed`) as unknown as { n: number }[];
    const turns = (await this.sql`WITH removed AS (
        DELETE FROM anden_turns WHERE user_id = ${userId} RETURNING 1
      ) SELECT count(*)::int AS n FROM removed`) as unknown as { n: number }[];
    return Number(facts[0]?.n ?? 0) + Number(turns[0]?.n ?? 0);
  }

  async putTurn(turn: Turn): Promise<void> {
    await this.sql`INSERT INTO anden_turns (user_id, question, answer, created_at)
      VALUES (${turn.userId}, ${turn.question.slice(0, MAX_TURN_TEXT)},
        ${turn.answer.slice(0, MAX_TURN_TEXT)}, ${turn.createdAt})`;
    await this.sql`DELETE FROM anden_turns WHERE user_id = ${turn.userId}
      AND created_at <= ${new Date(Date.now() - TURN_TTL_MS).toISOString()}`;
    await this.sql`DELETE FROM anden_turns WHERE user_id = ${turn.userId} AND id NOT IN (
      SELECT id FROM anden_turns WHERE user_id = ${turn.userId}
      ORDER BY created_at DESC, id DESC LIMIT ${MAX_TURNS})`;
  }

  async recentTurns(userId: string, n: number): Promise<Turn[]> {
    await this.sql`DELETE FROM anden_turns WHERE user_id = ${userId}
      AND created_at <= ${new Date(Date.now() - TURN_TTL_MS).toISOString()}`;
    const rows = (await this.sql`SELECT user_id, question, answer, created_at FROM (
        SELECT id, user_id, question, answer, created_at FROM anden_turns
        WHERE user_id = ${userId} ORDER BY created_at DESC, id DESC LIMIT ${Math.max(0, n)}
      ) recent ORDER BY created_at ASC, id ASC`) as unknown as TurnRow[];
    return rows.map((row) => ({
      userId: row.user_id,
      question: row.question,
      answer: row.answer,
      createdAt: row.created_at,
    }));
  }

  async putTrace(trace: Trace): Promise<void> {
    await this.sql`INSERT INTO anden_traces (
        trace_id, user_id, question, steps, total_ms, tokens, cost_usd, ok, truncated, model, prompt_hash, params, created_at
      ) VALUES (
        ${trace.traceId}, ${trace.userId}, ${trace.question}, ${JSON.stringify(trace.steps)}::jsonb,
        ${trace.totalMs}, ${trace.tokens}, ${trace.costUsd}, ${trace.ok}, ${trace.truncated},
        ${trace.model}, ${trace.promptHash}, ${trace.params}, ${trace.createdAt})
      ON CONFLICT (trace_id) DO UPDATE SET
        steps = excluded.steps, total_ms = excluded.total_ms, tokens = excluded.tokens,
        cost_usd = excluded.cost_usd, ok = excluded.ok, truncated = excluded.truncated,
        model = excluded.model, prompt_hash = excluded.prompt_hash, params = excluded.params`;
  }

  async getTrace(traceId: string): Promise<Trace | null> {
    const rows = (await this.sql`SELECT trace_id, user_id, question, steps, total_ms, tokens,
        cost_usd, ok, truncated, model, prompt_hash, params, created_at
      FROM anden_traces WHERE trace_id = ${traceId}`) as unknown as TraceRow[];
    return rows[0] ? toTrace(rows[0]) : null;
  }

  async recentTraces(userId: string, limit: number): Promise<TraceSummary[]> {
    const rows = (await this.sql`SELECT trace_id, question, steps, total_ms, tokens, cost_usd, ok, created_at
      FROM anden_traces WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT ${Math.max(1, limit)}`) as unknown as TraceRow[];
    return rows.map((row) => ({
      traceId: row.trace_id,
      question: row.question,
      steps: parseSteps(row.steps).filter((step) => step.kind !== 'plan').length,
      totalMs: Number(row.total_ms),
      tokens: Number(row.tokens),
      costUsd: Number(row.cost_usd),
      ok: row.ok === true,
      createdAt: row.created_at,
    }));
  }
}
