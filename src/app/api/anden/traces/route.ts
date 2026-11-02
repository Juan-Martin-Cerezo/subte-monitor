import { NextResponse } from "next/server";
import { readUserId } from "@/lib/anden/identity";
import { getStore } from "@/lib/anden/store";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function limitFrom(request: Request): number {
  const raw = new URL(request.url).searchParams.get("limit");
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
}

export async function GET(request: Request) {
  const userId = await readUserId();
  if (!userId) return NextResponse.json({ traces: [] });

  const store = getStore();
  await store.init();
  const traces = await store.recentTraces(userId, limitFrom(request));

  return NextResponse.json({
    traces: traces.map((trace) => ({
      trace_id: trace.traceId,
      question: trace.question,
      steps: trace.steps,
      total_ms: trace.totalMs,
      tokens: trace.tokens,
      cost_usd: Number(trace.costUsd.toFixed(6)),
      ok: trace.ok,
      created_at: trace.createdAt,
    })),
  });
}
