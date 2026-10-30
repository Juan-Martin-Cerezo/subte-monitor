"use client";

import { useEffect, useRef, useState } from "react";
import { FACT_LABELS, formatFactValue } from "@/lib/anden/fact-labels";
import type { FactKey, FactValue } from "@/lib/anden/store/types";
import { Icon } from "./Icon";

interface MemoryFact {
  key: FactKey;
  value: FactValue;
  updated_at: string;
  expires_at: string;
}

interface MemoryPanelProps {
  onClose: () => void;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function MemoryPanel({ onClose }: MemoryPanelProps) {
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [turns, setTurns] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/anden/memory", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("memory unavailable");
        return res.json() as Promise<{ facts: MemoryFact[]; turns: number }>;
      })
      .then((data) => {
        if (!active) return;
        setFacts(data.facts);
        setTurns(data.turns);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });

    return () => {
      active = false;
    };
  }, [reload]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const removeFact = async (key: FactKey) => {
    setBusy(key);
    try {
      const res = await fetch(`/api/anden/memory?key=${key}`, { method: "DELETE" });
      if (res.ok) setFacts((current) => current.filter((fact) => fact.key !== key));
    } finally {
      setBusy(null);
    }
  };

  const removeAll = async () => {
    setBusy("all");
    try {
      const res = await fetch("/api/anden/memory", { method: "DELETE" });
      if (res.ok) {
        setFacts([]);
        setTurns(0);
      }
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm md:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-low shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-outline-variant/10 px-4 py-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-container/15 ring-1 ring-primary-container/40">
            <Icon.Settings size={18} className="text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="memory-title" className="text-title-sm font-bold text-on-background">
              Memoria de Anden
            </h2>
            <p className="text-body-sm text-on-surface-variant">
              Lo que Anden guarda para no volver a preguntarte lo mismo.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar memoria"
            className="icon-btn focus-ring !h-9 !w-9 shrink-0"
          >
            <Icon.X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 scrollbar-thin">
          {status === "loading" && (
            <div className="space-y-2" aria-busy="true" aria-label="Cargando memoria">
              <div className="skeleton-pulse h-14 rounded-lg" />
              <div className="skeleton-pulse h-14 rounded-lg" />
            </div>
          )}

          {status === "error" && (
            <div className="rounded-lg bg-error-container/20 px-3 py-3 text-body-sm text-on-error-container">
              No pude leer la memoria.
              <button
                type="button"
                onClick={() => {
                  setStatus("loading");
                  setReload((value) => value + 1);
                }}
                className="ml-2 font-bold underline underline-offset-2 focus-ring"
              >
                Reintentar
              </button>
            </div>
          )}

          {status === "ready" && facts.length === 0 && (
            <p className="py-6 text-center text-body-sm text-on-surface-variant">
              Anden todavía no guardó nada. Cuando le cuentes de dónde salís o a dónde vas, va a
              recordarlo acá.
            </p>
          )}

          {status === "ready" && facts.length > 0 && (
            <ul className="divide-y divide-outline-variant/10">
              {facts.map((fact) => (
                <li key={fact.key} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-label-caps text-outline">
                      {FACT_LABELS[fact.key] ?? fact.key}
                    </p>
                    <p className="truncate text-body-md font-medium text-on-background">
                      {formatFactValue(fact.key, fact.value)}
                    </p>
                    <p className="text-[11px] font-mono text-outline">
                      Vence el {formatDate(fact.expires_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeFact(fact.key)}
                    disabled={busy === fact.key}
                    aria-label={`Borrar ${FACT_LABELS[fact.key] ?? fact.key}`}
                    className="icon-btn focus-ring !h-9 !w-9 shrink-0 text-outline hover:text-error disabled:opacity-40"
                  >
                    <Icon.X size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-outline-variant/10 px-4 py-3">
          <span className="text-[11px] font-mono text-outline">
            {turns > 0
              ? `${turns} ${turns === 1 ? "conversación" : "conversaciones"} guardadas`
              : "Sin conversaciones guardadas"}
          </span>
          <a
            href="/anden"
            className="focus-ring rounded-sm text-body-sm font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
          >
            Abrir Anden
          </a>
          <div className="ml-auto flex items-center gap-2">
            {confirming ? (
              <>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="btn-ghost focus-ring !px-3 !py-1.5 text-body-sm"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void removeAll()}
                  disabled={busy === "all"}
                  className="focus-ring rounded-md bg-error px-3 py-1.5 text-body-sm font-bold text-on-error disabled:opacity-40"
                >
                  Sí, borrar todo
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!facts.length && turns === 0}
                className="btn-ghost focus-ring !px-3 !py-1.5 text-body-sm disabled:opacity-40"
              >
                Borrar todo
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
