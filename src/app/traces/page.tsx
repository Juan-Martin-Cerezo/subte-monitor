import Link from "next/link";
import { readUserId } from "@/lib/anden/identity";
import { getStore } from "@/lib/anden/store";
import type { TraceSummary } from "@/lib/anden/store/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Anden · Trazas",
  description: "Últimas consultas registradas por el arnés de Anden.",
};

function formatTime(value: string): string {
  return new Date(value).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "medium" });
}

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`;
}

function statusLabel(ok: boolean): string {
  return ok ? "ok" : "con error";
}

export default async function TracesPage() {
  const userId = await readUserId();

  let traces: TraceSummary[] = [];
  let unavailable = false;

  if (userId) {
    try {
      const store = getStore();
      await store.init();
      traces = await store.recentTraces(userId, 50);
    } catch {
      unavailable = true;
    }
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-4xl px-3 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-label-caps tracking-widest text-outline">ANDEN</p>
          <h1 className="text-headline-md font-bold text-on-background">Trazas</h1>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Las últimas 50 consultas de este navegador. Cada paso quedó guardado para poder
            reproducirlo.
          </p>
        </div>
        <nav className="flex items-center gap-2" aria-label="Navegación de Anden">
          <Link href="/anden" className="btn-ghost focus-ring text-body-sm">
            Preguntar
          </Link>
          <Link href="/" className="btn-ghost focus-ring text-body-sm">
            Volver al mapa
          </Link>
        </nav>
      </header>

      {unavailable && (
        <p
          role="alert"
          className="rounded-lg bg-error-container/20 px-3 py-3 text-body-sm text-on-error-container"
        >
          No pude leer el almacén de trazas.
        </p>
      )}

      {!unavailable && traces.length === 0 && (
        <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-8 text-center">
          <p className="text-body-md text-on-surface">Todavía no hay trazas en este navegador.</p>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Hacé una pregunta en Anden y la consulta aparece acá.
          </p>
          <Link
            href="/anden"
            className="focus-ring mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary-container px-4 text-body-sm font-bold text-on-primary-container"
          >
            Ir a Anden
          </Link>
        </div>
      )}

      {traces.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-outline-variant/20 bg-surface-container-low">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <caption className="sr-only">Últimas trazas de Anden</caption>
            <thead>
              <tr className="border-b border-outline-variant/20 text-label-caps tracking-wider text-outline">
                <th scope="col" className="px-3 py-2 font-bold">
                  Hora
                </th>
                <th scope="col" className="px-3 py-2 font-bold">
                  Pregunta
                </th>
                <th scope="col" className="px-3 py-2 text-right font-bold">
                  Pasos
                </th>
                <th scope="col" className="px-3 py-2 text-right font-bold">
                  ms
                </th>
                <th scope="col" className="px-3 py-2 text-right font-bold">
                  Costo
                </th>
                <th scope="col" className="px-3 py-2 font-bold">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody>
              {traces.map((trace) => (
                <tr
                  key={trace.traceId}
                  className="border-b border-outline-variant/10 align-top last:border-b-0 hover:bg-surface-container-high/40"
                >
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-on-surface-variant">
                    {formatTime(trace.createdAt)}
                  </td>
                  <td className="px-3 py-2.5 text-body-sm">
                    <Link
                      href={`/traces/${trace.traceId}`}
                      className="focus-ring rounded-sm font-medium text-on-background underline decoration-outline-variant underline-offset-4 hover:decoration-primary"
                    >
                      {trace.question}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-data-md text-on-surface">
                    {trace.steps}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-data-md text-on-surface">
                    {trace.totalMs}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-data-md text-on-surface">
                    {formatCost(trace.costUsd)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-body-sm">
                    <span className={trace.ok ? "text-primary" : "text-secondary"}>
                      {statusLabel(trace.ok)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
