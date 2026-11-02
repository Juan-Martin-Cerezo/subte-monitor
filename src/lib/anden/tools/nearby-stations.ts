import { getNearbyStations } from "@subte/core";
import { optionalInteger, requireNumber } from "./args";
import type { AgentTool } from "./types";

export const nearbyStationsTool: AgentTool = {
  name: "nearby_stations",
  description:
    "Stations within walking distance of a latitude and longitude, with distance in meters. Use only when the question " +
    "provides coordinates. Not for finding a station by name.",
  parameters: {
    type: "object",
    properties: {
      lat: {
        type: "number",
        minimum: -90,
        maximum: 90,
        description: "Latitude in decimal degrees.",
      },
      lng: {
        type: "number",
        minimum: -180,
        maximum: 180,
        description: "Longitude in decimal degrees.",
      },
      radius_m: {
        type: "integer",
        minimum: 1,
        maximum: 50000,
        description: "Search radius in meters. Defaults to 800.",
      },
    },
    required: ["lat", "lng"],
    additionalProperties: false,
  },
  async execute(args) {
    return getNearbyStations({
      lat: requireNumber(args, "lat"),
      lng: requireNumber(args, "lng"),
      radiusM: optionalInteger(args, "radius_m", 800, 1, 50000),
    });
  },
};
