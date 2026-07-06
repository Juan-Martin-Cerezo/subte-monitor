import { db } from './db';
import { createHash } from 'crypto';
import { LINE_SHAPES } from './shapes';

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

export interface Prediction {
  routeId: string;
  directionId: number;
  stopId: string;
  stationName: string;
  destinationName: string;
  etaSeconds: number;
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

// Snaps coordinates along a high-resolution GTFS line shape
function interpolateOnShape(
  shape: [number, number][] | undefined,
  prevLat: number,
  prevLon: number,
  nextLat: number,
  nextLon: number,
  progress: number
): { latitude: number; longitude: number } {
  if (!shape || shape.length === 0) {
    return {
      latitude: prevLat + progress * (nextLat - prevLat),
      longitude: prevLon + progress * (nextLon - prevLon)
    };
  }

  // Find index in shape closest to prev coordinates
  let prevIdx = 0;
  let minPrevDist = Infinity;
  for (let i = 0; i < shape.length; i++) {
    const dist = getDistanceMeters(prevLat, prevLon, shape[i][0], shape[i][1]);
    if (dist < minPrevDist) {
      minPrevDist = dist;
      prevIdx = i;
    }
  }

  // Find index in shape closest to next coordinates
  let nextIdx = 0;
  let minNextDist = Infinity;
  for (let i = 0; i < shape.length; i++) {
    const dist = getDistanceMeters(nextLat, nextLon, shape[i][0], shape[i][1]);
    if (dist < minNextDist) {
      minNextDist = dist;
      nextIdx = i;
    }
  }

  // If both matched the same or invalid order, fallback to linear
  if (prevIdx === nextIdx) {
    return {
      latitude: prevLat + progress * (nextLat - prevLat),
      longitude: prevLon + progress * (nextLon - prevLon)
    };
  }

  // Extract the segment points in the correct direction
  const segment: [number, number][] = [];
  if (prevIdx < nextIdx) {
    for (let i = prevIdx; i <= nextIdx; i++) {
      segment.push(shape[i]);
    }
  } else {
    for (let i = prevIdx; i >= nextIdx; i--) {
      segment.push(shape[i]);
    }
  }

  // Compute cumulative distances
  const distances: number[] = [0];
  let totalDist = 0;
  for (let i = 0; i < segment.length - 1; i++) {
    const d = getDistanceMeters(
      segment[i][0], segment[i][1],
      segment[i+1][0], segment[i+1][1]
    );
    totalDist += d;
    distances.push(totalDist);
  }

  const targetDist = progress * totalDist;

  // Find the sub-segment
  for (let i = 0; i < segment.length - 1; i++) {
    if (targetDist >= distances[i] && targetDist <= distances[i + 1]) {
      const segLength = distances[i + 1] - distances[i];
      const segProgress = segLength > 0 ? (targetDist - distances[i]) / segLength : 0;
      return {
        latitude: segment[i][0] + segProgress * (segment[i+1][0] - segment[i][0]),
        longitude: segment[i][1] + segProgress * (segment[i+1][1] - segment[i][1])
      };
    }
  }

  // Fallback
  const last = segment[segment.length - 1];
  return { latitude: last[0], longitude: last[1] };
}

// Persistent memory tracker to survive hot reload in Next.js development
export interface TrackerEntry {
  routeId: string;
  directionId: number;
  tripId: string;
  t_inicio: number;
  lastSeen: number;
  lastStopId: string;
  lastTargetSeq: number;
  lastProgress: number;
  stationEnterTime: number;
  lastStatus: 'IN_TRANSIT' | 'STOPPED';
}

const globalForTracker = globalThis as unknown as { 
  subteTracker: Map<string, TrackerEntry> 
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
  const cleanedRoute = rawRouteId.trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
  
  const dbRoutes = ['LineaA', 'LineaB', 'LineaC', 'LineaD', 'LineaE', 'LineaH', 'PM-Civico', 'PM-Savio'];
  for (const dbRoute of dbRoutes) {
    const line = dbRoute.replace('Linea', '').replace('PM-', '').toLowerCase();
    const routeSuffix = cleanedRoute.replace('linea', '').replace('line', '').replace('subte', '');
    if (!routeSuffix.includes(line.toLowerCase())) {
      continue;
    }
    return dbRoute;
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
  let fetchedAt = nowUnix;

  const cacheLimitSeconds = 1.5; // cache for 1.5 seconds
  const cached = globalForCache.subteCache;

  if (cached && nowUnix - cached.fetchedAt < cacheLimitSeconds) {
    rawForecast = cached.rawForecast;
    alerts = cached.alerts;
    fetchedAt = cached.fetchedAt;
  } else {
    // Fetch fresh
    let rawAlerts: GCBAAlertsResponse | null = null;
    try {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 4000);
      const fo = { cache: 'no-store' as const, signal: ac.signal };
      const [forecastRes, alertsRes] = await Promise.all([
        fetch(forecastUrl, fo).then(res => res.ok ? res.json() : null),
        fetch(alertsUrl, fo).then(res => res.ok ? res.json() : null)
      ]);
      clearTimeout(to);
      rawForecast = forecastRes as GCBAForecastResponse | null;
      rawAlerts = alertsRes as GCBAAlertsResponse | null;
    } catch (error) {
      console.error('Error fetching live Subte telemetry:', error);
    }

    if (!rawForecast || !rawForecast.Entity || rawForecast.Entity.length === 0) {
      console.log('No live telemetry data available (API response empty/failed)');
      rawForecast = { Header: { timestamp: nowUnix }, Entity: [] };
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
    } else {
      // Use the last successfully fetched alerts if current fetch returned empty or failed
      alerts = globalForAlerts.lastAlerts;
    }

    // Save to global cache
    globalForCache.subteCache = {
      rawForecast,
      alerts,
      fetchedAt: nowUnix,
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
  const feedTimestamp = rawForecast.Header.timestamp;
  const rawArrivals: RawArrival[] = [];
  rawForecast.Entity.forEach((entity: GCBAEntity) => {
    if (!entity.Linea) return;
    const rawRouteId = entity.Linea.Route_Id;
    if (!rawRouteId) return;

    const routeId = matchDbRoute(rawRouteId);
    if (!routeId) return;

    // Line D normalisation: handle duplicate placeholder timestamps
    let isCorruptedLineD = false;
    if (routeId === 'LineaD' && entity.Linea.Estaciones && entity.Linea.Estaciones.length > 3) {
      const times = entity.Linea.Estaciones.map(e => e.arrival?.time || e.departure?.time).filter(Boolean) as number[];
      const uniqueTimes = new Set(times);
      if (uniqueTimes.size <= 2) {
        isCorruptedLineD = true;
      }
    }

    if (isCorruptedLineD && entity.Linea.Estaciones) {
      let tripStartEpoch = feedTimestamp;
      if (entity.Linea.start_time) {
        const dateStr = entity.Linea.start_date || new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(4, 6)) - 1;
        const day = parseInt(dateStr.substring(6, 8));
        const [hh, mm, ss] = entity.Linea.start_time.split(':').map(Number);
        const localDate = new Date(year, month, day, hh, mm, ss);
        const parsedEpoch = Math.floor(localDate.getTime() / 1000);
        if (Math.abs(nowUnix - parsedEpoch) < 7200) {
          tripStartEpoch = parsedEpoch;
        } else {
          tripStartEpoch = feedTimestamp - 600;
        }
      }

      entity.Linea.Estaciones.forEach(est => {
        const seq = sequences.find(s => s.stopId === est.stop_id);
        const seqNum = seq ? seq.stopSequence : 1;
        const delay = est.arrival?.delay || est.departure?.delay || 0;
        const reconstructedArrival = tripStartEpoch + Math.round(seqNum * 88.5) + delay;
        const reconstructedDeparture = reconstructedArrival + STOP_DURATION_S;

        est.arrival = { time: reconstructedArrival, delay: 0 };
        est.departure = { time: reconstructedDeparture, delay: 0 };
      });
    }

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
    const validStops: { stopId: string; stopSequence: number; arrivalTime: number; delay: number; etaEnPaquete: number }[] = [];

    rawArrivals.forEach(arr => {
      if (arr.routeId === routeId && arr.directionId === directionId) {
        const seq = seqList.find(s => s.stopId === arr.stopId);
        if (seq) {
          const arrivalTimeAdjusted = arr.arrivalTime + timeDiff;
          const etaEnPaquete = arr.arrivalTime - feedTimestamp;
          // Filter based solely on API package: etaEnPaquete >= -60
          if (etaEnPaquete >= -60) {
            validStops.push({
              stopId: arr.stopId,
              stopSequence: seq.stopSequence,
              arrivalTime: arrivalTimeAdjusted,
              delay: arr.delay,
              etaEnPaquete
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
      
      // 1. Time-based matching (Primary)
      for (const [id, entry] of trackerDB.entries()) {
        if (entry.routeId === routeId && entry.directionId === directionId && !usedIds.has(id)) {
          const diff = Math.abs(entry.t_inicio - avg_t_inicio);
          if (diff < minDiff && diff <= 600) {
            minDiff = diff;
            matchedTripId = id;
          }
        }
      }

      // 2. Early activeStop extraction
      const sortedStops = [...cluster.stops].sort((a, b) => a.stopSequence - b.stopSequence);
      if (sortedStops.length === 0) return; // continues to next cluster
      let activeStop = sortedStops.find(s => s.etaEnPaquete >= -40) || sortedStops[sortedStops.length - 1];

      // 3. Spatial matching (Fallback for massive lag spikes)
      if (!matchedTripId) {
        for (const [id, entry] of trackerDB.entries()) {
          if (entry.routeId === routeId && entry.directionId === directionId && !usedIds.has(id)) {
            // If a 'new' train occupies the exact same physical block (+/- 1 sequence) 
            // as an existing tracked train, assume it's the same physical train to preserve ID.
            if (Math.abs(entry.lastTargetSeq - activeStop.stopSequence) <= 1) {
              matchedTripId = id;
              break;
            }
          }
        }
      }

      let stableId: string;
      let trackedTrain: TrackerEntry;
      if (matchedTripId) {
        stableId = matchedTripId;
        trackedTrain = trackerDB.get(matchedTripId)!;
        trackedTrain.t_inicio = avg_t_inicio;
        trackedTrain.lastSeen = nowUnix;
        
        // REGLA 1: Anti-Moonwalking (Evitar que el tren retroceda si la API manda datos viejos)
        if (activeStop.stopSequence < trackedTrain.lastTargetSeq) {
          const simStop = seqList.find(s => s.stopSequence === trackedTrain.lastTargetSeq);
          if (simStop) {
            activeStop = {
              t_inicio: trackedTrain.t_inicio,
              stopId: simStop.stopId,
              stopSequence: trackedTrain.lastTargetSeq,
              arrivalTime: nowUnix,
              delay: 0,
              etaEnPaquete: trackedTrain.lastStatus === 'STOPPED' ? -10 : 30 // Mantiene el estado anterior
            };
          }
        } 
        // REGLA 2: Breadcrumb Trail / Anti-Teleportation (Obligar a visitar secuencias intermedias)
        else {
          // Si estaba STOPPED, el siguiente paso lógico es la estación + 1. Si estaba en TRANSIT, es la misma estación.
          const nextLogicalSeq = trackedTrain.lastStatus === 'STOPPED' ? trackedTrain.lastTargetSeq + 1 : trackedTrain.lastTargetSeq;
          
          const skipSize = activeStop.stopSequence - nextLogicalSeq;
          if (skipSize > 0 && skipSize <= 3) {
            // Salto ≤3 estaciones. Forzamos secuencia intermedia para evitar microsaltos.
            const simStop = seqList.find(s => s.stopSequence === nextLogicalSeq);
            if (simStop) {
              activeStop = {
                t_inicio: trackedTrain.t_inicio,
                stopId: simStop.stopId,
                stopSequence: nextLogicalSeq,
                arrivalTime: nowUnix - 10,
                delay: 0,
                etaEnPaquete: -10 // Forzamos ETA negativo para que la máquina lo registre como STOPPED rápidamente
              };
            }
          }
        }

        // Verificamos si cambió de estación
        if (trackedTrain.lastStopId !== activeStop.stopId) {
          trackedTrain.lastStopId = activeStop.stopId;
          trackedTrain.stationEnterTime = nowUnix;
        }
      } else {
        const lineChar = routeId.startsWith('PM-') ? routeId.replace('-', '') : routeId.replace('Linea', '');
        let randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
        stableId = `${lineChar}-${randomPart}`;
        while (usedIds.has(stableId) || trackerDB.has(stableId)) {
          randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
          stableId = `${lineChar}-${randomPart}`;
        }
        
        trackedTrain = {
          routeId,
          directionId,
          tripId: stableId,
          t_inicio: avg_t_inicio,
          lastSeen: nowUnix,
          lastStopId: activeStop.stopId,
          lastTargetSeq: activeStop.stopSequence,
          lastProgress: 0.0,
          stationEnterTime: nowUnix,
          lastStatus: 'STOPPED'
        };
        trackerDB.set(stableId, trackedTrain);
      }
      usedIds.add(stableId);

      const nextStation = stationMap.get(activeStop.stopId);
      const nextStopName = nextStation?.stopName || 'Estación';
      const nextStopId = activeStop.stopId;
      const etaSeconds = Math.max(0, activeStop.arrivalTime - nowUnix);

      const segundosParaArriboLocal = activeStop.arrivalTime - nowUnix;
      const apiConfirmaAnden = activeStop.etaEnPaquete <= 15 && activeStop.etaEnPaquete >= -60;

      let status: 'IN_TRANSIT' | 'STOPPED' = 'IN_TRANSIT';
      let progress = 0.0;
      let prevStopId = activeStop.stopId;
      let prevStopName = nextStopName;

      const nextSeqIndex = seqList.findIndex(s => s.stopId === activeStop.stopId);
      if (nextSeqIndex > 0) {
        prevStopId = seqList[nextSeqIndex - 1].stopId;
        prevStopName = stationMap.get(prevStopId)?.stopName || 'Estación';
      }

      if (apiConfirmaAnden) {
        status = 'STOPPED';
        progress = 0.0;
      } else {
        status = 'IN_TRANSIT';
        const rawProgress = Math.max(0.0, Math.min(0.95, 1 - (segundosParaArriboLocal / 90)));
        
        // Trinquete Estricto (No puede disminuir su progreso visual hacia el mismo objetivo)
        if (matchedTripId) {
          if (trackedTrain.lastTargetSeq === activeStop.stopSequence) {
            progress = Math.max(trackedTrain.lastProgress || 0, rawProgress);
          } else {
            progress = rawProgress;
          }
        } else {
          progress = rawProgress;
        }
      }

      // GUARDADO DE ESTADO PARA EL PRÓXIMO FRAME
      trackedTrain.lastTargetSeq = activeStop.stopSequence;
      trackedTrain.lastProgress = progress;
      trackedTrain.lastStatus = status;

      // Interpolate coordinates
      const prevStation = prevStopId ? stationMap.get(prevStopId) : null;
      let lat = nextStation?.latitude || 0;
      let lon = nextStation?.longitude || 0;

      if (status === 'IN_TRANSIT' && prevStation && nextStation) {
        const shape = LINE_SHAPES[routeId];
        const snapped = interpolateOnShape(
          shape,
          prevStation.latitude, prevStation.longitude,
          nextStation.latitude, nextStation.longitude,
          progress
        );
        lat = snapped.latitude;
        lon = snapped.longitude;
      }

      // Line D special: Ignore stopped trains completely
      if (routeId === 'LineaD' && status === 'STOPPED') {
        return;
      }

      // ALGORITMO CAZAFANTASMAS: Exempt terminals (sequence 1 or max sequence)
      const entryData = trackerDB.get(stableId);
      const maxSeq = Math.max(...seqList.map(s => s.stopSequence));
      const isTerminal = activeStop.stopSequence === 1 || activeStop.stopSequence === maxSeq;
      
      if (status === 'STOPPED' && entryData && (nowUnix - entryData.stationEnterTime > 300)) {
         if (!isTerminal) return; // Drop phantom trains in mid-route only
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
    if (!usedIds.has(tripId) && nowUnix - entry.lastSeen <= 90) {
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

      // Dead reckoning: no fresh API data, so never confirm platform arrival
      status = 'IN_TRANSIT';
      const newProgress = Math.max(0.0, Math.min(0.95, 1 - ((activeStop.arrivalTime - nowUnix) / 90)));
      
      // Trinquete
      if (entry.lastTargetSeq === activeStop.stopSequence) {
        progress = Math.max(entry.lastProgress, newProgress);
      } else {
        entry.lastTargetSeq = activeStop.stopSequence;
        entry.lastProgress = 0.0;
        progress = newProgress;
      }
      entry.lastProgress = progress;
      entry.lastStatus = status;

      if (nextSeqIndex > 0) {
        prevStopId = seqList[nextSeqIndex - 1].stopId;
        prevStopName = stationMap.get(prevStopId)?.stopName || 'Estación';
      }

      // Interpolate coordinates
      const prevStation = prevStopId ? stationMap.get(prevStopId) : null;
      let lat = nextStation?.latitude || 0;
      let lon = nextStation?.longitude || 0;

      if (status === 'IN_TRANSIT' && prevStation && nextStation) {
        const shape = LINE_SHAPES[entry.routeId];
        const snapped = interpolateOnShape(
          shape,
          prevStation.latitude, prevStation.longitude,
          nextStation.latitude, nextStation.longitude,
          progress
        );
        lat = snapped.latitude;
        lon = snapped.longitude;
      }


      // Dead reckoning: train reached projected station. Mark STOPPED, push to client.
      // Will be cleaned by ghostbuster after 300s timeout.
      if (progress >= 0.95) {
        status = 'STOPPED';
        progress = 0.0;
        lat = nextStation?.latitude || 0;
        lon = nextStation?.longitude || 0;
      }

      // ALGORITMO CAZAFANTASMAS: Si el tren está 'STOPPED' en el mismo andén por más de 180 segundos, ignorarlo.
      if ((status as string) === 'STOPPED' && (nowUnix - entry.stationEnterTime > 300)) {
         continue; // Ignorar (es un tren fantasma del CBTC)
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

  // Memory cleanup: remove trains last seen more than 300s ago
  for (const [tripId, entry] of trackerDB.entries()) {
    if (nowUnix - entry.lastSeen > 300) {
      trackerDB.delete(tripId);
    }
  }

  // Virtual simulator dispatcher for C, H, Premetro lines
  const simRoutes = ['LineaC', 'LineaH', 'PM-Civico', 'PM-Savio'];
  const localDateStr = new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' });
  const localDate = new Date(localDateStr);
  const localDay = localDate.getDay();
  const localHour = localDate.getHours();
  const localMinute = localDate.getMinutes();
  const localTimeVal = localHour * 100 + localMinute;

  let isTransitActive = false;
  if (localDay === 0) { // Sunday
    isTransitActive = localTimeVal >= 800 && localTimeVal <= 2230;
  } else if (localDay === 6) { // Saturday
    isTransitActive = localTimeVal >= 600 && localTimeVal <= 2330;
  } else { // Weekday
    isTransitActive = localTimeVal >= 530 && localTimeVal <= 2330;
  }

  if (isTransitActive) {
    simRoutes.forEach(routeId => {
      let headwayModifier = 1.0;
      let isInterrupted = false;
      const lineAlerts = alerts.filter(a => a.routeId === routeId);
      lineAlerts.forEach(a => {
        if (a.effect === 'Sin Servicio') {
          isInterrupted = true;
        } else if (a.effect === 'Servicio Demorado' || a.effect === 'Frecuencia Reducida') {
          headwayModifier = 1.5;
        }
      });

      if (isInterrupted) return;

      const baseHeadway = routeId.startsWith('PM-') ? 900 : 300;
      const headway = Math.round(baseHeadway * headwayModifier);

      [0, 1].forEach(directionId => {
        const key = `${routeId}_${directionId}`;
        const seqList = routeSequences[key] || [];
        if (seqList.length < 2) return;

        const sortedSeq = [...seqList].sort((a, b) => a.stopSequence - b.stopSequence);
        const totalStops = sortedSeq.length;
        const tripDuration = (totalStops - 1) * 88.5;
        const numTrips = Math.ceil(tripDuration / headway);

        for (let k = 0; k < numTrips; k++) {
          const elapsedTime = ((nowUnix - k * headway) % headway) + k * headway;
          if (elapsedTime >= tripDuration || elapsedTime < 0) continue;

          const stopIdx = Math.floor(elapsedTime / 88.5);
          if (stopIdx >= totalStops - 1) continue;

          const activeStop = sortedSeq[stopIdx];
          const nextStop = sortedSeq[stopIdx + 1];

          const dwellTime = elapsedTime % 88.5;
          let status: 'STOPPED' | 'IN_TRANSIT' = 'STOPPED';
          let progress = 0.0;
          const prevStopId = activeStop.stopId;
          const prevStopName = stationMap.get(prevStopId)?.stopName || 'Estación';
          const nextStopId = nextStop.stopId;
          const nextStopName = stationMap.get(nextStopId)?.stopName || 'Estación';

          if (dwellTime < STOP_DURATION_S) {
            status = 'STOPPED';
            progress = 0.0;
          } else {
            status = 'IN_TRANSIT';
            progress = (dwellTime - STOP_DURATION_S) / (88.5 - STOP_DURATION_S);
          }

          const prevStation = stationMap.get(prevStopId);
          const nextStation = stationMap.get(nextStopId);
          let lat = nextStation?.latitude || 0;
          let lon = nextStation?.longitude || 0;

          if (status === 'IN_TRANSIT' && prevStation && nextStation) {
            const shape = LINE_SHAPES[routeId];
            const snapped = interpolateOnShape(
              shape,
              prevStation.latitude, prevStation.longitude,
              nextStation.latitude, nextStation.longitude,
              progress
            );
            lat = snapped.latitude;
            lon = snapped.longitude;
          }

          const lineChar = routeId.startsWith('PM-') ? routeId.replace('-', '') : routeId.replace('Linea', '');
          const tripId = `SIM-${lineChar}-${directionId}-${k}`;
          const etaSeconds = Math.max(0, Math.round(((stopIdx + 1) * 88.5) - elapsedTime));

          trains.push({
            id: tripId,
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
            delaySeconds: 0,
            updatedAt: nowUnix
          });
        }
      });
    });
  }

  // Map raw predictions for the raw schedule tab
  const apiPredictions = rawArrivals.map(arr => {
    const key = `${arr.routeId}_${arr.directionId}`;
    const seqList = routeSequences[key] || [];
    
    // Find destination (terminal station)
    const terminalSeq = seqList[seqList.length - 1];
    const destinationName = terminalSeq 
      ? (stationMap.get(terminalSeq.stopId)?.stopName || 'Terminal')
      : 'Terminal';
      
    const station = stationMap.get(arr.stopId);
    const stationName = station ? station.stopName : 'Estación';
    
    const etaSeconds = Math.max(0, (arr.arrivalTime + timeDiff) - nowUnix);
    
    return {
      routeId: arr.routeId,
      directionId: arr.directionId,
      stopId: arr.stopId,
      stationName,
      destinationName,
      etaSeconds,
      delay: arr.delay
    };
  }).filter(p => p.etaSeconds < 1800);

  // Add predictions from sim trains for the arrivals tab
  const simPredictions: Prediction[] = [];
  trains.filter(t => t.id.startsWith('SIM-')).forEach(simTrain => {
    const key = `${simTrain.routeId}_${simTrain.directionId}`;
    const seqList = routeSequences[key] || [];
    const terminalSeq = seqList[seqList.length - 1];
    const destinationName = terminalSeq
      ? (stationMap.get(terminalSeq.stopId)?.stopName || 'Terminal')
      : 'Terminal';
    simPredictions.push({
      routeId: simTrain.routeId,
      directionId: simTrain.directionId,
      stopId: simTrain.nextStopId,
      stationName: simTrain.nextStopName,
      destinationName,
      etaSeconds: simTrain.etaSeconds,
      delay: 0
    });
  });

  const schedulePredictions = [...apiPredictions, ...simPredictions];

  return {
    trains: trains.sort((a, b) => a.id.localeCompare(b.id)),
    alerts,
    predictions: schedulePredictions
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


