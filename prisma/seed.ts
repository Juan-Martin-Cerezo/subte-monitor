import { PrismaClient } from "@prisma/client";
import { PrismaNeonHTTP } from "@prisma/adapter-neon";
import "dotenv/config";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const prisma = databaseUrl.includes("neon.tech")
  ? new PrismaClient({ adapter: new PrismaNeonHTTP(databaseUrl, {}) })
  : new PrismaClient();

function parseCSV(content: string): Record<string, string>[] {
  if (content.startsWith("\uFEFF")) {
    content = content.slice(1);
  }
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];

  const parseLine = (line: string) => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    return row;
  });
}

async function main() {
  console.log("Starting Subte GTFS seeding...");

  // gtfs.zip is committed; download it only when missing.
  const zipPath = path.join(process.cwd(), "gtfs.zip");
  if (!fs.existsSync(zipPath)) {
    const clientId = process.env.SUBTE_CLIENT_ID;
    const clientSecret = process.env.SUBTE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("gtfs.zip is missing and SUBTE_CLIENT_ID / SUBTE_CLIENT_SECRET are not set.");
    }
    console.log("Downloading GTFS zip...");
    const url = `https://apitransporte.buenosaires.gob.ar/subtes/feed-gtfs?client_id=${clientId}&client_secret=${clientSecret}`;
    execSync(`curl -sf -o "${zipPath}" "${url}"`);
    console.log("GTFS zip downloaded.");
  }

  // Extract relevant files into memory using unzip -p
  console.log("Extracting GTFS files...");
  const tripsCSV = execSync(`unzip -p "${zipPath}" trips.txt`, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
  const stopTimesCSV = execSync(`unzip -p "${zipPath}" stop_times.txt`, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
  const stopsCSV = execSync(`unzip -p "${zipPath}" stops.txt`, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });

  console.log("Parsing CSV files...");
  const trips = parseCSV(tripsCSV);
  const stopTimes = parseCSV(stopTimesCSV);
  const stops = parseCSV(stopsCSV);

  // Group trips by route_id and direction_id
  const routeDirectionTrips: Record<string, string[]> = {};
  trips.forEach((t) => {
    const key = `${t.route_id}_${t.direction_id}`;
    if (!routeDirectionTrips[key]) {
      routeDirectionTrips[key] = [];
    }
    routeDirectionTrips[key].push(t.trip_id);
  });

  // Group stop times by trip_id
  const tripStopTimes: Record<string, typeof stopTimes> = {};
  stopTimes.forEach((st) => {
    if (!tripStopTimes[st.trip_id]) {
      tripStopTimes[st.trip_id] = [];
    }
    tripStopTimes[st.trip_id].push(st);
  });

  // For each route and direction, select the representative trip (the one with the most stops)
  console.log("Identifying canonical route sequences...");
  const canonicalSequences: {
    routeId: string;
    directionId: number;
    stops: { stopId: string; sequence: number }[];
  }[] = [];

  const subteRoutes = [
    "LineaA",
    "LineaB",
    "LineaC",
    "LineaD",
    "LineaE",
    "LineaH",
    "PM-Civico",
    "PM-Savio",
  ];

  subteRoutes.forEach((routeId) => {
    [0, 1].forEach((directionId) => {
      const key = `${routeId}_${directionId}`;
      const tripIds = routeDirectionTrips[key];
      if (!tripIds || tripIds.length === 0) {
        console.warn(`No trips found for ${routeId} dir ${directionId}`);
        return;
      }

      // Find the trip with the most stop times
      let bestTripId = tripIds[0];
      let maxStops = 0;
      tripIds.forEach((tId) => {
        const count = tripStopTimes[tId]?.length || 0;
        if (count > maxStops) {
          maxStops = count;
          bestTripId = tId;
        }
      });

      const stList = tripStopTimes[bestTripId] || [];
      // Sort by stop_sequence
      stList.sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));

      const seqStops = stList.map((st, index) => ({
        stopId: st.stop_id,
        sequence: index + 1, // Re-index sequentially from 1
      }));

      if (seqStops.length > 0) {
        canonicalSequences.push({
          routeId,
          directionId,
          stops: seqStops,
        });
      }
    });
  });

  // Create stops map for easy lookup
  const stopsMap: Record<string, (typeof stops)[0]> = {};
  stops.forEach((s) => {
    stopsMap[s.stop_id] = s;
  });

  // Collect all unique stops referenced in the canonical sequences
  const referencedStopIds = new Set<string>();
  canonicalSequences.forEach((cs) => {
    cs.stops.forEach((s) => referencedStopIds.add(s.stopId));
  });

  console.log(`Found ${referencedStopIds.size} unique stations to seed.`);

  // Insert Stations
  console.log("Seeding Stations...");
  for (const stopId of referencedStopIds) {
    const s = stopsMap[stopId];
    if (!s) {
      console.warn(`Stop details not found for ID ${stopId}`);
      continue;
    }

    const name = s.stop_name || "Estación Desconocida";
    const lat = parseFloat(s.stop_lat) || 0;
    const lon = parseFloat(s.stop_lon) || 0;

    await prisma.station.upsert({
      where: { stopId },
      update: {
        stopName: name,
        latitude: lat,
        longitude: lon,
      },
      create: {
        stopId,
        stopName: name,
        latitude: lat,
        longitude: lon,
      },
    });
  }

  // Insert Route Sequences
  console.log("Seeding Route Sequences...");
  // Delete existing sequences individually (HTTP mode)
  const existingSeqs = await prisma.routeSequence.findMany({ select: { id: true } });
  for (const s of existingSeqs) {
    await prisma.routeSequence.delete({ where: { id: s.id } }).catch(() => {});
  }

  for (const cs of canonicalSequences) {
    for (const s of cs.stops) {
      await prisma.routeSequence.create({
        data: {
          routeId: cs.routeId,
          directionId: cs.directionId,
          stopSequence: s.sequence,
          stopId: s.stopId,
        },
      });
    }
  }

  console.log("GTFS Seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
