"use client";

import { useState, useMemo } from "react";
import type { Station, RouteSequence } from "../types";
import { LINE_META, type LineId } from "../lines";
import { Icon } from "../Icon";
import { classNames, formatClock, formatEta, lineShort } from "../utils";
import type { Prediction, TrainTelemetry } from "@/lib/telemetry";

interface Props {
  stations: Station[];
  sequences: RouteSequence[];
  predictions: Prediction[];
  trainsByLine: Record<string, TrainTelemetry[]>;
  now: number;
}

export function ArrivalsScreen({ stations, predictions, trainsByLine, now }: Props) {
  const [origin, setOrigin] = useState<string>("");
  const [lineFilter, setLineFilter] = useState<LineId | "All">("All");

  const stationNames = useMemo(
    () => Array.from(new Set(stations.map((s) => s.stopName))).sort(),
    [stations]
  );

  const arrivals = useMemo(() => {
    let list = predictions.filter((p) => p.etaSeconds >= 0 && p.etaSeconds < 1800);
    if (origin) list = list.filter((p) => p.stationName === origin);
    if (lineFilter !== "All") list = list.filter((p) => p.routeId === lineFilter);
    return list.sort((a, b) => a.etaSeconds - b.etaSeconds).slice(0, 60);
  }, [predictions, origin, lineFilter]);

  const grouped = useMemo(() => {
    const m: Record<string, typeof arrivals> = {};
    for (const arr of arrivals) {
      const key = arr.routeId;
      if (!m[key]) m[key] = [];
      m[key].push(arr);
    }
    return m;
  }, [arrivals]);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 max-w-6xl mx-auto w-full">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <p className="text-label-caps text-outline tracking-widest">Subte Live</p>
          <h1 className="text-headline-lg font-bold text-on-background tracking-tight mt-0.5">
            Próximos Arribos
          </h1>
          <p className="text-body-md text-on-surface-variant mt-1">
            Filtrá por estación y línea para ver los próximos servicios.
          </p>
        </div>
        <div className="flex items-center gap-2 text-body-sm text-on-surface-variant">
          <span className="live-dot" />
          <span className="font-mono">{formatClock(now)}</span>
        </div>
      </header>

      {/* Filters */}
      <section className="bento-card p-4 grid gap-3 md:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor="arr-origin" className="text-label-caps text-outline block mb-1">
            Estación
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary">
              <Icon.Pin size={18} />
            </span>
            <select
              id="arr-origin"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              className="w-full appearance-none bg-surface-container-low border border-outline-variant/15 rounded-md pl-10 pr-9 py-2.5 text-body-md text-on-background focus-ring focus:border-primary-container"
            >
              <option value="">Todas las estaciones</option>
              {stationNames.map((n) => (
                <option key={`a-${n}`} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-outline pointer-events-none">
              <Icon.Caret size={16} />
            </span>
          </div>
        </div>
        <div>
          <p className="text-label-caps text-outline mb-1">Línea</p>
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setLineFilter("All")}
              className={classNames(
                "flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-semibold transition-all active:scale-90 border touch-target",
                lineFilter === "All"
                  ? "bg-primary-container text-on-primary-container border-primary-container"
                  : "bg-surface-container/80 text-on-surface-variant border-outline-variant/20"
              )}
            >
              Todas
            </button>
            {Object.values(LINE_META).map((l) => (
              <button
                key={l.id}
                onClick={() => setLineFilter(l.id)}
                className={classNames(
                  "flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-semibold transition-all active:scale-90 border",
                  lineFilter === l.id
                    ? "text-white border-transparent"
                    : "bg-surface-container/80 text-on-surface-variant border-outline-variant/20"
                )}
                style={lineFilter === l.id ? { background: l.color } : {}}
              >
                <span
                  className="flex items-center justify-center rounded-full text-[9px] font-black text-white shrink-0"
                  style={{ background: l.color, width: 18, height: 18 }}
                >
                  {lineShort(l.id)}
                </span>
                {l.short}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Summary cards */}
      <section className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <div className="bento-card p-3 text-center">
          <p className="text-data-lg font-bold text-primary">{arrivals.length}</p>
          <p className="text-label-caps text-outline mt-0.5">Arribos</p>
        </div>
        <div className="bento-card p-3 text-center">
          <p className="text-data-lg font-bold text-primary">{Object.keys(grouped).length}</p>
          <p className="text-label-caps text-outline mt-0.5">Líneas activas</p>
        </div>
        <div className="bento-card p-3 text-center">
          <p className="text-data-lg font-bold text-primary">
            {arrivals.length > 0 ? formatEta(arrivals[0].etaSeconds) : "—"}
          </p>
          <p className="text-label-caps text-outline mt-0.5">Próximo</p>
        </div>
        <div className="bento-card p-3 text-center">
          <p className="text-data-lg font-bold text-primary">
            {Object.values(trainsByLine).reduce((s, t) => s + t.length, 0)}
          </p>
          <p className="text-label-caps text-outline mt-0.5">Formaciones</p>
        </div>
      </section>

      {/* Grouped list */}
      {arrivals.length === 0 ? (
        <div className="bento-card p-10 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-high mb-3">
            <Icon.Clock size={24} className="text-outline" />
          </span>
          <p className="text-headline-sm font-bold text-on-background">Sin arribos</p>
          <p className="text-body-sm text-on-surface-variant mt-1">
            No hay servicios próximos con los filtros actuales.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {Object.entries(grouped).map(([routeId, list]) => {
            const line = LINE_META[routeId as LineId];
            return (
              <section key={routeId} className="bento-card p-3 md:p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="line-badge" style={{ background: line.color }}>
                    {lineShort(line.id)}
                  </span>
                  <h2 className="text-title-sm font-bold text-on-background">{line.name}</h2>
                  <span className="text-label-caps text-outline">{list.length} arribos</span>
                </div>
                <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((p, i) => {
                    const isNow = p.etaSeconds <= 15;
                    return (
                      <li
                        key={`a-${routeId}-${i}`}
                        className={classNames(
                          "inner-card p-3 md:p-2.5 flex items-center gap-2 touch-target",
                          isNow && "border-primary-container/40"
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-body-sm font-bold text-on-background truncate">
                            {p.stationName}
                          </p>
                          <p className="text-[10px] text-on-surface-variant truncate">
                            → {p.destinationName}
                          </p>
                        </div>
                        {p.delay > 0 && (
                          <span className="text-[9px] font-mono text-amber-300 font-bold shrink-0">
                            +{Math.round(p.delay / 60)}m
                          </span>
                        )}
                        <span
                          className={classNames(
                            "font-mono font-bold tabular-nums shrink-0 text-right",
                            isNow ? "text-primary" : "text-on-background"
                          )}
                        >
                          {isNow ? (
                            <span className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                              AHORA
                            </span>
                          ) : (
                            formatEta(p.etaSeconds)
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
