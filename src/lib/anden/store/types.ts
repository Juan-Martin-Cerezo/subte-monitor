export type FactKey =
  | "home_station"
  | "work_station"
  | "usual_line"
  | "usual_departure_time"
  | "step_free"
  | "max_transfer_minutes";

export type FactValue = string | number | boolean;

export interface Fact {
  userId: string;
  key: FactKey;
  value: FactValue;
  updatedAt: string;
  expiresAt: string;
}

export interface Turn {
  userId: string;
  question: string;
  answer: string;
  createdAt: string;
}

export type TraceKind = "plan" | "tool" | "retrieve" | "memory" | "answer";

export interface TraceStep {
  step: number;
  kind: TraceKind;
  input: string;
  output: string;
  ok: boolean;
  ms: number;
  tokensIn: number;
  tokensOut: number;
}

export interface Trace {
  traceId: string;
  userId: string;
  question: string;
  steps: TraceStep[];
  totalMs: number;
  tokens: number;
  costUsd: number;
  ok: boolean;
  truncated: boolean;
  model: string;
  promptHash: string;
  params: string;
  createdAt: string;
}

export interface TraceSummary {
  traceId: string;
  question: string;
  steps: number;
  totalMs: number;
  tokens: number;
  costUsd: number;
  ok: boolean;
  createdAt: string;
}

export interface AndenStore {
  init(): Promise<void>;
  putFact(f: Fact): Promise<void>;
  listFacts(userId: string): Promise<Fact[]>;
  deleteFact(userId: string, key: string): Promise<boolean>;
  deleteAll(userId: string): Promise<number>;
  putTurn(t: Turn): Promise<void>;
  recentTurns(userId: string, n: number): Promise<Turn[]>;
  putTrace(t: Trace): Promise<void>;
  getTrace(traceId: string): Promise<Trace | null>;
  recentTraces(userId: string, limit: number): Promise<TraceSummary[]>;
}
