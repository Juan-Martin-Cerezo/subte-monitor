import { getTelemetry } from './client.js';
import { feedFreshness } from './feed.js';
import { matchLines } from './lines.js';

const VALID_LINES = 'LineaA, LineaB, LineaC, LineaD, LineaE, LineaH, Premetro';

export interface StatusAlert {
  id: string;
  header: string;
  description: string;
  cause: string;
  effect: string;
}

export interface StatusResult {
  generatedAt: string;
  line?: string;
  lines?: string[];
  stale: boolean;
  feedAgeSeconds: number | null;
  feedUpdatedAt: string | null;
  alertCount: number;
  alerts: Record<string, StatusAlert[]>;
}

export async function getStatus(line?: string): Promise<StatusResult> {
  const selected = line ? matchLines(line) : [];
  if (line && !selected.length) {
    throw new Error(`unknown line '${line}'. Valid values: ${VALID_LINES}.`);
  }

  const telemetry = await getTelemetry();
  const alerts: Record<string, StatusAlert[]> = {};

  for (const alert of telemetry.alerts) {
    if (selected.length && !selected.some(lineId => lineId === alert.routeId)) continue;
    const group = alerts[alert.routeId] ?? [];
    group.push({
      id: alert.id,
      header: alert.headerText,
      description: alert.descriptionText,
      cause: alert.cause,
      effect: alert.effect,
    });
    alerts[alert.routeId] = group;
  }

  const alertCount = Object.values(alerts).reduce((sum, group) => sum + group.length, 0);

  return {
    generatedAt: new Date().toISOString(),
    ...(selected.length === 1 ? { line: selected[0] } : {}),
    ...(selected.length > 1 ? { lines: selected } : {}),
    ...feedFreshness(telemetry),
    alertCount,
    alerts,
  };
}
