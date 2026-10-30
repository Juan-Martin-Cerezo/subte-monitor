import transfersData from "../data/transfers.json" with { type: "json" };
import accessibilityData from "../data/accessibility.json" with { type: "json" };
import type { Bootstrap } from "./types.ts";
import { compactName, editDistance, normalizeName } from "./names.ts";

const TRANSFERS = transfersData as Record<string, string[]>;
const ACCESSIBILITY = accessibilityData as Record<string, { elevators: number; stairs: number }>;

export interface PhysicalStation {
  name: string;
  key: string;
  latitude: number;
  longitude: number;
  lines: string[];
}

export interface StationIndex {
  stations: PhysicalStation[];
  byKey: Map<string, PhysicalStation>;
}

export type ResolveResult = { ok: true; station: PhysicalStation } | { ok: false; message: string };

export function buildStationIndex(bootstrap: Bootstrap): StationIndex {
  const routesByStop = new Map<string, Set<string>>();
  for (const sequence of bootstrap.sequences) {
    const routes = routesByStop.get(sequence.stopId) ?? new Set<string>();
    routes.add(sequence.routeId);
    routesByStop.set(sequence.stopId, routes);
  }

  const byKey = new Map<string, PhysicalStation>();
  for (const station of bootstrap.stations) {
    const key = compactName(station.stopName);
    let physical = byKey.get(key);
    if (!physical) {
      physical = {
        name: station.stopName,
        key,
        latitude: station.latitude,
        longitude: station.longitude,
        lines: [],
      };
      byKey.set(key, physical);
    }
    for (const line of routesByStop.get(station.stopId) ?? []) {
      if (!physical.lines.includes(line)) physical.lines.push(line);
    }
  }

  for (const station of byKey.values()) {
    station.lines.sort();
  }

  return { stations: [...byKey.values()], byKey };
}

function candidatesMessage(input: string, stations: PhysicalStation[]): string {
  const names = stations.slice(0, 8).map((station) => station.name);
  const extra = stations.length > 8 ? `, and ${stations.length - 8} more` : "";
  return `station '${input}' is ambiguous. Candidates: ${names.join(", ")}${extra}.`;
}

export function resolveStation(input: string, index: StationIndex): ResolveResult {
  const cleaned = normalizeName(input).replace(/^(estacion|station)\s+/, "");
  const key = cleaned.replace(/ /g, "");

  if (!key) return { ok: false, message: "station name is empty" };
  if (key.length < 2) {
    return {
      ok: false,
      message: `station '${input}' is too short. Provide at least two characters.`,
    };
  }

  const exact = index.byKey.get(key);
  if (exact) return { ok: true, station: exact };

  const prefixed = index.stations.filter((station) => station.key.startsWith(key));
  if (prefixed.length === 1) return { ok: true, station: prefixed[0] as PhysicalStation };
  if (prefixed.length > 1) return { ok: false, message: candidatesMessage(input, prefixed) };

  const scored = index.stations
    .map((station) => ({ station, distance: editDistance(key, station.key) }))
    .sort((a, b) => a.distance - b.distance || a.station.name.localeCompare(b.station.name));

  const bestDistance = scored[0]?.distance ?? Number.POSITIVE_INFINITY;
  if (bestDistance <= 2) {
    const best = scored
      .filter((item) => item.distance === bestDistance)
      .map((item) => item.station);
    if (best.length === 1) return { ok: true, station: best[0] as PhysicalStation };
    return { ok: false, message: candidatesMessage(input, best) };
  }

  const closest = scored.slice(0, 3).map((item) => item.station.name);
  return {
    ok: false,
    message: `station '${input}' not found. Closest: ${closest.join(", ")}.`,
  };
}

export interface PlanEdge {
  to: string;
  type: "ride" | "transfer";
  fromName: string;
  toName: string;
  fromLine: string;
  toLine: string;
  stops: number;
  minutes: number;
  accessible: boolean;
}

export interface PlanGraph {
  adjacency: Map<string, PlanEdge[]>;
  routesByKey: Map<string, string[]>;
  namesByKey: Map<string, string>;
}

export interface TripLeg {
  line: string;
  board: string;
  alight: string;
  stops: number;
}

