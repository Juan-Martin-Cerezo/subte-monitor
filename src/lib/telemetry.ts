import { db } from './db';
import { createHash } from 'crypto';

export interface TrainTelemetry {
  id: string;
  routeId: string;
  directionId: number;
  status: 'STOPPED' | 'IN_TRANSIT';
  progress: number;
  latitude: number;
  longitude: number;
  nextStopId: string;
  nextStopName: string;
  prevStopId: string | null;
  prevStopName: string | null;
  etaSeconds: number;
  delaySeconds: number;
  updatedAt: number;
}

export interface AlertData {
  id: string;
  routeId: string;
  headerText: string;
  descriptionText: string;
  cause: string;
  effect: string;
}

export interface GCBAStation {
  stop_id: string;
  stop_name: string;
  arrival?: {
    time: number;
    delay: number;
  } | null;
  departure?: {
    time: number;
    delay: number;
  } | null;
}

export interface GCBAEntity {
  ID: string;
  Linea?: {
    Trip_Id: string;
    Route_Id: string;
    Direction_ID: number;
    start_time: string;
    start_date: string;
    Estaciones?: GCBAStation[];
  };
}

export interface GCBAForecastResponse {
  Header: {
    timestamp: number;
  };
  Entity: GCBAEntity[];
}

export interface GCBAAlertEntity {
  id: string;
  alert?: {
    header_text?: {
      translation?: { text: string; language: string }[];
    };
    description_text?: {
      translation?: { text: string; language: string }[];
    };
    informed_entity?: { route_id?: string; stop_id?: string }[];
    cause?: number;
    effect?: number;
  };
}

export interface GCBAAlertsResponse {
  header: {
    timestamp: number;
  };
  entity: GCBAAlertEntity[];
}

export interface RawArrival {
  routeId: string;
  directionId: number;
  stopId: string;
  arrivalTime: number;
  departureTime: number;
  delay: number;
}

// Haversine formula to compute distance between coordinates in meters
function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Stable hashing for train IDs using terminal departure time projection
function getStableTrainId(routeId: string, directionId: number, tStartSeconds: number): string {
  // Group into 150-second (2.5 min) windows to prevent jitter while maintaining distinct trains
  const bucket = Math.round(tStartSeconds / 150) * 150;
  const hash = createHash('sha256')
    .update(`${routeId}_${directionId}_${bucket}`)
    .digest('hex');
  const lineChar = routeId.replace('Linea', '');
  return `${lineChar}-${hash.substring(0, 5).toUpperCase()}`;
}

