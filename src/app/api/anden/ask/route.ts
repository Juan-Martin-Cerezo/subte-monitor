import { NextResponse } from 'next/server';
import { ABSTAIN, validateCitations } from '@/lib/anden/citations';
import { extractFacts } from '@/lib/anden/extraction';
import { getUserId } from '@/lib/anden/identity';
import { LlmConfigError, chat, type ChatMessage } from '@/lib/anden/llm';
import { factsForPrompt, loadMemory, memoryOriginClause, type MemorySnapshot } from '@/lib/anden/memory';
import { search, type RetrievedSource } from '@/lib/anden/retrieval';
import { getStore } from '@/lib/anden/store';

const MAX_QUESTION = 500;

const SYSTEM_PROMPT = [
  'Sos Anden, el asistente de la red de subte de Buenos Aires.',
  'Respondé en español, en una o dos oraciones, usando solo las fuentes.',
  'Cada afirmación tiene que llevar entre corchetes el id de la fuente que la respalda, por ejemplo [kb:tarifa-subte-sube].',
  'No cites números como S1, usá el id.',
  `Si las fuentes no alcanzan para responder, respondé exactamente: ${ABSTAIN}`,
].join(' ');

const STRICT_PROMPT = [
  'Tu respuesta anterior no incluyó ninguna cita válida.',
  'Volvé a responder citando con el id de la fuente cada afirmación.',
  `Si no podés respaldar la respuesta, respondé exactamente: ${ABSTAIN}`,
].join(' ');

function buildMessages(
  question: string,
  sources: RetrievedSource[],
  strict: boolean,
  memory: MemorySnapshot,
): ChatMessage[] {
  const numbered = sources
    .map((source, index) => `[S${index + 1}] id=${source.id} | ${source.title}\n${source.text}`)
    .join('\n\n');

  const system = [SYSTEM_PROMPT, factsForPrompt(memory.facts), strict ? STRICT_PROMPT : '']
    .filter(Boolean)
    .join(' ');

  const history: ChatMessage[] = memory.turns.flatMap((turn) => [
    { role: 'user', content: turn.question },
    { role: 'assistant', content: turn.answer },
  ]);

  return [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: `Pregunta: ${question}\n\nFuentes:\n${numbered}` },
  ];
}

function publicSources(sources: RetrievedSource[]) {
  return sources.map(({ id, title, text, source, score }) => ({ id, title, text, source, score }));
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

async function remember(userId: string, question: string, answer: string) {
  try {
    const store = getStore();
    await store.init();
    for (const fact of await extractFacts(userId, question)) await store.putFact(fact);
    await store.putTurn({ userId, question, answer, createdAt: new Date().toISOString() });
  } catch {
    // la memoria es best effort: nunca cambia la respuesta que ya se calculó
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('No pude leer el JSON de la solicitud.');
  }

  const question = typeof (body as { question?: unknown })?.question === 'string'
    ? (body as { question: string }).question.trim()
    : '';

  if (!question) return badRequest('Falta la pregunta.');
  if (question.length > MAX_QUESTION) return badRequest('La pregunta es demasiado larga.');

  const userId = await getUserId();
  const memory = await loadMemory(userId, 4).catch(() => ({ facts: [], turns: [] }));
  const sources = await search(question, 6);
  const ids = sources.map((source) => source.id);

  if (!sources.length) {
    return NextResponse.json({
      answer: ABSTAIN,
      sources: [],
      abstained: true,
      citations_valid: true,
      usage: {},
    });
  }

  try {
    let result = await chat(buildMessages(question, sources, false, memory));
    let answer = result.content.trim();
    let abstained = !answer || answer === ABSTAIN;
    let check = validateCitations(answer, ids);

    if (!abstained && check.citations.length === 0) {
      result = await chat(buildMessages(question, sources, true, memory));
      answer = result.content.trim();
      abstained = !answer || answer === ABSTAIN;
      check = validateCitations(answer, ids);

      if (!abstained && check.citations.length === 0) {
        answer = ABSTAIN;
        abstained = true;
      }
    }

    const clause = abstained ? null : memoryOriginClause(question, memory.facts);
    const finalAnswer = abstained ? ABSTAIN : clause ? `${clause} ${check.answer}` : check.answer;

    if (!abstained) await remember(userId, question, finalAnswer);

    return NextResponse.json({
      answer: finalAnswer,
      sources: publicSources(sources),
      abstained,
      citations_valid: abstained ? true : check.citationsValid,
      usage: result.usage,
    });
  } catch (error) {
    if (error instanceof LlmConfigError) {
      return NextResponse.json({ error: 'El modelo no está configurado.' }, { status: 503 });
    }
    return NextResponse.json({ error: 'No pude consultar el modelo en este momento.' }, { status: 502 });
  }
}
