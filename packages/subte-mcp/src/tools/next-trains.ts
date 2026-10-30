import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getBootstrap, getTelemetry } from '../http.js';
import { feedFreshness } from '../feed.js';
import { matchLines, lineLabel } from '../lines.js';
import { compactName } from '../names.js';
import { buildStationIndex, resolveStation } from '../network.js';
import { toolError, toolResult } from './results.js';

const VALID_LINES = 'LineaA, LineaB, LineaC, LineaD, LineaE, LineaH, Premetro';

export function registerNextTrainsTool(server: McpServer): void {
  server.registerTool(
    'next_trains',
    {
      title: 'Next trains',
      description:
        'Use for upcoming arrivals at one station, sorted by ETA. Station names match without accents or case. ' +
        'Not for trip planning or service alerts. If the station name is ambiguous, the tool lists the candidates instead of guessing.',
      inputSchema: {
        station: z.string().min(2).describe('Station name, for example Aguero or "Plaza de Mayo".'),
        line: z.string().optional().describe('Optional line filter, for example LineaD or D.'),
        limit: z.number().int().min(1).max(20).default(3).describe('Maximum number of arrivals to return. Defaults to 3.'),
      },
    },
    async ({ station, line, limit }) => {
      try {
        const index = buildStationIndex(await getBootstrap());
        const resolved = resolveStation(station, index);
        if (!resolved.ok) return toolError(new Error(resolved.message));

        const requested = line ? matchLines(line) : [];
        if (line && !requested.length) {
          return toolError(new Error(`unknown line '${line}'. Valid values: ${VALID_LINES}.`));
        }

        const served = requested.length
          ? requested.filter(candidate => resolved.station.lines.includes(candidate))
          : resolved.station.lines;

        if (requested.length && !served.length) {
          return toolError(
            new Error(
              `station '${resolved.station.name}' is not served by ${requested.map(lineLabel).join(' or ')}. ` +
                `Lines at this station: ${resolved.station.lines.map(lineLabel).join(', ')}.`
            )
          );
        }

        if (!served.length) {
          return toolError(new Error(`station '${resolved.station.name}' has no line information in the reference feed.`));
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

        return toolResult({
          station: resolved.station.name,
          lines: served,
          ...(note ? { note } : {}),
          ...feedFreshness(telemetry),
          arrivals,
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
