import { NextResponse } from 'next/server';
import { extractFacts } from '@/lib/anden/extraction';
import { extractCitations } from '@/lib/anden/citations';
import { runHarness } from '@/lib/anden/harness';
import { getUserId } from '@/lib/anden/identity';
import { LlmConfigError } from '@/lib/anden/llm';
import { getStore } from '@/lib/anden/store';

const MAX_QUESTION = 500;

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

  try {
    const result = await runHarness({ question, userId });

    if (!result.abstained && !result.truncated) await remember(userId, question, result.answer);

    return NextResponse.json({
      answer: result.answer,
      sources: result.sources,
      citations: extractCitations(result.answer),
      abstained: result.abstained,
      citations_valid: result.citationsValid,
      usage: result.usage,
      steps: result.steps,
      trace_id: result.traceId,
      trace_steps: result.traceSteps,
      total_ms: result.totalMs,
      tokens: result.tokens,
      cost_usd: result.costUsd,
      truncated: result.truncated,
    });
  } catch (error) {
    if (error instanceof LlmConfigError) {
      return NextResponse.json({ error: 'El modelo no está configurado.' }, { status: 503 });
    }
    return NextResponse.json({ error: 'No pude consultar el modelo en este momento.' }, { status: 502 });
  }
}