export interface TransferPoint {
  from: string;
  to: string;
  fromLine: string;
  toLine: string;
  walkMinutes: number;
  accessible: boolean;
}

export interface TripPlan {
  legs: TripLeg[];
  transferPoints: TransferPoint[];
  totalStops: number;
  transferCount: number;
  durationMinutes: number;
}

function state(stationKey: string, line: string): string {
  return `${stationKey}|${line}`;
}

function hasElevator(stationKey: string): boolean {
  return (ACCESSIBILITY[stationKey]?.elevators ?? 0) > 0;
}

export function buildGraph(
  bootstrap: Bootstrap,
  index: StationIndex,
  stepFree: boolean
): PlanGraph {
  const adjacency = new Map<string, PlanEdge[]>();
  const routesByKey = new Map<string, string[]>();
  const namesByKey = new Map<string, string>();

  for (const station of index.stations) {
    routesByKey.set(station.key, station.lines);
    namesByKey.set(station.key, station.name);
  }

  const addEdge = (from: string, edge: PlanEdge) => {
    const edges = adjacency.get(from) ?? [];
    const duplicate = edges.some(
      (existing) =>
        existing.to === edge.to &&
        existing.type === edge.type &&
        existing.fromLine === edge.fromLine &&
        existing.toLine === edge.toLine
    );
    if (!duplicate) edges.push(edge);
    adjacency.set(from, edges);
  };

  const rideKeys = new Set<string>();
  const stationByStopId = new Map(bootstrap.stations.map((station) => [station.stopId, station]));
  const byRouteDirection = new Map<
    string,
    { routeId: string; stopId: string; stopSequence: number }[]
  >();
  for (const sequence of bootstrap.sequences) {
    const key = `${sequence.routeId}|${sequence.directionId}`;
    const list = byRouteDirection.get(key) ?? [];
    list.push(sequence);
    byRouteDirection.set(key, list);
  }

  for (const list of byRouteDirection.values()) {
    list.sort((a, b) => a.stopSequence - b.stopSequence);
    for (let i = 0; i < list.length - 1; i++) {
      const fromStop = list[i];
      const toStop = list[i + 1];
      if (!fromStop || !toStop) continue;

      const from = stationByStopId.get(fromStop.stopId);
      const to = stationByStopId.get(toStop.stopId);
      if (!from || !to) continue;

      const fromKey = compactName(from.stopName);
      const toKey = compactName(to.stopName);
      if (!fromKey || !toKey) continue;

      const fromState = state(fromKey, fromStop.routeId);
      const toState = state(toKey, toStop.routeId);
      const pair = `${fromState}>${toState}`;
      if (rideKeys.has(pair)) continue;
      rideKeys.add(pair);

      addEdge(fromState, {
        to: toState,
        type: "ride",
        fromName: namesByKey.get(fromKey) ?? from.stopName,
        toName: namesByKey.get(toKey) ?? to.stopName,
        fromLine: fromStop.routeId,
        toLine: toStop.routeId,
        stops: 1,
        minutes: 2,
        accessible: true,
      });
      addEdge(toState, {
        to: fromState,
        type: "ride",
        fromName: namesByKey.get(toKey) ?? to.stopName,
        toName: namesByKey.get(fromKey) ?? from.stopName,
        fromLine: toStop.routeId,
        toLine: toStop.routeId,
        stops: 1,
        minutes: 2,
        accessible: true,
      });
    }
  }

  for (const [stationKey, lines] of routesByKey) {
    if (lines.length < 2) continue;
    const accessible = hasElevator(stationKey);
    if (stepFree && !accessible) continue;

    for (const fromLine of lines) {
      for (const toLine of lines) {
        if (fromLine === toLine) continue;
        const fromName = namesByKey.get(stationKey) ?? stationKey;
        addEdge(state(stationKey, fromLine), {
          to: state(stationKey, toLine),
          type: "transfer",
          fromName,
          toName: fromName,
          fromLine,
          toLine,
          stops: 0,
          minutes: 3,
          accessible,
        });
      }
    }
  }

  for (const [fromKey, toKeys] of Object.entries(TRANSFERS)) {
    const fromLines = routesByKey.get(fromKey);
    if (!fromLines?.length) continue;

    for (const toKey of toKeys) {
      const toLines = routesByKey.get(toKey);
      if (!toLines?.length) continue;

      // a linked pair counts as step-free when either station has an elevator
      const accessible = hasElevator(fromKey) || hasElevator(toKey);
      if (stepFree && !accessible) continue;

      const fromName = namesByKey.get(fromKey) ?? fromKey;
      const toName = namesByKey.get(toKey) ?? toKey;

      for (const fromLine of fromLines) {
        for (const toLine of toLines) {
          if (fromLine === toLine) continue;
          addEdge(state(fromKey, fromLine), {
            to: state(toKey, toLine),
            type: "transfer",
            fromName,
            toName,
            fromLine,
            toLine,
            stops: 0,
            minutes: 3,
            accessible,
          });
        }
      }
    }
  }

  return { adjacency, routesByKey, namesByKey };
}

