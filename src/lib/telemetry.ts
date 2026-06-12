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

// Persistent memory tracker to survive hot reload in Next.js development
const globalForTracker = globalThis as unknown as { 
  subteTracker: Map<string, { routeId: string; directionId: number; tripId: string; t_inicio: number; lastSeen: number }> 
};
if (!globalForTracker.subteTracker) {
  globalForTracker.subteTracker = new Map();
}
const trackerDB = globalForTracker.subteTracker;

// Persistent memory cache for the feed
const globalForCache = globalThis as unknown as { 
  subteCache: { 
    rawForecast: GCBAForecastResponse; 
    alerts: AlertData[];
    fetchedAt: number; 
    isMocked: boolean;
  } | null 
};
if (!globalForCache.subteCache) {
  globalForCache.subteCache = null;
}

// Persistent memory to keep track of a stable clock sync offset with the GCBA API
const globalForSync = globalThis as unknown as {
  subteSync: {
    lastFeedTimestamp: number;
    stableTimeDiff: number;
  }
};
if (!globalForSync.subteSync) {
  globalForSync.subteSync = {
    lastFeedTimestamp: 0,
    stableTimeDiff: 0
  };
}
const syncDB = globalForSync.subteSync;

// Persistent memory to keep last successfully fetched alerts in case API fails
const globalForAlerts = globalThis as unknown as {
  lastAlerts: AlertData[];
};
if (!globalForAlerts.lastAlerts) {
  globalForAlerts.lastAlerts = [];
}

// Permissive route matching helper to handle GCBA variants (like "LineC", "linec", "LineaC", etc.)
function matchDbRoute(rawRouteId: string | undefined): string | null {
  if (!rawRouteId) return null;
  const cleaned = rawRouteId.trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
  
  const dbRoutes = ['LineaA', 'LineaB', 'LineaC', 'LineaD', 'LineaE', 'LineaH'];
  for (const dbRoute of dbRoutes) {
    const line = dbRoute.replace('Linea', '').toLowerCase();
    if (
      cleaned === `linea${line}` ||
      cleaned === line ||
      cleaned === `line${line}` ||
      cleaned === `subte${line}`
    ) {
      return dbRoute;
    }
  }
  return null;
}

