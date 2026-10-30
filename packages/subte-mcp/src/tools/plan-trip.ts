import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getBootstrap } from '../http.js';
import { buildGraph, buildStationIndex, findPlan, resolveStation } from '../network.js';
import { toolError, toolResult } from './results.js';

export function registerPlanTripTool(server: McpServer): void {
  server.registerTool(
    'plan_trip',
    {
      title: 'Plan a trip',
      description:
        'Use for a route between two stations, including transfers and an estimated duration. ' +
        'Not for live delays; pair it with next_trains. step_free avoids transfers at stations without an elevator. ' +
        'Estimates assume 2 minutes per stop and 3 minutes per transfer.',
      inputSchema: {
        from: z.string().min(2).describe('Origin station name.'),
        to: z.string().min(2).describe('Destination station name.'),
        step_free: z.boolean().default(false).describe('Avoid transfers at stations without an elevator.'),
      },
    },
    async ({ from, to, step_free }) => {
      try {
        const bootstrap = await getBootstrap();
        const index = buildStationIndex(bootstrap);
        const origin = resolveStation(from, index);
        if (!origin.ok) return toolError(new Error(origin.message));
        const destination = resolveStation(to, index);
        if (!destination.ok) return toolError(new Error(destination.message));

        if (origin.station.key === destination.station.key) {
          return toolError(
            new Error(`origin and destination are the same station ('${origin.station.name}'). Choose two different stations.`)
          );
        }

        const plan = findPlan(buildGraph(bootstrap, index, step_free), origin.station.key, destination.station.key);
        if (!plan) {
          return toolError(
            new Error(
              step_free
                ? `no step-free route found between '${origin.station.name}' and '${destination.station.name}'. Try step_free=false.`
                : `no route found between '${origin.station.name}' and '${destination.station.name}'.`
            )
          );
        }

        return toolResult({
          from: origin.station.name,
          to: destination.station.name,
          stepFree: step_free,
          totalStops: plan.totalStops,
          transferCount: plan.transferCount,
          durationMinutes: plan.durationMinutes,
          assumption: '2 min per stop, 3 min per transfer',
          legs: plan.legs,
          transferPoints: plan.transferPoints,
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
