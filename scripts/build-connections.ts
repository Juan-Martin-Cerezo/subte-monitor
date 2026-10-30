/**
 * Build script: pre-computes bus and train connections for each subway station.
 * Downloads official GCBA GeoJSON data and outputs src/lib/connections.ts
 *
 * Run: npx tsx scripts/build-connections.ts
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

// Disable strict SSL for GCBA CDN (legacy TLS config)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const BUS_STOPS_URL =
  "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/transporte-y-obras-publicas/colectivos-paradas/paradas-de-colectivo.geojson";
const TRAIN_STATIONS_URL =
  "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/transporte-y-obras-publicas/estaciones-ferrocarril/estaciones-de-ferrocarril.geojson";
const SUBTE_STATIONS_URL =
  "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/sbase/subte-estaciones/estaciones_de_subte.geojson";

const BUS_RADIUS_METERS = 250;
const TRAIN_RADIUS_METERS = 500;

interface GeoPoint {
  type: "Point";
  coordinates: [number, number]; // [lng, lat]
}

interface BusStopFeature {
  type: "Feature";
  properties: {
    fid: number;
    CALLE: string;
    "ALT PLANO": string;
    DIRECCION: string;
    L1: string | null;
    L2: string | null;
    L3: string | null;
    L4: string | null;
    L5: string | null;
    L6: string | null;
  };
  geometry: GeoPoint;
}

interface TrainStationFeature {
  type: "Feature";
  properties: {
    linea: string;
    nombre: string;
  };
  geometry: GeoPoint;
}

interface SubteStationFeature {
  type: "Feature";
  properties: {
    id: number;
    estacion: string;
    linea: string;
  };
  geometry: GeoPoint;
}

interface GeoJSON {
  type: "FeatureCollection";
  features: Array<BusStopFeature | TrainStationFeature | SubteStationFeature>;
}

export interface BusConnection {
  line: string;
  count: number;
  nearestDistance: number;
}

export interface TrainConnection {
  line: string;
  stationName: string;
  distance: number;
}

export interface StationConnections {
  buses: BusConnection[];
  trains: TrainConnection[];
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

async function fetchGeoJSON(url: string): Promise<GeoJSON> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

function getBusLines(feature: BusStopFeature): string[] {
  const lines: string[] = [];
  const props = feature.properties;
  for (const key of ["L1", "L2", "L3", "L4", "L5", "L6"] as const) {
    if (props[key]) lines.push(props[key]!);
  }
  return lines;
}

async function main() {
  console.log("Fetching subte stations...");
  const subteData = await fetchGeoJSON(SUBTE_STATIONS_URL);
  const subteStations = subteData.features as SubteStationFeature[];

  console.log(`Found ${subteStations.length} subte stations`);
  console.log("Fetching bus stops...");
  const busData = await fetchGeoJSON(BUS_STOPS_URL);
  const busStops = busData.features as BusStopFeature[];
  console.log(`Found ${busStops.length} bus stops`);

  console.log("Fetching train stations...");
  const trainData = await fetchGeoJSON(TRAIN_STATIONS_URL);
  const trainStations = trainData.features as TrainStationFeature[];
  console.log(`Found ${trainStations.length} train stations`);

  const connections: Record<string, StationConnections> = {};

  for (const station of subteStations) {
    const [lng, lat] = station.geometry.coordinates;
    const stationId = station.properties.estacion
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "");

    // Find nearby bus stops
    const busLineCounts = new Map<string, { count: number; nearestDist: number }>();
    for (const stop of busStops) {
      const [stopLng, stopLat] = stop.geometry.coordinates;
      const dist = haversineDistance(lat, lng, stopLat, stopLng);
      if (dist <= BUS_RADIUS_METERS) {
        const lines = getBusLines(stop);
        for (const line of lines) {
          const existing = busLineCounts.get(line);
          if (existing) {
            existing.count++;
            existing.nearestDist = Math.min(existing.nearestDist, dist);
          } else {
            busLineCounts.set(line, { count: 1, nearestDist: dist });
          }
        }
      }
    }

    // Find nearby train stations
    const trainConnections: TrainConnection[] = [];
    const seenTrainStations = new Set<string>();
    for (const train of trainStations) {
      const [trainLng, trainLat] = train.geometry.coordinates;
      const dist = haversineDistance(lat, lng, trainLat, trainLng);
      if (dist <= TRAIN_RADIUS_METERS) {
        const key = `${train.properties.linea}-${train.properties.nombre}`;
        if (!seenTrainStations.has(key)) {
          seenTrainStations.add(key);
          trainConnections.push({
            line: train.properties.linea,
            stationName: train.properties.nombre,
            distance: dist,
          });
        }
      }
    }

    const buses: BusConnection[] = Array.from(busLineCounts.entries())
      .map(([line, { count, nearestDist }]) => ({
        line,
        count,
        nearestDistance: nearestDist,
      }))
      .sort((a, b) => a.nearestDistance - b.nearestDistance)
      .slice(0, 8);

    trainConnections.sort((a, b) => a.distance - b.distance);

    if (buses.length > 0 || trainConnections.length > 0) {
      connections[stationId] = { buses, trains: trainConnections };
    }
  }

  const stationsWithConnections = Object.keys(connections).length;
  console.log(`${stationsWithConnections} stations have connections`);

  const output = `// AUTO-GENERATED by scripts/build-connections.ts — do not edit manually
// Source: BA Data (data.buenosaires.gob.ar) - colectivos-paradas, estaciones-ferrocarril
// Generated: ${new Date().toISOString()}

export interface BusConnection {
  line: string;
  count: number;
  nearestDistance: number;
}

export interface TrainConnection {
  line: string;
  stationName: string;
  distance: number;
}

export interface StationConnections {
  buses: BusConnection[];
  trains: TrainConnection[];
}

export const STATION_CONNECTIONS: Record<string, StationConnections> = ${JSON.stringify(connections, null, 2)};
`;

  const outputPath = join(process.cwd(), "src/lib/connections.ts");
  writeFileSync(outputPath, output);
  console.log(`Written to ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
