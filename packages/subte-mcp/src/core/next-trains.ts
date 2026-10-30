import { getBootstrap, getTelemetry } from './client.ts';
import { feedFreshness } from './feed.ts';
import { lineLabel, matchLines } from './lines.ts';
import { compactName } from './names.ts';
import { buildStationIndex, resolveStation } from './network.ts';

const VALID_LINES = 'LineaA, LineaB, LineaC, LineaD, LineaE, LineaH, Premetro';

export interface NextTrainsQuery {
  station: string;
  line?: string;
  limit?: number;
}

export interface Arrival {
  line: string;
  directionId: number;
  destination: string;
  etaSeconds: number;
  etaMinutes: number;
  delaySeconds: number;
  stopId: string;
}

export interface NextTrainsResult {
  station: string;
  lines: string[];
  note?: string;
  stale: boolean;
  feedAgeSeconds: number | null;
  feedUpdatedAt: string | null;
  arrivals: Arrival[];
}

export async function getNextTrains(query: NextTrainsQuery): Promise<NextTrainsResult> {
  const { station, line, limit = 3 } = query;

  const index = buildStationIndex(await getBootstrap());
  const resolved = resolveStation(station, index);
  if (!resolved.ok) throw new Error(resolved.message);

  const requested = line ? matchLines(line) : [];
  if (line && !requested.length) {
    throw new Error(`unknown line '${line}'. Valid values: ${VALID_LINES}.`);
  }

  const served = requested.length
    ? requested.filter(candidate => resolved.station.lines.includes(candidate))
    : resolved.station.lines;

  if (requested.length && !served.length) {
    throw new Error(
      `station '${resolved.station.name}' is not served by ${requested.map(lineLabel).join(' or ')}. ` +
        `Lines at this station: ${resolved.station.lines.map(lineLabel).join(', ')}.`
    );
  }

  if (!served.length) {
    throw new Error(`station '${resolved.station.name}' has no line information in the reference feed.`);
  }

  const telemetry = await getTelemetry();
  const allowed = new Set(served);
  const arrivals = telemetry.predictions
    .filter(prediction => compactName(prediction.stationName) === resolved.station.key)
    .filter(prediction => allowed.has(prediction.routeId))
    .filter(prediction => prediction.etaSeconds >= 0)
    .sort((a, b) => a.etaSeconds - b.etaSeconds)
    .slice(0, limit)
    .map(prediction => ({
      line: prediction.routeId,
      directionId: prediction.directionId,
      destination: prediction.destinationName,
      etaSeconds: prediction.etaSeconds,
      etaMinutes: Math.round(prediction.etaSeconds / 60),
      delaySeconds: prediction.delay,
      stopId: prediction.stopId,
    }));

  const onlyLineD = served.every(candidate => candidate === 'LineaD');
  const note =
    arrivals.length === 0
      ? onlyLineD
        ? 'LineaD is not included in the live telemetry feed.'
        : 'no upcoming arrivals in the current feed.'
      : undefined;

  return {
    station: resolved.station.name,
    lines: served,
    ...(note ? { note } : {}),
    ...feedFreshness(telemetry),
    arrivals,
  };
}