export async function getTelemetryData() {
  const clientId = process.env.SUBTE_CLIENT_ID || '3e5e59431f5b4007a5df945007ad47e1';
  const clientSecret = process.env.SUBTE_CLIENT_SECRET || 'c64a5F5972dA4A9C9Da51020c67d1112';

  const forecastUrl = `https://apitransporte.buenosaires.gob.ar/subtes/forecastGTFS?client_id=${clientId}&client_secret=${clientSecret}`;
  const alertsUrl = `https://apitransporte.buenosaires.gob.ar/subtes/serviceAlerts?client_id=${clientId}&client_secret=${clientSecret}&json=1`;

  const nowUnix = Math.floor(Date.now() / 1000);

  // Fetch all stations and sequences from DB first
  const stations = await db.station.findMany();
  const sequences = await db.routeSequence.findMany({
    orderBy: { stopSequence: 'asc' }
  });

  let rawForecast: GCBAForecastResponse | null = null;
  let alerts: AlertData[] = [];
  let isMocked = false;
  let fetchedAt = nowUnix;

  const cacheLimitSeconds = 4; // cache for 4 seconds
  const cached = globalForCache.subteCache;

  if (cached && nowUnix - cached.fetchedAt < cacheLimitSeconds) {
    rawForecast = cached.rawForecast;
    alerts = cached.alerts;
    isMocked = cached.isMocked;
    fetchedAt = cached.fetchedAt;
  } else {
    // Fetch fresh
    let rawAlerts: GCBAAlertsResponse | null = null;
    try {
      const [forecastRes, alertsRes] = await Promise.all([
        fetch(forecastUrl, { cache: 'no-store' }).then(res => res.ok ? res.json() : null),
        fetch(alertsUrl, { cache: 'no-store' }).then(res => res.ok ? res.json() : null)
      ]);
      rawForecast = forecastRes as GCBAForecastResponse | null;
      rawAlerts = alertsRes as GCBAAlertsResponse | null;
    } catch (error) {
      console.error('Error fetching live Subte telemetry:', error);
    }

    if (!rawForecast || !rawForecast.Entity || rawForecast.Entity.length === 0) {
      console.log('Using simulated live telemetry (empty/failed API response)');
      isMocked = true;
      rawForecast = generateMockForecast(nowUnix, sequences);
    }

    // Process alerts
    if (rawAlerts && rawAlerts.entity && rawAlerts.entity.length > 0) {
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
      globalForAlerts.lastAlerts = alerts;
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
      globalForAlerts.lastAlerts = alerts;
    } else {
      // Use the last successfully fetched alerts if current fetch returned empty or failed
      alerts = globalForAlerts.lastAlerts;
    }

    // Save to global cache
    globalForCache.subteCache = {
      rawForecast,
      alerts,
      fetchedAt: nowUnix,
      isMocked
    };
    fetchedAt = nowUnix;
  }

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
    const rawRouteId = entity.Linea.Route_Id;
    if (!rawRouteId) return;

    const routeId = matchDbRoute(rawRouteId);
    if (!routeId) return;

    entity.Linea.Estaciones?.forEach((est: GCBAStation) => {
      const arrTime = est.arrival?.time || est.departure?.time;
      if (!arrTime) return;

      const stopDirectionId = getDirectionFromStopId(est.stop_id);
      if (stopDirectionId === null) return;

      rawArrivals.push({
        routeId,
        directionId: stopDirectionId,
        stopId: est.stop_id,
        arrivalTime: arrTime,
        departureTime: est.departure?.time || arrTime + STOP_DURATION_S,
        delay: est.arrival?.delay || est.departure?.delay || 0
      });
    });
  });

  const trains: TrainTelemetry[] = [];
  const usedIds = new Set<string>();

  // Calculate stable time offset of the feed to synchronize with local server time
  const feedTimestamp = rawForecast.Header.timestamp;
  let timeDiff = syncDB.stableTimeDiff;

  if (feedTimestamp !== syncDB.lastFeedTimestamp || !timeDiff) {
    // If feed timestamp updated (or is dynamic/mocked), we recalculate the stable time difference
    timeDiff = nowUnix - feedTimestamp;
    syncDB.lastFeedTimestamp = feedTimestamp;
    syncDB.stableTimeDiff = timeDiff;
  }

  // Run Stateful Tracking with 1D Clustering algorithm for each route and direction
  for (const [key, seqList] of Object.entries(routeSequences)) {
    const [routeId, dirStr] = key.split('_');
    const directionId = parseInt(dirStr);

    // Collect all valid arrivals for this route and direction
    const validStops: { stopId: string; stopSequence: number; arrivalTime: number; delay: number }[] = [];
    
    rawArrivals.forEach(arr => {
      if (arr.routeId === routeId && arr.directionId === directionId) {
        const seq = seqList.find(s => s.stopId === arr.stopId);
        if (seq) {
          const arrivalTimeAdjusted = arr.arrivalTime + timeDiff;
          // Filter out stale predictions that are more than 60 seconds in the past
          if (arrivalTimeAdjusted >= nowUnix - 60) {
            validStops.push({
              stopId: arr.stopId,
              stopSequence: seq.stopSequence,
              arrivalTime: arrivalTimeAdjusted,
              delay: arr.delay
            });
          }
        }
      }
    });

    if (validStops.length === 0) continue;

    // Calculate t_inicio for each stop to project departure from terminal
    const validStopsWithTInicio = validStops.map(stop => {
      const t_inicio = stop.arrivalTime - (stop.stopSequence * 88.5);
      return { ...stop, t_inicio };
    });

    // Sort strictly by t_inicio
    validStopsWithTInicio.sort((a, b) => a.t_inicio - b.t_inicio);

    // 1D Clustering (DBSCAN 1D)
    const clusters: { t_inicio_values: number[]; stops: typeof validStopsWithTInicio }[] = [];
    
    validStopsWithTInicio.forEach(stop => {
      let added = false;
      if (clusters.length > 0) {
        const lastCluster = clusters[clusters.length - 1];
        const avg = lastCluster.t_inicio_values.reduce((sum, v) => sum + v, 0) / lastCluster.t_inicio_values.length;
        if (Math.abs(stop.t_inicio - avg) < 180) {
          lastCluster.t_inicio_values.push(stop.t_inicio);
          lastCluster.stops.push(stop);
          added = true;
        }
      }
      if (!added) {
        clusters.push({
          t_inicio_values: [stop.t_inicio],
          stops: [stop]
        });
      }
    });

    // Process each cluster (each physical train found)
    clusters.forEach(cluster => {
      const avg_t_inicio = cluster.t_inicio_values.reduce((sum, v) => sum + v, 0) / cluster.t_inicio_values.length;
      
      let matchedTripId: string | null = null;
      let minDiff = Infinity;
      
      for (const [tripId, entry] of trackerDB.entries()) {
        if (entry.routeId === routeId && entry.directionId === directionId && !usedIds.has(tripId)) {
          const diff = Math.abs(entry.t_inicio - avg_t_inicio);
          if (diff < minDiff && diff <= 240) {
            minDiff = diff;
            matchedTripId = tripId;
          }
        }
      }
      
      let stableId: string;
      if (matchedTripId) {
        stableId = matchedTripId;
        const entry = trackerDB.get(matchedTripId)!;
        entry.t_inicio = avg_t_inicio;
        entry.lastSeen = nowUnix;
      } else {
        const lineChar = routeId.replace('Linea', '');
        let randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
        stableId = `${lineChar}-${randomPart}`;
        while (usedIds.has(stableId) || trackerDB.has(stableId)) {
          randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
          stableId = `${lineChar}-${randomPart}`;
        }
        
        trackerDB.set(stableId, {
          routeId,
          directionId,
          tripId: stableId,
          t_inicio: avg_t_inicio,
          lastSeen: nowUnix
        });
      }
      usedIds.add(stableId);

      // Sort cluster stops strictly by stopSequence
      const sortedStops = [...cluster.stops].sort((a, b) => a.stopSequence - b.stopSequence);
      if (sortedStops.length === 0) return;

      // Find activeStop: the stop with the lowest arrivalTime meeting arrivalTime - nowUnix >= -40
      const activeStop = sortedStops.find(s => s.arrivalTime - nowUnix >= -40) || sortedStops[sortedStops.length - 1];

      const nextStation = stationMap.get(activeStop.stopId);
      const nextStopName = nextStation?.stopName || 'Estación';
      const nextStopId = activeStop.stopId;
      const etaSeconds = Math.max(0, activeStop.arrivalTime - nowUnix);

      let status: 'STOPPED' | 'IN_TRANSIT' = 'STOPPED';
      let progress = 0;
      let prevStopId: string | null = null;
      let prevStopName: string | null = null;

      const nextSeqIndex = seqList.findIndex(s => s.stopId === activeStop.stopId);

      if (nowUnix >= activeStop.arrivalTime) {
        // STATIONARY
        status = 'STOPPED';
        progress = 0.0;
        prevStopId = activeStop.stopId;
        prevStopName = nextStopName;
      } else {
        // IN_TRANSIT
        status = 'IN_TRANSIT';
        progress = Math.max(0.0, Math.min(0.95, 1 - ((activeStop.arrivalTime - nowUnix) / 90)));

        if (nextSeqIndex > 0) {
          prevStopId = seqList[nextSeqIndex - 1].stopId;
          prevStopName = stationMap.get(prevStopId)?.stopName || 'Estación';
        }
      }

      // Interpolate coordinates
      const prevStation = prevStopId ? stationMap.get(prevStopId) : null;
      let lat = nextStation?.latitude || 0;
      let lon = nextStation?.longitude || 0;

      if (status === 'IN_TRANSIT' && prevStation && nextStation) {
        lat = prevStation.latitude + progress * (nextStation.latitude - prevStation.latitude);
        lon = prevStation.longitude + progress * (nextStation.longitude - prevStation.longitude);
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
        delaySeconds: activeStop.delay,
        updatedAt: nowUnix
      });
    });
  }

  // Dead reckoning: Keep returning active trains that are temporarily missing from the feed
  for (const [tripId, entry] of trackerDB.entries()) {
    if (!usedIds.has(tripId) && nowUnix - entry.lastSeen <= 40) {
      // Find the route sequence for this train
      const key = `${entry.routeId}_${entry.directionId}`;
      const seqList = routeSequences[key];
      if (!seqList || seqList.length === 0) continue;

      // Calculate projected arrival times for each station based on t_inicio
      const projectedStops = seqList.map(seq => {
        const arrivalTime = entry.t_inicio + (seq.stopSequence * 88.5);
        return {
          stopId: seq.stopId,
          stopSequence: seq.stopSequence,
          arrivalTime,
          delay: 0
        };
      });

      // Filter out stops that are more than 60 seconds in the past
      const validStops = projectedStops.filter(s => s.arrivalTime >= nowUnix - 60);
      if (validStops.length === 0) continue;

      // Find the active stop
      const activeStop = validStops.find(s => s.arrivalTime - nowUnix >= -40) || validStops[validStops.length - 1];

      const nextStation = stationMap.get(activeStop.stopId);
      const nextStopName = nextStation?.stopName || 'Estación';
      const nextStopId = activeStop.stopId;
      const etaSeconds = Math.max(0, activeStop.arrivalTime - nowUnix);

      let status: 'STOPPED' | 'IN_TRANSIT' = 'STOPPED';
      let progress = 0;
      let prevStopId: string | null = null;
      let prevStopName: string | null = null;

      const nextSeqIndex = seqList.findIndex(s => s.stopId === activeStop.stopId);

      if (nowUnix >= activeStop.arrivalTime) {
        status = 'STOPPED';
        progress = 0.0;
        prevStopId = activeStop.stopId;
        prevStopName = nextStopName;
      } else {
        status = 'IN_TRANSIT';
        progress = Math.max(0.0, Math.min(0.95, 1 - ((activeStop.arrivalTime - nowUnix) / 90)));

        if (nextSeqIndex > 0) {
          prevStopId = seqList[nextSeqIndex - 1].stopId;
          prevStopName = stationMap.get(prevStopId)?.stopName || 'Estación';
        }
      }

      // Interpolate coordinates
      const prevStation = prevStopId ? stationMap.get(prevStopId) : null;
      let lat = nextStation?.latitude || 0;
      let lon = nextStation?.longitude || 0;

      if (status === 'IN_TRANSIT' && prevStation && nextStation) {
        lat = prevStation.latitude + progress * (nextStation.latitude - prevStation.latitude);
        lon = prevStation.longitude + progress * (nextStation.longitude - prevStation.longitude);
      }

      trains.push({
        id: entry.tripId,
        routeId: entry.routeId,
        directionId: entry.directionId,
        status,
        progress,
        latitude: lat,
        longitude: lon,
        nextStopId,
        nextStopName,
        prevStopId,
        prevStopName,
        etaSeconds,
        delaySeconds: 0,
        updatedAt: nowUnix
      });
    }
  }

  // Memory cleanup: remove trains last seen more than 120s ago
  for (const [tripId, entry] of trackerDB.entries()) {
    if (nowUnix - entry.lastSeen > 120) {
      trackerDB.delete(tripId);
    }
  }

  return {
    trains: trains.sort((a, b) => a.id.localeCompare(b.id)),
    alerts,
    isMocked
  };
}

