"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { TrainTelemetry, AlertData, Prediction } from "@/lib/telemetry";
import type { Station, RouteSequence, ReportItem } from "./types";
import { ALL_LINE_IDS, type LineId } from "./lines";
import { isLineId } from "./utils";

// Per-category expiry in milliseconds
const REPORT_TTL: Record<string, number> = {
  "Demora excesiva": 30 * 60 * 1000,
  "Aglomeración / congestión": 60 * 60 * 1000,
  "Formación fuera de servicio": 2 * 60 * 60 * 1000,
  "Estación cerrada": 4 * 60 * 60 * 1000,
  "Incidente de seguridad": 4 * 60 * 60 * 1000,
  Otro: 2 * 60 * 60 * 1000,
};
const DEFAULT_REPORT_TTL = 24 * 60 * 60 * 1000; // ascensor/escalera

const POLL_MS = 2000;

export interface TelemetryPayload {
  trains: TrainTelemetry[];
  alerts: AlertData[];
  predictions: Prediction[];
  stale?: boolean;
}

export function useDashboardData() {
  const [telemetry, setTelemetry] = useState<TelemetryPayload>({
    trains: [],
    alerts: [],
    predictions: [],
  });
  const [stations, setStations] = useState<Station[]>([]);
  const [sequences, setSequences] = useState<RouteSequence[]>([]);
  const [activeLine, setActiveLine] = useState<LineId | "All">("All");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  // Lazy initialiser: reading the wall clock is only allowed at mount time, not on every render.
  const [now, setNow] = useState<number>(() => Date.now());

  // Initial bootstrap — stations + sequences come from the server in `page.tsx`,
  // but we also support fetching them lazily if absent.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bootstrap", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        setStations(json.stations ?? []);
        setSequences(json.sequences ?? []);
      } catch {
        /* fallback to props if API absent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Polling
  const fetchTelemetry = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/telemetry?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data);
        // If server says 'stale', show connection banner but keep showing previous data
        setConnectionError(data.stale === true);
      } else {
        setConnectionError(true);
      }
    } catch {
      setConnectionError(true);
    } finally {
      setTimeout(() => setIsRefreshing(false), 350);
    }
  }, []);

  useEffect(() => {
    // Kick the first poll off in a microtask so the effect body itself never sets state
    // synchronously (avoids a cascading render on mount).
    queueMicrotask(fetchTelemetry);
    const id = setInterval(fetchTelemetry, POLL_MS);
    return () => clearInterval(id);
  }, [fetchTelemetry]);

  // Clock tick for live ETAs
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Trains grouped by line
  const trainsByLine = useMemo(() => {
    const map: Record<string, TrainTelemetry[]> = {};
    for (const id of ALL_LINE_IDS) map[id] = [];
    for (const t of telemetry.trains) {
      if (map[t.routeId]) map[t.routeId].push(t);
    }
    return map;
  }, [telemetry.trains]);

  const visibleLines = useMemo(() => {
    return ALL_LINE_IDS.filter((id) => isLineId(id) && (activeLine === "All" || activeLine === id));
  }, [activeLine]);

  // Filter predictions that are still upcoming
  const livePredictions = useMemo(() => {
    if (!telemetry.predictions) return [];
    return telemetry.predictions.filter((p) => p.etaSeconds >= -10 && p.etaSeconds < 1800);
  }, [telemetry.predictions]);

  // `activeLine` is typed `LineId | "All"` and every setter call site passes a valid line, so no
  // effect is needed to reset a stale/invalid selection.

  // User-submitted reports — fetch every 60s, filter by per-category TTL
  const [userReports, setUserReports] = useState<ReportItem[]>([]);
  const fetchUserReports = useCallback(async () => {
    try {
      const res = await fetch("/api/reports");
      if (!res.ok) return;
      const data: ReportItem[] = await res.json();
      const now = Date.now();
      setUserReports(
        data.filter((r) => {
          const ttl = REPORT_TTL[r.category] ?? DEFAULT_REPORT_TTL;
          return now - new Date(r.createdAt).getTime() < ttl;
        })
      );
    } catch {
      /* silent */
    }
  }, []);
  useEffect(() => {
    // Same as above: defer the first fetch to a microtask, then poll.
    queueMicrotask(fetchUserReports);
    const id = setInterval(fetchUserReports, 60_000);
    return () => clearInterval(id);
  }, [fetchUserReports]);

  return {
    stations,
    sequences,
    telemetry: { ...telemetry, predictions: livePredictions },
    activeLine,
    setActiveLine,
    visibleLines,
    trainsByLine,
    isRefreshing,
    connectionError,
    fetchTelemetry,
    now,
    userReports,
  };
}
