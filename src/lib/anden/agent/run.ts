import { ABSTAIN, validateCitations } from '../citations';
import { chat, type ChatMessage, type LlmUsage } from '../llm';
import {
  answerMentionsStation,
  factsForPrompt,
  loadMemory,
  memoryOriginClause,
  type MemorySnapshot,
} from '../memory';
import type { RetrievedSource } from '../retrieval';
import { llmTools, toolByName } from '../tools';

const MAX_TOOL_CALLS = 4;
const MAX_TOOL_CHARS = 3500;

export const SYSTEM_PROMPT = [
  'Sos Anden, el asistente de la red de subte de Buenos Aires.',
  'Respondé en español, en una o dos oraciones, sin markdown.',
  'Usá las herramientas para datos en vivo: subway_status para el estado del servicio, next_trains para arribos, ' +
    'plan_trip para viajes y nearby_stations para cercanía con coordenadas.',
  'Usá search_knowledge para datos escritos de la red: horarios, tarifas, accesibilidad, estaciones, combinaciones ' +
    'y cómo funciona la aplicación.',
  'Cuando respondas con datos de search_knowledge, citá cada afirmación con el id de la fuente que la respalda, ' +
    'por ejemplo [kb:tarifa-subte-sube]. No cites números como S1, usá el id.',
  'Los datos de las herramientas en vivo no llevan cita.',
  'No inventes estaciones, líneas, precios ni horarios.',
  'Si una herramienta devuelve un error porque la estación o la línea no existen o no se corresponden, no ofrezcas alternativas: ' +
    `respondé exactamente: ${ABSTAIN}`,
  `Si las herramientas y las fuentes no alcanzan, respondé exactamente: ${ABSTAIN}`,
].join(' ');

const PARTIAL_ANSWER = 'No llegué a una respuesta completa dentro del presupuesto de esta consulta.';

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  ms: number;
}

export interface AgentResult {
  answer: string;
  steps: AgentStep[];
  sources: RetrievedSource[];
  abstained: boolean;
  citationsValid: boolean;
  usage: LlmUsage;
  evidence: string[];
  truncated: boolean;
}

export interface AgentInput {
  question: string;
  userId: string;
}

export type AgentStepKind = 'plan' | 'tool' | 'retrieve' | 'answer';

export interface AgentStepEvent {
  kind: AgentStepKind;
  input: string;
  output: string;
  ok: boolean;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  malformed?: boolean;
}

export interface AgentBudget {
  exhausted(): boolean;
  consumeStep(): boolean;
  addUsage(usage: LlmUsage): void;
}

export interface ToolGuard {
  ok: boolean;
  error?: string;
}

export interface AgentOptions {
  budget?: AgentBudget;
  memory?: MemorySnapshot;
  notes?: string;
  maxToolCalls?: number;
  allowedTools?: string[];
  beforeTool?: (name: string, args: Record<string, unknown>) => ToolGuard;
  onStep?: (event: AgentStepEvent) => void;
}