// Helper to determine route direction based on stop ID suffix
function getDirectionFromStopId(stopId: string): number | null {
  const lastChar = stopId[stopId.length - 1];
  if (lastChar === 'S' || lastChar === 'E') {
    return 0;
  }
  if (lastChar === 'N' || lastChar === 'O') {
    return 1;
  }
  return null;
}

// Generate realistic mock forecast when live API has no data or is down
function generateMockForecast(nowUnix: number, sequences: any[]): GCBAForecastResponse {
  const subteRoutes = ['LineaA', 'LineaB', 'LineaC', 'LineaD', 'LineaE', 'LineaH'];
  const entities: GCBAEntity[] = [];

  // Group sequences by routeId and directionId
  const routeSeqMap: Record<string, string[]> = {};
  sequences.forEach(seq => {
    const key = `${seq.routeId}_${seq.directionId}`;
    if (!routeSeqMap[key]) routeSeqMap[key] = [];
    routeSeqMap[key].push(seq.stopId);
  });

  subteRoutes.forEach(routeId => {
    [0, 1].forEach(directionId => {
      const key = `${routeId}_${directionId}`;
      const stopsList = routeSeqMap[key] || [];
      if (stopsList.length === 0) return;

      // 3 simulated trains per line and direction
      for (let trainIndex = 0; trainIndex < 3; trainIndex++) {
        // Stagger departure times: every 8 minutes (480 seconds)
        const offset = trainIndex * 480;
        const baseStart = nowUnix - 600 + offset;
        const tripId = `${routeId.replace('Linea', '')}_T${trainIndex + 1}`;

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
