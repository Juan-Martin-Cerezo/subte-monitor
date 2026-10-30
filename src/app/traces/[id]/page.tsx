import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HARNESS_CONFIG } from '@/lib/anden/harness/config';
import { readUserId } from '@/lib/anden/identity';
import { getStore } from '@/lib/anden/store';
import type { Trace } from '@/lib/anden/store/types';

export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  plan: 'plan',
  tool: 'herramienta',
  retrieve: 'búsqueda',
  memory: 'memoria',
  answer: 'respuesta',
};

function clip(value: string): string {
  return value.length > HARNESS_CONFIG.maxDetailChars
    ? `${value.slice(0, HARNESS_CONFIG.maxDetailChars)}... (truncado)`
    : value;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'medium' });
}

export default async function TraceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await readUserId();

  let trace: Trace | null = null;
  if (userId) {
    try {
      const store = getStore();
      await store.init();
      const found = await store.getTrace(id);
      trace = found && found.userId === userId ? found : null;
    } catch {
      trace = null;
    }
  }

  if (!trace) notFound();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-3 py-6 sm:px-6 sm:py-10">
      <nav className="mb-5 flex items-center gap-2" aria-label="Volver">
        <Link href="/traces" className="btn-ghost focus-ring text-body-sm">
          Volver a las trazas
        </Link>
        <Link href="/anden" className="btn-ghost focus-ring text-body-sm">
          Preguntar
        </Link>
      </nav>

      <header className="mb-6">
        <p className="text-label-caps tracking-widest text-outline">TRAZA {trace.traceId.slice(0, 8)}</p>
        <h1 className="mt-1 text-headline-sm font-bold break-words text-on-background">{trace.question}</h1>
        <p className="mt-2 font-mono text-[11px] text-on-surface-variant">
          {formatTime(trace.createdAt)} · {trace.totalMs} ms · {trace.tokens} tokens · $
          {trace.costUsd.toFixed(6)} · {trace.ok ? 'ok' : 'con error'}
          {trace.truncated ? ' · truncada' : ''}
        </p>
      </header>

      <section className="mb-6 rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3">
        <h2 className="text-label-caps tracking-wider text-outline">Reproducción</h2>
        <dl className="mt-2 grid gap-2 text-body-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-on-surface-variant">Modelo</dt>
          <dd className="font-mono text-on-surface">{trace.model}</dd>
          <dt className="text-on-surface-variant">Hash del prompt</dt>
          <dd className="font-mono break-all text-on-surface">{trace.promptHash}</dd>
          <dt className="text-on-surface-variant">Parámetros</dt>
          <dd>
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-on-surface">
              {trace.params}
            </pre>
          </dd>
        </dl>
      </section>

      <section aria-labelledby="steps-title">
        <h2 id="steps-title" className="mb-3 text-title-md font-bold text-on-background">
          Pasos ({trace.steps.length})
        </h2>
        <ol className="flex flex-col gap-3">
          {trace.steps.map((step) => (
            <li
              key={step.step}
              className="rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-data-md text-primary">{step.step}</span>
                <span className="text-title-sm font-bold text-on-background">
                  {KIND_LABELS[step.kind] ?? step.kind}
                </span>
                <span className={step.ok ? 'text-body-sm text-primary' : 'text-body-sm text-secondary'}>
                  {step.ok ? 'ok' : 'falló'}
                </span>
                <span className="ml-auto font-mono text-[11px] text-on-surface-variant">
                  {step.ms} ms · {step.tokensIn} in · {step.tokensOut} out
                </span>
              </div>
              <div className="mt-2 grid gap-2">
                <div>
                  <p className="text-label-caps tracking-wider text-outline">Entrada</p>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-container-lowest px-2 py-2 font-mono text-[11px] text-on-surface">
                    {clip(step.input)}
                  </pre>
                </div>
                <div>
                  <p className="text-label-caps tracking-wider text-outline">Salida</p>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-container-lowest px-2 py-2 font-mono text-[11px] text-on-surface">
                    {clip(step.output)}
                  </pre>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
