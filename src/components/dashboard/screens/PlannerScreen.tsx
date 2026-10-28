"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import type { Station, RouteSequence, ReportItem } from "../types";
import { LINE_META, MANUAL_CONNECTIONS, type LineId, normalizeStationKey } from "../lines";
import { Icon } from "../Icon";
import { classNames, formatClock, formatEta, lineShort } from "../utils";
import type { Prediction } from "@/lib/telemetry";
import { ACCESSIBILITY_METADATA } from "@/lib/metadata";

interface Leg {
  routeId: LineId | null;
  stops: string[];
}

interface PlannedRoute {
  legs: Leg[];
  time: number;
  stops: number;
  transfers: number;
}

interface Props {
  stations: Station[];
  sequences: RouteSequence[];
  predictions: Prediction[];
  userReports: ReportItem[];
}

export function PlannerScreen({ stations, sequences, predictions, userReports }: Props) {
  const [origin, setOrigin] = useState<string>("");
  const [destination, setDestination] = useState<string>("");
  const [stepFree, setStepFree] = useState(false);
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Unique sorted station names
  const stationNames = useMemo(
    () => Array.from(new Set(stations.map((s) => s.stopName))).sort(),
    [stations]
  );

  // Build the graph once (Dijkstra).
  const graph = useMemo(() => {
    const g: Record<string, { node: string; weight: number; routeId: LineId | null }[]> = {};
    stations.forEach((s) => {
      g[s.stopId] = [];
    });
    sequences.forEach((seq) => {
      const list = sequences
        .filter((s) => s.routeId === seq.routeId && s.directionId === seq.directionId)
        .sort((a, b) => a.stopSequence - b.stopSequence);
      for (let i = 0; i < list.length - 1; i++) {
        const u = list[i].stopId;
        const v = list[i + 1].stopId;
        if (!g[u]) g[u] = [];
        if (!g[v]) g[v] = [];
        g[u].push({ node: v, weight: stepFree ? 1 : 1, routeId: seq.routeId as LineId });
        g[v].push({ node: u, weight: 1, routeId: seq.routeId as LineId });
      }
    });
    // Cross-platform connections (deduped by name pair)
    const seen = new Set<string>();
    for (let i = 0; i < stations.length; i++) {
      for (let j = i + 1; j < stations.length; j++) {
        const a = stations[i];
        const b = stations[j];
        const sameName = a.stopName === b.stopName;
        const manual = MANUAL_CONNECTIONS[a.stopName]?.includes(b.stopName);
        if (sameName || manual) {
          const aKey = `${a.stopName}::${[...new Set(sequences.filter((s) => s.stopId === a.stopId).map((s) => s.routeId))].sort().join(",")}`;
          const bKey = `${b.stopName}::${[...new Set(sequences.filter((s) => s.stopId === b.stopId).map((s) => s.routeId))].sort().join(",")}`;
          const pairKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);
          const aRoutes = new Set(
            sequences.filter((s) => s.stopId === a.stopId).map((s) => s.routeId)
          );
          const bRoutes = new Set(
            sequences.filter((s) => s.stopId === b.stopId).map((s) => s.routeId)
          );
          const overlap = [...aRoutes].some((r) => bRoutes.has(r));
          if (!overlap) {
            if (!g[a.stopId]) g[a.stopId] = [];
            if (!g[b.stopId]) g[b.stopId] = [];
            // If step-free required, connections heavy (8) to discourage.
            g[a.stopId].push({ node: b.stopId, weight: stepFree ? 8 : 3, routeId: null });
            g[b.stopId].push({ node: a.stopId, weight: stepFree ? 8 : 3, routeId: null });
          }
        }
      }
    }
    return g;
  }, [stations, sequences, stepFree]);

  const findRoute = useCallback(() => {
    if (!origin || !destination || origin === destination) return;
    const startIds = stations.filter((s) => s.stopName === origin).map((s) => s.stopId);
    const endIds = new Set(stations.filter((s) => s.stopName === destination).map((s) => s.stopId));
    if (!startIds.length || !endIds.size) return;

    // Multi-source Dijkstra
    const distances: Record<string, number> = {};
    const previous: Record<string, { node: string; routeId: LineId | null }> = {};
    const queue = new Set<string>(Object.keys(graph));

    startIds.forEach((s) => {
      distances[s] = 0;
    });
    Object.keys(graph).forEach((n) => {
      if (!(n in distances)) distances[n] = Infinity;
    });

    let bestPath: { stopId: string; routeId: LineId | null }[] | null = null;
    let bestDist = Infinity;

    while (queue.size) {
      let u: string | null = null;
      let minD = Infinity;
      for (const n of queue) {
        const d = distances[n] ?? Infinity;
        if (d < minD) {
          minD = d;
          u = n;
        }
      }
      if (u === null) break;
      queue.delete(u);
      if (endIds.has(u) && minD < bestDist) {
        bestDist = minD;
        const path: { stopId: string; routeId: LineId | null }[] = [];
        let cur: string | null = u;
        while (cur) {
          const info: { node: string; routeId: LineId | null } | undefined =
            previous[cur as string];
          path.push({ stopId: cur, routeId: info?.routeId ?? null });
          cur = info?.node ?? null;
        }
        path.reverse();
        bestPath = path;
      }
      for (const e of graph[u] ?? []) {
        if (!queue.has(e.node)) continue;
        const alt = minD + e.weight;
        if (alt < (distances[e.node] ?? Infinity)) {
          distances[e.node] = alt;
          previous[e.node] = { node: u, routeId: e.routeId };
        }
      }
    }

    if (!bestPath) {
      setRoute(null);
      return;
    }

    // Group into legs
    const legs: Leg[] = [];
    let current: Leg | null = null;
    for (let i = 0; i < bestPath.length; i++) {
      const item = bestPath[i];
      const stationObj = stations.find((s) => s.stopId === item.stopId);
      if (!stationObj) continue;
      const next = bestPath[i + 1];
      const nextRoute = next?.routeId ?? null;
      if (!current) {
        current = { routeId: nextRoute, stops: [stationObj.stopName] };
      } else {
        current.stops.push(stationObj.stopName);
        if (nextRoute !== current.routeId) {
          legs.push(current);
          current = { routeId: nextRoute, stops: [stationObj.stopName] };
        }
      }
    }
    if (current && current.stops.length) legs.push(current);

    const stops = bestPath.length;
    const transfers = Math.max(0, legs.filter((l) => l.routeId !== null).length - 1);
    const time = stops * 2 + transfers * 4;
    setRoute({ legs, time, stops, transfers });
  }, [origin, destination, stations, graph]);

  // Live departures from origin
  const liveFromOrigin = useMemo(() => {
    if (!origin || !predictions.length) return [];
    return predictions
      .filter((p) => p.stationName === origin)
      .filter((p) => p.etaSeconds >= 0 && p.etaSeconds < 1800)
      .sort((a, b) => a.etaSeconds - b.etaSeconds)
      .slice(0, 8);
  }, [origin, predictions]);

  // If step-free, drop legs whose stations have no accessibility info
  const isStepFreeCompatible = useMemo(() => {
    if (!route) return true;
    for (const leg of route.legs) {
      if (!leg.routeId) continue;
      for (const stop of leg.stops) {
        const key = normalizeStationKey(stop);
        if (!ACCESSIBILITY_METADATA[key]) return false;
      }
    }
    return true;
  }, [route]);

  // Find stations with active reports
  const stationsWithReports = useMemo(() => {
    const s = new Set<string>();
    userReports.forEach((r) => s.add(r.station));
    return s;
  }, [userReports]);
  const originHasReport = origin && stationsWithReports.has(origin);
  const destHasReport = destination && stationsWithReports.has(destination);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 max-w-6xl mx-auto w-full">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-label-caps text-outline tracking-widest">Subte Live</p>
          <h1 className="text-headline-lg font-bold text-on-background tracking-tight mt-0.5">
            Planificador de Viaje
          </h1>
          <p className="text-body-md text-on-surface-variant mt-1">
            Calculá la mejor ruta entre dos estaciones de la red.
          </p>
        </div>
        <div className="hidden md:flex items-center gap-2 text-body-sm text-on-surface-variant">
          <span className="live-dot" />
          <span className="font-mono">{formatClock(now)}</span>
        </div>
      </header>

      {/* Inputs — origin/destination, swap, accessibility toggle */}
      <section className="bento-card p-4 md:p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto] items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="planner-origin" className="text-label-caps text-outline">
              Origen
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary">
                <Icon.Pin size={18} />
              </span>
              <select
                id="planner-origin"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                className="w-full appearance-none bg-surface-container-low border border-outline-variant/15 rounded-md pl-10 pr-9 py-3 md:py-2.5 text-body-md text-on-background focus-ring focus:border-primary-container"
              >
                <option value="">Elegí una estación</option>
                {stationNames.map((n) => (
                  <option key={`o-${n}`} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-outline pointer-events-none">
                <Icon.Caret size={16} />
              </span>
            </div>
          </div>

          <button
            onClick={() => {
              const a = origin;
              setOrigin(destination);
              setDestination(a);
            }}
            className="icon-btn !w-10 !h-10 bg-surface-container border border-outline-variant/15 hover:border-primary-container/40 focus-ring"
            aria-label="Invertir origen y destino"
          >
            <Icon.Swap size={18} />
          </button>

          <div className="flex flex-col gap-1">
            <label htmlFor="planner-dest" className="text-label-caps text-outline">
              Destino
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary">
                <Icon.Pin size={18} />
              </span>
              <select
                id="planner-dest"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="w-full appearance-none bg-surface-container-low border border-outline-variant/15 rounded-md pl-10 pr-9 py-3 md:py-2.5 text-body-md text-on-background focus-ring focus:border-primary-container"
              >
                <option value="">Elegí una estación</option>
                {stationNames.map((n) => (
                  <option key={`d-${n}`} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-outline pointer-events-none">
                <Icon.Caret size={16} />
              </span>
            </div>
          </div>

          <button
            onClick={findRoute}
            disabled={!origin || !destination}
            className="btn-primary focus-ring"
          >
            <Icon.Search size={16} />
            Buscar rutas
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <label className="flex items-center gap-2 text-body-sm text-on-surface-variant cursor-pointer select-none">
            <input
              type="checkbox"
              checked={stepFree}
              onChange={(e) => setStepFree(e.target.checked)}
              className="appearance-none h-5 w-5 rounded border border-outline-variant/40 bg-surface-container checked:bg-primary-container checked:border-primary-container transition focus-ring"
              style={{
                backgroundImage: stepFree
                  ? "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2300344b' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E\")"
                  : "none",
                backgroundSize: "14px 14px",
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
              }}
            />
            <Icon.Accessibility size={16} className="text-primary" />
            Priorizar estaciones con ascensores
          </label>
        </div>
      </section>

      {/* Report warnings */}
      {(originHasReport || destHasReport) && (
        <section className="bento-card border-amber-500/30 p-3 flex flex-wrap items-center gap-2 text-body-sm text-amber-300">
          <Icon.Alert size={16} className="shrink-0" />
          {originHasReport && (
            <span>
              Reportes activos en <strong>{origin}</strong>
            </span>
          )}
          {originHasReport && destHasReport && <span> · </span>}
          {destHasReport && (
            <span>
              Reportes activos en <strong>{destination}</strong>
            </span>
          )}
        </section>
      )}

      {/* Results grid */}
      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Timeline */}
        <div className="bento-card p-4 md:p-5 flex flex-col min-h-[320px]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-headline-sm font-bold text-on-background flex items-center gap-2">
              <Icon.Route size={18} className="text-primary" />
              Tu ruta
            </h2>
            {route && (
              <div className="flex items-center gap-3 text-label-caps">
                <span className="flex items-center gap-1 text-on-surface-variant">
                  <Icon.Clock size={14} />
                  {route.time} min
                </span>
                <span className="flex items-center gap-1 text-on-surface-variant">
                  <Icon.Pin size={14} />
                  {route.stops} paradas
                </span>
                <span className="flex items-center gap-1 text-on-surface-variant">
                  <Icon.Transfer size={14} />
                  {route.transfers} conexiones
                </span>
              </div>
            )}
          </div>

          {!route ? (
            <div className="flex-1 flex flex-col items-center justify-center text-on-surface-variant py-10">
              <Icon.Route size={42} className="text-outline mb-3 opacity-60" />
              <p className="text-body-md">Elegí origen y destino para calcular una ruta.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {route.legs.map((leg, idx) => {
                if (!leg.routeId) {
                  return (
                    <div key={`tr-${idx}`} className="flex items-center gap-3 pl-2 py-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                      <p className="text-body-sm text-amber-300 font-semibold">
                        Transbordo en {leg.stops[0]}
                      </p>
                    </div>
                  );
                }
                const lineColor = LINE_META[leg.routeId].color;
                return (
                  <div key={`leg-${idx}`} className="inner-card p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="line-badge" style={{ background: lineColor }}>
                        {lineShort(leg.routeId)}
                      </span>
                      <p className="text-body-sm font-bold text-on-background">
                        {LINE_META[leg.routeId].name}
                      </p>
                      <span className="ml-auto text-label-caps text-outline font-mono">
                        {(leg.stops.length - 1) * 2} min
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5 pl-1">
                      {leg.stops.map((s, i) => {
                        const first = i === 0;
                        const last = i === leg.stops.length - 1;
                        return (
                          <div
                            key={`s-${idx}-${i}`}
                            className="flex items-center gap-2 text-body-sm"
                          >
                            {first ? (
                              <Icon.Pin size={12} className="text-primary shrink-0" />
                            ) : last ? (
                              <Icon.Pin size={12} className="text-secondary shrink-0" />
                            ) : (
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ background: lineColor, opacity: 0.5 }}
                              />
                            )}
                            <span
                              className={classNames(
                                first || last
                                  ? "font-bold text-on-background"
                                  : "text-on-surface-variant"
                              )}
                            >
                              {s}
                            </span>
                            {stationsWithReports.has(s) && <span title="Reportes activos">⚠</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Accessibility warning */}
              {stepFree && !isStepFreeCompatible && (
                <div className="mt-2 inner-card border border-amber-500/30 p-3 text-body-sm text-amber-300 flex items-start gap-2">
                  <Icon.Accessibility size={16} className="shrink-0 mt-0.5" />
                  Algunas estaciones de esta ruta no tienen ascensor. Considerá reducir transbordos.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live departures from origin */}
        <div className="bento-card p-4 md:p-5 flex flex-col min-h-[320px]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-headline-sm font-bold text-on-background flex items-center gap-2">
              <Icon.Clock size={18} className="text-primary" />
              Próximas salidas
            </h2>
            {origin && (
              <span className="text-label-caps text-outline truncate max-w-[140px]">{origin}</span>
            )}
          </div>

          {!origin ? (
            <div className="flex-1 flex flex-col items-center justify-center text-on-surface-variant py-10">
              <Icon.Clock size={42} className="text-outline mb-3 opacity-60" />
              <p className="text-body-md">Elegí un origen para ver arribos.</p>
            </div>
          ) : liveFromOrigin.length === 0 ? (
            <p className="text-body-sm text-outline">Sin arribos en los próximos 30 min.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-outline-variant/10">
              {liveFromOrigin.map((p, i) => {
                const isNow = p.etaSeconds <= 15;
                return (
                  <li key={`dep-${i}`} className="flex items-center gap-3 py-2.5">
                    <span
                      className="line-badge"
                      style={{ background: LINE_META[p.routeId as LineId]?.color }}
                    >
                      {lineShort(p.routeId)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-body-sm font-bold text-on-background truncate">
                        → {p.destinationName}
                      </p>
                    </div>
                    <span
                      className={classNames(
                        "font-mono font-bold tabular-nums text-right",
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
          )}
        </div>
      </section>
    </div>
  );
}
