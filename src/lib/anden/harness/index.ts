import { createHash, randomUUID } from 'node:crypto';
import {
  runAgent,
  SYSTEM_PROMPT,
  type AgentResult,
  type AgentStepEvent,
  type ToolGuard,
} from '../agent/run';
import { LlmConfigError, currentModel } from '../llm';
import { FACTS_MARKER, factsForPrompt, loadMemory, type MemorySnapshot } from '../memory';
import { getStore } from '../store';
import type { Trace, TraceStep } from '../store/types';
import { Budget } from './budget';
import { HARNESS_CONFIG, MODEL_PARAMS } from './config';
import { buildPlan } from './plan';
import { traceStepSchema, validateToolArgs, type Plan } from './schema';

export interface HarnessInput {
  question: string;
  userId: string;
}

export interface HarnessResult extends AgentResult {
  traceId: string;
  traceSteps: number;
  totalMs: number;
  tokens: number;
  costUsd: number;
  model: string;
}

const EMPTY_MEMORY: MemorySnapshot = { facts: [], turns: [] };
const MEMORY_BLOCK = /\n\s*-\s*(Casa|Trabajo|Línea habitual|Hora de salida|Sin escaleras|Combinación máxima):/;
const TRANSPORT_ERROR = /(timed out|fetch failed|network|ECONN|ETIMEDOUT|EAI_AGAIN|socket)/i;

