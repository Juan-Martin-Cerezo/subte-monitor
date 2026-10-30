import { getBootstrap } from './client.ts';
import { buildGraph, buildStationIndex, findPlan, resolveStation, type TripLeg, type TransferPoint } from './network.ts';

export interface PlanTripQuery {
  from: string;
  to: string;
  stepFree?: boolean;
}

export interface PlanTripResult {
  from: string;
  to: string;
  stepFree: boolean;
  totalStops: number;
  transferCount: number;
  durationMinutes: number;
  assumption: string;
  legs: TripLeg[];
  transferPoints: TransferPoint[];
}

export async function getPlanTrip(query: PlanTripQuery): Promise<PlanTripResult> {
  const { from, to, stepFree = false } = query;

  const bootstrap = await getBootstrap();
  const index = buildStationIndex(bootstrap);
  const origin = resolveStation(from, index);
  if (!origin.ok) throw new Error(origin.message);
  const destination = resolveStation(to, index);
  if (!destination.ok) throw new Error(destination.message);

  if (origin.station.key === destination.station.key) {
    throw new Error(`origin and destination are the same station ('${origin.station.name}'). Choose two different stations.`);
  }

  const plan = findPlan(buildGraph(bootstrap, index, stepFree), origin.station.key, destination.station.key);
  if (!plan) {
    throw new Error(
      stepFree
        ? `no step-free route found between '${origin.station.name}' and '${destination.station.name}'. Try step_free=false.`
        : `no route found between '${origin.station.name}' and '${destination.station.name}'.`
    );
  }

  return {
    from: origin.station.name,
    to: destination.station.name,
    stepFree,
    totalStops: plan.totalStops,
    transferCount: plan.transferCount,
    durationMinutes: plan.durationMinutes,
    assumption: '2 min per stop, 3 min per transfer',
    legs: plan.legs,
    transferPoints: plan.transferPoints,
  };
}
