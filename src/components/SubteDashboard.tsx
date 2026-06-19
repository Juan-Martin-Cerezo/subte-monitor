'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TrainTelemetry, AlertData } from '@/lib/telemetry';
import 'leaflet/dist/leaflet.css';
import { LINE_SHAPES } from '@/lib/shapes';
import { ACCESSIBILITY_METADATA } from '@/lib/metadata';
import { ARTWORK_METADATA, PREMETRO_STATION_DETAILS, SUBTE_LINES_GEOM, AOM_SUMMARY } from '@/lib/metadata_extended';

interface ReportData {
  id: string;
  line: string;
  station: string;
  category: string;
  comment: string;
  createdAt: string;
}

interface Station {
  stopId: string;
  stopName: string;
  latitude: number;
  longitude: number;
}

interface RouteSequence {
  id: string;
  routeId: string;
  directionId: number;
  stopSequence: number;
  stopId: string;
}

interface Prediction {
  routeId: string;
  directionId: number;
  stopId: string;
  stationName: string;
  destinationName: string;
  etaSeconds: number;
  delay: number;
}

interface SubteDashboardProps {
  initialStations: Station[];
  initialSequences: RouteSequence[];
  initialTelemetry: {
    trains: TrainTelemetry[];
    alerts: AlertData[];
    predictions?: Prediction[];
  };
}

const LINE_DETAILS: Record<string, { name: string; color: string; bgClass: string; borderClass: string; textColor: string; gradient: string }> = {
  LineaA: {
    name: 'Línea A',
    color: '#00A6D6',
    bgClass: 'bg-cyan-500/10',
    borderClass: 'border-cyan-500/30',
    textColor: 'text-cyan-400',
    gradient: 'from-cyan-500 to-blue-500'
  },
  LineaB: {
    name: 'Línea B',
    color: '#ED1C24',
    bgClass: 'bg-red-500/10',
    borderClass: 'border-red-500/30',
    textColor: 'text-red-400',
    gradient: 'from-red-500 to-rose-600'
  },
  LineaC: {
    name: 'Línea C',
    color: '#0072C6',
    bgClass: 'bg-blue-500/10',
    borderClass: 'border-blue-500/30',
    textColor: 'text-blue-400',
    gradient: 'from-blue-500 to-indigo-600'
  },
  LineaD: {
    name: 'Línea D',
    color: '#00965E',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/30',
    textColor: 'text-emerald-400',
    gradient: 'from-emerald-500 to-teal-600'
  },
  LineaE: {
    name: 'Línea E',
    color: '#6C2B7A',
    bgClass: 'bg-purple-500/10',
    borderClass: 'border-purple-500/30',
    textColor: 'text-purple-400',
    gradient: 'from-purple-500 to-violet-600'
  },
  LineaH: {
    name: 'Línea H',
    color: '#FFCD00',
    bgClass: 'bg-yellow-500/10',
    borderClass: 'border-yellow-500/30',
    textColor: 'text-yellow-400',
    gradient: 'from-yellow-500 to-amber-500'
  },
  'PM-Civico': {
    name: 'P-C',
    color: '#FFBD33',
    bgClass: 'bg-orange-500/10',
    borderClass: 'border-orange-500/30',
    textColor: 'text-orange-400',
    gradient: 'from-orange-400 to-amber-500'
  },
  'PM-Savio': {
    name: 'P-S',
    color: '#FFBD33',
    bgClass: 'bg-orange-500/10',
    borderClass: 'border-orange-500/30',
    textColor: 'text-orange-400',
    gradient: 'from-orange-400 to-amber-500'
  }
};

const MANUAL_TRANSFERS: Record<string, string[]> = {
  'Perú': ['Catedral', 'Bolívar'],
  'Catedral': ['Perú', 'Bolívar'],
  'Bolívar': ['Perú', 'Catedral'],
  'Avenida de Mayo': ['Lima'],
  'Lima': ['Avenida de Mayo'],
  'Carlos Pellegrini': ['9 de Julio', 'Diagonal Norte'],
  '9 de Julio': ['Carlos Pellegrini', 'Diagonal Norte'],
  'Diagonal Norte': ['Carlos Pellegrini', '9 de Julio'],
  'Plaza Miserere': ['Once'],
  'Once': ['Plaza Miserere'],
  'Humberto I': ['Jujuy'],
  'Jujuy': ['Humberto I'],
  'Santa Fe': ['Pueyrredón'],
  'Pueyrredón': ['Santa Fe', 'Corrientes'],
  'Corrientes': ['Pueyrredón'],
  'Intendente Saguier': ['Plaza de los Virreyes'],
  'Plaza de los Virreyes': ['Intendente Saguier']
};

