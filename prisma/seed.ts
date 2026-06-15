import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

function parseCSV(content: string): Record<string, string>[] {
  if (content.startsWith('\uFEFF')) {
    content = content.slice(1);
  }
  const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length === 0) return [];
  
  const parseLine = (line: string) => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return row;
  });
}

async function main() {
  console.log('Starting Subte GTFS seeding...');

  // Ensure gtfs.zip is available, otherwise download it
  const zipPath = path.join(process.cwd(), 'gtfs.zip');
  if (!fs.existsSync(zipPath)) {
    console.log('Downloading GTFS zip...');
    const url = 'https://apitransporte.buenosaires.gob.ar/subtes/feed-gtfs?client_id=3e5e59431f5b4007a5df945007ad47e1&client_secret=c64a5F5972dA4A9C9Da51020c67d1112';
    execSync(`curl -s -o "${zipPath}" "${url}"`);
    console.log('GTFS zip downloaded.');
  }

  // Extract relevant files into memory using unzip -p
  console.log('Extracting GTFS files...');
  const tripsCSV = execSync(`unzip -p "${zipPath}" trips.txt`, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
  const stopTimesCSV = execSync(`unzip -p "${zipPath}" stop_times.txt`, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
  const stopsCSV = execSync(`unzip -p "${zipPath}" stops.txt`, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });

  console.log('Parsing CSV files...');
  const trips = parseCSV(tripsCSV);
  const stopTimes = parseCSV(stopTimesCSV);
  const stops = parseCSV(stopsCSV);

  // Group trips by route_id and direction_id
  const routeDirectionTrips: Record<string, string[]> = {};
  trips.forEach(t => {
    const key = `${t.route_id}_${t.direction_id}`;
    if (!routeDirectionTrips[key]) {
      routeDirectionTrips[key] = [];
    }
    routeDirectionTrips[key].push(t.trip_id);
  });

  // Group stop times by trip_id
  const tripStopTimes: Record<string, typeof stopTimes> = {};
  stopTimes.forEach(st => {
    if (!tripStopTimes[st.trip_id]) {
      tripStopTimes[st.trip_id] = [];
    }
    tripStopTimes[st.trip_id].push(st);
  });

  // For each route and direction, select the representative trip (the one with the most stops)
  console.log('Identifying canonical route sequences...');
  const canonicalSequences: { routeId: string; directionId: number; stops: { stopId: string; sequence: number }[] }[] = [];

  const subteRoutes = ['LineaA', 'LineaB', 'LineaC', 'LineaD', 'LineaE', 'LineaH', 'PM-Civico', 'PM-Savio'];

  subteRoutes.forEach(routeId => {
    [0, 1].forEach(directionId => {
      const key = `${routeId}_${directionId}`;
      const tripIds = routeDirectionTrips[key];
      if (!tripIds || tripIds.length === 0) {
        console.warn(`No trips found for ${routeId} dir ${directionId}`);
        return;
      }

      // Find the trip with the most stop times
      let bestTripId = tripIds[0];
      let maxStops = 0;
      tripIds.forEach(tId => {
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
        sequence: index + 1 // Re-index sequentially from 1
      }));

      if (seqStops.length > 0) {
        canonicalSequences.push({
          routeId,
          directionId,
          stops: seqStops
        });
      }
    });
  });

  // Create stops map for easy lookup
  const stopsMap: Record<string, typeof stops[0]> = {};
  stops.forEach(s => {
    stopsMap[s.stop_id] = s;
  });

  // Collect all unique stops referenced in the canonical sequences
  const referencedStopIds = new Set<string>();
  canonicalSequences.forEach(cs => {
    cs.stops.forEach(s => referencedStopIds.add(s.stopId));
  });

  console.log(`Found ${referencedStopIds.size} unique stations to seed.`);

  // Insert Stations
  console.log('Seeding Stations...');
  for (const stopId of referencedStopIds) {
    const s = stopsMap[stopId];
    if (!s) {
      console.warn(`Stop details not found for ID ${stopId}`);
      continue;
    }

    const name = s.stop_name || 'Estación Desconocida';
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
  console.log('Seeding Route Sequences...');
  // Delete existing sequences to prevent unique constraint conflicts on reload
  await prisma.routeSequence.deleteMany({});

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

  // Seed Historical Flow Data
  console.log('Seeding Historical Flow...');
  await prisma.historicalFlow.deleteMany({});

  const stations = await prisma.station.findMany();

  // Helper to estimate if a station is a major transit hub
  const hubNames = [
    'retiro', 'constitucion', 'catedral', 'diagonal norte', 'carlos pellegrini',
    'plaza de mayo', 'peru', 'once', 'corrientes', 'pueyrredon', 'independencia',
    'congreso de tucuman', 'san pedrito', 'juan manuel de rosas', 'federico lacroze',
    'bolivar', 'humberto 1', 'jujuy'
  ];

  const isHub = (name: string) => {
    const lower = name.toLowerCase();
    return hubNames.some(hn => lower.includes(hn));
  };

  const getLineFromStopId = (stopId: string) => {
    // Determine the line based on the canonical sequences
    // (Defaulting based on ID prefixes if we want, or just general categories)
    if (stopId.startsWith('10') || stopId.startsWith('A')) return 'LineaA';
    if (stopId.startsWith('20') || stopId.startsWith('B')) return 'LineaB';
    if (stopId.startsWith('30') || stopId.startsWith('C')) return 'LineaC';
    if (stopId.startsWith('40') || stopId.startsWith('D')) return 'LineaD';
    if (stopId.startsWith('50') || stopId.startsWith('E')) return 'LineaE';
    if (stopId.startsWith('60') || stopId.startsWith('H')) return 'LineaH';
    return 'LineaA';
  };

  const flowRecords: { line: string; station: string; hour: number; congestionLevel: string; passengerFlow: number }[] = [];

  for (const station of stations) {
    const line = getLineFromStopId(station.stopId);
    const isStationHub = isHub(station.stopName);

    for (let hour = 5; hour <= 23; hour++) {
      let congestionLevel = 'Verde';
      let flowMultiplier = 1.0;

      // Determine peak periods
      if ((hour >= 8 && hour < 9) || (hour >= 18 && hour < 19)) {
        congestionLevel = 'Rojo';
        flowMultiplier = 5.0;
      } else if (
        (hour >= 7 && hour < 8) ||
        (hour >= 9 && hour < 10) ||
        (hour >= 12 && hour < 14) ||
        (hour >= 17 && hour < 18) ||
        (hour >= 19 && hour < 20)
      ) {
        congestionLevel = 'Amarillo';
        flowMultiplier = 2.5;
      } else {
        congestionLevel = 'Verde';
        flowMultiplier = 0.8;
      }

      // Base passengers flow per hour
      const baseFlow = isStationHub ? 800 : 200;
      // Add some randomness but keep it structured
      const randomFactor = 0.8 + Math.random() * 0.4;
      const passengerFlow = Math.round(baseFlow * flowMultiplier * randomFactor);

      flowRecords.push({
        line,
        station: station.stopName,
        hour,
        congestionLevel,
        passengerFlow,
      });
    }
  }

  // Insert HistoricalFlow in bulk using createMany
  await prisma.historicalFlow.createMany({
    data: flowRecords,
    skipDuplicates: true,
  });

  console.log(`Seeded ${flowRecords.length} historical flow records.`);
  console.log('GTFS Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
