'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TrainTelemetry, AlertData } from '@/lib/telemetry';
import 'leaflet/dist/leaflet.css';
import { LINE_SHAPES } from '@/lib/shapes';

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

interface SubteDashboardProps {
  initialStations: Station[];
  initialSequences: RouteSequence[];
  initialTelemetry: {
    trains: TrainTelemetry[];
    alerts: AlertData[];
    isMocked: boolean;
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
  'Corrientes': ['Pueyrredón']
};

export default function SubteDashboard({
  initialStations,
  initialSequences,
  initialTelemetry
}: SubteDashboardProps) {
  // Navigation Screens Tab state
  const [currentTab, setCurrentTab] = useState<'map' | 'planner' | 'stations' | 'status'>('map');

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

  // Planner Screen state
  const [plannerOrigin, setPlannerOrigin] = useState<string>('');
  const [plannerDestination, setPlannerDestination] = useState<string>('');
  const [plannedRoute, setPlannedRoute] = useState<any[] | null>(null);
  const [stepFreeRequired, setStepFreeRequired] = useState(false);

  // Station Directory Screen state
  const [stationSearch, setStationSearch] = useState<string>('');
  const [stationLineFilter, setStationLineFilter] = useState<string>('LineaD'); // Default Line D
  const [directorySelectedStationId, setDirectorySelectedStationId] = useState<string | null>(null);
  const [stationFlowData, setStationFlowData] = useState<any[]>([]);
  const [isLoadingFlow, setIsLoadingFlow] = useState(false);

  // Responsive mobile list toggle
  const [showMobileList, setShowMobileList] = useState(true);

  // Station feedback form
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportCategory, setReportCategory] = useState('Congestión');
  const [reportComment, setReportComment] = useState('');
  const [reportSuccess, setReportSuccess] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

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