export default function SubteDashboard({
  initialStations,
  initialSequences,
  initialTelemetry
}: SubteDashboardProps) {
  // Navigation Screens Tab state
  const [currentTab, setCurrentTab] = useState<'map' | 'planner' | 'stations' | 'status' | 'arrivals' | 'aom'>('map');

  // Interactive Map State
  const [activeLine, setActiveLine] = useState<string>('All'); // 'All' or lineId
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [selectedTrainId, setSelectedTrainId] = useState<string | null>(null);
  const [pinnedTrainId, setPinnedTrainId] = useState<string | null>(null);

  // Free Zoom tracking flag
  const [mapUserMoved, setMapUserMoved] = useState(false);
  const mapUserMovedRef = useRef(false);

  // Live Telemetry data
  const [telemetry, setTelemetry] = useState(initialTelemetry);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // User reports trigger
  const [reportTrigger, setReportTrigger] = useState(0);
  const [reports, setReports] = useState<ReportData[]>([]);

  // Leaflet map refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const tracksGroupRef = useRef<any>(null);
  const stationsGroupRef = useRef<any>(null);
  const trainsGroupRef = useRef<any>(null);
  const mapBoundsInitializedRef = useRef(false);
  const isProgrammaticMoveRef = useRef(false);
  const trainMarkersRef = useRef<Map<string, any>>(new Map());

  // Helper to determine route direction destination
  const getTrainDestination = useCallback((routeId: string, directionId: number) => {
    const seqList = initialSequences.filter(s => s.routeId === routeId && s.directionId === directionId);
    if (seqList.length === 0) return 'Terminal';
    const terminalSeq = seqList[seqList.length - 1];
    const station = initialStations.find(st => st.stopId === terminalSeq.stopId);
    return station ? station.stopName : 'Terminal';
  }, [initialSequences, initialStations]);

  // Planner Screen state
  const [plannerOrigin, setPlannerOrigin] = useState<string>('');
  const [plannerDestination, setPlannerDestination] = useState<string>('');
  const [plannedRoute, setPlannedRoute] = useState<any[] | null>(null);
  const [stepFreeRequired, setStepFreeRequired] = useState(false);

  // Station Directory Screen state
  const [stationSearch, setStationSearch] = useState<string>('');
  const [stationLineFilter, setStationLineFilter] = useState<string>('LineaA'); // Default Line A
  const [arrivalsLineFilter, setArrivalsLineFilter] = useState<string>('LineaA');
  const [arrivalsDestFilter, setArrivalsDestFilter] = useState<string>('all');
  const [directorySelectedStationId, setDirectorySelectedStationId] = useState<string | null>(null);

  // All lines always visible on map
  const visibleLines = useMemo(() => {
    return Object.keys(LINE_DETAILS);
  }, []);

  // Reset selected lines if they disappear
  useEffect(() => {
    if (activeLine !== 'All' && !visibleLines.includes(activeLine)) {
      setActiveLine('All');
    }
    if (stationLineFilter !== 'All' && !visibleLines.includes(stationLineFilter)) {
      setStationLineFilter(visibleLines[0] || 'LineaA');
    }
    if (!visibleLines.includes(arrivalsLineFilter)) {
      setArrivalsLineFilter(visibleLines[0] || 'LineaA');
    }
  }, [visibleLines, activeLine, stationLineFilter, arrivalsLineFilter]);

  // Compute unique destinations for arrivals filter
  const arrivalsDestinations = useMemo(() => {
    const dests = new Set<string>();
    (telemetry.predictions || []).forEach(p => {
      if (p.routeId === arrivalsLineFilter && p.destinationName) {
        dests.add(p.destinationName);
      }
    });
    return Array.from(dests).sort();
  }, [arrivalsLineFilter, telemetry.predictions]);

  // Responsive mobile list toggle
  const [showMobileList, setShowMobileList] = useState(true);

  // Station feedback form
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportCategory, setReportCategory] = useState('Congestión');
  const [reportComment, setReportComment] = useState('');
  const [reportSuccess, setReportSuccess] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  // Ordered station list for the selected line in raw arrivals
  const arrivalsStations = useMemo(() => {
    const seqs = initialSequences.filter(s => s.routeId === arrivalsLineFilter);
    const stopIds = new Set(seqs.map(s => s.stopId));
    const lineStations = initialStations.filter(s => stopIds.has(s.stopId));
    
    // Group by stopName to show both directions together
    const grouped: Record<string, { stopName: string; stops: typeof lineStations }> = {};
    lineStations.forEach(s => {
      if (!grouped[s.stopName]) {
        grouped[s.stopName] = { stopName: s.stopName, stops: [] };
      }
      grouped[s.stopName].stops.push(s);
    });
    
    // Order them by the average/first stopSequence
    return Object.values(grouped).map(g => {
      const firstStopId = g.stops[0].stopId;
      const seq = seqs.find(s => s.stopId === firstStopId);
      const minSeq = seq ? seq.stopSequence : 999;
      return { ...g, minSeq };
    }).sort((a, b) => a.minSeq - b.minSeq);
  }, [arrivalsLineFilter, initialSequences, initialStations]);

  // Unique list of station names for the planner options
  const uniqueStationNames = useMemo(() => {
    return Array.from(new Set(initialStations.map(s => s.stopName))).sort();
  }, [initialStations]);

  // Selected station reference (directory)
  const directorySelectedStation = useMemo(() => {
    return initialStations.find(s => s.stopId === directorySelectedStationId) || initialStations.find(s => s.stopName === '9 de Julio') || null;
  }, [directorySelectedStationId, initialStations]);

  const mapSelectedStation = useMemo(() => {
    return initialStations.find(s => s.stopId === selectedStationId) || null;
  }, [selectedStationId, initialStations]);

  // Fetch telemetry updates every 2 seconds
  const fetchTelemetry = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/telemetry?line=${activeLine}&t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data);
        setConnectionError(false);
      } else {
        setConnectionError(true);
      }
    } catch (error) {
      console.error('Error updating live telemetry:', error);
      setConnectionError(true);
    } finally {
      setIsRefreshing(false);
      setIsInitialLoading(false);
    }
  }, [activeLine]);

  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 2000);
    return () => clearInterval(interval);
  }, [fetchTelemetry]);

  // Update clock
  useEffect(() => {
    const updateClock = () => {
      const clockEl = document.getElementById('live-clock');
      const timeString = new Date().toLocaleTimeString('es-AR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (clockEl) clockEl.textContent = timeString;
    };
    const timeoutId = setTimeout(updateClock, 0);
    const timer = setInterval(updateClock, 1000);
    return () => {
      clearTimeout(timeoutId);
      clearInterval(timer);
    };
  }, []);

  // Fetch reports on mount/update
  useEffect(() => {
    let active = true;
    const fetchReports = async () => {
      try {
        const url = activeLine !== 'All' ? `/api/reports?line=${activeLine}` : '/api/reports';
        const res = await fetch(url);
        if (res.ok && active) {
          const data = await res.json();
          setReports(data);
        }
      } catch (error) {
        console.error('Error fetching reports:', error);
      }
    };

    fetchReports();
    return () => {
      active = false;
    };
  }, [activeLine, reportTrigger]);

  // Handle report submission
  const handleSubmitReport = async (e: React.FormEvent, targetStationId: string) => {
    e.preventDefault();
    const station = initialStations.find(s => s.stopId === targetStationId);
    if (!station) return;

    let line = 'LineaA';
    const seq = initialSequences.find(s => s.stopId === targetStationId);
    if (seq) line = seq.routeId;

    setIsSubmittingReport(true);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          line,
          station: station.stopName,
          category: reportCategory,
          comment: reportComment
        })
      });

      if (res.ok) {
        setReportSuccess(true);
        setReportComment('');
        setReportTrigger(prev => prev + 1);
        setTimeout(() => {
          setReportSuccess(false);
          setShowReportForm(false);
        }, 2000);
      }
    } catch (error) {
      console.error('Error submitting report:', error);
    } finally {
      setIsSubmittingReport(false);
    }
  };

  // -------------------------------------------------------------
  // DIJKSTRA ROUTING LOGIC
  // -------------------------------------------------------------
  const graph = useMemo(() => {
    const g: Record<string, { node: string; weight: number; routeId: string | null }[]> = {};

    initialStations.forEach(s => {
      g[s.stopId] = [];
    });

    const routeSeqs: Record<string, typeof initialSequences> = {};
    initialSequences.forEach(seq => {
      const key = `${seq.routeId}-${seq.directionId}`;
      if (!routeSeqs[key]) routeSeqs[key] = [];
      routeSeqs[key].push(seq);
    });

    Object.values(routeSeqs).forEach(seqs => {
      seqs.sort((a, b) => a.stopSequence - b.stopSequence);
      for (let i = 0; i < seqs.length - 1; i++) {
        const u = seqs[i].stopId;
        const v = seqs[i + 1].stopId;
        if (g[u] && g[v]) {
          g[u].push({ node: v, weight: 1, routeId: seqs[i].routeId });
          g[v].push({ node: u, weight: 1, routeId: seqs[i].routeId });
        }
      }
    });

    for (let i = 0; i < initialStations.length; i++) {
      for (let j = i + 1; j < initialStations.length; j++) {
        const s1 = initialStations[i];
        const s2 = initialStations[j];
        const hasSameName = s1.stopName === s2.stopName;
        const isManual = MANUAL_TRANSFERS[s1.stopName]?.includes(s2.stopName);

        if (hasSameName || isManual) {
          const r1 = initialSequences.filter(seq => seq.stopId === s1.stopId).map(seq => seq.routeId);
          const r2 = initialSequences.filter(seq => seq.stopId === s2.stopId).map(seq => seq.routeId);
          const shareAnyRoute = r1.some(routeId => r2.includes(routeId));
          if (!shareAnyRoute) {
            g[s1.stopId].push({ node: s2.stopId, weight: 3, routeId: null });
            g[s2.stopId].push({ node: s1.stopId, weight: 3, routeId: null });
          }
        }
      }
    }

    return g;
  }, [initialStations, initialSequences]);

  const findRoute = useCallback(() => {
    if (!plannerOrigin || !plannerDestination) return;

    const startIds = initialStations.filter(s => s.stopName === plannerOrigin).map(s => s.stopId);
    const endIds = new Set(initialStations.filter(s => s.stopName === plannerDestination).map(s => s.stopId));

    if (startIds.length === 0 || endIds.size === 0) return;

    let bestPath: { stopId: string; routeId: string | null }[] | null = null;
    let bestDist = Infinity;

    startIds.forEach(startId => {
      const distances: Record<string, number> = {};
      const previous: Record<string, { node: string; routeId: string | null } | null> = {};
      const queue = new Set<string>();

      Object.keys(graph).forEach(node => {
        distances[node] = Infinity;
        previous[node] = null;
        queue.add(node);
      });

      distances[startId] = 0;

      while (queue.size > 0) {
        let minNode: string | null = null;
        let minDist = Infinity;
        queue.forEach(node => {
          if (distances[node] < minDist) {
            minDist = distances[node];
            minNode = node;
          }
        });

        if (minNode === null || minDist === Infinity) break;
        const u = minNode;
        queue.delete(u);

        if (endIds.has(u)) {
          if (distances[u] < bestDist) {
            bestDist = distances[u];
            const path: { stopId: string; routeId: string | null }[] = [];
            let curr: string | null = u;
            while (curr) {
              const nodeKey: string = curr;
              const prevInfo: { node: string; routeId: string | null } | null = previous[nodeKey];
              path.push({ stopId: nodeKey, routeId: prevInfo ? prevInfo.routeId : null });
              curr = prevInfo ? prevInfo.node : null;
            }
            path.reverse();
            bestPath = path;
          }
          break;
        }

        graph[u]?.forEach(edge => {
          if (!queue.has(edge.node)) return;
          const alt = distances[u] + edge.weight;
          if (alt < distances[edge.node]) {
            distances[edge.node] = alt;
            previous[edge.node] = { node: u, routeId: edge.routeId };
          }
        });
      }
    });

    if (bestPath) {
      const legs: any[] = [];
      let currentLeg: { routeId: string | null; stops: string[] } | null = null;

      for (let i = 0; i < (bestPath as any).length; i++) {
        const item = (bestPath as any)[i];
        const stationObj = initialStations.find(s => s.stopId === item.stopId);
        if (!stationObj) continue;

        const nextItem = (bestPath as any)[i + 1];
        const nextRouteId = nextItem ? nextItem.routeId : null;

        if (!currentLeg) {
          currentLeg = {
            routeId: nextRouteId,
            stops: [stationObj.stopName]
          };
        } else {
          currentLeg.stops.push(stationObj.stopName);
          if (nextRouteId !== currentLeg.routeId) {
            legs.push(currentLeg);
            currentLeg = {
              routeId: nextRouteId,
              stops: [stationObj.stopName]
            };
          }
        }
      }
      if (currentLeg && currentLeg.stops.length > 0) {
        legs.push(currentLeg);
      }

      setPlannedRoute(legs);
    } else {
      setPlannedRoute(null);
    }
  }, [plannerOrigin, plannerDestination, graph, initialStations]);

  const handleFindRoutes = () => {
    findRoute();
  };

  const swapPlannerStations = () => {
    const temp = plannerOrigin;
    setPlannerOrigin(plannerDestination);
    setPlannerDestination(temp);
  };

  const routeSummaryMetrics = useMemo(() => {
    if (!plannedRoute) return { time: 0, stops: 0, transfers: 0 };
    let stops = 0;
    let transfers = 0;
    plannedRoute.forEach(leg => {
      if (leg.routeId) {
        stops += leg.stops.length - 1;
      } else {
        transfers += 1;
      }
    });
    const time = (stops * 2) + (transfers * 4);
    return { time, stops, transfers };
  }, [plannedRoute]);

  // -------------------------------------------------------------
  // LEAFLET MAP DRAWING & INITIALIZATION
  // -------------------------------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;
    const container = mapContainerRef.current;
    if ((container as any)._leaflet_id) return;

    let isMounted = true;
    let localMap: any = null;

    import('leaflet').then((L) => {
      if (!isMounted) return;
      if (mapInstanceRef.current) return;
      if ((container as any)._leaflet_id) return;

      const map = L.map(container, {
        center: [-34.6037, -58.3816],
        zoom: 13,
        zoomControl: false,
        attributionControl: false
      });
      localMap = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(map);

      L.control.zoom({ position: 'topright' }).addTo(map);

      // Track manual map interactions to prevent auto-centering resets
      const handleUserInteraction = () => {
        if (isProgrammaticMoveRef.current) return;
        mapUserMovedRef.current = true;
        setMapUserMoved(true);
      };
      map.on('dragend', handleUserInteraction);
      map.on('zoomend', handleUserInteraction);
      map.on('movestart', handleUserInteraction);

      // Disable marker transitions during zoom or panning to avoid drifting artifacts
      map.on('zoomstart', () => container.classList.add('map-zooming'));
      map.on('zoomend', () => container.classList.remove('map-zooming'));
      map.on('movestart', () => container.classList.add('map-zooming'));
      map.on('moveend', () => container.classList.remove('map-zooming'));

      const tracksGroup = L.layerGroup().addTo(map);
      const stationsGroup = L.layerGroup().addTo(map);
      const trainsGroup = L.layerGroup().addTo(map);

      mapInstanceRef.current = map;
      tracksGroupRef.current = tracksGroup;
      stationsGroupRef.current = stationsGroup;
      trainsGroupRef.current = trainsGroup;
    });

    return () => {
      isMounted = false;
      if (localMap) {
        localMap.remove();
        mapInstanceRef.current = null;
      } else if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update map contents (Tracks, Stations, Trains)
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    import('leaflet').then((L) => {
      const tracksGroup = tracksGroupRef.current;
      const stationsGroup = stationsGroupRef.current;
      const trainsGroup = trainsGroupRef.current;

      tracksGroup.clearLayers();
      stationsGroup.clearLayers();

      const activeLines = activeLine === 'All' ? visibleLines : [activeLine];

      // Draw Tracks
      Object.entries(LINE_DETAILS).forEach(([lineId, details]) => {
        if (!activeLines.includes(lineId)) return;
        const points = LINE_SHAPES[lineId] as L.LatLngTuple[] | undefined;
        if (points && points.length > 0) {
          L.polyline(points, {
            color: details.color,
            weight: activeLine === lineId ? 6.5 : 4,
            opacity: activeLine === 'All' ? 0.7 : 0.95
          }).addTo(tracksGroup);
        }
      });

      // Draw Physical tracks backing from NUEVADATA geometries
      SUBTE_LINES_GEOM.forEach(track => {
        L.polyline(track.coords, {
          color: '#1e293b',
          weight: 2.5,
          opacity: 0.3,
          dashArray: '4, 4'
        }).addTo(tracksGroup);
      });

      // Group active stations by name
      const activeSequences = initialSequences.filter(s => activeLines.includes(s.routeId));
      const activeStopIds = new Set(activeSequences.map(s => s.stopId));
      const activeStations = initialStations.filter(s => activeStopIds.has(s.stopId));

      const stationsByName = new Map<string, Station[]>();
      activeStations.forEach(s => {
        const name = s.stopName;
        if (!stationsByName.has(name)) {
          stationsByName.set(name, []);
        }
        stationsByName.get(name)!.push(s);
      });

      // Draw Stations
      stationsByName.forEach((group) => {
        const s = group[0];
        const isSelected = group.some(gs => gs.stopId === selectedStationId);
        const seq = initialSequences.find(seq => seq.stopId === s.stopId);
        const lineColor = seq ? LINE_DETAILS[seq.routeId]?.color : '#475569';

        const stationHtml = `
          <div style="position: relative; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;">
            ${isSelected ? `
              <div style="position: absolute; inset: -4px; border: 2px solid #fff; border-radius: 50%; animation: pulse 1.5s infinite;"></div>
            ` : ''}
            <div style="width: ${isSelected ? '14px' : '11px'}; height: ${isSelected ? '14px' : '11px'}; background: #090d16; border: 3px solid ${lineColor}; border-radius: 50%;"></div>
            <div style="position: absolute; width: 4px; height: 4px; background: ${isSelected ? '#fff' : '#cbd5e1'}; border-radius: 50%;"></div>
            ${(activeLine !== 'All' || isSelected) ? `
              <div style="position: absolute; left: 16px; white-space: nowrap; font-size: 9px; font-weight: bold; color: ${isSelected ? '#fff' : '#94a3b8'}; text-shadow: 0 1px 3px rgba(0,0,0,0.8); pointer-events: none;">
                ${s.stopName}
              </div>
            ` : ''}
          </div>
        `;

        const stationIcon = L.divIcon({
          className: 'custom-station-icon',
          html: stationHtml,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });

        const marker = L.marker([s.latitude, s.longitude], { icon: stationIcon }).addTo(stationsGroup);
        marker.on('click', () => {
          setSelectedStationId(s.stopId);
          setSelectedTrainId(null);
        });
      });

      // Draw Trains
      const activeTrains = telemetry.trains.filter(t => activeLines.includes(t.routeId));
      const activeTrainIds = new Set(activeTrains.map(t => t.id));

      // Remove markers for trains that are no longer active
      for (const [id, marker] of trainMarkersRef.current.entries()) {
        if (!activeTrainIds.has(id)) {
          marker.remove();
          trainMarkersRef.current.delete(id);
        }
      }

      activeTrains.forEach(train => {
        const color = LINE_DETAILS[train.routeId]?.color || '#fff';
        const isSelected = selectedTrainId === train.id;
        const isPinned = pinnedTrainId === train.id;

        // Calculate heading
        let heading = train.directionId === 0 ? 90 : 270;
        const nextStation = initialStations.find(s => s.stopId === train.nextStopId);
        const prevStation = train.prevStopId ? initialStations.find(s => s.stopId === train.prevStopId) : null;
        if (nextStation) {
          const x1 = prevStation ? prevStation.longitude : train.longitude;
          const y1 = prevStation ? prevStation.latitude : train.latitude;
          const dx = nextStation.longitude - x1;
          const dy = nextStation.latitude - y1;
          if (Math.abs(dx) > 0.00001 || Math.abs(dy) > 0.00001) {
            heading = -Math.atan2(dy, dx) * (180 / Math.PI);
          }
        }

        const htmlContent = `
          <div style="position: relative; width: 30px; height: 30px; cursor: pointer;">
            ${isPinned ? `
              <div style="position: absolute; inset: -5px; border: 2px dashed ${color}; border-radius: 50%; animation: spin 6s linear infinite;"></div>
            ` : ''}
            ${isSelected && !isPinned ? `
              <div style="position: absolute; inset: -4px; border: 1.5px solid #fff; border-radius: 50%;"></div>
            ` : ''}
            <div style="position: absolute; top: 11px; left: 11px; width: 8px; height: 8px; background: ${color}; clip-path: polygon(100% 50%, 0% 0%, 0% 100%); transform: rotate(${heading}deg) translate(9px, 0);"></div>
            <div style="position: absolute; inset: 2px; background: #090d16; border: 3px solid ${color}; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px ${color};">
              <div style="width: 0; height: 0; border-top: 3.5px solid transparent; border-bottom: 3.5px solid transparent; border-left: 5.5px solid ${color}; transform: rotate(${heading}deg); margin-left: 1.5px;"></div>
            </div>
            <div style="position: absolute; top: -18px; left: 50%; transform: translateX(-50%); color: ${isPinned ? '#fff' : color}; font-family: monospace; font-size: 10px; font-weight: bold; white-space: nowrap; text-shadow: 0 2px 4px rgba(0,0,0,0.9);">
              ${train.id}
            </div>
          </div>
        `;

        const trainIcon = L.divIcon({
          className: 'custom-train-icon',
          html: htmlContent,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });

        const statusText = train.status === 'STOPPED' ? 'Detenido en' : 'Rumbo a';
        const etaMin = Math.round(train.etaSeconds / 60);
        const tooltipContent = `
          <div style="color: #fff; background: #0b0f19; border: 1px solid #334155; padding: 4px 8px; border-radius: 6px; font-size: 10px; font-weight: 600;">
            <strong>TREN ${train.id}</strong><br/>
            ${statusText} ${train.nextStopName} (ETA: ${etaMin}m)<br/>
            <span style="color: #f59e0b; font-size: 9px;">Sentido: Hacia ${getTrainDestination(train.routeId, train.directionId)}</span>
          </div>
        `;

        let marker = trainMarkersRef.current.get(train.id);
        if (marker) {
          marker.setLatLng([train.latitude, train.longitude]);
          marker.setIcon(trainIcon);
          marker.setTooltipContent(tooltipContent);
        } else {
          marker = L.marker([train.latitude, train.longitude], { icon: trainIcon }).addTo(trainsGroup);
          marker.bindTooltip(tooltipContent, { direction: 'top', offset: [0, -10], opacity: 0.95 });
          marker.on('click', () => {
            setSelectedTrainId(train.id);
            setSelectedStationId(null);
          });
          trainMarkersRef.current.set(train.id, marker);
        }
      });
    });
  }, [telemetry, activeLine, selectedStationId, selectedTrainId, pinnedTrainId, initialStations, initialSequences, getTrainDestination, visibleLines]);


  // Center or Fit Bounds only if user has not panned or zoomed manually
  const fitMapBounds = useCallback(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    isProgrammaticMoveRef.current = true;
    const resetProgrammatic = () => {
      setTimeout(() => {
        isProgrammaticMoveRef.current = false;
      }, 500);
    };

    if (pinnedTrainId) {
      const pinnedTrain = telemetry.trains.find(t => t.id === pinnedTrainId);
      if (pinnedTrain) {
        const currentZoom = map.getZoom() || 15;
        map.setView([pinnedTrain.latitude, pinnedTrain.longitude], currentZoom, { animate: true });
        resetProgrammatic();
      }
    } else if (activeLine !== 'All') {
      const lineSeqs = initialSequences.filter(s => s.routeId === activeLine && s.directionId === 0);
      const lineStations = initialStations.filter(s => lineSeqs.some(seq => seq.stopId === s.stopId));
      if (lineStations.length > 0) {
        import('leaflet').then((L) => {
          const latlngs = lineStations.map(s => [s.latitude, s.longitude] as L.LatLngTuple);
          map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50], animate: true });
          resetProgrammatic();
        });
      }
    } else {
      if (!mapBoundsInitializedRef.current) {
        import('leaflet').then((L) => {
          const latlngs = initialStations.map(s => [s.latitude, s.longitude] as L.LatLngTuple);
          if (latlngs.length > 0) {
            map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], animate: true });
            mapBoundsInitializedRef.current = true;
            resetProgrammatic();
          }
        });
      } else {
        isProgrammaticMoveRef.current = false;
      }
    }
  }, [activeLine, initialStations, initialSequences, pinnedTrainId, telemetry.trains]);

  // Trigger fit bounds explicitly when activeLine, pinnedTrainId changes
  useEffect(() => {
    if (!mapUserMovedRef.current) {
      fitMapBounds();
    }
  }, [activeLine, pinnedTrainId, fitMapBounds]);

  // Automatically track pinned train as it moves
  useEffect(() => {
    if (!mapInstanceRef.current || !pinnedTrainId || mapUserMovedRef.current) return;
    const pinnedTrain = telemetry.trains.find(t => t.id === pinnedTrainId);
    if (pinnedTrain) {
      const currentZoom = mapInstanceRef.current.getZoom() || 15;
      isProgrammaticMoveRef.current = true;
      mapInstanceRef.current.setView([pinnedTrain.latitude, pinnedTrain.longitude], currentZoom, { animate: true });
      setTimeout(() => {
        isProgrammaticMoveRef.current = false;
      }, 500);
    }
  }, [telemetry.trains, pinnedTrainId]);

  // Invalidate Map size on screen tab switch to redraw Leaflet correctly
  useEffect(() => {
    if (currentTab === 'map' && mapInstanceRef.current) {
      const timer = setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize({ animate: false });
          if (!mapUserMovedRef.current && activeLine !== 'All') {
            fitMapBounds();
          }
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentTab, fitMapBounds, activeLine]);

  const handleResetMapPosition = () => {
    mapUserMovedRef.current = false;
    setMapUserMoved(false);
    fitMapBounds();
  };

  // -------------------------------------------------------------
  // PRE CALCULATED SUMMARY DATA
  // -------------------------------------------------------------
  const activeTrains = useMemo(() => {
    const activeLines = activeLine === 'All' ? visibleLines : [activeLine];
    return telemetry.trains.filter(t => activeLines.includes(t.routeId));
  }, [telemetry.trains, activeLine, visibleLines]);

  const averageDelay = useMemo(() => {
    if (activeTrains.length === 0) return 0;
    return Math.round(activeTrains.reduce((sum, t) => sum + Math.max(0, t.delaySeconds), 0) / activeTrains.length);
  }, [activeTrains]);

  const delayedTrains = useMemo(() => {
    return activeTrains.filter(t => t.delaySeconds > 60);
  }, [activeTrains]);

  const globalAlerts = telemetry.alerts;

  // Station lists for Directory Screen
  const directoryStations = useMemo(() => {
    let filtered = initialStations;
    if (stationSearch) {
      const search = stationSearch.toLowerCase();
      filtered = filtered.filter(s => s.stopName.toLowerCase().includes(search));
    }
    if (stationLineFilter !== 'All') {
      const lineSeqs = initialSequences.filter(s => s.routeId === stationLineFilter);
      const stopIds = new Set(lineSeqs.map(s => s.stopId));
      filtered = filtered.filter(s => stopIds.has(s.stopId));
    }

    const seen = new Set<string>();
    return filtered.filter(s => {
      if (seen.has(s.stopName)) return false;
      seen.add(s.stopName);
      return true;
    }).sort((a, b) => a.stopName.localeCompare(b.stopName));
  }, [initialStations, initialSequences, stationSearch, stationLineFilter]);

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-on-surface font-body-md overflow-hidden relative">
      
      {/* Skeleton Loading — matches layout structure, fades out */}
      {isInitialLoading && (
        <div className="absolute inset-0 z-[9999] flex flex-row animate-[fadeIn_0.2s_ease-in]">
          {/* Sidebar skeleton */}
          <aside className="hidden md:flex w-64 shrink-0 flex-col bg-surface-dim/80 border-r border-outline-variant/20">
            <div className="p-5 border-b border-outline-variant/10 space-y-2">
              <div className="w-7 h-5 rounded bg-slate-800/80 animate-pulse" />
              <div className="w-14 h-2 rounded bg-slate-800/60 animate-pulse" />
            </div>
            <div className="flex-1 p-3 space-y-1.5">
              {[1, 2, 3, 4, 5, 6, 7].map(i => (
                <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-slate-800/80 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
                    <div className="w-20 h-3 rounded bg-slate-800/70 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
                  </div>
                  <div className="w-5 h-2.5 rounded bg-slate-800/50 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
                </div>
              ))}
            </div>
          </aside>

          {/* Content area skeleton */}
          <div className="flex-1 bg-surface flex items-center justify-center">
            <div className="flex flex-col items-center gap-5 opacity-70">
              <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-secondary/10 border border-secondary/20 shadow-[0_0_20px_rgba(0,238,252,0.1)] animate-pulse">
                <span className="material-symbols-outlined text-[32px] text-secondary/80">subway</span>
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-xl font-black tracking-wider text-white/80">BA SUBTE</h2>
                <p className="text-[11px] text-secondary/60 font-mono tracking-widest uppercase">Conectando telemetría...</p>
              </div>
              <div className="w-48 h-1.5 rounded-full bg-slate-800/50 overflow-hidden">
                <div className="h-full w-1/3 rounded-full bg-secondary/30 animate-[loadingBar_1.2s_ease-in-out_infinite]" />
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* TopAppBar - Responsive Flex layout to prevent overlaps */}
      <header className="hidden md:flex h-16 shrink-0 w-full z-50 justify-between items-center px-gutter bg-surface-container/70 dark:bg-surface-container-lowest/80 backdrop-blur-xl border-b border-outline-variant/30">
        <div className="flex items-center gap-md">
          <span className="text-title-sm font-headline-md font-bold tracking-tight text-on-surface dark:text-on-background md:hidden">SUBTE-MONITOR</span>
        </div>
        
        {/* Navigation links matching Stitch structure */}
        <nav className="hidden md:flex items-center gap-lg">
          <button
            onClick={() => setCurrentTab('map')}
            className={`px-sm py-xs text-headline-md font-headline-md transition-colors duration-205 rounded ${
              currentTab === 'map'
                ? 'text-secondary-container dark:text-secondary border-b-2 border-secondary-container dark:border-secondary pb-1'
                : 'text-on-surface-variant dark:text-outline hover:text-on-surface hover:bg-surface-variant/50'
            }`}
          >
            Mapa
          </button>
          <button
            onClick={() => setCurrentTab('planner')}
            className={`px-sm py-xs text-headline-md font-headline-md transition-colors duration-205 rounded ${
              currentTab === 'planner'
                ? 'text-secondary-container dark:text-secondary border-b-2 border-secondary-container dark:border-secondary pb-1'
                : 'text-on-surface-variant dark:text-outline hover:text-on-surface hover:bg-surface-variant/50'
            }`}
          >
            Planificador
          </button>
          <button
            onClick={() => {
              setCurrentTab('stations');
              setShowMobileList(true);
            }}
            className={`px-sm py-xs text-headline-md font-headline-md transition-colors duration-205 rounded ${
              currentTab === 'stations'
                ? 'text-secondary-container dark:text-secondary border-b-2 border-secondary-container dark:border-secondary pb-1'
                : 'text-on-surface-variant dark:text-outline hover:text-on-surface hover:bg-surface-variant/50'
            }`}
          >
            Estaciones
          </button>
          <button
            onClick={() => setCurrentTab('status')}
            className={`px-sm py-xs text-headline-md font-headline-md transition-colors duration-205 rounded ${
              currentTab === 'status'
                ? 'text-secondary-container dark:text-secondary border-b-2 border-secondary-container dark:border-secondary pb-1'
                : 'text-on-surface-variant dark:text-outline hover:text-on-surface hover:bg-surface-variant/50'
            }`}
          >
            Estado
          </button>
          <button
            onClick={() => setCurrentTab('arrivals')}
            className={`px-sm py-xs text-headline-md font-headline-md transition-colors duration-205 rounded ${
              currentTab === 'arrivals'
                ? 'text-secondary-container dark:text-secondary border-b-2 border-secondary-container dark:border-secondary pb-1'
                : 'text-on-surface-variant dark:text-outline hover:text-on-surface hover:bg-surface-variant/50'
            }`}
          >
            Arribos en Vivo
          </button>
          <button
            onClick={() => setCurrentTab('aom')}
            className={`px-sm py-xs text-headline-md font-headline-md transition-colors duration-205 rounded ${
              currentTab === 'aom'
                ? 'text-secondary-container dark:text-secondary border-b-2 border-secondary-container dark:border-secondary pb-1'
                : 'text-on-surface-variant dark:text-outline hover:text-on-surface hover:bg-surface-variant/50'
            }`}
          >
            AOM y Datos
          </button>
        </nav>

        {/* Header Icons and Pill */}
        <div className="flex items-center gap-sm text-secondary dark:text-secondary-fixed">
          {/* Real-time Indicator Badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-low border border-outline-variant/30 text-[10px] font-mono tracking-widest text-outline mr-2 uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping"></span>
            GCBA TIEMPO REAL
          </div>

          <button onClick={fetchTelemetry} disabled={isRefreshing} aria-label="Notifications" className="p-sm hover:bg-surface-variant/50 transition-colors duration-200 rounded-full active:scale-95 active:opacity-80 flex items-center justify-center">
            <span className={`material-symbols-outlined ${isRefreshing ? 'animate-spin' : ''}`}>sync</span>
          </button>
          <button onClick={() => setCurrentTab('status')} aria-label="Notifications" className="p-sm hover:bg-surface-variant/50 transition-colors duration-200 rounded-full active:scale-95 active:opacity-80 flex items-center justify-center">
            <span className="material-symbols-outlined">notifications</span>
          </button>
          <button aria-label="Settings" className="p-sm hover:bg-surface-variant/50 transition-colors duration-200 rounded-full active:scale-95 active:opacity-80 flex items-center justify-center">
            <span className="material-symbols-outlined">settings</span>
          </button>
        </div>
      </header>

      {/* Mobile Top Bar (Mobile Only) */}
      <header className="md:hidden h-12 shrink-0 w-full z-50 bg-surface-container/90 backdrop-blur-xl border-b border-outline-variant/20 flex justify-between items-center px-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black tracking-tight text-secondary">BA SUBTE</span>
          <span className="text-[9px] font-mono text-outline uppercase tracking-wider hidden xs:inline">
            · Monitor
          </span>
        </div>
        <div className="flex gap-1">
          <button onClick={() => { setCurrentTab('stations'); setShowMobileList(true); }} className="p-1.5" aria-label="Buscar estaciones">
            <span className="material-symbols-outlined text-[20px] text-outline">search</span>
          </button>
          <button onClick={() => { setCurrentTab('status'); }} className="p-1.5" aria-label="Alertas de servicio">
            <span className="material-symbols-outlined text-[20px] text-outline">notifications</span>
          </button>
        </div>
      </header>

      {/* MIDDLE WORKSPACE - Natural layout container */}
      <div className="flex flex-row flex-1 w-full overflow-hidden relative min-h-0">
        
        {/* SideNavBar (Desktop Only) */}
        <aside className="hidden md:flex w-64 shrink-0 h-full flex-col bg-surface-dim/80 dark:bg-surface-container-lowest/90 border-r border-outline-variant/20 shadow-xl text-left">
          <div className="p-lg border-b border-outline-variant/10">
            <h1 className="text-headline-md font-headline-md font-black text-secondary">BA SUBTE</h1>
            <p className="text-label-caps font-label-caps text-on-surface-variant mt-xs">Monitor de Red</p>
          </div>
          <nav className="flex-1 overflow-y-auto py-md flex flex-col gap-xs">
            <button
              onClick={() => {
                setActiveLine('All');
                setCurrentTab('map');
                setSelectedStationId(null);
                setSelectedTrainId(null);
                setPinnedTrainId(null);
              }}
              className={`flex items-center justify-between px-4 py-3 transition-all duration-300 rounded-lg mx-2 ${
                activeLine === 'All' && currentTab === 'map'
                  ? 'bg-secondary-container/20 text-secondary-container border-l-4 border-secondary'
                  : 'text-on-surface-variant opacity-75 hover:bg-surface-container-highest/40 hover:opacity-100 hover:translate-x-1'
              }`}
            >
              <span className="flex items-center gap-md">
                <span className="material-symbols-outlined text-secondary">apps</span>
                <span className="text-data-md font-data-md font-bold">Todas las Líneas</span>
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-container/60 text-outline border-outline-variant/10">
                {telemetry.trains.length}
              </span>
            </button>

            {visibleLines.map(lineId => {
              const details = LINE_DETAILS[lineId];
              const lineTrains = telemetry.trains.filter(t => t.routeId === lineId);
              const isSelected = activeLine === lineId && currentTab === 'map';

              return (
                <button
                  key={lineId}
                  onClick={() => {
                    setActiveLine(lineId);
                    setCurrentTab('map');
                    setSelectedStationId(null);
                    setSelectedTrainId(null);
                    setPinnedTrainId(null);
                  }}
                  className={`flex items-center justify-between px-4 py-3 transition-all duration-300 rounded-lg mx-2 ${
                    isSelected
                      ? 'bg-secondary-container/20 text-secondary-container border-l-4'
                      : 'text-on-surface-variant opacity-75 hover:bg-surface-container-highest/40 hover:opacity-100 hover:translate-x-1'
                  }`}
                  style={{ borderLeftColor: isSelected ? details.color : 'transparent' }}
                >
                  <span className="flex items-center gap-md">
                    <span className="material-symbols-outlined" style={{ color: details.color }}>subway</span>
                    <span className="text-data-md font-data-md font-bold">{details.name}</span>
                  </span>
                  
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-container/60 text-outline border-outline-variant/10">
                    {lineTrains.length}
                  </span>
                </button>
              );
            })}
          </nav>
          
          <div className="p-md border-t border-outline-variant/10 flex flex-col gap-md">
            <button
              onClick={() => {
                setCurrentTab('stations');
                setShowReportForm(true);
              }}
              className="w-full py-sm bg-on-background text-background font-bold text-body-sm rounded hover:bg-surface-tint transition-colors flex justify-center items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">report</span>
              Reportar Incidente
            </button>
            
            <div className="flex justify-around border-t border-outline-variant/20 pt-4">
              <button onClick={() => { setCurrentTab('stations'); setShowMobileList(true); }} className="text-on-surface-variant hover:text-primary transition-colors flex flex-col items-center gap-xs">
                <span className="material-symbols-outlined text-sm">help</span>
                <span className="text-[10px] font-label-caps">Ayuda</span>
              </button>
              <button onClick={() => setCurrentTab('status')} className="text-on-surface-variant hover:text-primary transition-colors flex flex-col items-center gap-xs">
                <span className="material-symbols-outlined text-sm">warning</span>
                <span className="text-[10px] font-label-caps">Alertas</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Content Area */}
        <div className="flex-1 h-full min-h-0 overflow-hidden relative bg-surface flex flex-col pb-14 md:pb-0">
          
          {/* Subtle grid background */}
          {currentTab !== 'map' && (
            <div className="absolute inset-0 z-0 opacity-10 pointer-events-none" style={{ backgroundImage: "radial-gradient(#909095 1px, transparent 1px)", backgroundColor: "transparent", backgroundSize: "24px 24px" }} />
          )}

          {/* ======================================================= */}
          {/* SCREEN 1: MAP INTERACTIVO                               */}
          {/* ======================================================= */}
          <div
            className="absolute inset-0 w-full h-full"
            style={{
              visibility: currentTab === 'map' ? 'visible' : 'hidden',
              height: currentTab === 'map' ? '100%' : '0px',
              overflow: 'hidden'
            }}
          >
            {/* Mobile Line Filter Bar */}
            <div className="absolute top-4 left-4 right-4 z-[1000] md:hidden flex gap-2 overflow-x-auto pb-2 scrollbar-none flex-nowrap card-floating p-2.5 shadow-2xl">
              <button
                onClick={() => {
                  setActiveLine('All');
                  setSelectedStationId(null);
                  setSelectedTrainId(null);
                  setPinnedTrainId(null);
                }}
                className={`px-3 py-1.5 rounded-full border border-outline-variant/30 text-xs font-bold transition-all shrink-0 ${
                  activeLine === 'All'
                    ? 'text-white border-transparent bg-secondary'
                    : 'text-outline hover:border-outline'
                }`}
              >
                TODAS
              </button>
              {visibleLines.map(lineId => {
                const details = LINE_DETAILS[lineId];
                const isActive = activeLine === lineId;
                const shortLabel = lineId === 'PM-Civico' ? 'P-C' : lineId === 'PM-Savio' ? 'P-S' : lineId.replace('Linea', '');
                return (
                  <button
                    key={`mobile-map-filter-${lineId}`}
                    onClick={() => {
                      setActiveLine(lineId);
                      setSelectedStationId(null);
                      setSelectedTrainId(null);
                      setPinnedTrainId(null);
                    }}
                    className={`w-8 h-8 rounded-full border border-outline-variant/30 flex items-center justify-center text-xs font-bold transition-all shrink-0 ${
                      isActive
                        ? 'text-white border-transparent'
                        : 'text-outline hover:border-outline'
                    }`}
                    style={{ backgroundColor: isActive ? details.color : 'transparent' }}
                  >
                    {shortLabel}
                  </button>
                );
              })}
            </div>

            {/* LEAFLET MAP */}
            <div ref={mapContainerRef} className="w-full h-full z-0" />

            {/* MANUAL RECENTER FLOATING BUTTON */}
            {mapUserMoved && (
              <button
                onClick={handleResetMapPosition}
                className="absolute z-[1000] bottom-20 md:bottom-4 left-4 px-4 py-2.5 bg-secondary text-background hover:bg-secondary-container rounded-xl font-bold text-xs shadow-2xl transition-all flex items-center gap-1.5 active:scale-95 border border-outline-variant/30"
              >
                <span className="material-symbols-outlined text-sm">my_location</span>
                Recalibrar Vista
              </button>
            )}

            {/* Floating metrics over map */}
            <div className="absolute top-4 left-4 z-10 hidden lg:flex flex-col gap-3 pointer-events-none">
              <div className="card-floating p-4 text-left shadow-2xl w-52 flex flex-col gap-1 pointer-events-auto">
                <span className="text-[10px] font-black text-outline uppercase tracking-widest font-mono">Filtro de Línea</span>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-sm font-bold text-on-surface">{activeLine === 'All' ? 'Todas las Líneas' : LINE_DETAILS[activeLine]?.name}</span>
                  <button
                    onClick={() => {
                      setActiveLine('All');
                      setSelectedStationId(null);
                      setSelectedTrainId(null);
                      setPinnedTrainId(null);
                    }}
                    className="text-[9px] text-secondary bg-secondary/10 px-1.5 py-0.5 rounded border border-secondary/20 hover:bg-secondary hover:text-background transition"
                  >
                    Restablecer
                  </button>
                </div>
              </div>

              <div className="card-floating p-4 text-left shadow-2xl w-52 flex flex-col gap-1 pointer-events-auto">
                <span className="text-[10px] font-black text-outline uppercase tracking-widest font-mono">Formaciones Activas</span>
                <span className="text-xl font-black text-on-surface font-mono mt-0.5">{activeTrains.length}</span>
              </div>
            </div>

            {/* Selected Station / Train Floating Detail (Map View) */}
            {(selectedStationId || selectedTrainId) && (
              <div className="absolute bottom-20 md:bottom-4 left-4 right-4 md:left-auto z-10 md:w-80 card-floating p-4 shadow-2xl text-left flex flex-col gap-3">
                <div className="flex justify-between items-start">
                  <div>
                    {selectedStationId ? (
                      <>
                        <span className="text-[8px] font-bold text-outline uppercase tracking-widest block font-mono">Estación</span>
                        <h3 className="text-sm font-extrabold text-on-surface leading-tight mt-0.5">{mapSelectedStation?.stopName}</h3>
                      </>
                    ) : (() => {
                      const train = telemetry.trains.find(t => t.id === selectedTrainId);
                      return (
                        <>
                          <span className="text-[8px] font-bold text-outline uppercase tracking-widest block font-mono">Formación</span>
                          <h3 className="text-sm font-extrabold text-on-surface leading-tight mt-0.5 font-mono">Tren {train?.id} ({LINE_DETAILS[train?.routeId || '']?.name.replace('Línea ', '')})</h3>
                        </>
                      );
                    })()}
                  </div>
                  <button
                    onClick={() => { setSelectedStationId(null); setSelectedTrainId(null); }}
                    className="text-[10px] font-bold text-on-surface-variant hover:text-on-surface px-2 py-0.5 inner-card hover:bg-surface-container transition"
                  >
                    Cerrar
                  </button>
                </div>
                
                <hr className="border-outline-variant/10" />

                {selectedStationId ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-[9px] font-bold text-outline uppercase font-mono block">Próximos Arribos:</span>
                    <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                      {telemetry.trains.filter(t => t.nextStopId === selectedStationId).length === 0 ? (
                        <span className="text-[10px] text-on-surface-variant italic text-center py-2 inner-card">No hay arribos próximos.</span>
                      ) : (
                        telemetry.trains.filter(t => t.nextStopId === selectedStationId).map(arr => (
                          <div key={arr.id} className="p-2 rounded-lg inner-card flex items-center justify-between text-xs font-mono">
                            <span className="text-on-surface font-bold">{arr.id}</span>
                            <span className="text-secondary font-black">{arr.etaSeconds === 0 ? 'En andén' : `${Math.floor(arr.etaSeconds / 60)} min`}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : (() => {
                  const train = telemetry.trains.find(t => t.id === selectedTrainId);
                  if (!train) return null;
                  return (
                    <div className="flex flex-col gap-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-outline font-medium font-mono uppercase text-[9px]">Próxima estación:</span>
                        <span className="font-semibold text-on-surface">{train.nextStopName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-outline font-medium font-mono uppercase text-[9px]">Sentido:</span>
                        <span className="font-bold text-amber-400">Hacia {getTrainDestination(train.routeId, train.directionId)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-outline font-medium font-mono uppercase text-[9px]">Llegada Estimada:</span>
                        <span className="font-bold text-secondary font-mono">{train.etaSeconds === 0 ? 'En andén' : `${Math.floor(train.etaSeconds / 60)}m ${train.etaSeconds % 60}s`}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-outline font-medium font-mono uppercase text-[9px]">Demora:</span>
                        <span className={`font-semibold ${train.delaySeconds > 60 ? 'text-error' : 'text-secondary'}`}>
                          {train.delaySeconds > 0 ? `${Math.floor(train.delaySeconds / 60)} min` : 'Sin demora'}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          const isCurrentlyPinned = pinnedTrainId === train.id;
                          if (isCurrentlyPinned) {
                            setPinnedTrainId(null);
                          } else {
                            setPinnedTrainId(train.id);
                            mapUserMovedRef.current = false;
                            setMapUserMoved(false);
                            if (mapInstanceRef.current) {
                              const currentZoom = mapInstanceRef.current.getZoom() || 15;
                              isProgrammaticMoveRef.current = true;
                              mapInstanceRef.current.setView([train.latitude, train.longitude], currentZoom, { animate: true });
                              setTimeout(() => {
                                isProgrammaticMoveRef.current = false;
                              }, 500);
                            }
                          }
                        }}
                        className={`w-full py-1.5 rounded-lg font-bold text-xs border transition flex items-center justify-center gap-1.5 mt-2 ${
                          pinnedTrainId === train.id
                            ? 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30'
                            : 'bg-secondary/10 text-secondary border-secondary/20 hover:bg-secondary/20'
                        }`}
                      >
                        <span className="material-symbols-outlined text-sm">
                          {pinnedTrainId === train.id ? 'gps_fixed' : 'gps_not_fixed'}
                        </span>
                        {pinnedTrainId === train.id ? 'Siguiendo Tren' : 'Seguir Formación'}
                      </button>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* ======================================================= */}
          {/* SCREEN 2: ROUTE PLANNER — REDESIGNED                     */}
          {/* ======================================================= */}
          {currentTab === 'planner' && (
            <div className="flex-1 p-gutter md:p-margin-desktop overflow-x-hidden overflow-y-auto animate-fade-in">
              <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-lg">

                {/* ── LEFT COLUMN: Planner + Route Timeline ── */}
                <div className="lg:col-span-5 flex flex-col gap-lg">

                  {/* Planner Panel */}
                  <section className="relative overflow-hidden rounded-2xl border border-outline-variant/20 bg-gradient-to-br from-surface-container/90 via-surface-container/70 to-surface/90 backdrop-blur-xl shadow-2xl">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-secondary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-primary/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2 pointer-events-none" />

                    <div className="relative p-md md:p-lg flex flex-col gap-md">
                      {/* Header */}
                      <div className="flex items-center gap-sm mb-xs">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-secondary/20 to-secondary/5 border border-secondary/20 flex items-center justify-center">
                          <span className="material-symbols-outlined text-secondary text-xl">route</span>
                        </div>
                        <div>
                          <h2 className="text-title-sm font-title-sm font-bold text-on-background">Planificar Viaje</h2>
                          <p className="text-label-caps font-label-caps text-on-surface-variant">Encontrá la mejor ruta en Subte</p>
                        </div>
                      </div>

                      {/* Inputs */}
                      <div className="relative flex flex-col gap-sm">
                        {/* Origin */}
                        <div className="group relative">
                          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-secondary/50 rounded-full" />
                          <div className="flex items-center bg-black/60 border border-outline-variant/20 rounded-xl group-focus-within:border-secondary/50 group-focus-within:shadow-[0_0_20px_rgba(0,238,252,0.15)] transition-all duration-300 pl-md">
                            <span className="material-symbols-outlined text-secondary text-lg">trip_origin</span>
                            <select
                              value={plannerOrigin}
                              onChange={(e) => setPlannerOrigin(e.target.value)}
                              className="w-full bg-transparent border-none text-body-md text-on-background focus:ring-0 py-sm pr-sm pl-xs outline-none cursor-pointer appearance-none"
                              style={{ backgroundImage: 'none' }}
                            >
                              <option value="" className="bg-surface-container">Estación de Origen</option>
                              {uniqueStationNames.map(name => (
                                <option key={`origin-${name}`} value={name} className="bg-surface-container">{name}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Visual connector line */}
                        <div className="flex flex-col items-center -my-1 z-10">
                          <div className="w-px h-2 bg-outline-variant/40" />
                          <button
                            onClick={swapPlannerStations}
                            className="w-7 h-7 flex items-center justify-center bg-surface-variant rounded-full border border-outline-variant/30 hover:border-secondary/50 hover:bg-surface-bright transition-all text-on-background active:scale-90 group"
                            title="Intercambiar origen y destino"
                          >
                            <span className="material-symbols-outlined text-[16px] group-hover:text-secondary transition-colors">swap_vert</span>
                          </button>
                          <div className="w-px h-2 bg-outline-variant/40" />
                        </div>

                        {/* Destination */}
                        <div className="group relative">
                          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-error/50 rounded-full" />
                          <div className="flex items-center bg-black/60 border border-outline-variant/20 rounded-xl group-focus-within:border-error/50 group-focus-within:shadow-[0_0_20px_rgba(255,69,58,0.15)] transition-all duration-300 pl-md">
                            <span className="material-symbols-outlined text-error text-lg">location_on</span>
                            <select
                              value={plannerDestination}
                              onChange={(e) => setPlannerDestination(e.target.value)}
                              className="w-full bg-transparent border-none text-body-md text-on-background focus:ring-0 py-sm pr-sm pl-xs outline-none cursor-pointer appearance-none"
                              style={{ backgroundImage: 'none' }}
                            >
                              <option value="" className="bg-surface-container">Estación de Destino</option>
                              {uniqueStationNames.map(name => (
                                <option key={`dest-${name}`} value={name} className="bg-surface-container">{name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Options row */}
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-xs cursor-pointer group">
                          <input
                            checked={stepFreeRequired}
                            onChange={(e) => setStepFreeRequired(e.target.checked)}
                            className="form-checkbox bg-black/60 border-outline-variant/40 text-secondary rounded w-4 h-4 focus:ring-secondary focus:ring-offset-background cursor-pointer"
                            type="checkbox"
                          />
                          <span className="text-label-caps font-label-caps text-on-surface-variant group-hover:text-on-background transition-colors flex items-center gap-xs">
                            <span className="material-symbols-outlined text-[14px]">accessible</span>
                            Sin barreras
                          </span>
                        </label>
                      </div>

                      {/* Search button */}
                      <button
                        onClick={handleFindRoutes}
                        disabled={!plannerOrigin || !plannerDestination}
                        className="relative w-full py-sm rounded-xl font-bold text-body-md text-background overflow-hidden transition-all duration-300 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-secondary via-secondary/90 to-primary" />
                        <div className="absolute inset-0 bg-[length:200%_100%] bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
                        <span className="relative flex items-center justify-center gap-xs">
                          <span className="material-symbols-outlined text-[18px]">search</span>
                          Buscar Rutas
                        </span>
                      </button>
                    </div>
                  </section>

                  {/* Route Timeline Results */}
                  <section className="relative flex-1 min-h-[250px] rounded-2xl border border-outline-variant/15 bg-gradient-to-b from-surface-container/60 to-surface/50 backdrop-blur-md shadow-lg overflow-hidden">
                    <div className="p-md border-b border-outline-variant/10 flex justify-between items-center">
                      <h3 className="text-body-md font-body-md font-bold text-on-background flex items-center gap-xs">
                        <span className="material-symbols-outlined text-secondary text-lg">map</span>
                        Ruta
                      </h3>
                      {plannedRoute && (
                        <div className="flex items-center gap-xs text-label-caps font-label-caps text-on-surface-variant">
                          <span className="material-symbols-outlined text-[14px]">schedule</span>
                          {routeSummaryMetrics.time} min
                        </div>
                      )}
                    </div>

                    <div className="p-sm md:p-md overflow-y-auto">
                      {plannedRoute ? (
                        <div className="flex flex-col gap-0">
                          {/* Route Timeline — each leg as a visual step */}
                          {plannedRoute.map((leg, legIdx) => {
                            if (!leg.routeId) {
                              // Transfer step
                              return (
                                <div key={`transfer-${legIdx}`} className="flex items-start gap-sm py-sm">
                                  <div className="flex flex-col items-center">
                                    <div className="w-3 h-3 rounded-full bg-amber-400 border-2 border-amber-400/30" />
                                    <div className="w-0.5 flex-1 min-h-[24px] bg-gradient-to-b from-amber-400/40 to-outline-variant/20" />
                                  </div>
                                  <div className="flex-1 bg-amber-500/5 border border-amber-500/15 rounded-lg px-sm py-xs">
                                    <div className="flex items-center gap-xs text-label-caps font-label-caps text-amber-400">
                                      <span className="material-symbols-outlined text-[14px]">transfer_within_a_station</span>
                                      Trasbordo
                                    </div>
                                    <p className="text-body-sm font-body-sm text-on-surface-variant">
                                      {leg.stops[0]} → {leg.stops[leg.stops.length - 1]}
                                    </p>
                                  </div>
                                </div>
                              );
                            }

                            const lineColor = LINE_DETAILS[leg.routeId]?.color || '#475569';
                            const lineLabel = leg.routeId.replace('Linea', '');
                            const stationCount = leg.stops.length;

                            return (
                              <div key={`leg-${leg.routeId}-${legIdx}`} className="flex items-start gap-sm">
                                <div className="flex flex-col items-center pt-1.5">
                                  {legIdx === 0 ? (
                                    <div className="w-3.5 h-3.5 rounded-full border-2" style={{ borderColor: lineColor, backgroundColor: lineColor + '33' }} />
                                  ) : (
                                    <div className="w-3 h-3 rounded-full border-2" style={{ borderColor: lineColor, backgroundColor: lineColor + '33' }} />
                                  )}
                                  <div className="w-0.5 flex-1 min-h-[28px]" style={{ backgroundColor: lineColor + '44' }} />
                                </div>
                                <div className="flex-1 pb-sm">
                                  <div className="flex items-center gap-xs mb-xs">
                                    <span
                                      className="inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold text-white uppercase"
                                      style={{ backgroundColor: lineColor }}
                                    >
                                      {lineLabel}
                                    </span>
                                    <span className="text-label-caps font-label-caps font-bold" style={{ color: lineColor }}>
                                      {LINE_DETAILS[leg.routeId]?.name || leg.routeId}
                                    </span>
                                    <span className="text-label-caps font-label-caps text-on-surface-variant ml-auto">
                                      {(stationCount - 1) * 2} min
                                    </span>
                                  </div>
                                  {/* Station list for this leg */}
                                  <div className="flex flex-col gap-0.5">
                                    {leg.stops.map((stopName: string, stopIdx: number) => {
                                      const isFirst = stopIdx === 0;
                                      const isLast = stopIdx === stationCount - 1;
                                      return (
                                        <div key={`stop-${legIdx}-${stopIdx}`} className="flex items-center gap-xs">
                                          {isFirst ? (
                                            <span className="material-symbols-outlined text-secondary text-[14px]">trip_origin</span>
                                          ) : isLast ? (
                                            <span className="material-symbols-outlined text-error text-[14px]">location_on</span>
                                          ) : (
                                            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: lineColor + '66' }} />
                                          )}
                                          <span className={`text-body-sm font-body-sm ${isFirst || isLast ? 'font-bold text-on-background' : 'text-on-surface-variant'}`}>
                                            {stopName}
                                          </span>
                                          {stopIdx < stationCount - 1 && (
                                            <span className="text-label-caps font-label-caps text-outline ml-auto">
                                              {stopIdx === 0 ? 'Salida' : ''}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            );
                          })}

                          {/* Route summary footer */}
                          <div className="mt-sm pt-sm border-t border-outline-variant/10 flex items-center justify-between px-xs">
                            <div className="flex items-center gap-md text-label-caps font-label-caps text-on-surface-variant">
                              <span className="flex items-center gap-xs">
                                <span className="material-symbols-outlined text-[14px]">transfer_within_a_station</span>
                                {routeSummaryMetrics.transfers} trasbordos
                              </span>
                              <span className="flex items-center gap-xs">
                                <span className="material-symbols-outlined text-[14px]">station</span>
                                {routeSummaryMetrics.stops} estaciones
                              </span>
                            </div>
                            <div className="text-data-md font-data-md font-black font-mono text-secondary">
                              {routeSummaryMetrics.time}
                              <span className="text-label-caps font-label-caps text-on-surface-variant ml-0.5">min</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                          <div className="w-14 h-14 rounded-2xl bg-surface-container border border-outline-variant/20 flex items-center justify-center mb-sm">
                            <span className="material-symbols-outlined text-outline text-3xl">signpost</span>
                          </div>
                          <p className="text-body-sm font-body-sm text-on-surface-variant max-w-xs leading-relaxed">
                            Seleccioná origen y destino para calcular la mejor ruta
                          </p>
                          <p className="text-label-caps font-label-caps text-outline mt-xs">
                            Incluye combinaciones entre líneas
                          </p>
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                {/* ── RIGHT COLUMN: Live Departure Board ── */}
                <div className="lg:col-span-7 flex flex-col gap-lg">

                  {/* Live Departure Board */}
                  <section className="rounded-2xl border border-outline-variant/15 bg-gradient-to-b from-surface-container/80 to-surface/60 backdrop-blur-xl shadow-2xl overflow-hidden">
                    {/* Header */}
                    <div className="relative px-md py-md md:px-lg md:py-lg border-b border-outline-variant/10 bg-gradient-to-r from-surface-container-lowest/80 via-surface-container-lowest/60 to-transparent">
                      <div className="absolute top-0 right-0 w-40 h-40 bg-secondary/3 rounded-full blur-2xl pointer-events-none" />
                      <div className="relative flex justify-between items-end">
                        <div>
                          <h2 className="text-headline-sm font-headline-sm font-black text-on-background tracking-tight flex items-center gap-xs">
                            <span className="material-symbols-outlined text-secondary text-2xl">departure_board</span>
                            Partidas
                          </h2>
                          <p className="text-body-sm font-body-sm text-on-surface-variant flex items-center gap-xs mt-0.5">
                            <span className="material-symbols-outlined text-[14px] text-secondary">my_location</span>
                            {plannerOrigin || 'Seleccioná una estación'}
                          </p>
                        </div>
                        <div className="text-data-lg font-data-lg text-secondary font-mono tabular-nums" id="live-clock">
                          --:--:--
                        </div>
                      </div>
                    </div>

                    {/* Table */}
                    <div className="flex flex-col">
                      {/* Header row */}
                      <div className="grid grid-cols-[40px_1fr_80px_80px] gap-xs px-md py-xs border-b border-outline-variant/10 text-label-caps font-label-caps text-on-surface-variant bg-surface-dim/40">
                        <div className="text-center">LÍNEA</div>
                        <div>DESTINO</div>
                        <div className="text-right">ESTADO</div>
                        <div className="text-right">ARRIBO</div>
                      </div>

                      {/* Body */}
                      <div className="flex flex-col divide-y divide-outline-variant/5">
                        {(() => {
                          if (!plannerOrigin) {
                            return (
                              <div className="flex flex-col items-center justify-center py-10 text-center">
                                <div className="w-10 h-10 rounded-xl bg-surface-container border border-outline-variant/20 flex items-center justify-center mb-sm">
                                  <span className="material-symbols-outlined text-outline text-xl">trip_origin</span>
                                </div>
                                <p className="text-body-sm font-body-sm text-on-surface-variant">Elegí un origen para ver las próximas partidas</p>
                              </div>
                            );
                          }

                          const originStopIds = initialStations.filter(s => s.stopName === plannerOrigin).map(s => s.stopId);
                          const departures = telemetry.trains.filter(t => originStopIds.includes(t.nextStopId));

                          if (departures.length === 0) {
                            return (
                              <div className="flex flex-col items-center justify-center py-10 text-center">
                                <div className="w-10 h-10 rounded-xl bg-surface-container border border-outline-variant/20 flex items-center justify-center mb-sm">
                                  <span className="material-symbols-outlined text-outline text-xl">hourglass_empty</span>
                                </div>
                                <p className="text-body-sm font-body-sm text-on-surface-variant">No hay trenes programados en esta estación</p>
                              </div>
                            );
                          }

                          return departures.map((dep, idx) => {
                            const details = LINE_DETAILS[dep.routeId];
                            const isDelayed = dep.delaySeconds > 60;
                            const isNow = dep.etaSeconds <= 60;

                            return (
                              <div
                                key={`dep-${dep.id}-${idx}`}
                                className={`grid grid-cols-[40px_1fr_80px_80px] gap-xs px-md py-sm items-center relative transition-all duration-200 hover:bg-surface-container/40 ${
                                  isDelayed ? 'bg-error/5' : ''
                                }`}
                              >
                                {isDelayed && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-error" />}

                                {/* Line badge */}
                                <div className="flex justify-center">
                                  <span
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold text-white uppercase shadow-sm"
                                    style={{ backgroundColor: details?.color || '#475569' }}
                                  >
                                    {dep.routeId.replace('Linea', '')}
                                  </span>
                                </div>

                                {/* Destination */}
                                <div>
                                  <div className="text-body-sm font-body-sm font-bold text-on-background uppercase tracking-wide truncate">
                                    {getTrainDestination(dep.routeId, dep.directionId)}
                                  </div>
                                  <div className="text-label-caps font-label-caps text-on-surface-variant truncate">
                                    {dep.nextStopName}
                                  </div>
                                </div>

                                {/* Status */}
                                <div className={`text-right text-label-caps font-label-caps font-bold ${
                                  isDelayed ? 'text-error' : (isNow ? 'text-secondary' : 'text-on-surface-variant')
                                }`}>
                                  {isDelayed ? 'DEMORADO' : (isNow ? 'EN ANDÉN' : 'A TIEMPO')}
                                </div>

                                {/* ETA */}
                                <div className={`text-right font-black leading-none ${
                                  isDelayed ? 'text-error text-body-md' : (isNow ? 'text-secondary text-headline-sm' : 'text-headline-sm font-bold text-on-background')
                                }`}>
                                  {isNow ? (
                                    <span className="inline-flex items-center gap-1">
                                      <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse inline-block" />
                                      AHORA
                                    </span>
                                  ) : (
                                    `${Math.floor(dep.etaSeconds / 60)}m`
                                  )}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>

                    {/* Footer */}
                    {plannerOrigin && (
                      <div className="px-md py-xs border-t border-outline-variant/5 bg-surface-dim/20">
                        <p className="text-label-caps font-label-caps text-outline text-center">
                          Datos en tiempo real · Actualización cada 2s
                        </p>
                      </div>
                    )}
                  </section>

                  {/* Quick station suggestions grid */}
                  {!plannerOrigin && !plannerDestination && (
                    <section className="rounded-2xl border border-outline-variant/10 bg-gradient-to-b from-surface-container/40 to-surface/30 backdrop-blur-sm shadow-lg p-md">
                      <h3 className="text-label-caps font-label-caps font-bold text-on-surface-variant mb-sm flex items-center gap-xs">
                        <span className="material-symbols-outlined text-[14px]">star</span>
                        Estaciones frecuentes
                      </h3>
                      <div className="flex flex-wrap gap-xs">
                        {['Catedral', '9 de Julio', 'Once', 'Pacifico', 'Juramento', 'Congreso', 'Tribunales', 'Facultad de Medicina', 'Retiro', 'Belgrano'].map(station => (
                          <button
                            key={`quick-${station}`}
                            onClick={() => {
                              if (!plannerOrigin) setPlannerOrigin(station);
                              else if (!plannerDestination && station !== plannerOrigin) setPlannerDestination(station);
                            }}
                            className="px-sm py-xs rounded-lg border border-outline-variant/15 bg-surface-container/50 hover:bg-surface-container hover:border-outline-variant/30 transition-all text-label-caps font-label-caps text-on-surface-variant hover:text-on-background active:scale-95"
                          >
                            {station}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ======================================================= */}
          {/* SCREEN 3: STATION DIRECTORY                             */}
          {/* ======================================================= */}
          {currentTab === 'stations' && (
            <div className="flex-1 flex flex-col md:flex-row relative z-10 overflow-hidden h-full animate-fade-in text-left">
              {/* Left Pane: Station List & Filters */}
              <div className={`w-full md:w-[400px] lg:w-[450px] flex flex-col h-full bg-surface-container border-r border-outline-variant/10 z-20 ${
                directorySelectedStationId && !showMobileList ? 'hidden md:flex' : 'flex'
              }`}>
                {/* Filters Header */}
                <div className="p-6 border-b border-outline-variant/10 shrink-0">
                  <h2 className="text-headline-md font-headline-md text-on-surface mb-4">
                    {stationLineFilter === 'All' ? 'Todas las Estaciones' : LINE_DETAILS[stationLineFilter]?.name}
                  </h2>
                  
                  {/* Line Filters Badge selector */}
                  <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-none flex-nowrap">
                    <button
                      onClick={() => {
                        setStationLineFilter('All');
                        setShowMobileList(false);
                      }}
                      className={`w-8 h-8 rounded-full border border-outline-variant/30 flex items-center justify-center text-[10px] font-bold transition-all shrink-0 ${
                        stationLineFilter === 'All'
                          ? 'text-white border-transparent bg-secondary'
                          : 'text-outline hover:border-outline'
                      }`}
                    >
                      T
                    </button>
                    {visibleLines.map(lineId => {
                      const isActive = stationLineFilter === lineId;
                      const details = LINE_DETAILS[lineId];
                      return (
                        <button
                          key={`badge-filter-${lineId}`}
                          onClick={() => {
                            setStationLineFilter(lineId);
                            const first = initialSequences.find(s => s.routeId === lineId);
                            if (first) {
                              setDirectorySelectedStationId(first.stopId);
                              setShowMobileList(false);
                            }
                          }}
                          className={`w-8 h-8 rounded-full border border-outline-variant/30 flex items-center justify-center text-[10px] font-bold transition-all shrink-0 ${
                            isActive
                              ? 'text-white border-transparent shadow-[0_0_10px_rgba(0,150,94,0.5)]'
                              : 'text-outline hover:border-outline'
                          }`}
                          style={{ backgroundColor: isActive ? details.color : 'transparent' }}
                        >
                          {lineId === 'PM-Civico' ? 'P-C' : lineId === 'PM-Savio' ? 'P-S' : 'T'}
                        </button>
                      );
                    })}
                  </div>

                  {/* Search Input */}
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
                    <input
                      value={stationSearch}
                      onChange={(e) => setStationSearch(e.target.value)}
                      className="w-full bg-surface-container border border-outline-variant/30 rounded-lg py-2 pl-10 pr-4 text-body-sm text-on-surface focus:border-secondary-container focus:ring-1 focus:ring-secondary-container outline-none"
                      placeholder="Buscar estación..."
                      type="text"
                    />
                  </div>
                </div>

                {/* Station List */}
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {directoryStations.map(s => {
                    const passingLines = initialSequences
                      .filter(seq => seq.stopId === s.stopId || initialStations.find(st => st.stopId === seq.stopId)?.stopName === s.stopName)
                      .map(seq => seq.routeId);
                    const uniquePassingLines = Array.from(new Set(passingLines));
                    const isSelected = directorySelectedStation?.stopName === s.stopName;

                    return (
                      <div
                        key={`directory-row-${s.stopId}`}
                        onClick={() => {
                          setDirectorySelectedStationId(s.stopId);
                          setShowMobileList(false);
                        }}
                        className={`group border rounded-xl p-4 cursor-pointer transition-all duration-200 relative overflow-hidden ${
                          isSelected
                            ? 'bg-surface-container-highest border-secondary/35 shadow-[0_0_15px_rgba(0,238,252,0.1)]'
                            : 'bg-surface-container-low hover:bg-surface-container border-outline-variant/10'
                        }`}
                      >
                        {isSelected && (
                          <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: LINE_DETAILS[stationLineFilter]?.color }} />
                        )}
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h3 className={`text-title-sm font-headline-md ${isSelected ? 'text-secondary' : 'text-on-surface group-hover:text-secondary-container transition-colors'}`}>
                              {s.stopName}
                            </h3>
                            <p className="text-body-sm text-outline">Estación de Subte</p>
                          </div>
                          <div className="flex gap-1">
                            {uniquePassingLines.map(lineId => (
                              <span
                                key={`badge-${s.stopId}-${lineId}`}
                                className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold text-white border border-outline-variant/10"
                                style={{ backgroundColor: LINE_DETAILS[lineId]?.color }}
                              >
                                {lineId.replace('Linea', '')}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className={`flex gap-3 mt-3 ${isSelected ? 'text-secondary' : 'text-outline'}`}>
                          <span className="material-symbols-outlined text-[16px]">elevator</span>
                          <span className="material-symbols-outlined text-[16px]">wifi</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Pane: Station Detail */}
              <div className={`flex-1 overflow-y-auto p-4 md:p-8 h-full bg-surface ${
                !directorySelectedStationId || showMobileList ? 'hidden md:block' : 'block'
              }`}>
                {directorySelectedStation ? (
                  <div className="animate-in fade-in duration-200">
                    
                    {/* Mobile Back Button */}
                    <button
                      onClick={() => setShowMobileList(true)}
                      className="md:hidden mb-6 px-4 py-2 bg-surface-container border border-outline-variant/30 hover:bg-surface-variant text-on-surface text-xs font-bold rounded-xl transition flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-sm">arrow_back</span>
                      Volver al Listado
                    </button>

                    {/* Station Header */}
                    <div className="mb-8 border-b border-outline-variant/10 pb-6 flex justify-between items-end flex-wrap gap-4">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <span
                            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-lg text-white border border-outline-variant/10 shadow-md"
                            style={{ backgroundColor: LINE_DETAILS[stationLineFilter]?.color || '#475569' }}
                          >
                            {stationLineFilter.replace('Linea', '')}
                          </span>
                          <span className="text-label-caps font-label-caps text-outline tracking-widest uppercase font-mono">Selección Activa</span>
                        </div>
                        <h2 className="text-display-lg font-display-lg text-on-surface">{directorySelectedStation.stopName}</h2>
                        <p className="text-data-lg font-data-lg text-outline mt-2">Estación de la red de subterráneos de Buenos Aires</p>
                        {(() => {
                          const accessKey = directorySelectedStation.stopName.toLowerCase()
                            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                            .replace(/[^a-z0-9]/g, '');
                          const access = ACCESSIBILITY_METADATA[accessKey];
                          if (!access) return null;
                          return (
                            <div className="flex gap-4 mt-4 text-xs text-on-surface-variant">
                              <span className="flex items-center gap-1.5 bg-surface-container-low px-3 py-1.5 rounded-xl border border-outline-variant/10">
                                <span className="material-symbols-outlined text-[16px] text-secondary">elevator</span>
                                <span className="font-bold text-on-surface">{access.ascensores}</span> {access.ascensores === 1 ? 'Ascensor' : 'Ascensores'}
                              </span>
                              <span className="flex items-center gap-1.5 bg-surface-container-low px-3 py-1.5 rounded-xl border border-outline-variant/10">
                                <span className="material-symbols-outlined text-[16px] text-secondary">stairs</span>
                                <span className="font-bold text-on-surface">{access.escaleras}</span> {access.escaleras === 1 ? 'Escalera Mecánica' : 'Escaleras Mecánicas'}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Bento Grid Layout */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* Connections */}
                      <div className="lg:col-span-1 card-base p-6 flex flex-col">
                        <h3 className="text-title-sm font-headline-md text-outline mb-4 flex items-center gap-2 font-mono">
                          <span className="material-symbols-outlined">transit_enterexit</span>
                          Conexiones
                        </h3>
                        <div className="space-y-4 flex-1">
                          {(() => {
                            const currentSeq = initialSequences.find(s => s.stopId === directorySelectedStation.stopId);
                            const currentRouteId = currentSeq ? currentSeq.routeId : '';

                            const connections = initialStations.filter(
                              st => (st.stopName === directorySelectedStation.stopName || MANUAL_TRANSFERS[directorySelectedStation.stopName]?.includes(st.stopName)) && st.stopId !== directorySelectedStation.stopId
                            ).filter(conn => {
                              const connSeq = initialSequences.find(s => s.stopId === conn.stopId);
                              const connRouteId = connSeq ? connSeq.routeId : '';
                              return connRouteId && connRouteId !== currentRouteId;
                            });

                            if (connections.length === 0) {
                              return <p className="text-xs text-outline italic py-4">No hay líneas de combinación en esta plataforma.</p>;
                            }

                            return connections.map(conn => {
                              const seq = initialSequences.find(s => s.stopId === conn.stopId);
                              const details = seq ? LINE_DETAILS[seq.routeId] : null;

                              return (
                                <div key={conn.stopId} className="flex items-center gap-4 bg-surface-container-low p-3 rounded-lg border border-outline-variant/10 text-left">
                                  <span
                                    className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg text-white border border-outline-variant/10"
                                    style={{ backgroundColor: details?.color }}
                                  >
                                    {seq?.routeId.replace('Linea', '')}
                                  </span>
                                  <div>
                                    <p className="text-body-md font-bold text-on-surface">{conn.stopName}</p>
                                    <p className="text-body-sm text-outline">Combinación Subterránea</p>
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>

                      {/* Live Arrivals departure board */}
                      <div className="lg:col-span-2 card-base p-6 flex flex-col">
                        <h3 className="text-title-sm font-headline-md text-outline mb-4 flex items-center gap-2 font-mono">
                          <span className="material-symbols-outlined">my_location</span>
                          Arribos en Vivo
                        </h3>

                        <div className="flex-1 flex flex-col gap-3">
                          {(() => {
                            const stationAliases = initialStations
                              .filter(st => st.stopName === directorySelectedStation.stopName)
                              .map(st => st.stopId);
                            const arrivals = telemetry.trains.filter(t => stationAliases.includes(t.nextStopId));

                            if (arrivals.length === 0) {
                              return (
                                <p className="text-xs text-outline italic py-6 text-center inner-card">
                                  No hay arribos programados próximamente.
                                </p>
                              );
                            }

                             return arrivals.map(arr => {
                               const details = LINE_DETAILS[arr.routeId];
                               const seqList = initialSequences.filter(s => s.routeId === arr.routeId && s.directionId === arr.directionId);
                               const terminalSeq = seqList[seqList.length - 1];
                               const destinationName = terminalSeq 
                                 ? (initialStations.find(st => st.stopId === terminalSeq.stopId)?.stopName || 'Terminal')
                                 : 'Terminal';

                               return (
                                 <div key={arr.id} className="flex items-center justify-between p-3.5 bg-surface-container-low rounded-lg border border-outline-variant/15 font-mono text-xs text-left">
                                   <div className="flex flex-col gap-1">
                                     <div className="flex items-center gap-3">
                                       <span
                                         className="h-6 w-6 rounded flex items-center justify-center font-bold text-white text-[10px]"
                                         style={{ backgroundColor: details?.color }}
                                       >
                                         {arr.routeId.replace('Linea', '')}
                                       </span>
                                       <span className="font-bold text-on-surface">{arr.id}</span>
                                       <span className="text-[10px] text-outline">→ {arr.nextStopName}</span>
                                     </div>
                                     <span className="text-[9px] text-amber-500 font-bold">Sentido: Hacia {destinationName}</span>
                                   </div>
                                   <span className="text-cyan-400 font-black text-sm shrink-0">
                                     {arr.etaSeconds === 0 ? 'AHORA' : `${Math.floor(arr.etaSeconds / 60)} min`}
                                   </span>
                                 </div>
                               );
                             });
                          })()}
                        </div>
                      </div>

                      {/* Premetro Station details card */}
                      {(() => {
                        const accessKey = directorySelectedStation.stopName.toLowerCase()
                          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                          .replace(/[^a-z0-9]/g, '');
                        const pmDetail = PREMETRO_STATION_DETAILS[accessKey];
                        if (!pmDetail) return null;
                        return (
                          <div className="lg:col-span-3 card-base p-6 flex-col animate-fade-in">
                            <h3 className="text-title-sm font-headline-md text-outline mb-4 flex items-center gap-2 font-mono">
                              <span className="material-symbols-outlined text-orange-400">info</span>
                              Detalles de Estación Premetro
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                              <div className="inner-card p-4">
                                <span className="text-outline block font-bold mb-1 font-mono uppercase tracking-widest text-[9px]">Dirección / Ubicación</span>
                                <span className="text-on-surface font-bold">{pmDetail.address || 'No disponible'}</span>
                              </div>
                              <div className="inner-card p-4">
                                <span className="text-outline block font-bold mb-1 font-mono uppercase tracking-widest text-[9px]">Barrio</span>
                                <span className="text-on-surface font-bold">{pmDetail.barrio || 'No disponible'}</span>
                              </div>
                              <div className="inner-card p-4">
                                <span className="text-outline block font-bold mb-1 font-mono uppercase tracking-widest text-[9px]">Comuna</span>
                                <span className="text-on-surface font-bold">{pmDetail.comuna || 'No disponible'}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Artworks (Obras de Arte) Bento Item */}
                      {(() => {
                        const accessKey = directorySelectedStation.stopName.toLowerCase()
                          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                          .replace(/[^a-z0-9]/g, '');
                        // Check exact or partial matching
                        let artworks = ARTWORK_METADATA[accessKey];
                        if (!artworks) {
                          // Try partial matching
                          const matchingKey = Object.keys(ARTWORK_METADATA).find(k => k.includes(accessKey) || accessKey.includes(k));
                          if (matchingKey) {
                            artworks = ARTWORK_METADATA[matchingKey];
                          }
                        }
                        if (!artworks || artworks.length === 0) return null;
                        return (
                          <div className="lg:col-span-3 card-base p-6 flex-col animate-fade-in">
                            <h3 className="text-title-sm font-headline-md text-outline mb-4 flex items-center gap-2 font-mono">
                              <span className="material-symbols-outlined text-secondary font-bold">palette</span>
                              Patrimonio Artístico y Obras de Arte ({artworks.length})
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {artworks.map((art, idx) => (
                                <div key={idx} className="inner-card p-4 flex flex-col gap-2 hover:bg-surface-container transition-colors">
                                  <div className="flex justify-between items-start gap-2">
                                    <h4 className="font-bold text-on-surface text-sm leading-snug">{art.nombre || 'Sin Título'}</h4>
                                    {art.periodo && (
                                      <span className="px-2 py-0.5 rounded bg-secondary/10 text-secondary text-[10px] font-bold font-mono shrink-0">
                                        {art.periodo}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-secondary font-bold font-mono">{art.artistas}</p>
                                  {art.tecnica && (
                                    <p className="text-[11px] text-on-surface-variant leading-normal">
                                      <span className="text-outline font-bold">Técnica:</span> {art.tecnica}
                                    </p>
                                  )}
                                  {art.observaciones && (
                                    <p className="text-[11px] text-on-surface-variant italic mt-1 leading-relaxed border-l border-outline-variant/20 pl-2">
                                      {art.observaciones}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Station reports form bento */}
                      <div className="lg:col-span-3 glass-panel rounded-2xl p-6 flex flex-col text-left">
                        <div className="flex justify-between items-center mb-4">
                          <h3 className="text-title-sm font-headline-md text-outline flex items-center gap-2 font-mono">
                            <span className="material-symbols-outlined">announcement</span>
                            Novedades y Reportes de Plataforma
                          </h3>
                          {!showReportForm && (
                            <button
                              onClick={() => setShowReportForm(true)}
                              className="text-xs font-bold text-secondary hover:text-secondary-container"
                            >
                              + Añadir Reporte
                            </button>
                          )}
                        </div>

                        {!showReportForm ? (
                          <div className="space-y-3 max-h-48 overflow-y-auto">
                            {reports.filter(r => r.station === directorySelectedStation.stopName).length === 0 ? (
                              <p className="text-xs text-outline italic py-4 text-center">No hay reportes activos en esta estación.</p>
                            ) : (
                              reports
                                .filter(r => r.station === directorySelectedStation.stopName)
                                .map(r => (
                                  <div key={r.id} className="p-3 bg-surface-container-low border border-outline-variant/10 rounded-lg text-xs text-left">
                                    <div className="flex justify-between items-center">
                                      <span className="px-2 py-0.5 rounded text-[8px] font-bold uppercase inner-card text-secondary">
                                        {r.category}
                                      </span>
                                      <span className="text-[9px] text-outline font-mono">
                                        {new Date(r.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    </div>
                                    <p className="text-on-surface-variant leading-relaxed mt-2">&ldquo;{r.comment}&rdquo;</p>
                                  </div>
                                ))
                            )}
                          </div>
                        ) : (
                          <form onSubmit={(e) => handleSubmitReport(e, directorySelectedStation.stopId)} className="inner-card p-4 flex flex-col gap-3">
                            {reportSuccess ? (
                              <div className="text-center py-4 flex flex-col items-center gap-1">
                                <span className="h-8 w-8 rounded-full bg-secondary/10 text-secondary flex items-center justify-center font-bold text-sm">✓</span>
                                <p className="text-xs text-secondary font-bold">Reporte enviado.</p>
                              </div>
                            ) : (
                              <>
                                <div>
                                  <label className="text-[9px] font-bold uppercase text-outline block mb-1">Categoría</label>
                                  <select
                                    value={reportCategory}
                                    onChange={(e) => setReportCategory(e.target.value)}
                                    className="w-full bg-surface-container border border-outline-variant/20 text-on-surface text-xs p-2 rounded-lg outline-none"
                                  >
                                    <option>Congestión</option>
                                    <option>Demoras</option>
                                    <option>Seguridad</option>
                                    <option>Limpieza</option>
                                    <option>Climatización</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[9px] font-bold uppercase text-outline block mb-1">Detalles</label>
                                  <textarea
                                    value={reportComment}
                                    onChange={(e) => setReportComment(e.target.value)}
                                    placeholder="Describa brevemente el estado de la plataforma..."
                                    maxLength={100}
                                    required
                                    rows={2}
                                    className="w-full bg-surface-container border border-outline-variant/20 text-on-surface text-xs p-2 rounded-lg outline-none resize-none"
                                  />
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setShowReportForm(false)}
                                    className="text-xs text-on-surface-variant px-3 py-1.5 rounded-lg inner-card"
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    type="submit"
                                    disabled={isSubmittingReport}
                                    className="text-xs text-background bg-secondary hover:bg-secondary-container hover:text-on-secondary-container px-4 py-1.5 rounded-lg font-bold disabled:opacity-50"
                                  >
                                    {isSubmittingReport ? 'Enviando...' : 'Enviar'}
                                  </button>
                                </div>
                              </>
                            )}
                          </form>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-body-sm text-outline italic p-6">Seleccioná una estación para ver datos detallados.</p>
                )}
              </div>
            </div>
          )}

          {/* ======================================================= */}
          {/* SCREEN 5: RAW ARRIVALS (DIRECT API DATA)                */}
          {/* ======================================================= */}
          {currentTab === 'arrivals' && (
            <div className="flex-1 h-full flex flex-col overflow-hidden animate-fade-in">
              {/* Sticky header */}
              <div className="shrink-0 p-4 md:p-6 bg-surface-container/80 backdrop-blur-xl border-b border-outline-variant/20">
                <div className="max-w-6xl mx-auto flex flex-col gap-4">
                  {/* Title + badge row */}
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg md:text-xl font-black text-on-surface flex items-center gap-2">
                      <span className="material-symbols-outlined text-secondary">schedule</span>
                      Arribos en Vivo
                    </h2>
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full inner-card text-[10px] font-mono text-outline">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                      RAW
                    </span>
                  </div>

                  {/* Line selector pills */}
                  <div className="flex gap-2 overflow-x-auto scrollbar-none flex-nowrap">
                    {visibleLines.map(lineId => {
                      const isActive = arrivalsLineFilter === lineId;
                      const details = LINE_DETAILS[lineId];
                      return (
                        <button
                          key={`arr-line-${lineId}`}
                          onClick={() => setArrivalsLineFilter(lineId)}
                          className={`px-4 py-2 rounded-xl border text-xs md:text-sm font-bold transition-all shrink-0 ${
                            isActive
                              ? 'text-white border-transparent shadow-md'
                              : 'text-outline border-outline-variant/20 hover:border-outline/40 bg-surface-container-low/30'
                          }`}
                          style={{ backgroundColor: isActive ? details.color : 'transparent' }}
                        >
                          {details.name}
                        </button>
                      );
                    })}
                  </div>

                  {/* Destination filter — shows actual terminal names, not "Ida/Vuelta" */}
                  {arrivalsDestinations.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto scrollbar-none flex-nowrap">
                      <button
                        onClick={() => setArrivalsDestFilter('all')}
                        className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all shrink-0 ${
                          arrivalsDestFilter === 'all'
                            ? 'bg-secondary/20 text-secondary border-secondary/40'
                            : 'text-outline border-outline-variant/20 hover:border-outline/40 bg-surface-container-low/30'
                        }`}
                      >
                        Todos los sentidos
                      </button>
                      {arrivalsDestinations.map(dest => (
                        <button
                          key={`arr-dest-${dest}`}
                          onClick={() => setArrivalsDestFilter(dest)}
                          className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all shrink-0 ${
                            arrivalsDestFilter === dest
                              ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                              : 'text-outline border-outline-variant/20 hover:border-outline/40 bg-surface-container-low/30'
                          }`}
                        >
                          Hacia {dest}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Scrollable results */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6">
                <div className="max-w-6xl mx-auto">
                  {(() => {
                    const raw = (telemetry.predictions || [])
                      .filter(p =>
                        p.routeId === arrivalsLineFilter &&
                        (arrivalsDestFilter === 'all' || p.destinationName === arrivalsDestFilter)
                      )
                      .sort((a, b) => a.etaSeconds - b.etaSeconds);

                    if (raw.length === 0) {
                      return (
                        <div className="text-center py-20 text-sm text-outline italic">
                          Sin datos de arribos para {LINE_DETAILS[arrivalsLineFilter]?.name}
                          {arrivalsDestFilter !== 'all' && ` hacia ${arrivalsDestFilter}`}
                        </div>
                      );
                    }

                    return (
                      <>
                        {/* Desktop: compact data table */}
                        <div className="hidden md:block overflow-x-auto rounded-xl border border-outline-variant/10">
                          <table className="w-full text-xs font-mono">
                            <thead>
                              <tr className="bg-surface-dim/60 text-[9px] text-outline uppercase tracking-widest">
                                <th className="text-left py-3 px-4 font-bold">Estación</th>
                                <th className="text-left py-3 px-4 font-bold">Destino</th>
                                <th className="text-left py-3 px-4 font-bold">Andén</th>
                                <th className="text-right py-3 px-4 font-bold">Arribo</th>
                                <th className="text-right py-3 px-4 font-bold">Demora</th>
                              </tr>
                            </thead>
                            <tbody>
                              {raw.map((p, i) => {
                                const isArriving = p.etaSeconds <= 15;
                                return (
                                  <tr
                                    key={`arr-d-${i}`}
                                    className={`border-t border-outline-variant/5 hover:bg-surface-container-low/40 transition-colors ${
                                      isArriving ? 'bg-secondary/5' : ''
                                    }`}
                                  >
                                    <td className="py-3 px-4">
                                      <span className="text-on-surface font-bold text-xs">{p.stationName}</span>
                                    </td>
                                    <td className="py-3 px-4 text-on-surface-variant">{(p.destinationName || '').substring(0, 24)}</td>
                                    <td className="py-3 px-4 text-outline text-[10px]">{p.stopId}</td>
                                    <td className={`py-3 px-4 text-right font-black ${
                                      isArriving ? 'text-secondary animate-pulse' : 'text-secondary'
                                    }`}>
                                      {isArriving ? 'AHORA' : `${Math.floor(p.etaSeconds / 60)}m ${p.etaSeconds % 60}s`}
                                    </td>
                                    <td className={`py-3 px-4 text-right font-bold ${
                                      p.delay > 60 ? 'text-amber-400' : 'text-outline'
                                    }`}>
                                      {p.delay > 0 ? `+${Math.round(p.delay / 60)}m` : '—'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile: compact card list */}
                        <div className="md:hidden flex flex-col gap-2">
                          {raw.map((p, i) => {
                            const isArriving = p.etaSeconds <= 15;
                            return (
                              <div
                                key={`arr-m-${i}`}
                                className={`rounded-xl px-4 py-3 flex items-center justify-between border ${
                                  isArriving
                                    ? 'inner-card border-secondary/20'
                                    : 'inner-card'
                                }`}
                              >
                                <div className="min-w-0 mr-2">
                                  <div className="text-sm font-extrabold text-on-surface truncate">{p.stationName}</div>
                                  <div className="text-[10px] text-on-surface-variant truncate">
                                    → {(p.destinationName || '').substring(0, 28)}
                                  </div>
                                  {p.delay > 0 && (
                                    <span className="text-[9px] text-amber-400 font-bold">
                                      +{Math.round(p.delay / 60)}m demora
                                    </span>
                                  )}
                                </div>
                                <div className="shrink-0 text-right">
                                  <span className={`text-sm font-black font-mono ${
                                    isArriving ? 'text-secondary animate-pulse' : 'text-secondary'
                                  }`}>
                                    {isArriving ? 'AHORA' : `${Math.floor(p.etaSeconds / 60)}m`}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Summary row */}
                        <div className="mt-4 text-[10px] text-outline font-mono text-center">
                          {raw.length} arribo{raw.length !== 1 ? 's' : ''} · Actualización cada 2s
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* ======================================================= */}
          {/* SCREEN 4: SERVICE STATUS                                */}
          {/* ======================================================= */}
          {currentTab === 'status' && (
            <div className="flex-1 p-gutter md:p-margin-desktop overflow-x-hidden overflow-y-auto animate-fade-in">
              <div className="max-w-4xl mx-auto flex flex-col gap-6">
                <div className="card-base p-6 flex flex-col gap-4">
                  <h2 className="text-lg font-black text-on-surface">Alertas del Servicio de Red</h2>
                  <p className="text-body-sm text-on-surface-variant">Alertas oficiales y advertencias activas de la red de transporte.</p>
                  
                  <hr className="border-outline-variant/10" />

                  <div className="flex flex-col gap-3">
                    {globalAlerts.length === 0 ? (
                      <div className="p-6 text-center inner-card flex flex-col items-center gap-3">
                        <span className="h-10 w-10 rounded-full bg-secondary/10 text-secondary flex items-center justify-center font-bold text-sm">✓</span>
                        <h4 className="text-sm font-bold text-on-surface">Todas las Líneas Operan Normalmente</h4>
                        <p className="text-body-sm text-on-surface-variant text-center max-w-sm leading-relaxed">No se registran demoras, interrupciones de servicio ni problemas de infraestructura en la red.</p>
                      </div>
                    ) : (
                      globalAlerts.map(alert => {
                        const isGlobal = alert.routeId === 'Global';
                        const details = LINE_DETAILS[alert.routeId];

                        return (
                          <div key={alert.id} className="p-4 inner-card flex gap-3 items-start">
                            <span className="text-amber-400 text-lg shrink-0">⚠</span>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[9px] font-bold text-amber-400 uppercase tracking-widest font-mono">
                                  {alert.effect}
                                </span>
                                {!isGlobal && details && (
                                  <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${details.textColor} ${details.bgClass} border ${details.borderClass}`}>
                                    {details.name}
                                  </span>
                                )}
                              </div>
                              <h4 className="font-bold text-on-surface mt-1.5 leading-snug">{alert.headerText}</h4>
                              <p className="text-body-sm text-on-surface-variant mt-1 leading-relaxed">{alert.descriptionText}</p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* ======================================================= */}
          {/* SCREEN 6: AOM & SYSTEM STATISTICS                       */}
          {/* ======================================================= */}
          {currentTab === 'aom' && (
            <div className="flex-1 p-gutter md:p-margin-desktop overflow-x-hidden overflow-y-auto animate-fade-in">
              <div className="max-w-4xl mx-auto flex flex-col gap-6">

                {/* AOM Summary Card */}
                <div className="card-base p-6 flex flex-col gap-4">
                  <div>
                    <h2 className="text-xl font-black text-on-surface flex items-center gap-2">
                      <span className="material-symbols-outlined text-secondary">description</span>
                      {AOM_SUMMARY.title}
                    </h2>
                    <p className="text-body-sm text-on-surface-variant mt-1">
                      Detalles regulatorios y contractuales de la concesión del servicio público.
                    </p>
                  </div>

                  <hr className="border-outline-variant/10" />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="inner-card p-4">
                      <span className="text-secondary font-bold block mb-1 font-mono uppercase tracking-widest text-[9px]">Fecha de Suscripción</span>
                      <span className="text-on-surface">{AOM_SUMMARY.date}</span>
                    </div>
                    <div className="inner-card p-4">
                      <span className="text-secondary font-bold block mb-1 font-mono uppercase tracking-widest text-[9px]">Partes Involucradas</span>
                      <span className="text-on-surface">{AOM_SUMMARY.parties}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 mt-2">
                    <h3 className="text-sm font-bold text-on-surface">Obligaciones Principales del Operador</h3>
                    <ul className="list-disc list-inside text-body-sm text-on-surface-variant space-y-2 pl-2">
                      {AOM_SUMMARY.key_obligations.map((ob, idx) => (
                        <li key={idx} className="leading-relaxed">{ob}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                    <div className="inner-card p-4">
                      <h4 className="text-xs font-bold text-secondary mb-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">train</span>
                        Material Rodante
                      </h4>
                      <p className="text-body-sm text-on-surface-variant leading-relaxed">{AOM_SUMMARY.material_rodante}</p>
                    </div>
                    <div className="inner-card p-4">
                      <h4 className="text-xs font-bold text-secondary mb-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">engineering</span>
                        Infraestructura
                      </h4>
                      <p className="text-body-sm text-on-surface-variant leading-relaxed">{AOM_SUMMARY.infrastructure}</p>
                    </div>
                  </div>

                  <div className="inner-card p-4 border-error/20">
                    <h4 className="text-xs font-bold text-error mb-1 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">gavel</span>
                      Régimen de Penalidades y Sanciones
                    </h4>
                    <p className="text-body-sm text-on-surface-variant leading-relaxed">{AOM_SUMMARY.penalties}</p>
                  </div>

                  <div className="inner-card p-4 font-mono text-[10px] text-on-surface-variant leading-relaxed">
                    <span className="text-outline font-bold block mb-1 text-[9px] uppercase tracking-wider">Detalles de Operación (Extracto)</span>
                    <p className="whitespace-pre-line">{AOM_SUMMARY.details_operation}</p>
                  </div>
                </div>

                {/* Premetro Stations List Card */}
                <div className="card-base p-6 flex flex-col gap-4">
                  <div>
                    <h3 className="text-lg font-black text-on-surface flex items-center gap-2">
                      <span className="material-symbols-outlined text-orange-400">explore</span>
                      Catastro e Información del Premetro (NUEVADATA 2026)
                    </h3>
                    <p className="text-body-sm text-on-surface-variant mt-1">
                      Detalle geográfico, catastral y de ubicación de las paradas activas del Premetro de Buenos Aires.
                    </p>
                  </div>

                  <hr className="border-outline-variant/10" />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Object.entries(PREMETRO_STATION_DETAILS).map(([normName, st]) => (
                      <div key={normName} className="inner-card p-4 flex flex-col gap-2">
                        <div className="flex justify-between items-start">
                          <h4 className="font-bold text-on-surface text-sm">{st.fullName.replace('Estación de premetro ', '')}</h4>
                          <span className="px-2 py-0.5 rounded bg-orange-500/10 text-orange-400 text-[9px] font-bold uppercase tracking-widest font-mono">
                            Premetro
                          </span>
                        </div>
                        <div className="text-body-sm text-on-surface-variant space-y-1 mt-1 leading-normal">
                          <p><span className="text-outline font-bold">Dirección:</span> {st.address}</p>
                          <p><span className="text-outline font-bold">Barrio:</span> {st.barrio}</p>
                          <p><span className="text-outline font-bold">Comuna:</span> {st.comuna}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>
          )}

        </div>
      </div>

      {/* Mobile Bottom Navigation Bar (Mobile Only) — 6 tabs covering all screens */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-14 bg-surface-container/95 backdrop-blur-xl border-t border-outline-variant/20 z-50 flex justify-around items-center px-1 safe-area-bottom">
        {[
          { id: 'map' as const, icon: 'map', label: 'Mapa' },
          { id: 'planner' as const, icon: 'route', label: 'Ruta' },
          { id: 'stations' as const, icon: 'subway', label: 'Estac.' },
          { id: 'arrivals' as const, icon: 'schedule', label: 'Arribos' },
          { id: 'status' as const, icon: 'warning', label: 'Alertas' },
          { id: 'aom' as const, icon: 'description', label: 'Datos' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setCurrentTab(tab.id);
              if (tab.id === 'stations') setShowMobileList(true);
            }}
            className={`flex flex-col items-center justify-center flex-1 py-0.5 transition-colors min-w-0 ${
              currentTab === tab.id ? 'text-secondary' : 'text-outline hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">{tab.icon}</span>
            <span className="text-[9px] font-bold mt-0.5 leading-tight">{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Footer - Positioned relative to layout columns to avoid overlaps */}
      <footer className="hidden md:flex h-10 shrink-0 w-full justify-between items-center px-gutter bg-surface-container-lowest border-t border-outline-variant/10 z-30">
        <p className="text-[11px] text-outline">© 2026 SBASE - Gobierno de la Ciudad de Buenos Aires</p>
        <div className="flex gap-md text-[11px]">
          <a className="text-on-surface-variant hover:text-primary transition-colors" href="#">Política de Privacidad</a>
          <a className="text-on-surface-variant hover:text-primary transition-colors" href="#">Términos del Servicio</a>
          <a className="text-on-surface-variant hover:text-primary transition-colors" href="#">Acceso API</a>
        </div>
      </footer>
    </div>
  );
}
