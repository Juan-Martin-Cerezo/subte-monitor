import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getNextTrains } from "../core/index.js";
import { toolError, toolResult } from "./results.js";

export function registerNextTrainsTool(server: McpServer): void {
  server.registerTool(
    "next_trains",
    {
      title: "Next trains",
      description:
        "Use for upcoming arrivals at one station, sorted by ETA. Station names match without accents or case. " +
        "Not for trip planning or service alerts. If the station name is ambiguous, the tool lists the candidates instead of guessing.",
      inputSchema: {
        station: z.string().min(2).describe('Station name, for example Aguero or "Plaza de Mayo".'),
        line: z.string().optional().describe("Optional line filter, for example LineaD or D."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(3)
          .describe("Maximum number of arrivals to return. Defaults to 3."),
      },
    },
    async ({ station, line, limit }) => {
      try {
        return toolResult(await getNextTrains({ station, line, limit }));
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