function addUsage(total: LlmUsage, next: LlmUsage): LlmUsage {
  return {
    prompt_tokens: (total.prompt_tokens ?? 0) + (next.prompt_tokens ?? 0),
    completion_tokens: (total.completion_tokens ?? 0) + (next.completion_tokens ?? 0),
    total_tokens: (total.total_tokens ?? 0) + (next.total_tokens ?? 0),
  };
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isAbstention(answer: string): boolean {
  const trimmed = answer.trim();
  return trimmed === ABSTAIN || trimmed === 'No tengo información sobre eso';
}

function collectSources(payload: unknown, into: Map<string, RetrievedSource>): void {
  if (!payload || typeof payload !== 'object') return;
  const sources = (payload as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return;

  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const candidate = source as RetrievedSource;
    if (typeof candidate.id === 'string' && typeof candidate.text === 'string' && !into.has(candidate.id)) {
      into.set(candidate.id, candidate);
    }
  }
}

function history(memory: MemorySnapshot): ChatMessage[] {
  return memory.turns.flatMap((turn) => [
    { role: 'user' as const, content: turn.question },
    { role: 'assistant' as const, content: turn.answer },
  ]);
}

function repairMessages(messages: ChatMessage[]): ChatMessage[] {
  return [
    ...messages,
    {
      role: 'user',
      content:
        'Tu respuesta no tiene citas válidas. Volvé a responder citando con el id de la fuente cada afirmación. ' +
        `Si no podés respaldar la respuesta, respondé exactamente: ${ABSTAIN}`,
    },
  ];
}

function finalMessages(messages: ChatMessage[]): ChatMessage[] {
  return [
    ...messages,
    {
      role: 'user',
      content:
        'Respondé ahora la pregunta con lo que devolvieron las herramientas. No llames más herramientas. ' +
        `Si no alcanza, respondé exactamente: ${ABSTAIN}`,
    },
  ];
}

function usageEvent(usage: LlmUsage): { tokensIn: number; tokensOut: number } {
  return { tokensIn: usage.prompt_tokens ?? 0, tokensOut: usage.completion_tokens ?? 0 };
}

export async function runAgent({ question, userId }: AgentInput, options: AgentOptions = {}): Promise<AgentResult> {
  const memory =
    options.memory ??
    (await loadMemory(userId, 4).catch<MemorySnapshot>(() => ({ facts: [], turns: [] })));
  const collected = new Map<string, RetrievedSource>();
  const steps: AgentStep[] = [];
  const evidence: string[] = [];
  let usage: LlmUsage = {};

  const system = [SYSTEM_PROMPT, factsForPrompt(memory.facts), options.notes].filter(Boolean).join(' ');
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...history(memory),
    { role: 'user', content: `Pregunta: ${question}` },
  ];

  const tools = options.allowedTools
    ? llmTools().filter((tool) => options.allowedTools?.includes(tool.function.name))
    : llmTools();
  const maxToolCalls = options.maxToolCalls ?? MAX_TOOL_CALLS;
  const emit = options.onStep ?? (() => {});

  let answer = '';
  let truncated = false;
  let toolCalls = 0;

  while (true) {
    if (options.budget?.exhausted()) {
      truncated = true;
      break;
    }

    const started = Date.now();
    const result = await chat(messages, { tools, temperature: 0, maxTokens: 600 });
    const ms = Date.now() - started;
    options.budget?.addUsage(result.usage);
    usage = addUsage(usage, result.usage);

    if (!result.toolCalls.length) {
      answer = result.content.trim();
      emit({
        kind: 'answer',
        input: question,
        output: answer,
        ok: true,
        ms,
        ...usageEvent(result.usage),
      });
      break;
    }

    emit({
      kind: 'plan',
      input: question,
      output: result.toolCalls.map((call) => `${call.function.name}(${call.function.arguments})`).join('\n'),
      ok: true,
      ms,
      ...usageEvent(result.usage),
    });

    messages.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls });

    for (const call of result.toolCalls) {
      if (toolCalls >= maxToolCalls || (options.budget && !options.budget.consumeStep())) {
        truncated = true;
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ error: 'step budget reached, not executed' }),
        });
        continue;
      }

      toolCalls += 1;
      const args = parseArgs(call.function.arguments);
      const startedTool = Date.now();
      let ok = true;
      let malformed = false;
      let payload: unknown;

      const guard = options.beforeTool?.(call.function.name, args);
      if (guard && !guard.ok) {
        ok = false;
        malformed = true;
        payload = { error: guard.error ?? 'invalid tool arguments' };
      } else {
        const tool = toolByName(call.function.name);
        if (!tool) {
          ok = false;
          malformed = true;
          payload = { error: `unknown tool '${call.function.name}'` };
        } else {
          try {
            payload = await tool.execute(args);
          } catch (error) {
            ok = false;
            payload = { error: error instanceof Error ? error.message : String(error) };
          }
        }
      }

      const stepMs = Date.now() - startedTool;
      steps.push({ tool: call.function.name, args, ok, ms: stepMs });
      if (call.function.name === 'search_knowledge') collectSources(payload, collected);

      emit({
        kind: call.function.name === 'search_knowledge' ? 'retrieve' : 'tool',
        input: call.function.arguments || JSON.stringify(args),
        output: JSON.stringify(payload),
        ok,
        ms: stepMs,
        tokensIn: 0,
        tokensOut: 0,
        ...(malformed ? { malformed: true } : {}),
      });

      const text = JSON.stringify(payload);
      const sent = text.length > MAX_TOOL_CHARS ? `${text.slice(0, MAX_TOOL_CHARS)}... (truncated)` : text;
      evidence.push(sent);
      messages.push({ role: 'tool', tool_call_id: call.id, content: sent });
    }

    if (truncated) break;
  }

  if (!answer) {
    if (options.budget?.exhausted()) {
      truncated = true;
      answer = PARTIAL_ANSWER;
    } else {
      const started = Date.now();
      const result = await chat(finalMessages(messages), { temperature: 0, maxTokens: 400 });
      options.budget?.addUsage(result.usage);
      usage = addUsage(usage, result.usage);
      answer = result.content.trim();
      emit({
        kind: 'answer',
        input: question,
        output: answer,
        ok: !isAbstention(answer),
        ms: Date.now() - started,
        ...usageEvent(result.usage),
      });
    }
  }

  const sources = [...collected.values()];
  const sourceIds = sources.map((source) => source.id);
  let check = validateCitations(answer, sourceIds);

  const liveToolSucceeded = steps.some((step) => step.ok && step.tool !== 'search_knowledge');
  const needsCitations = sources.length > 0 && !liveToolSucceeded;

  if (!truncated && !isAbstention(answer) && needsCitations && check.citations.length === 0) {
    if (options.budget?.exhausted()) {
      truncated = true;
    } else {
      const started = Date.now();
      const result = await chat(repairMessages(messages), { temperature: 0, maxTokens: 400 });
      options.budget?.addUsage(result.usage);
      usage = addUsage(usage, result.usage);
      answer = result.content.trim();
      check = validateCitations(answer, sourceIds);
      emit({
        kind: 'answer',
        input: question,
        output: answer,
        ok: !isAbstention(answer),
        ms: Date.now() - started,
        ...usageEvent(result.usage),
      });

      if (!isAbstention(answer) && check.citations.length === 0) {
        answer = ABSTAIN;
        check = validateCitations(answer, sourceIds);
      }
    }
  }

  const abstained = isAbstention(answer);
  if (abstained) {
    return { answer: ABSTAIN, steps, sources, abstained: true, citationsValid: true, usage, evidence, truncated };
  }

  const clause = memoryOriginClause(question, memory.facts);
  const withOrigin =
    clause && !answerMentionsStation(check.answer, clause.origin)
      ? `${clause.text} ${check.answer}`
      : check.answer;

  return {
    answer: withOrigin,
    steps,
    sources,
    abstained: false,
    citationsValid: check.citationsValid,
    usage,
    evidence,
    truncated,
  };
}
