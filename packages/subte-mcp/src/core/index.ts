export { ApiError, getBootstrap, getTelemetry } from './client.ts';
export { feedFreshness, type FeedFreshness } from './feed.ts';
export { lineLabel, matchLines, type LineId } from './lines.ts';
export { compactName, editDistance, normalizeName } from './names.ts';
export {
  buildGraph,
  buildStationIndex,
  findNearby,
  findPlan,
  resolveStation,
  type NearbyStation,
  type PhysicalStation,
  type PlanEdge,
  type PlanGraph,
  type ResolveResult,
  type StationIndex,
  type TransferPoint,
  type TripLeg,
  type TripPlan,
} from './network.ts';
export {
  getStatus,
  type StatusAlert,
  type StatusResult,
} from './status.ts';
export {
  getNextTrains,
  type Arrival,
  type NextTrainsQuery,
  type NextTrainsResult,
} from './next-trains.ts';
export {
  getPlanTrip,
  type PlanTripQuery,
  type PlanTripResult,
} from './plan-trip.ts';
export {
  getNearbyStations,
  type NearbyQuery,
  type NearbyResult,
} from './nearby.ts';
export type {
  Alert,
  Bootstrap,
  Prediction,
  RouteSequence,
  Station,
  Telemetry,
  Train,
} from './types.ts';
