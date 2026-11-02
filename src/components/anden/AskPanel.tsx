"use client";

import { useRef, useState } from "react";
import Link from "next/link";

const EXAMPLES = [
  "¿Está andando la línea B ahora?",
  "¿Hasta qué hora funciona el subte?",
  "¿Cuánto sale el boleto de subte?",
];

const MAX_QUESTION = 500;

interface Source {
  id: string;
  title: string;
  text: string;
  source: string;
  score: number;
}

interface Step {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  ms: number;
}

interface AskResponse {
  answer: string;
  sources: Source[];
  citations: string[];
  abstained: boolean;
  citations_valid: boolean;
  steps: Step[];
  trace_id: string;
  trace_steps: number;
  total_ms: number;
  tokens: number;
  cost_usd: number;
  truncated: boolean;
  error?: string;
}

interface Turn {
  id: string;
  question: string;
  pending: boolean;
  response?: AskResponse;
  error?: string;
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

function money(usd: number): string {
  return usd < 0.001 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(3)}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function toolsUsed(steps: Step[]): { name: string; count: number; failed: number }[] {
  const byName = new Map<string, { name: string; count: number; failed: number }>();
  for (const step of steps) {
    const current = byName.get(step.tool) ?? { name: step.tool, count: 0, failed: 0 };
    current.count += 1;
    if (!step.ok) current.failed += 1;
    byName.set(step.tool, current);
  }
  return [...byName.values()];
}

function sourceTitle(response: AskResponse, id: string): string {
  return response.sources.find((source) => source.id === id)?.title ?? id;
}

function TurnView({ turn }: { turn: Turn }) {
  const response = turn.response;
  const steps = response?.trace_steps ?? response?.steps.length ?? 0;
  const sources = response?.sources.length ?? 0;

  return (
    <article className="border-b border-outline-variant/10 py-4 last:border-b-0">
      <h2 className="text-body-md font-semibold break-words text-on-background">{turn.question}</h2>

      {turn.pending && (
        <p
          className="mt-2 flex items-center gap-2 text-body-sm text-on-surface-variant"
          role="status"
        >
          <span
            className="h-2 w-2 animate-pulse rounded-full bg-primary-container"
            aria-hidden="true"
          />
          Consultando el estado del servicio.
        </p>
      )}

      {turn.error && (
        <p
          role="alert"
          className="mt-2 rounded-lg bg-error-container/20 px-3 py-2 text-body-sm text-on-error-container"
        >
          {turn.error}
        </p>
      )}

      {response && (
        <>
          <p className="mt-2 text-body-md leading-relaxed break-words whitespace-pre-wrap text-on-surface">
            {response.answer}
          </p>

          {response.truncated && (
            <p className="mt-1 text-body-sm text-tertiary">
              La respuesta se cortó por el presupuesto de la consulta.
            </p>
          )}

          <details className="group mt-2">
            <summary className="focus-ring inline-flex min-h-[32px] cursor-pointer list-none items-center gap-1.5 rounded-sm font-mono text-[11px] text-on-surface-variant hover:text-on-background [&::-webkit-details-marker]:hidden">
              <span className="transition-transform group-open:rotate-90" aria-hidden="true">
                ›
              </span>
              <span>
                {plural(steps, "paso", "pasos")} · {plural(sources, "fuente", "fuentes")} ·{" "}
                {seconds(response.total_ms)} s · {money(response.cost_usd)}
              </span>
            </summary>

            <div className="mt-2 rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-3">
              <p className="text-label-caps tracking-wider text-outline">Herramientas</p>
              {steps === 0 ? (
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  Ninguna. Anden respondió sin consultar datos.
                </p>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {toolsUsed(response.steps).map((tool) => (
                    <li key={tool.name} className="font-mono text-[11px] text-on-surface">
                      {tool.name}
                      <span className="text-on-surface-variant"> ×{tool.count}</span>
                      {tool.failed > 0 && (
                        <span className="text-secondary"> ({tool.failed} falló)</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-3 text-label-caps tracking-wider text-outline">Citas</p>
              {response.citations.length === 0 ? (
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  Sin citas del corpus. Los datos en vivo no llevan cita.
                </p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {response.citations.map((id) => (
                    <li key={id} className="text-body-sm break-words text-on-surface">
                      <span className="font-mono text-[11px] text-primary">{id}</span>
                      <span className="text-on-surface-variant">
                        {" "}
                        · {sourceTitle(response, id)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-3 border-t border-outline-variant/10 pt-2 font-mono text-[11px] text-on-surface-variant">
                {response.tokens} tokens ·{" "}
                <Link
                  href={`/traces/${response.trace_id}`}
                  className="focus-ring rounded-sm text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                >
                  ver la traza
                </Link>
              </p>
            </div>
          </details>
        </>
      )}
    </article>
  );
}

export default function AskPanel() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const pending = turns.some((turn) => turn.pending);

  const ask = async (raw: string) => {
    const text = raw.trim();
    if (!text || pending) return;

    const id = crypto.randomUUID();
    setTurns((current) => [...current, { id, question: text, pending: true }]);
    setQuestion("");

    try {
      const res = await fetch("/api/anden/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const data = (await res.json()) as AskResponse;
      if (!res.ok) throw new Error(data.error ?? "No pude consultar a Anden.");
      setTurns((current) =>
        current.map((turn) => (turn.id === id ? { ...turn, pending: false, response: data } : turn))
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "No pude consultar a Anden.";
      setTurns((current) =>
        current.map((turn) => (turn.id === id ? { ...turn, pending: false, error: message } : turn))
      );
    } finally {
      inputRef.current?.focus();
    }
  };

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-3 py-5 sm:px-5 sm:py-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-label-caps tracking-widest text-outline">ANDEN</p>
          <h1 className="text-headline-sm font-bold text-on-background">Preguntá por el subte</h1>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Estado del servicio, arribos y datos de la red, en una respuesta corta.
          </p>
        </div>
        <nav className="flex items-center gap-2" aria-label="Navegación de Anden">
          <Link href="/traces" className="btn-ghost focus-ring text-body-sm">
            Trazas
          </Link>
          <Link href="/" className="btn-ghost focus-ring text-body-sm">
            Volver al mapa
          </Link>
        </nav>
      </header>

      {turns.length === 0 && (
        <section className="mb-5 rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-5">
          <h2 className="text-title-sm font-bold text-on-background">Qué podés preguntar</h2>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Anden consulta el estado en vivo y la base de datos de la red. Tres ejemplos:
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => {
                    setQuestion(example);
                    inputRef.current?.focus();
                  }}
                  className="focus-ring flex min-h-[44px] w-full items-center rounded-lg border border-outline-variant/25 bg-surface-container px-3 text-left text-body-sm text-on-surface hover:bg-surface-container-high"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Conversación">
        <div aria-live="polite">
          {turns.map((turn) => (
            <TurnView key={turn.id} turn={turn} />
          ))}
        </div>
      </section>

      <form
        className="sticky bottom-0 mt-4 border-t border-outline-variant/20 bg-background/95 py-3 backdrop-blur"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor="anden-question" className="sr-only">
          Pregunta para Anden
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <textarea
            id="anden-question"
            ref={inputRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value.slice(0, MAX_QUESTION))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(question);
              }
            }}
            rows={2}
            placeholder="¿Está andando la línea B?"
            className="input-field min-h-[44px] w-full resize-none"
          />
          <button
            type="submit"
            disabled={!question.trim() || pending}
            className="focus-ring min-h-[44px] shrink-0 rounded-md bg-primary-container px-4 text-body-sm font-bold text-on-primary-container disabled:opacity-40"
          >
            {pending ? "Consultando" : "Preguntar"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-outline">
          Enter envía. Shift + Enter agrega un salto de línea.
        </p>
      </form>
    </main>
  );
}
