import { NextResponse } from "next/server";
import { HARNESS_CONFIG } from "@/lib/anden/harness/config";
import { readUserId } from "@/lib/anden/identity";
import { getStore } from "@/lib/anden/store";

export const dynamic = "force-dynamic";

function clip(value: string): string {
  return value.length > HARNESS_CONFIG.maxDetailChars
    ? `${value.slice(0, HARNESS_CONFIG.maxDetailChars)}... (truncado)`
    : value;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await readUserId();
  if (!userId) return NextResponse.json({ error: "No encontré esa traza." }, { status: 404 });

  const { id } = await context.params;
  const store = getStore();
  await store.init();
  const trace = await store.getTrace(id);

  if (!trace || trace.userId !== userId) {
    return NextResponse.json({ error: "No encontré esa traza." }, { status: 404 });
  }

  return NextResponse.json({
    trace_id: trace.traceId,
    question: trace.question,
    steps: trace.steps.map((step) => ({
      step: step.step,
      kind: step.kind,
      input: clip(step.input),
      output: clip(step.output),
      ok: step.ok,
      ms: step.ms,
      tokens_in: step.tokensIn,
      tokens_out: step.tokensOut,
    })),
    total_ms: trace.totalMs,
    tokens: trace.tokens,
    cost_usd: Number(trace.costUsd.toFixed(6)),
    ok: trace.ok,
    truncated: trace.truncated,
    model: trace.model,
    prompt_hash: trace.promptHash,
    params: trace.params,
    created_at: trace.createdAt,
  });
}
