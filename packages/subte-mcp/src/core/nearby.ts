import { getBootstrap } from "./client.ts";
import { buildStationIndex, findNearby, type NearbyStation } from "./network.ts";

export interface NearbyQuery {
  lat: number;
  lng: number;
  radiusM?: number;
}

export interface NearbyResult {
  lat: number;
  lng: number;
  radiusM: number;
  count: number;
  stations: NearbyStation[];
}

export async function getNearbyStations(query: NearbyQuery): Promise<NearbyResult> {
  const { lat, lng, radiusM = 800 } = query;

  const index = buildStationIndex(await getBootstrap());
  const stations = findNearby(index, lat, lng, radiusM);

  return {
    lat,
    lng,
    radiusM,
    count: stations.length,
    stations,
  };
}
