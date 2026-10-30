import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getNearbyStations } from "../core/index.js";
import { toolError, toolResult } from "./results.js";

export function registerNearbyTool(server: McpServer): void {
  server.registerTool(
    "nearby_stations",
    {
      title: "Nearby stations",
      description:
        "Use when you have coordinates and need subway stations within walking distance, with distance in meters. " +
        "Not for finding a station by name; use next_trains instead.",
      inputSchema: {
        lat: z
          .number()
          .min(-90)
          .max(90)
          .describe("Latitude in decimal degrees, for example -34.6037."),
        lng: z
          .number()
          .min(-180)
          .max(180)
          .describe("Longitude in decimal degrees, for example -58.3816."),
        radius_m: z
          .number()
          .int()
          .min(1)
          .max(50000)
          .default(800)
          .describe("Search radius in meters. Defaults to 800."),
      },
    },
    async ({ lat, lng, radius_m }) => {
      try {
        return toolResult(await getNearbyStations({ lat, lng, radiusM: radius_m }));
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
