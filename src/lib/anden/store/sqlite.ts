import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AndenStore,
  Fact,
  FactKey,
  FactValue,
  Trace,
  TraceStep,
  TraceSummary,
  Turn,
} from "./types";

const DEFAULT_DB_PATH = path.join(process.cwd(), ".anden", "anden.db");
const TURN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TURNS = 8;
const MAX_TURN_TEXT = 500;

interface FactRow {
  user_id: string;
  key: string;
  value: string;
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
  steps: string;
  total_ms: number;
  tokens: number;
  cost_usd: number;
  ok: number;
  truncated: number;
  model: string;
  prompt_hash: string;
  params: string;
  created_at: string;
}

function parseValue(raw: string): FactValue {
  return JSON.parse(raw) as FactValue;
}

function parseSteps(raw: string): TraceStep[] {
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
    totalMs: row.total_ms,
    tokens: row.tokens,
    costUsd: row.cost_usd,
    ok: row.ok === 1,
    truncated: row.truncated === 1,
    model: row.model,
    promptHash: row.prompt_hash,
    params: row.params,
    createdAt: row.created_at,
  };
}

export class SqliteStore implements AndenStore {
  private readonly file: string;
  private db: DatabaseSync | null = null;

  constructor(file = DEFAULT_DB_PATH) {
    this.file = file;
  }

  async init(): Promise<void> {
    if (this.db) return;

    mkdirSync(path.dirname(this.file), { recursive: true });
    const db = new DatabaseSync(this.file);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS anden_facts (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      );
      CREATE TABLE IF NOT EXISTS anden_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS anden_turns_user ON anden_turns (user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS anden_traces (
        trace_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        question TEXT NOT NULL,
        steps TEXT NOT NULL,
        total_ms INTEGER NOT NULL,
        tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        ok INTEGER NOT NULL,
        truncated INTEGER NOT NULL,
        model TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        params TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS anden_traces_user ON anden_traces (user_id, created_at DESC);
    `);
    this.db = db;
  }

  private conn(): DatabaseSync {
    if (!this.db) throw new Error("sqlite store not initialized");
    return this.db;
  }

  async putFact(fact: Fact): Promise<void> {
    this.conn()
      .prepare(
        `INSERT INTO anden_facts (user_id, key, value, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`
      )
      .run(fact.userId, fact.key, JSON.stringify(fact.value), fact.updatedAt, fact.expiresAt);
  }

  async listFacts(userId: string): Promise<Fact[]> {
    const db = this.conn();
    db.prepare("DELETE FROM anden_facts WHERE expires_at <= ?").run(new Date().toISOString());

    const rows = db
      .prepare(
        `SELECT user_id, key, value, updated_at, expires_at
         FROM anden_facts WHERE user_id = ? ORDER BY key`
      )
      .all(userId) as unknown as FactRow[];

    return rows.map((row) => ({
      userId: row.user_id,
      key: row.key as FactKey,
      value: parseValue(row.value),
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    }));
  }

  async deleteFact(userId: string, key: string): Promise<boolean> {
    const result = this.conn()
      .prepare("DELETE FROM anden_facts WHERE user_id = ? AND key = ?")
      .run(userId, key);
    return Number(result.changes) > 0;
  }

  async deleteAll(userId: string): Promise<number> {
    const db = this.conn();
    const facts = Number(
      db.prepare("SELECT COUNT(*) AS n FROM anden_facts WHERE user_id = ?").get(userId)?.n ?? 0
    );
    const turns = Number(
      db.prepare("SELECT COUNT(*) AS n FROM anden_turns WHERE user_id = ?").get(userId)?.n ?? 0
    );
    db.prepare("DELETE FROM anden_facts WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM anden_turns WHERE user_id = ?").run(userId);
    return facts + turns;
  }

  async putTurn(turn: Turn): Promise<void> {
    const db = this.conn();
    db.prepare(
      "INSERT INTO anden_turns (user_id, question, answer, created_at) VALUES (?, ?, ?, ?)"
    ).run(
      turn.userId,
      turn.question.slice(0, MAX_TURN_TEXT),
      turn.answer.slice(0, MAX_TURN_TEXT),
      turn.createdAt
    );
    db.prepare("DELETE FROM anden_turns WHERE user_id = ? AND created_at <= ?").run(
      turn.userId,
      new Date(Date.now() - TURN_TTL_MS).toISOString()
    );
    db.prepare(
      `DELETE FROM anden_turns WHERE user_id = ? AND id NOT IN (
         SELECT id FROM anden_turns WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
       )`
    ).run(turn.userId, turn.userId, MAX_TURNS);
  }

  async recentTurns(userId: string, n: number): Promise<Turn[]> {
    const db = this.conn();
    db.prepare("DELETE FROM anden_turns WHERE user_id = ? AND created_at <= ?").run(
      userId,
      new Date(Date.now() - TURN_TTL_MS).toISOString()
    );

    const rows = db
      .prepare(
        `SELECT user_id, question, answer, created_at FROM (
           SELECT id, user_id, question, answer, created_at FROM anden_turns
           WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
         ) ORDER BY created_at ASC, id ASC`
      )
      .all(userId, Math.max(0, n)) as unknown as TurnRow[];

    return rows.map((row) => ({
      userId: row.user_id,
      question: row.question,
      answer: row.answer,
      createdAt: row.created_at,
    }));
  }

  async putTrace(trace: Trace): Promise<void> {
    this.conn()
      .prepare(
        `INSERT INTO anden_traces (
           trace_id, user_id, question, steps, total_ms, tokens, cost_usd, ok, truncated, model, prompt_hash, params, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (trace_id) DO UPDATE SET
           steps = excluded.steps,
           total_ms = excluded.total_ms,
           tokens = excluded.tokens,
           cost_usd = excluded.cost_usd,
           ok = excluded.ok,
           truncated = excluded.truncated,
           model = excluded.model,
           prompt_hash = excluded.prompt_hash,
           params = excluded.params`
      )
      .run(
        trace.traceId,
        trace.userId,
        trace.question,
        JSON.stringify(trace.steps),
        trace.totalMs,
        trace.tokens,
        trace.costUsd,
        trace.ok ? 1 : 0,
        trace.truncated ? 1 : 0,
        trace.model,
        trace.promptHash,
        trace.params,
        trace.createdAt
      );
  }

  async getTrace(traceId: string): Promise<Trace | null> {
    const row = this.conn()
      .prepare("SELECT * FROM anden_traces WHERE trace_id = ?")
      .get(traceId) as unknown as TraceRow | undefined;
    return row ? toTrace(row) : null;
  }

  async recentTraces(userId: string, limit: number): Promise<TraceSummary[]> {
    const rows = this.conn()
      .prepare(
        `SELECT trace_id, question, steps, total_ms, tokens, cost_usd, ok, created_at
         FROM anden_traces WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(userId, Math.max(1, limit)) as unknown as TraceRow[];

    return rows.map((row) => ({
      traceId: row.trace_id,
      question: row.question,
      steps: parseSteps(row.steps).filter((step) => step.kind !== "plan").length,
      totalMs: row.total_ms,
      tokens: row.tokens,
      costUsd: row.cost_usd,
      ok: row.ok === 1,
      createdAt: row.created_at,
    }));
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