  // Fetch telemetry updates every 5 seconds
  const fetchTelemetry = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/telemetry?t=${Date.now()}`, { cache: 'no-store' });
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
  }, []);

  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 3000);
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

  // Fetch historical flow data for the selected station
  useEffect(() => {
    if (!directorySelectedStation) {
      setStationFlowData([]);
      return;
    }
    setIsLoadingFlow(true);
    fetch(`/api/historical?station=${encodeURIComponent(directorySelectedStation.stopName)}`)
      .then(res => res.json())
      .then(data => {
        if (data.hourlyStats) {
          setStationFlowData(data.hourlyStats);
        }
      })
      .catch(err => console.error('Error fetching historical flow:', err))
      .finally(() => setIsLoadingFlow(false));
  }, [directorySelectedStation]);

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
          g[s1.stopId].push({ node: s2.stopId, weight: 3, routeId: null });
          g[s2.stopId].push({ node: s1.stopId, weight: 3, routeId: null });
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

      // Track manual map interactions to prevent auto-centering resets (zoom is preserved)
      map.on('dragend', () => {
        mapUserMovedRef.current = true;
        setMapUserMoved(true);
      });

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
      trainsGroup.clearLayers();

      const activeLines = activeLine === 'All' ? Object.keys(LINE_DETAILS) : [activeLine];

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

        const marker = L.marker([train.latitude, train.longitude], { icon: trainIcon }).addTo(trainsGroup);

        const statusText = train.status === 'STOPPED' ? 'Detenido en' : 'Rumbo a';
        const etaMin = Math.round(train.etaSeconds / 60);
        marker.bindTooltip(`
          <div style="color: #fff; background: #0b0f19; border: 1px solid #334155; padding: 4px 8px; border-radius: 6px; font-size: 10px; font-weight: 600;">
            <strong>TREN ${train.id}</strong><br/>
            ${statusText} ${train.nextStopName} (ETA: ${etaMin}m)
          </div>
        `, { direction: 'top', offset: [0, -10], opacity: 0.95 });

        marker.on('click', () => {
          setSelectedTrainId(train.id);
          setSelectedStationId(null);
        });
      });
    });
  }, [telemetry, activeLine, selectedStationId, selectedTrainId, pinnedTrainId, initialStations, initialSequences]);

  // Center or Fit Bounds only if user has not panned or zoomed manually
  const fitMapBounds = useCallback(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    if (pinnedTrainId) {
      const pinnedTrain = telemetry.trains.find(t => t.id === pinnedTrainId);
      if (pinnedTrain) {
        const currentZoom = map.getZoom() || 15;
        map.setView([pinnedTrain.latitude, pinnedTrain.longitude], currentZoom, { animate: true });
      }
    } else if (activeLine !== 'All') {
      const lineSeqs = initialSequences.filter(s => s.routeId === activeLine && s.directionId === 0);
      const lineStations = initialStations.filter(s => lineSeqs.some(seq => seq.stopId === s.stopId));
      if (lineStations.length > 0) {
        import('leaflet').then((L) => {
          const latlngs = lineStations.map(s => [s.latitude, s.longitude] as L.LatLngTuple);
          map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50], animate: true });
        });
      }
    } else {
      import('leaflet').then((L) => {
        const latlngs = initialStations.map(s => [s.latitude, s.longitude] as L.LatLngTuple);
        if (latlngs.length > 0) {
          map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], animate: true });
        }
      });
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
      mapInstanceRef.current.setView([pinnedTrain.latitude, pinnedTrain.longitude], currentZoom, { animate: true });
    }
  }, [telemetry.trains, pinnedTrainId]);

  // Invalidate Map size on screen tab switch to redraw Leaflet correctly
  useEffect(() => {
    if (currentTab === 'map' && mapInstanceRef.current) {
      const timer = setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize({ animate: false });
          if (!mapUserMovedRef.current) {
            fitMapBounds();
          }
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentTab, fitMapBounds]);

  const handleResetMapPosition = () => {
    mapUserMovedRef.current = false;
    setMapUserMoved(false);
    fitMapBounds();
  };

  // -------------------------------------------------------------
  // PRE CALCULATED SUMMARY DATA
  // -------------------------------------------------------------
  const activeTrains = useMemo(() => {
    const activeLines = activeLine === 'All' ? Object.keys(LINE_DETAILS) : [activeLine];
    return telemetry.trains.filter(t => activeLines.includes(t.routeId));
  }, [telemetry.trains, activeLine]);

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
      
      {/* Dynamic Skeleton Loading Overlay */}
      {isInitialLoading && (
        <div className="absolute inset-0 bg-background/95 backdrop-blur-md z-[9999] flex items-center justify-center">
          <div className="flex flex-col items-center gap-6 max-w-sm w-full px-6">
            {/* Pulsating Logo Icon */}
            <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-secondary/10 border border-secondary/20 shadow-[0_0_30px_rgba(0,238,252,0.15)] animate-pulse">
              <span className="material-symbols-outlined text-[40px] text-secondary">subway</span>
              <div className="absolute inset-0 rounded-full border border-secondary/40 animate-ping opacity-20"></div>
            </div>

            {/* Title & Status */}
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-black tracking-wider text-white">BA SUBTE</h2>
              <p className="text-xs text-secondary font-mono tracking-widest uppercase animate-pulse">Conectando telemetría...</p>
            </div>

            {/* Sidebar line list skeleton */}
            <div className="w-full bg-surface-container-lowest/40 border border-outline-variant/10 p-4 rounded-2xl flex flex-col gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-800 animate-pulse"></div>
                    <div className="w-24 h-3 bg-slate-800 rounded animate-pulse"></div>
                  </div>
                  <div className="w-6 h-3 bg-slate-800 rounded animate-pulse"></div>
                </div>
              ))}
            </div>

            <p className="text-[9px] text-slate-500 font-mono text-center">Resolviendo ranuras de vía fijas en tiempo real...</p>
          </div>
        </div>
      )}
      
      {/* TopAppBar - Responsive Flex layout to prevent overlaps */}
      <header className="h-16 shrink-0 w-full z-50 flex justify-between items-center px-gutter bg-surface-container/70 dark:bg-surface-container-lowest/80 backdrop-blur-xl border-b border-outline-variant/30">
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
        </nav>

        {/* Header Icons and Pill */}
        <div className="flex items-center gap-sm text-secondary dark:text-secondary-fixed">
          {/* Real-time Indicator Badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-low border border-outline-variant/30 text-[10px] font-mono tracking-widest text-outline mr-2 uppercase">
            <span className={`h-1.5 w-1.5 rounded-full ${telemetry.isMocked ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500 animate-ping'}`}></span>
            {telemetry.isMocked ? 'Simulado' : 'GCBA Vivo'}
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
      <header className="md:hidden fixed top-0 w-full z-50 bg-surface-container/90 backdrop-blur-xl border-b border-outline-variant/20 flex justify-between items-center px-4 h-14">
        <h1 className="text-title-sm font-headline-md font-bold tracking-tight text-on-background">BA SUBTE</h1>
        <div className="flex gap-2">
          <button onClick={() => { setCurrentTab('stations'); setShowMobileList(true); }} className="p-2"><span className="material-symbols-outlined text-outline">search</span></button>
          <button onClick={() => setCurrentTab(prev => prev === 'planner' ? 'stations' : 'planner')} className="p-2"><span className="material-symbols-outlined text-outline">menu</span></button>
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
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                {telemetry.trains.length}
              </span>
            </button>

            {Object.entries(LINE_DETAILS).map(([lineId, details]) => {
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
                  
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
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
        <div className="flex-1 h-full min-h-0 overflow-hidden relative bg-surface flex flex-col pb-16 md:pb-0">
          
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
              <div className="bg-slate-900/90 border border-slate-800/80 backdrop-blur-md rounded-2xl p-4 text-left shadow-2xl w-52 flex flex-col gap-1 pointer-events-auto">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-mono">Filtro de Línea</span>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-sm font-bold text-slate-200">{activeLine === 'All' ? 'Todas las Líneas' : LINE_DETAILS[activeLine]?.name}</span>
                  <button
                    onClick={() => {
                      setActiveLine('All');
                      setSelectedStationId(null);
                      setSelectedTrainId(null);
                      setPinnedTrainId(null);
                    }}
                    className="text-[9px] text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 hover:bg-indigo-500 hover:text-white transition"
                  >
                    Restablecer
                  </button>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800/80 backdrop-blur-md rounded-2xl p-4 text-left shadow-2xl w-52 flex flex-col gap-1 pointer-events-auto">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-mono">Formaciones Activas</span>
                <span className="text-xl font-black text-white font-mono mt-0.5">{activeTrains.length}</span>
              </div>
            </div>

            {/* Selected Station / Train Floating Detail (Map View) */}
            {(selectedStationId || selectedTrainId) && (
              <div className="absolute bottom-20 md:bottom-4 left-4 right-4 md:left-auto z-10 md:w-80 bg-slate-900/90 border border-slate-800/80 backdrop-blur-md rounded-2xl p-4 shadow-2xl text-left flex flex-col gap-3">
                <div className="flex justify-between items-start">
                  <div>
                    {selectedStationId ? (
                      <>
                        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block font-mono">Estación</span>
                        <h3 className="text-sm font-extrabold text-white leading-tight mt-0.5">{mapSelectedStation?.stopName}</h3>
                      </>
                    ) : (() => {
                      const train = telemetry.trains.find(t => t.id === selectedTrainId);
                      return (
                        <>
                          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block font-mono">Formación</span>
                          <h3 className="text-sm font-extrabold text-white leading-tight mt-0.5 font-mono">Tren {train?.id} ({LINE_DETAILS[train?.routeId || '']?.name.replace('Línea ', '')})</h3>
                        </>
                      );
                    })()}
                  </div>
                  <button
                    onClick={() => { setSelectedStationId(null); setSelectedTrainId(null); }}
                    className="text-[10px] font-bold text-slate-400 hover:text-white px-2 py-0.5 bg-slate-950 border border-slate-850 rounded-lg hover:bg-slate-900 transition"
                  >
                    Cerrar
                  </button>
                </div>
                
                <hr className="border-slate-850" />

                {selectedStationId ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-[9px] font-bold text-slate-500 uppercase font-mono block">Próximos Arribos:</span>
                    <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                      {telemetry.trains.filter(t => t.nextStopId === selectedStationId).length === 0 ? (
                        <span className="text-[10px] text-slate-500 italic text-center py-2 bg-slate-950/30 rounded-lg border border-slate-900">No hay arribos próximos.</span>
                      ) : (
                        telemetry.trains.filter(t => t.nextStopId === selectedStationId).map(arr => (
                          <div key={arr.id} className="p-2 rounded-lg bg-slate-950 border border-slate-900 flex items-center justify-between text-xs font-mono">
                            <span className="text-slate-300 font-bold">{arr.id}</span>
                            <span className="text-cyan-400 font-black">{arr.etaSeconds === 0 ? 'En andén' : `${Math.floor(arr.etaSeconds / 60)} min`}</span>
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
                        <span className="text-slate-500 font-medium font-mono uppercase text-[9px]">Próxima estación:</span>
                        <span className="font-semibold text-slate-350">{train.nextStopName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-medium font-mono uppercase text-[9px]">Llegada Estimada:</span>
                        <span className="font-bold text-cyan-400 font-mono">{train.etaSeconds === 0 ? 'En andén' : `${Math.floor(train.etaSeconds / 60)}m ${train.etaSeconds % 60}s`}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-550 font-medium font-mono uppercase text-[9px]">Demora:</span>
                        <span className={`font-semibold ${train.delaySeconds > 60 ? 'text-rose-400' : 'text-emerald-450'}`}>
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
                              mapInstanceRef.current.setView([train.latitude, train.longitude], currentZoom, { animate: true });
                            }
                          }
                        }}
                        className={`w-full py-1.5 rounded-lg font-bold text-xs border transition flex items-center justify-center gap-1.5 mt-2 ${
                          pinnedTrainId === train.id
                            ? 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30'
                            : 'bg-indigo-600/20 text-indigo-400 border-indigo-600/30 hover:bg-indigo-600/30 hover:text-white'
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
          {/* SCREEN 2: ROUTE PLANNER                                 */}
          {/* ======================================================= */}
          {currentTab === 'planner' && (
            <div className="flex-1 p-gutter md:p-margin-desktop overflow-x-hidden overflow-y-auto">
              <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-lg">
                {/* Left Column: Search & Results */}
                <div className="lg:col-span-4 flex flex-col gap-lg">
                  {/* Trip Planner Input Panel */}
                  <section className="glass-panel rounded-xl p-md flex flex-col gap-md text-left">
                    <h2 className="text-title-sm font-title-sm text-on-background flex items-center gap-sm">
                      <span className="material-symbols-outlined text-secondary">route</span>
                      Planificar Viaje
                    </h2>
                    <div className="relative flex flex-col gap-sm">
                      {/* Origin input */}
                      <div className="flex items-center bg-black border border-outline-variant/30 rounded-lg focus-within:border-secondary focus-within:shadow-[0_0_8px_rgba(0,238,252,0.3)] transition-all">
                        <span className="material-symbols-outlined text-on-surface-variant pl-sm">trip_origin</span>
                        <select
                          value={plannerOrigin}
                          onChange={(e) => setPlannerOrigin(e.target.value)}
                          className="w-full bg-transparent border-none text-body-md text-on-background placeholder-on-surface-variant focus:ring-0 py-sm px-sm outline-none"
                        >
                          <option value="" className="bg-surface-container">Desde (ej. Catedral)</option>
                          {uniqueStationNames.map(name => (
                            <option key={`origin-select-${name}`} value={name} className="bg-surface-container">{name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Swap button */}
                      <button
                        onClick={swapPlannerStations}
                        className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center bg-surface-variant rounded-full border border-outline-variant/50 hover:bg-surface-bright transition-colors text-on-background active:scale-95"
                      >
                        <span className="material-symbols-outlined text-[18px]">swap_vert</span>
                      </button>

                      {/* Destination input */}
                      <div className="flex items-center bg-black border border-outline-variant/30 rounded-lg focus-within:border-secondary focus-within:shadow-[0_0_8px_rgba(0,238,252,0.3)] transition-all mt-1">
                        <span className="material-symbols-outlined text-on-surface-variant pl-sm">location_on</span>
                        <select
                          value={plannerDestination}
                          onChange={(e) => setPlannerDestination(e.target.value)}
                          className="w-full bg-transparent border-none text-body-md text-on-background placeholder-on-surface-variant focus:ring-0 py-sm px-sm outline-none"
                        >
                          <option value="" className="bg-surface-container">Hacia (ej. Juramento)</option>
                          {uniqueStationNames.map(name => (
                            <option key={`dest-select-${name}`} value={name} className="bg-surface-container">{name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center gap-sm mt-xs">
                      <label className="flex items-center gap-xs cursor-pointer group">
                        <input
                          checked={stepFreeRequired}
                          onChange={(e) => setStepFreeRequired(e.target.checked)}
                          className="form-checkbox bg-black border-outline-variant/50 text-secondary rounded w-4 h-4 focus:ring-secondary focus:ring-offset-background"
                          type="checkbox"
                        />
                        <span className="text-body-sm font-body-sm text-on-surface-variant group-hover:text-on-background transition-colors flex items-center gap-xs">
                          <span className="material-symbols-outlined text-[16px]">accessible</span>
                          Sin barreras
                        </span>
                      </label>
                    </div>

                    <button
                      onClick={handleFindRoutes}
                      className="mt-xs w-full bg-on-background text-background font-bold text-body-md py-sm rounded-lg hover:bg-surface-tint transition-colors active:scale-[0.98]"
                    >
                      Buscar Rutas
                    </button>
                  </section>

                  {/* Suggested Routes results list */}
                  <section className="glass-panel rounded-xl flex flex-col flex-1 min-h-[300px] text-left">
                    <div className="p-md border-b border-outline-variant/10 flex justify-between items-center">
                      <h3 className="text-body-md font-body-md font-bold text-on-background">Rutas Sugeridas</h3>
                      <span className="text-label-caps font-label-caps text-on-surface-variant">En Vivo</span>
                    </div>

                    <div className="flex flex-col p-sm gap-sm overflow-y-auto">
                      {plannedRoute ? (
                        <div className="bg-surface-container/50 border border-secondary/30 rounded-lg p-sm relative overflow-hidden">
                          <div className="absolute top-0 left-0 w-1 h-full bg-secondary"></div>
                          
                          <div className="flex justify-between items-start mb-sm pl-xs">
                            <div className="flex items-center gap-xs">
                              <span className="text-headline-md font-headline-md font-bold font-mono">{routeSummaryMetrics.time}</span>
                              <span className="text-body-sm font-body-sm text-on-surface-variant">min</span>
                            </div>
                            <div className="text-right">
                              <div className="text-body-sm font-body-sm text-on-background font-bold">Ruta Óptima</div>
                              <div className="text-label-caps font-label-caps text-secondary flex items-center justify-end gap-xs">
                                <span className="w-2 h-2 rounded-full bg-secondary pulse-dot inline-block"></span>
                                {routeSummaryMetrics.transfers} trasbordos
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-sm pl-xs flex-wrap">
                            {plannedRoute.map((leg, idx) => {
                              if (!leg.routeId) return null;
                              return (
                                <React.Fragment key={`suggested-badges-${idx}`}>
                                  {idx > 0 && (
                                    <span className="material-symbols-outlined text-outline text-[16px]">arrow_forward</span>
                                  )}
                                  <div
                                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white uppercase border border-slate-900/20"
                                    style={{ backgroundColor: LINE_DETAILS[leg.routeId]?.color }}
                                  >
                                    {leg.routeId.replace('Linea', '')}
                                  </div>
                                </React.Fragment>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-550 italic text-center py-10">Ninguna ruta seleccionada. Use los campos del planificador para calcular el camino.</p>
                      )}
                    </div>
                  </section>
                </div>

                {/* Right Column: Departure Board & Charts */}
                <div className="lg:col-span-8 flex flex-col gap-lg text-left">
                  {/* Live Departure Board */}
                  <section className="glass-panel rounded-xl flex flex-col overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
                    <div className="bg-surface-container-lowest p-md border-b border-outline-variant/20 flex justify-between items-end">
                      <div>
                        <h2 className="text-headline-md font-headline-md font-bold text-on-background tracking-tight">PRÓXIMAS PARTIDAS</h2>
                        <p className="text-body-sm font-body-sm text-on-surface-variant flex items-center gap-xs mt-xs">
                          <span className="material-symbols-outlined text-[16px] text-secondary">my_location</span>
                          {plannerOrigin ? `Estación ${plannerOrigin}` : 'Seleccione Estación de Origen'}
                        </p>
                      </div>
                      <div className="text-data-lg font-data-lg text-secondary font-mono" id="live-clock">
                        --:--:--
                      </div>
                    </div>

                    <div className="flex flex-col">
                      {/* Table Header */}
                      <div className="grid grid-cols-12 gap-sm px-md py-sm border-b border-outline-variant/10 text-label-caps font-label-caps text-on-surface-variant bg-surface-dim/50">
                        <div className="col-span-2">LÍNEA</div>
                        <div className="col-span-6">DESTINO</div>
                        <div className="col-span-2 text-right">ESTADO</div>
                        <div className="col-span-2 text-right">ARRIBO</div>
                      </div>

                      {/* Board Rows */}
                      <div className="flex flex-col">
                        {(() => {
                          if (!plannerOrigin) {
                            return (
                              <p className="text-xs text-slate-550 italic p-6 text-center">Por favor seleccione una estación en el planificador de rutas para ver las partidas.</p>
                            );
                          }

                          const originStopIds = initialStations.filter(s => s.stopName === plannerOrigin).map(s => s.stopId);
                          const departures = telemetry.trains.filter(t => originStopIds.includes(t.nextStopId));

                          if (departures.length === 0) {
                            return (
                              <p className="text-xs text-slate-550 italic p-6 text-center">No hay trenes programados en esta estación actualmente.</p>
                            );
                          }

                          return departures.map((dep, idx) => {
                            const details = LINE_DETAILS[dep.routeId];
                            const isDelayed = dep.delaySeconds > 60;
                            const isNow = dep.etaSeconds <= 60;

                            return (
                              <div
                                key={`dep-row-${dep.id}-${idx}`}
                                className={`grid grid-cols-12 gap-sm px-md py-md border-b border-outline-variant/5 hover:bg-surface-container/30 transition-colors items-center relative overflow-hidden ${
                                  isDelayed ? 'bg-tertiary-container/10' : ''
                                }`}
                              >
                                {isDelayed && <div className="absolute top-0 left-0 w-1 h-full bg-error" />}
                                
                                <div className="col-span-2">
                                  <span
                                    className="inline-flex items-center justify-center w-8 h-8 rounded text-body-md font-bold text-white uppercase border border-slate-900/10"
                                    style={{ backgroundColor: details?.color || '#475569' }}
                                  >
                                    {dep.routeId.replace('Linea', '')}
                                  </span>
                                </div>
                                
                                <div className="col-span-6 text-title-sm font-title-sm text-on-background uppercase tracking-wide">
                                  {dep.nextStopName}
                                </div>
                                
                                <div className={`col-span-2 text-right text-label-caps font-label-caps ${
                                  isDelayed ? 'text-error' : (isNow ? 'text-secondary animate-pulse' : 'text-on-surface-variant')
                                }`}>
                                  {isDelayed ? 'DEMORADO' : (isNow ? 'EN ANDÉN' : 'A TIEMPO')}
                                </div>
                                
                                <div className={`col-span-2 text-right font-black leading-none ${
                                  isDelayed ? 'text-error text-headline-md' : (isNow ? 'text-display-lg text-secondary font-black' : 'text-headline-md font-bold')
                                }`}>
                                  {isNow ? 'AHORA' : `${Math.floor(dep.etaSeconds / 60)} min`}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  </section>

                  {/* Accessibility & Line Frequency Stats */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-lg">
                    <section className="glass-panel rounded-xl p-md flex flex-col h-64 text-left">
                      <div className="flex justify-between items-center mb-md">
                        <h3 className="text-body-md font-body-md font-bold text-on-background">Tendencia de Congestión</h3>
                        <span className="text-label-caps font-label-caps text-on-surface-variant font-mono">Hoy</span>
                      </div>
                      
                      <div className="flex-1 flex items-end gap-xs px-xs relative">
                        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-20">
                          <div className="border-t border-outline-variant w-full h-0"></div>
                          <div className="border-t border-outline-variant w-full h-0"></div>
                          <div className="border-t border-outline-variant w-full h-0"></div>
                          <div className="border-t border-outline-variant w-full h-0"></div>
                        </div>

                        {/* Chart Bars */}
                        {(() => {
                          const mockHours = [6, 8, 10, 12, 14, 16, 18, 20, 22];
                          const mockFlowPct = [30, 60, 90, 75, 45, 65, 95, 55, 25];

                          return mockHours.map((h, idx) => {
                            const isPeak = h === 18;
                            const heightVal = mockFlowPct[idx];

                            return (
                              <div key={`chart-leg-${h}`} className="w-full bg-secondary/60 rounded-t-sm hover:bg-secondary transition-colors relative group" style={{ height: `${heightVal}%` }}>
                                {isPeak && <div className="absolute inset-0 bg-error rounded-t-sm" />}
                                <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-surface-container border border-outline-variant/40 px-2 py-1 text-[9px] rounded text-white font-mono whitespace-nowrap z-20">
                                  {isPeak ? '18hs (Pico)' : `${h}hs`}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </section>

                    <section className="glass-panel rounded-xl p-md flex flex-col text-left">
                      <div className="flex justify-between items-center mb-md">
                        <h3 className="text-body-md font-body-md font-bold text-on-background flex items-center gap-xs">
                          <span className="material-symbols-outlined text-[20px]">accessible_forward</span>
                          Accesibilidad
                        </h3>
                        <span className="text-label-caps font-label-caps text-on-surface-variant font-mono">Estado</span>
                      </div>
                      
                      <div className="flex flex-col gap-sm">
                        <div className="flex items-center justify-between p-sm bg-surface-container/30 rounded border border-outline-variant/10">
                          <div className="flex items-center gap-sm">
                            <span className="material-symbols-outlined text-outline">elevator</span>
                            <span className="text-body-sm font-body-sm">Ascensores Principales</span>
                          </div>
                          <span className="text-label-caps font-label-caps text-secondary px-2 py-1 bg-secondary/10 rounded">OPERATIVO</span>
                        </div>

                        <div className="flex items-center justify-between p-sm bg-surface-container/30 rounded border border-outline-variant/10">
                          <div className="flex items-center gap-sm">
                            <span className="material-symbols-outlined text-outline">elevator</span>
                            <span className="text-body-sm font-body-sm">Andenes Línea D</span>
                          </div>
                          <span className="text-label-caps font-label-caps text-secondary px-2 py-1 bg-secondary/10 rounded">OPERATIVO</span>
                        </div>

                        <div className="flex items-center justify-between p-sm bg-surface-container/30 rounded border border-outline-variant/10">
                          <div className="flex items-center gap-sm">
                            <span className="material-symbols-outlined text-outline">escalator</span>
                            <span className="text-body-sm font-body-sm">Escaleras de Combinación</span>
                          </div>
                          <span className="text-label-caps font-label-caps text-error px-2 py-1 bg-error/10 rounded border border-error/20">SERVICIO REDUCIDO</span>
                        </div>
                      </div>
                    </section>
                  </div>
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
              <div className={`w-full md:w-[400px] lg:w-[450px] flex flex-col h-full glass-panel border-r border-outline-variant/10 z-20 ${
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
                      TODAS
                    </button>
                    {Object.keys(LINE_DETAILS).map(lineId => {
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
                          className={`w-8 h-8 rounded-full border border-outline-variant/30 flex items-center justify-center text-label-caps font-bold transition-all shrink-0 ${
                            isActive
                              ? 'text-white border-transparent shadow-[0_0_10px_rgba(0,150,94,0.5)]'
                              : 'text-outline hover:border-outline'
                          }`}
                          style={{ backgroundColor: isActive ? details.color : 'transparent' }}
                        >
                          {details.name.replace('Línea ', '')}
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
                                className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold text-white border border-slate-900/10"
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
              <div className={`flex-1 overflow-y-auto p-4 md:p-8 h-full bg-surface-container-lowest/50 ${
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
                            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-lg text-white border border-slate-900/20 shadow-md"
                            style={{ backgroundColor: LINE_DETAILS[stationLineFilter]?.color || '#475569' }}
                          >
                            {stationLineFilter.replace('Linea', '')}
                          </span>
                          <span className="text-label-caps font-label-caps text-outline tracking-widest uppercase font-mono">Selección Activa</span>
                        </div>
                        <h2 className="text-display-lg font-display-lg text-on-surface">{directorySelectedStation.stopName}</h2>
                        <p className="text-data-lg font-data-lg text-outline mt-2">Estación de la red de subterráneos de Buenos Aires</p>
                      </div>
                    </div>

                    {/* Bento Grid Layout */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* Connections */}
                      <div className="lg:col-span-1 glass-panel rounded-2xl p-6 flex flex-col">
                        <h3 className="text-title-sm font-headline-md text-outline mb-4 flex items-center gap-2 font-mono">
                          <span className="material-symbols-outlined">transit_enterexit</span>
                          Conexiones
                        </h3>
                        <div className="space-y-4 flex-1">
                          {(() => {
                            const connections = initialStations.filter(
                              st => st.stopName === directorySelectedStation.stopName && st.stopId !== directorySelectedStation.stopId
                            );

                            if (connections.length === 0) {
                              return <p className="text-xs text-slate-550 italic py-4">No hay líneas de combinación en esta plataforma.</p>;
                            }

                            return connections.map(conn => {
                              const seq = initialSequences.find(s => s.stopId === conn.stopId);
                              const details = seq ? LINE_DETAILS[seq.routeId] : null;

                              return (
                                <div key={conn.stopId} className="flex items-center gap-4 bg-surface-container-low p-3 rounded-lg border border-outline-variant/10 text-left">
                                  <span
                                    className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg text-white border border-slate-900/10"
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
                      <div className="lg:col-span-2 glass-panel rounded-2xl p-6 flex flex-col">
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
                                <p className="text-xs text-slate-550 italic py-6 text-center bg-slate-950/20 border border-slate-900 rounded-xl">
                                  No hay arribos programados próximamente.
                                </p>
                              );
                            }

                            return arrivals.map(arr => {
                              const details = LINE_DETAILS[arr.routeId];
                              return (
                                <div key={arr.id} className="flex items-center justify-between p-3.5 bg-surface-container-low rounded-lg border border-outline-variant/15 font-mono text-xs text-left">
                                  <div className="flex items-center gap-3">
                                    <span
                                      className="h-6 w-6 rounded flex items-center justify-center font-bold text-white text-[10px]"
                                      style={{ backgroundColor: details?.color }}
                                    >
                                      {arr.routeId.replace('Linea', '')}
                                    </span>
                                    <span className="font-bold text-slate-350">{arr.id}</span>
                                    <span className="text-[10px] text-slate-500">→ {arr.nextStopName}</span>
                                  </div>
                                  <span className="text-cyan-400 font-black text-sm">
                                    {arr.etaSeconds === 0 ? 'AHORA' : `${Math.floor(arr.etaSeconds / 60)} min`}
                                  </span>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>

                      {/* Passenger flow Bar Chart */}
                      <div className="lg:col-span-3 glass-panel rounded-2xl p-6 flex flex-col">
                        <h3 className="text-title-sm font-headline-md text-outline mb-4 flex items-center gap-2 font-mono">
                          <span className="material-symbols-outlined">bar_chart</span>
                          Gráfico de Congestión
                        </h3>

                        {isLoadingFlow ? (
                          <div className="h-32 flex items-center justify-center text-xs text-slate-500">Cargando estadísticas históricas...</div>
                        ) : stationFlowData.length === 0 ? (
                          <p className="text-xs text-slate-550 italic py-6 text-center">No hay registros de flujo de pasajeros disponibles.</p>
                        ) : (
                          <div className="flex items-end justify-between h-36 pt-4 border-b border-outline-variant/20">
                            {stationFlowData.map(item => {
                              const maxVal = Math.max(...stationFlowData.map(d => d.passengerFlow)) || 1;
                              const heightPct = Math.round((item.passengerFlow / maxVal) * 100);

                              let barColor = 'bg-secondary/40 hover:bg-secondary/70';
                              if (item.congestionLevel === 'Rojo') barColor = 'bg-error/50 hover:bg-error/85';
                              else if (item.congestionLevel === 'Amarillo') barColor = 'bg-tertiary/60 hover:bg-tertiary/90';

                              return (
                                <div key={`chart-dir-${item.hour}`} className="flex flex-col items-center flex-1 group relative">
                                  <div className="absolute opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 border border-slate-800 text-[9px] px-2 py-1 rounded shadow-xl text-center pointer-events-none -translate-y-8 z-10 whitespace-nowrap">
                                    <span className="font-bold text-white block">{item.passengerFlow} pasajeros</span>
                                    <span className="text-slate-400">{item.congestionLevel}</span>
                                  </div>

                                  <div
                                    className={`w-4 rounded-t-sm transition-all duration-300 ${barColor} shadow-md`}
                                    style={{ height: `${heightPct}%`, minHeight: '4px' }}
                                  />
                                  <span className="text-[9px] text-slate-500 font-mono mt-2">{String(item.hour).padStart(2, '0')}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

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
                              className="text-xs font-bold text-indigo-400 hover:text-indigo-300"
                            >
                              + Añadir Reporte
                            </button>
                          )}
                        </div>

                        {!showReportForm ? (
                          <div className="space-y-3 max-h-48 overflow-y-auto">
                            {reports.filter(r => r.station === directorySelectedStation.stopName).length === 0 ? (
                              <p className="text-xs text-slate-550 italic py-4 text-center">No hay reportes activos en esta estación.</p>
                            ) : (
                              reports
                                .filter(r => r.station === directorySelectedStation.stopName)
                                .map(r => (
                                  <div key={r.id} className="p-3 bg-surface-container-low border border-outline-variant/10 rounded-lg text-xs text-left">
                                    <div className="flex justify-between items-center">
                                      <span className="px-2 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-950 text-indigo-400 border border-slate-900">
                                        {r.category}
                                      </span>
                                      <span className="text-[9px] text-slate-500 font-mono">
                                        {new Date(r.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    </div>
                                    <p className="text-slate-350 leading-relaxed mt-2">&ldquo;{r.comment}&rdquo;</p>
                                  </div>
                                ))
                            )}
                          </div>
                        ) : (
                          <form onSubmit={(e) => handleSubmitReport(e, directorySelectedStation.stopId)} className="bg-slate-950/60 border border-outline-variant/20 p-4 rounded-xl flex flex-col gap-3">
                            {reportSuccess ? (
                              <div className="text-center py-4 flex flex-col items-center gap-1">
                                <span className="h-8 w-8 rounded-full bg-emerald-500/20 text-emerald-450 flex items-center justify-center font-bold text-sm">✓</span>
                                <p className="text-xs text-emerald-400 font-bold">Reporte enviado.</p>
                              </div>
                            ) : (
                              <>
                                <div>
                                  <label className="text-[9px] font-bold uppercase text-slate-500 block mb-1">Categoría</label>
                                  <select
                                    value={reportCategory}
                                    onChange={(e) => setReportCategory(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs p-2 rounded-lg outline-none"
                                  >
                                    <option>Congestión</option>
                                    <option>Demoras</option>
                                    <option>Seguridad</option>
                                    <option>Limpieza</option>
                                    <option>Climatización</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[9px] font-bold uppercase text-slate-500 block mb-1">Detalles</label>
                                  <textarea
                                    value={reportComment}
                                    onChange={(e) => setReportComment(e.target.value)}
                                    placeholder="Describa brevemente el estado de la plataforma..."
                                    maxLength={100}
                                    required
                                    rows={2}
                                    className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs p-2 rounded-lg outline-none resize-none"
                                  />
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setShowReportForm(false)}
                                    className="text-xs text-slate-400 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800"
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    type="submit"
                                    disabled={isSubmittingReport}
                                    className="text-xs text-white bg-indigo-600 hover:bg-indigo-500 px-4 py-1.5 rounded-lg font-bold disabled:opacity-50"
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
                  <p className="text-xs text-slate-500 italic p-6">Select a station in the list to view detailed data.</p>
                )}
              </div>
            </div>
          )}

          {/* ======================================================= */}
          {/* SCREEN 4: SERVICE STATUS                                */}
          {/* ======================================================= */}
          {currentTab === 'status' && (
            <div className="flex-1 p-gutter md:p-margin-desktop overflow-x-hidden overflow-y-auto animate-fade-in text-left">
              <div className="max-w-4xl mx-auto flex flex-col gap-6">
                <div className="bg-slate-900/60 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-2xl flex flex-col gap-4">
                  <h2 className="text-lg font-black text-white">Alertas del Servicio de Red</h2>
                  <p className="text-xs text-slate-400">Alertas oficiales y advertencias activas de la red de transporte.</p>
                  
                  <hr className="border-slate-800" />

                  <div className="flex flex-col gap-3">
                    {globalAlerts.length === 0 ? (
                      <div className="p-6 text-center bg-emerald-500/5 rounded-2xl border border-emerald-500/10 flex flex-col items-center gap-3">
                        <span className="h-10 w-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-sm">✓</span>
                        <h4 className="text-sm font-bold text-slate-200">Todas las Líneas Operan Normalmente</h4>
                        <p className="text-xs text-slate-400 text-center max-w-sm leading-relaxed">No se registran demoras, interrupciones de servicio ni problemas de infraestructura en la red.</p>
                      </div>
                    ) : (
                      globalAlerts.map(alert => {
                        const isGlobal = alert.routeId === 'Global';
                        const details = LINE_DETAILS[alert.routeId];

                        return (
                          <div key={alert.id} className="p-4 bg-amber-500/5 border border-amber-500/15 rounded-xl flex gap-3 items-start">
                            <span className="text-amber-500 text-lg shrink-0">⚠</span>
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
                              <h4 className="font-bold text-slate-200 mt-1.5 leading-snug">{alert.headerText}</h4>
                              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{alert.descriptionText}</p>
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

        </div>
      </div>

      {/* Mobile Bottom Navigation Bar (Mobile Only) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-surface-container/95 backdrop-blur-xl border-t border-outline-variant/20 z-50 flex justify-around items-center px-2">
        <button
          onClick={() => setCurrentTab('map')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
            currentTab === 'map' ? 'text-secondary' : 'text-outline hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-xl">map</span>
          <span className="text-[10px] font-bold mt-1">Mapa</span>
        </button>
        <button
          onClick={() => setCurrentTab('planner')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
            currentTab === 'planner' ? 'text-secondary' : 'text-outline hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-xl">route</span>
          <span className="text-[10px] font-bold mt-1">Planificador</span>
        </button>
        <button
          onClick={() => {
            setCurrentTab('stations');
            setShowMobileList(true);
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
            currentTab === 'stations' ? 'text-secondary' : 'text-outline hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-xl">subway</span>
          <span className="text-[10px] font-bold mt-1">Estaciones</span>
        </button>
        <button
          onClick={() => setCurrentTab('status')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
            currentTab === 'status' ? 'text-secondary' : 'text-outline hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-xl">warning</span>
          <span className="text-[10px] font-bold mt-1">Alertas</span>
        </button>
      </nav>

      {/* Footer - Positioned relative to layout columns to avoid overlaps */}
      <footer className="h-10 shrink-0 w-full flex justify-between items-center px-gutter bg-surface-container-lowest border-t border-outline-variant/10 z-30">
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
