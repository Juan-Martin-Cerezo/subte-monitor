import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPlanTrip } from "../core/index.js";
import { toolError, toolResult } from "./results.js";

export function registerPlanTripTool(server: McpServer): void {
  server.registerTool(
    "plan_trip",
    {
      title: "Plan a trip",
      description:
        "Use for a route between two stations, including transfers and an estimated duration. " +
        "Not for live delays; pair it with next_trains. step_free avoids transfers at stations without an elevator. " +
        "Estimates assume 2 minutes per stop and 3 minutes per transfer.",
      inputSchema: {
        from: z.string().min(2).describe("Origin station name."),
        to: z.string().min(2).describe("Destination station name."),
        step_free: z
          .boolean()
          .default(false)
          .describe("Avoid transfers at stations without an elevator."),
      },
    },
    async ({ from, to, step_free }) => {
      try {
        return toolResult(await getPlanTrip({ from, to, stepFree: step_free }));
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
