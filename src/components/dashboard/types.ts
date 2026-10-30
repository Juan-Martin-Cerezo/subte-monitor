export type TabId = "map" | "planner" | "stations" | "status" | "arrivals";

import type { TrainTelemetry, AlertData, Prediction } from "@/lib/telemetry";
import type { LineId } from "./lines";

export interface Station {
  stopId: string;
  stopName: string;
  latitude: number;
  longitude: number;
}

export interface RouteSequence {
  id: string;
  routeId: string;
  directionId: number;
  stopSequence: number;
  stopId: string;
}

export interface ReportItem {
  id: string;
  line: string;
  station: string;
  category: string;
  comment: string;
  createdAt: string;
}
