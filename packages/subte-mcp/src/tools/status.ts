import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTelemetry } from '../http.js';
import { feedFreshness } from '../feed.js';
import { matchLines } from '../lines.js';
import { toolError, toolResult } from './results.js';

const VALID_LINES = 'LineaA, LineaB, LineaC, LineaD, LineaE, LineaH, Premetro';

export function registerStatusTool(server: McpServer): void {
  server.registerTool(
    'subway_status',
    {
      title: 'Subway status',
      description:
        'Use for official service alerts, line by line, and to check how fresh the live feed is. ' +
        'Not for arrival times; use next_trains for those. The optional line filter accepts LineaB, B, or Premetro.',
      inputSchema: {
        line: z.string().optional().describe('Optional line filter, for example LineaB or B. Omit for all lines.'),
      },
    },
    async ({ line }) => {
      try {
        const selected = line ? matchLines(line) : [];
        if (line && !selected.length) {
          return toolError(new Error(`unknown line '${line}'. Valid values: ${VALID_LINES}.`));
        }

        const telemetry = await getTelemetry();
        const alerts: Record<string, { id: string; header: string; description: string; cause: string; effect: string }[]> = {};

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

        return toolResult({
          generatedAt: new Date().toISOString(),
          ...(selected.length === 1 ? { line: selected[0] } : {}),
          ...(selected.length > 1 ? { lines: selected } : {}),
          ...feedFreshness(telemetry),
          alertCount,
          alerts,
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