export async function getTelemetryData() {
  const clientId = process.env.SUBTE_CLIENT_ID || '3e5e59431f5b4007a5df945007ad47e1';
  const clientSecret = process.env.SUBTE_CLIENT_SECRET || 'c64a5F5972dA4A9C9Da51020c67d1112';

  const forecastUrl = `https://apitransporte.buenosaires.gob.ar/subtes/forecastGTFS?client_id=${clientId}&client_secret=${clientSecret}`;
  const alertsUrl = `https://apitransporte.buenosaires.gob.ar/subtes/serviceAlerts?client_id=${clientId}&client_secret=${clientSecret}&json=1`;

  const nowUnix = Math.floor(Date.now() / 1000);

  let rawForecast: GCBAForecastResponse | null = null;
  let rawAlerts: GCBAAlertsResponse | null = null;
  let isMocked = false;

  try {
    const [forecastRes, alertsRes] = await Promise.all([
      fetch(forecastUrl, { next: { revalidate: 10 } }).then(res => res.ok ? res.json() : null),
      fetch(alertsUrl, { next: { revalidate: 30 } }).then(res => res.ok ? res.json() : null)
    ]);
    rawForecast = forecastRes as GCBAForecastResponse | null;
    rawAlerts = alertsRes as GCBAAlertsResponse | null;
  } catch (error) {
    console.error('Error fetching live Subte telemetry:', error);
  }

  // If API failed or returned empty during off-hours, fall back to mock simulation
  if (!rawForecast || !rawForecast.Entity || rawForecast.Entity.length === 0) {
    console.log('Using simulated live telemetry (empty/failed API response)');
    isMocked = true;
    rawForecast = generateMockForecast(nowUnix);
  }

  const alerts: AlertData[] = [];
  if (rawAlerts && rawAlerts.entity) {
    rawAlerts.entity.forEach((ent: GCBAAlertEntity) => {
      if (ent.alert) {
        const routeId = ent.alert.informed_entity?.[0]?.route_id || 'Global';
        const header = ent.alert.header_text?.translation?.[0]?.text || 'Alerta de servicio';
        const desc = ent.alert.description_text?.translation?.[0]?.text || '';
        const causeCode = ent.alert.cause || 1;
        const effectCode = ent.alert.effect || 1;

        const causeMap: Record<number, string> = {
          1: 'Accidente', 2: 'Operativo Policial', 3: 'Manifestación', 4: 'Problemas Técnicos',
          5: 'Mantenimiento', 6: 'Clima', 7: 'Huelga', 8: 'Falta de Personal'
        };
        const effectMap: Record<number, string> = {
          1: 'Servicio Demorado', 2: 'Servicio Limitado', 3: 'Sin Servicio',
          4: 'Desvíos', 5: 'Estación Cerrada', 6: 'Frecuencia Reducida'
        };

        alerts.push({
          id: ent.id,
          routeId,
          headerText: header,
          descriptionText: desc,
          cause: causeMap[causeCode] || 'Otro',
          effect: effectMap[effectCode] || 'Modificación de Servicio'
        });
      }
    });
  } else if (isMocked) {
    // Generate some mock alerts if we are simulating
    alerts.push({
      id: 'mock-alert-1',
      routeId: 'LineaA',
      headerText: 'Línea A: Demoras por problemas técnicos en estación Congreso',
      descriptionText: 'Se registran demoras de hasta 10 minutos debido a una falla de señales.',
      cause: 'Problemas Técnicos',
      effect: 'Servicio Demorado'
    });
    alerts.push({
      id: 'mock-alert-2',
      routeId: 'LineaC',
      headerText: 'Línea C: Estación Retiro con andenes alternados',
      descriptionText: 'Obras de mantenimiento preventivo en aparatos de vía.',
      cause: 'Mantenimiento',
      effect: 'Frecuencia Reducida'
    });
  }

  // Fetch all stations and sequences from DB
  const stations = await db.station.findMany();
  const sequences = await db.routeSequence.findMany({
    orderBy: { stopSequence: 'asc' }
  });

  // Map stations for easy lookup
  const stationMap = new Map(stations.map(s => [s.stopId, s]));

  // Group sequences by route and direction
  const routeSequences: Record<string, typeof sequences> = {};
  sequences.forEach(seq => {
    const key = `${seq.routeId}_${seq.directionId}`;
    if (!routeSequences[key]) routeSequences[key] = [];
    routeSequences[key].push(seq);
  });

  // Speed and stop duration constants
  const SPEED_M_S = 12; // ~43 km/h
  const STOP_DURATION_S = 25; // 25s stopped

  // Flatten and group arrivals by route + direction
  const rawArrivals: RawArrival[] = [];
  rawForecast.Entity.forEach((entity: GCBAEntity) => {
    if (!entity.Linea) return;
    const routeId = entity.Linea.Route_Id;
    const directionId = entity.Linea.Direction_ID;
    if (!routeId || directionId === undefined) return;

    entity.Linea.Estaciones?.forEach((est: GCBAStation) => {
      const arrTime = est.arrival?.time || est.departure?.time;
      if (!arrTime) return;

      rawArrivals.push({
        routeId,
        directionId,
        stopId: est.stop_id,
        arrivalTime: arrTime,
        departureTime: est.departure?.time || arrTime + STOP_DURATION_S,
        delay: est.arrival?.delay || est.departure?.delay || 0
      });
    });
  });

  const trains: TrainTelemetry[] = [];

  // Run Fixed Track-Slot algorithm for each route and direction
  for (const [key, seqList] of Object.entries(routeSequences)) {
    const [routeId, dirStr] = key.split('_');
    const directionId = parseInt(dirStr);

    // Compute cumulative nominal travel times
    const cumNominalTime: Record<string, number> = {};
    let runningTime = 0;
    cumNominalTime[seqList[0].stopId] = 0;

    for (let i = 1; i < seqList.length; i++) {
      const prevStation = stationMap.get(seqList[i - 1].stopId);
      const nextStation = stationMap.get(seqList[i].stopId);

      if (prevStation && nextStation) {
        const dist = getDistanceMeters(
          prevStation.latitude,
          prevStation.longitude,
          nextStation.latitude,
          nextStation.longitude
        );
        const transitTime = dist / SPEED_M_S;
        runningTime += transitTime + STOP_DURATION_S;
      } else {
        runningTime += 100; // default backup hop time (100 seconds)
      }
      cumNominalTime[seqList[i].stopId] = runningTime;
    }

    // Map each stop to its sequence order
    const stopSeqMap = new Map(seqList.map(s => [s.stopId, s.stopSequence]));

    // Filter arrivals for this route + direction that are in the future or very recent
    const lineArrivals = rawArrivals.filter(
      arr => arr.routeId === routeId && arr.directionId === directionId && arr.arrivalTime > nowUnix - 90
    );

    if (lineArrivals.length === 0) continue;

    // Project arrivals back to terminal S_1
    const arrivalsWithProj = lineArrivals.map(arr => {
      const seq = stopSeqMap.get(arr.stopId) || 1;
      const cumTime = cumNominalTime[arr.stopId] || 0;
      const tProj = arr.arrivalTime - cumTime;
      return { ...arr, seq, tProj };
    }).sort((a, b) => a.tProj - b.tProj);

    // Cluster T_proj values using single-linkage clustering
    const CLUSTER_THRESHOLD_S = 160; // 160 seconds
    const clusters: { tProjValues: number[]; arrivals: typeof arrivalsWithProj }[] = [];

    arrivalsWithProj.forEach(item => {
      const matchedCluster = clusters.find(c => {
        const avg = c.tProjValues.reduce((sum, val) => sum + val, 0) / c.tProjValues.length;
        return Math.abs(avg - item.tProj) <= CLUSTER_THRESHOLD_S;
      });

      if (matchedCluster) {
        matchedCluster.tProjValues.push(item.tProj);
        matchedCluster.arrivals.push(item);
      } else {
        clusters.push({
          tProjValues: [item.tProj],
          arrivals: [item]
        });
      }
    });

    // Form trains from clusters
    clusters.forEach(cluster => {
      // Find average projected departure time
      const tStart = cluster.tProjValues.reduce((sum, val) => sum + val, 0) / cluster.tProjValues.length;
      const stableId = getStableTrainId(routeId, directionId, tStart);

      // Sort arrivals inside cluster by sequence ascending
      cluster.arrivals.sort((a, b) => a.seq - b.seq);

      // Filter upcoming arrivals
      const upcomingArrivals = cluster.arrivals.filter(arr => arr.arrivalTime >= nowUnix - 15);

      let nextStopId = '';
      let nextStopName = '';
      let prevStopId: string | null = null;
      let prevStopName: string | null = null;
      let etaSeconds = 0;
      let delaySeconds = 0;
      let status: 'STOPPED' | 'IN_TRANSIT' = 'STOPPED';
      let progress = 0;
      let lat = 0;
      let lon = 0;

      if (upcomingArrivals.length > 0) {
        // Next station is the one with the smallest sequence number among upcoming arrivals
        const nextArr = upcomingArrivals[0];
        nextStopId = nextArr.stopId;
        const nextStation = stationMap.get(nextStopId);
        nextStopName = nextStation?.stopName || 'Estación';
        etaSeconds = Math.max(0, nextArr.arrivalTime - nowUnix);
        delaySeconds = nextArr.delay;

        const nextSeqIndex = seqList.findIndex(s => s.stopId === nextStopId);

        if (nextSeqIndex > 0) {
          const prevArrSeq = seqList[nextSeqIndex - 1];
          prevStopId = prevArrSeq.stopId;
          const prevStation = stationMap.get(prevStopId);
          prevStopName = prevStation?.stopName || 'Estación';

          const prevCumTime = cumNominalTime[prevStopId] || 0;
          const nextCumTime = cumNominalTime[nextStopId] || 0;
          const segmentDuration = nextCumTime - prevCumTime;

          if (etaSeconds <= 15) {
            // Train is stopped at the next station
            status = 'STOPPED';
            progress = 1.0;
            lat = nextStation?.latitude || 0;
            lon = nextStation?.longitude || 0;
          } else {
            // Train is in transit between previous and next
            status = 'IN_TRANSIT';
            const elapsed = segmentDuration - etaSeconds;
            progress = Math.max(0.01, Math.min(0.99, elapsed / segmentDuration));

            if (prevStation && nextStation) {
              lat = prevStation.latitude + progress * (nextStation.latitude - prevStation.latitude);
              lon = prevStation.longitude + progress * (nextStation.longitude - prevStation.longitude);
            }
          }
        } else {
          // Train is at the terminal starting station
          status = 'STOPPED';
          progress = 0;
          lat = nextStation?.latitude || 0;
          lon = nextStation?.longitude || 0;
        }
      } else {
        // No upcoming arrivals in the cluster (train finished all stops or leaving terminal)
        const lastArr = cluster.arrivals[cluster.arrivals.length - 1];
        const lastStation = stationMap.get(lastArr.stopId);
        status = 'STOPPED';
        progress = 1.0;
        nextStopId = lastArr.stopId;
        nextStopName = lastStation?.stopName || 'Estación Terminal';
        lat = lastStation?.latitude || 0;
        lon = lastStation?.longitude || 0;
        delaySeconds = lastArr.delay;
      }

      trains.push({
        id: stableId,
        routeId,
        directionId,
        status,
        progress,
        latitude: lat,
        longitude: lon,
        nextStopId,
        nextStopName,
        prevStopId,
        prevStopName,
        etaSeconds,
        delaySeconds,
        updatedAt: nowUnix
      });
    });
  }

  return {
    trains: trains.sort((a, b) => a.id.localeCompare(b.id)),
    alerts,
    isMocked
  };
}