export function findPlan(graph: PlanGraph, fromKey: string, toKey: string): TripPlan | null {
  const startLines = graph.routesByKey.get(fromKey) ?? [];
  if (!startLines.length) return null;

  const distances = new Map<string, number>();
  const previous = new Map<string, { node: string; edge: PlanEdge }>();
  const pending = new Set<string>();
  const settled = new Set<string>();

  for (const line of startLines) {
    const node = state(fromKey, line);
    distances.set(node, 0);
    pending.add(node);
  }

  let targetNode: string | null = null;

  while (pending.size) {
    let current: string | null = null;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const node of pending) {
      const distance = distances.get(node) ?? Number.POSITIVE_INFINITY;
      if (distance < currentDistance) {
        current = node;
        currentDistance = distance;
      }
    }
    if (!current) break;
    pending.delete(current);
    settled.add(current);

    if (current.split("|")[0] === toKey) {
      targetNode = current;
      break;
    }

    for (const edge of graph.adjacency.get(current) ?? []) {
      if (settled.has(edge.to)) continue;
      const nextDistance = currentDistance + edge.minutes;
      if (nextDistance < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.to, nextDistance);
        previous.set(edge.to, { node: current, edge });
        pending.add(edge.to);
      }
    }
  }

  if (!targetNode) return null;

  const edges: PlanEdge[] = [];
  let cursor: string | undefined = targetNode;
  while (cursor) {
    const step = previous.get(cursor);
    if (!step) break;
    edges.push(step.edge);
    cursor = step.node;
  }
  edges.reverse();

  const legs: TripLeg[] = [];
  const transferPoints: TransferPoint[] = [];
  let currentLeg: TripLeg | null = null;

  for (const edge of edges) {
    if (edge.type === "transfer") {
      if (currentLeg) {
        legs.push(currentLeg);
        currentLeg = null;
      }
      transferPoints.push({
        from: edge.fromName,
        to: edge.toName,
        fromLine: edge.fromLine,
        toLine: edge.toLine,
        walkMinutes: edge.minutes,
        accessible: edge.accessible,
      });
      continue;
    }

    if (!currentLeg || currentLeg.line !== edge.fromLine) {
      if (currentLeg) legs.push(currentLeg);
      currentLeg = {
        line: edge.fromLine,
        board: edge.fromName,
        alight: edge.toName,
        stops: 1,
      };
    } else {
      currentLeg.alight = edge.toName;
      currentLeg.stops += 1;
    }
  }
  if (currentLeg) legs.push(currentLeg);

  const totalStops = legs.reduce((sum, leg) => sum + leg.stops, 0);
  const transferCount = transferPoints.length;

  return {
    legs,
    transferPoints,
    totalStops,
    transferCount,
    durationMinutes: totalStops * 2 + transferCount * 3,
  };
}

export interface NearbyStation {
  name: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  lines: string[];
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radius = 6371000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findNearby(
  index: StationIndex,
  lat: number,
  lng: number,
  radiusMeters: number
): NearbyStation[] {
  return index.stations
    .map((station: PhysicalStation) => ({
      name: station.name,
      latitude: station.latitude,
      longitude: station.longitude,
      distanceMeters: Math.round(distanceMeters(lat, lng, station.latitude, station.longitude)),
      lines: station.lines,
    }))
    .filter((station: NearbyStation) => station.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}
