import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getStatus } from "../core/index.js";
import { toolError, toolResult } from "./results.js";

export function registerStatusTool(server: McpServer): void {
  server.registerTool(
    "subway_status",
    {
      title: "Subway status",
      description:
        "Use for official service alerts, line by line, and to check how fresh the live feed is. " +
        "Not for arrival times; use next_trains for those. The optional line filter accepts LineaB, B, or Premetro.",
      inputSchema: {
        line: z
          .string()
          .optional()
          .describe("Optional line filter, for example LineaB or B. Omit for all lines."),
      },
    },
    async ({ line }) => {
      try {
        return toolResult(await getStatus(line));
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