// Generate realistic mock forecast when live API has no data or is down
function generateMockForecast(nowUnix: number): GCBAForecastResponse {
  const subteRoutes = ['LineaA', 'LineaB', 'LineaC', 'LineaD', 'LineaE', 'LineaH'];
  const entities: GCBAEntity[] = [];

  // Generate deterministic trips based on current time
  subteRoutes.forEach(routeId => {
    [0, 1].forEach(directionId => {
      // 3 simulated trains per line and direction
      for (let trainIndex = 0; trainIndex < 3; trainIndex++) {
        // Stagger departure times: every 8 minutes (480 seconds)
        const offset = trainIndex * 480;
        const baseStart = nowUnix - 600 + offset;
        const tripId = `${routeId.replace('Linea', '')}_T${trainIndex + 1}`;

        // Get hardcoded stops based on line. Since we don't have DB active here,
        // we map standard stop prefixes. We'll generate 8 generic stop sequences.
        const stopsList = getMockStopIds(routeId, directionId);
        const estaciones: GCBAStation[] = [];
        let runningTime = baseStart;

        stopsList.forEach((stopId) => {
          // ~100 seconds transit, ~25 seconds stop
          const arrivalTime = runningTime + 100;
          const departureTime = arrivalTime + 25;
          runningTime = departureTime;

          estaciones.push({
            stop_id: stopId,
            stop_name: `Estación ${stopId}`,
            arrival: {
              time: arrivalTime,
              delay: 30 * trainIndex // Mock slight delay
            },
            departure: {
              time: departureTime,
              delay: 30 * trainIndex
            }
          });
        });

        entities.push({
          ID: `${routeId}_${tripId}`,
          Linea: {
            Trip_Id: tripId,
            Route_Id: routeId,
            Direction_ID: directionId,
            start_time: '12:00:00',
            start_date: '20260610',
            Estaciones: estaciones
          }
        });
      }
    });
  });

  return {
    Header: { timestamp: nowUnix },
    Entity: entities
  };
}

