import { getPlanTrip } from "@subte/core";
import { optionalBoolean, requireString } from "./args";
import type { AgentTool } from "./types";

export const planTripTool: AgentTool = {
  name: "plan_trip",
  description:
    "Route between two stations with legs, transfers, stop count and estimated minutes. Use for how-to-get-there questions. " +
    "Set step_free to true when the user asks for an accessible route without stairs. Estimates assume 2 minutes per stop " +
    "and 3 minutes per transfer.",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "Origin station name." },
      to: { type: "string", description: "Destination station name." },
      step_free: {
        type: "boolean",
        description: "Avoid transfers at stations without an elevator.",
      },
    },
    required: ["from", "to"],
    additionalProperties: false,
  },
  async execute(args) {
    return getPlanTrip({
      from: requireString(args, "from"),
      to: requireString(args, "to"),
      stepFree: optionalBoolean(args, "step_free") ?? false,
    });
  },
};