function clip(value: string, max = HARNESS_CONFIG.maxStepChars): string {
  return value.length > max ? `${value.slice(0, max)}... (truncado)` : value;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function leaksFacts(args: Record<string, unknown>): boolean {
  return Object.values(args).some(
    (value) => typeof value === 'string' && (value.includes(FACTS_MARKER) || MEMORY_BLOCK.test(value)),
  );
}

function makeGuard(plan: Plan): (name: string, args: Record<string, unknown>) => ToolGuard {
  const allowed = new Set<string>(plan.tools);
  const seen = new Set<string>();

  return (name, args) => {
    if (!allowed.has(name)) return { ok: false, error: `tool '${name}' is not in the plan` };

    const validation = validateToolArgs(name, args);
    if (!validation.ok) return validation;

    if (leaksFacts(args)) {
      return { ok: false, error: 'tool arguments must not contain remembered facts' };
    }

    const key = `${name}:${stable(args)}`;
    if (seen.has(key)) {
      return { ok: false, error: `'${name}' was already called with the same arguments` };
    }
    seen.add(key);
    return { ok: true };
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function persist(trace: Trace): Promise<void> {
  try {
    const store = getStore();
    await store.init();
    await store.putTrace(trace);
  } catch {
    // la traza es observabilidad: si falla, la respuesta igual vale
  }
}

export async function runHarness({ question, userId }: HarnessInput): Promise<HarnessResult> {
  const traceId = randomUUID();
  const started = Date.now();
  const budget = new Budget();
  const plan = buildPlan(question);
  const steps: TraceStep[] = [];
  const malformed: string[] = [];
  const transport: string[] = [];
  let retried = false;
  let result: AgentResult | null = null;
  let thrown: unknown = null;

  const record = (raw: Omit<TraceStep, 'step'>): void => {
    const step = traceStepSchema.parse({ ...raw, step: steps.length + 1 });
    steps.push({ ...step, input: clip(step.input), output: clip(step.output) });
  };

  record({ kind: 'plan', input: question, output: JSON.stringify(plan), ok: true, ms: 0, tokensIn: 0, tokensOut: 0 });

  const memoryStarted = Date.now();
  let memory = EMPTY_MEMORY;
  let memoryOk = true;
  try {
    memory = await loadMemory(userId, 4);
  } catch {
    memoryOk = false;
  }
  record({
    kind: 'memory',
    input: userId,
    output: JSON.stringify({ facts: memory.facts.length, turns: memory.turns.length }),
    ok: memoryOk,
    ms: Date.now() - memoryStarted,
    tokensIn: 0,
    tokensOut: 0,
  });

  const onStep = (event: AgentStepEvent): void => {
    if (event.malformed) malformed.push(event.input);
    if (!event.ok && TRANSPORT_ERROR.test(event.output)) transport.push(event.output.slice(0, 200));
    record({
      kind: event.kind,
      input: event.input,
      output: event.output,
      ok: event.ok,
      ms: event.ms,
      tokensIn: event.tokensIn,
      tokensOut: event.tokensOut,
    });
  };

  let notes: string | undefined;

  for (let attempt = 1; attempt <= 2 && !result; attempt += 1) {
    try {
      const guard = makeGuard(plan);
      const candidate = await runAgent(
        { question, userId },
        {
          budget,
          memory,
          notes,
          allowedTools: plan.tools,
          maxToolCalls: HARNESS_CONFIG.maxToolSteps,
          beforeTool: guard,
          onStep,
        },
      );

      const deadEnd =
        candidate.abstained || candidate.truncated || candidate.steps.every((step) => !step.ok);

      const retryForTransport = transport.length > 0;
      const retryForArgs = malformed.length > 0 && deadEnd;

      if (!retried && (retryForTransport || retryForArgs)) {
        retried = true;
        notes = retryForTransport
          ? `La red falló al consultar una herramienta: ${transport.join(' | ')}. Reintentá la consulta.`
          : `La herramienta rechazó estos argumentos: ${malformed.join(' | ')}. Volvé a llamarla con argumentos válidos.`;
        record({
          kind: 'plan',
          input: question,
          output: `reintento ${retryForTransport ? 'por error de red' : 'por argumentos inválidos'}: ${notes}`,
          ok: false,
          ms: 0,
          tokensIn: 0,
          tokensOut: 0,
        });
        continue;
      }

      result = candidate;
    } catch (error) {
      if (error instanceof LlmConfigError) {
        thrown = error;
        break;
      }
      if (attempt >= 2) {
        thrown = error;
        break;
      }

      retried = true;
      notes = `La llamada anterior falló: ${message(error)}. Reintentá la pregunta desde el principio.`;
      record({
        kind: 'plan',
        input: question,
        output: `reintento por error de red: ${message(error)}`,
        ok: false,
        ms: 0,
        tokensIn: 0,
        tokensOut: 0,
      });
    }
  }

  if (!result && thrown === null) thrown = new Error('the agent produced no answer');

  if (!result) {
    record({
      kind: 'answer',
      input: question,
      output: message(thrown),
      ok: false,
      ms: Date.now() - started,
      tokensIn: 0,
      tokensOut: 0,
    });
  }

  const spent = budget.spent();
  const totalMs = Date.now() - started;
  const model = await currentModel().catch(() => 'unknown');
  const truncated = Boolean(result?.truncated);

  const trace: Trace = {
    traceId,
    userId,
    question,
    steps,
    totalMs,
    tokens: spent.tokens,
    costUsd: spent.costUsd,
    ok: Boolean(result) && !truncated,
    truncated,
    model,
    promptHash: createHash('sha256')
      .update([SYSTEM_PROMPT, factsForPrompt(memory.facts), notes].filter(Boolean).join(' '))
      .digest('hex'),
    params: JSON.stringify({
      temperature: MODEL_PARAMS.temperature,
      max_tokens: MODEL_PARAMS.toolTokens,
      answer_max_tokens: MODEL_PARAMS.answerTokens,
      max_steps: HARNESS_CONFIG.maxSteps,
      max_tokens_total: HARNESS_CONFIG.maxTokens,
      max_usd: HARNESS_CONFIG.maxUsd,
      max_ms: HARNESS_CONFIG.maxMs,
      tools: plan.tools,
      notes: notes ?? null,
    }),
    createdAt: new Date().toISOString(),
  };

  await persist(trace);

  if (!result) throw thrown;

  return {
    ...result,
    traceId,
    traceSteps: steps.filter((step) => step.kind !== 'plan').length,
    totalMs,
    tokens: spent.tokens,
    costUsd: spent.costUsd,
    model,
  };
}