// Helper to provide realistic stop IDs for mocks
function getMockStopIds(routeId: string, directionId: number): string[] {
  // Line A
  if (routeId === 'LineaA') {
    const stops = ['1059', '1060', '1061', '1062', '1063', '1064', '1065', '1066', '1067', '1068', '1069', '1070', '1071', '1072', '1073', '1074', '1075', '1076'];
    const suffix = directionId === 0 ? 'S' : 'N';
    const list = stops.map(s => s + suffix);
    return directionId === 0 ? list : list.reverse();
  }
  // Line B
  if (routeId === 'LineaB') {
    const stops = ['2051', '2052', '2053', '2054', '2055', '2056', '2057', '2058', '2059', '2060', '2061', '2062', '2063', '2064', '2065', '2066', '2067'];
    const suffix = directionId === 0 ? 'S' : 'N';
    const list = stops.map(s => s + suffix);
    return directionId === 0 ? list : list.reverse();
  }
  // Line C
  if (routeId === 'LineaC') {
    const stops = ['3051', '3052', '3053', '3054', '3055', '3056', '3057', '3058', '3059'];
    const suffix = directionId === 0 ? 'S' : 'N';
    const list = stops.map(s => s + suffix);
    return directionId === 0 ? list : list.reverse();
  }
  // Line D
  if (routeId === 'LineaD') {
    const stops = ['4051', '4052', '4053', '4054', '4055', '4056', '4057', '4058', '4059', '4060', '4061', '4062', '4063', '4064', '4065', '4066'];
    const suffix = directionId === 0 ? 'S' : 'N';
    const list = stops.map(s => s + suffix);
    return directionId === 0 ? list : list.reverse();
  }
  // Line E
  if (routeId === 'LineaE') {
    const stops = ['5051', '5052', '5053', '5054', '5055', '5056', '5057', '5058', '5059', '5060', '5061', '5062', '5063', '5064', '5065', '5066', '5067', '5068'];
    const suffix = directionId === 0 ? 'S' : 'N';
    const list = stops.map(s => s + suffix);
    return directionId === 0 ? list : list.reverse();
  }
  // Line H
  const stops = ['6051', '6052', '6053', '6054', '6055', '6056', '6057', '6058', '6059', '6060', '6061', '6062'];
  const suffix = directionId === 0 ? 'S' : 'N';
  const list = stops.map(s => s + suffix);
  return directionId === 0 ? list : list.reverse();
}
