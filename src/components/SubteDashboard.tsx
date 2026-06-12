'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
    color: '#00B4D8',
    bgClass: 'bg-cyan-500/10',
    borderClass: 'border-cyan-500/30',
    textColor: 'text-cyan-400',
    gradient: 'from-cyan-500 to-blue-500'
  },
  LineaB: {
    name: 'Línea B',
    color: '#E63946',
    bgClass: 'bg-red-500/10',
    borderClass: 'border-red-500/30',
    textColor: 'text-red-400',
    gradient: 'from-red-500 to-rose-600'
  },
  LineaC: {
    name: 'Línea C',
    color: '#3A86C8',
    bgClass: 'bg-blue-500/10',
    borderClass: 'border-blue-500/30',
    textColor: 'text-blue-400',
    gradient: 'from-blue-500 to-indigo-600'
  },
  LineaD: {
    name: 'Línea D',
    color: '#00AC67',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/30',
    textColor: 'text-emerald-400',
    gradient: 'from-emerald-500 to-teal-600'
  },
  LineaE: {
    name: 'Línea E',
    color: '#8338EC',
    bgClass: 'bg-purple-500/10',
    borderClass: 'border-purple-500/30',
    textColor: 'text-purple-400',
    gradient: 'from-purple-500 to-violet-600'
  },
  LineaH: {
    name: 'Línea H',
    color: '#FFB703',
    bgClass: 'bg-yellow-500/10',
    borderClass: 'border-yellow-500/30',
    textColor: 'text-yellow-400',
    gradient: 'from-yellow-500 to-amber-500'
  }
};

export default function SubteDashboard({
  initialStations,
  initialSequences,
  initialTelemetry
}: SubteDashboardProps) {
  // Navigation and Line selection
  const [activeLine, setActiveLine] = useState<string>('All'); // 'All' or lineId (e.g. 'LineaA')
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [selectedTrainId, setSelectedTrainId] = useState<string | null>(null);
  const [pinnedTrainId, setPinnedTrainId] = useState<string | null>(null);

  // Live Telemetry data
  const [telemetry, setTelemetry] = useState(initialTelemetry);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [connectionError, setConnectionError] = useState(false);

  // Leaflet map refs
  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const mapInstanceRef = React.useRef<any>(null);
  const tracksGroupRef = React.useRef<any>(null);
  const stationsGroupRef = React.useRef<any>(null);
  const trainsGroupRef = React.useRef<any>(null);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    import('leaflet').then((L) => {
      const map = L.map(mapContainerRef.current!, {
        center: [-34.6037, -58.3816],
        zoom: 13,
        zoomControl: false,
        attributionControl: false
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(map);

      L.control.zoom({ position: 'topright' }).addTo(map);

      const tracksGroup = L.layerGroup().addTo(map);
      const stationsGroup = L.layerGroup().addTo(map);
      const trainsGroup = L.layerGroup().addTo(map);

      mapInstanceRef.current = map;
      tracksGroupRef.current = tracksGroup;
      stationsGroupRef.current = stationsGroup;
      trainsGroupRef.current = trainsGroup;
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update Map Layers
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    import('leaflet').then((L) => {
      const map = mapInstanceRef.current;
      const tracksGroup = tracksGroupRef.current;
      const stationsGroup = stationsGroupRef.current;
      const trainsGroup = trainsGroupRef.current;

      tracksGroup.clearLayers();
      stationsGroup.clearLayers();
      trainsGroup.clearLayers();

      // Render Tracks
      Object.entries(LINE_DETAILS).map(([lineId, details]) => {
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

      // Render Stations
      Array.from(stationsByName.entries()).map(([, group]) => {
        const activeGroupStations = group.filter(s => {
          const seq = initialSequences.find(seq => seq.stopId === s.stopId);
          return seq && activeLines.includes(seq.routeId);
        });

        if (activeGroupStations.length === 0) return;

        const s = activeGroupStations[0];
        const isSelected = activeGroupStations.some(gs => gs.stopId === selectedStationId);

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

      // Render Trains
      activeTrains.map(train => {
        const color = LINE_DETAILS[train.routeId]?.color || '#fff';
        const isSelected = selectedTrainId === train.id;
        const isPinned = pinnedTrainId === train.id;
        const heading = getTrainHeading(train);

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
  }, [telemetry, activeLine, selectedStationId, selectedTrainId, pinnedTrainId]);

  // Center/Zoom view on pinned train
  useEffect(() => {
    if (!mapInstanceRef.current || !pinnedTrainId) return;
    const pinnedTrain = telemetry.trains.find(t => t.id === pinnedTrainId);
    if (pinnedTrain) {
      mapInstanceRef.current.setView([pinnedTrain.latitude, pinnedTrain.longitude], 15, { animate: true });
    }
  }, [telemetry.trains, pinnedTrainId]);

  // Zoom to fit bounds when a specific line is selected, or fit the entire network on Red Completa
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    import('leaflet').then((L) => {
      const map = mapInstanceRef.current;
      if (activeLine !== 'All') {
        const lineSeqs = initialSequences.filter(s => s.routeId === activeLine && s.directionId === 0);
        const lineStations = initialStations.filter(s => lineSeqs.some(seq => seq.stopId === s.stopId));
        if (lineStations.length > 0) {
          const latlngs = lineStations.map(s => [s.latitude, s.longitude] as L.LatLngTuple);
          const bounds = L.latLngBounds(latlngs);
          map.fitBounds(bounds, { padding: [50, 50], animate: true });
        }
      } else if (!pinnedTrainId) {
        // Fit the whole network if Red Completa is active and no train is pinned
        const latlngs = initialStations.map(s => [s.latitude, s.longitude] as L.LatLngTuple);
        if (latlngs.length > 0) {
          const bounds = L.latLngBounds(latlngs);
          map.fitBounds(bounds, { padding: [40, 40], animate: true });
        }
      }
    });
  }, [activeLine, initialStations, initialSequences, pinnedTrainId]);

  // User Reports state
  const [reports, setReports] = useState<ReportData[]>([]);
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportCategory, setReportCategory] = useState('Congestión');
  const [reportComment, setReportComment] = useState('');
  const [reportSuccess, setReportSuccess] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportTrigger, setReportTrigger] = useState(0);

  // Map Hover tooltip state
  const [hoveredEntity, setHoveredEntity] = useState<{
    type: 'station' | 'train';
    name: string;
    detail: string;
    x: number;
    y: number;
  } | null>(null);

  // Update clock on client
  useEffect(() => {
    const updateClock = () => {
      setCurrentTime(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    const timeoutId = setTimeout(updateClock, 0);
    const timer = setInterval(updateClock, 1000);
    return () => {
      clearTimeout(timeoutId);
      clearInterval(timer);
    };
  }, []);

  // Poll real-time telemetry every 2 seconds
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
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchTelemetry, 2000);
    return () => clearInterval(interval);
  }, [fetchTelemetry]);

  // Fetch passenger reports
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

  // Handle passenger report submission
  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStationId) return;

    const station = initialStations.find(s => s.stopId === selectedStationId);
    if (!station) return;

    let line = 'LineaA';
    const seq = initialSequences.find(s => s.stopId === selectedStationId);
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

  const activeLines = activeLine === 'All' ? Object.keys(LINE_DETAILS) : [activeLine];

  const activeSequences = initialSequences.filter(s => activeLines.includes(s.routeId));
  const activeStopIds = new Set(activeSequences.map(s => s.stopId));
  const activeStations = initialStations.filter(s => activeStopIds.has(s.stopId));

  // SVG dimensions for full-screen layout
  const svgWidth = 1000;
  const svgHeight = 720;

  // Bounding coordinates
  let minLat = -34.6433;
  let maxLat = -34.5559;
  let minLon = -58.4904;
  let maxLon = -58.3582;

  if (activeStations.length > 0) {
    minLat = Math.min(...activeStations.map(s => s.latitude));
    maxLat = Math.max(...activeStations.map(s => s.latitude));
    minLon = Math.min(...activeStations.map(s => s.longitude));
    maxLon = Math.max(...activeStations.map(s => s.longitude));
  }

  let finalMinLat: number;
  let finalMaxLat: number;
  let finalMinLon: number;
  let finalMaxLon: number;

  const pinnedTrain = pinnedTrainId ? telemetry.trains.find(t => t.id === pinnedTrainId) : null;

  if (pinnedTrain) {
    // Zoomed-in bounds centered on the pinned train
    const latZoom = 0.012; // height of the viewport in degrees (approx 1.3km)
    const lonZoom = latZoom * (svgWidth / svgHeight); // maintain aspect ratio

    finalMinLat = pinnedTrain.latitude - latZoom / 2;
    finalMaxLat = pinnedTrain.latitude + latZoom / 2;
    finalMinLon = pinnedTrain.longitude - lonZoom / 2;
    finalMaxLon = pinnedTrain.longitude + lonZoom / 2;
  } else {
    const latPad = (maxLat - minLat) * 0.15 || 0.005;
    const lonPad = (maxLon - minLon) * 0.15 || 0.005;

    finalMinLat = minLat - latPad;
    finalMaxLat = maxLat + latPad;
    finalMinLon = minLon - lonPad;
    finalMaxLon = maxLon + lonPad;
  }

  // Helper function to calculate heading angle of a train based on its route direction (negated for screen rotation)
  const getTrainHeading = (train: TrainTelemetry) => {
    const nextStation = initialStations.find(s => s.stopId === train.nextStopId);
    const prevStation = train.prevStopId ? initialStations.find(s => s.stopId === train.prevStopId) : null;

    let x1: number | null = null;
    let y1: number | null = null;
    let x2: number | null = null;
    let y2: number | null = null;

    if (prevStation && nextStation) {
      x1 = prevStation.longitude;
      y1 = prevStation.latitude;
      x2 = nextStation.longitude;
      y2 = nextStation.latitude;
    } else if (nextStation) {
      x1 = train.longitude;
      y1 = train.latitude;
      x2 = nextStation.longitude;
      y2 = nextStation.latitude;
    }

    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      if (Math.abs(dx) > 0.00001 || Math.abs(dy) > 0.00001) {
        return -Math.atan2(dy, dx) * (180 / Math.PI);
      }
    }

    return train.directionId === 0 ? 90 : 270;
  };

  const stationsByName = new Map<string, Station[]>();
  activeStations.forEach(s => {
    const name = s.stopName;
    if (!stationsByName.has(name)) {
      stationsByName.set(name, []);
    }
    stationsByName.get(name)!.push(s);
  });

  const activeTrains = telemetry.trains.filter(t => activeLines.includes(t.routeId));
  const delayedTrains = activeTrains.filter(t => t.delaySeconds > 60);
  const averageDelay = activeTrains.length > 0
    ? Math.round(activeTrains.reduce((sum, t) => sum + Math.max(0, t.delaySeconds), 0) / activeTrains.length)
    : 0;

  const selectedStation = initialStations.find(s => s.stopId === selectedStationId);
  const selectedStationArrivals = telemetry.trains.filter(
    t => t.nextStopId === selectedStationId && activeLines.includes(t.routeId)
  );

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 font-sans antialiased overflow-hidden">
      {/* HEADER NAVBAR */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md h-16 shrink-0 flex items-center justify-between px-4 sm:px-6 z-50">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 shrink-0">
            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm sm:text-lg font-bold tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              SUBTE-MONITOR
            </h1>
            <p className="text-[10px] sm:text-xs text-slate-500 font-medium hidden sm:block">Algoritmo Fixed-Slot & Stable Hashing</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 rounded-full bg-slate-900 border border-slate-800">
            {connectionError ? (
              <>
                <span className="h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-rose-500 animate-pulse"></span>
                <span className="text-[9px] sm:text-xs font-semibold text-rose-400 uppercase tracking-wider">
                  Reconectando...
                </span>
              </>
            ) : (
              <>
                <span className={`h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full ${telemetry.isMocked ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500 animate-ping'}`}></span>
                <span className="text-[9px] sm:text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  {telemetry.isMocked ? 'Simulado' : 'GCBA Conectado'}
                </span>
              </>
            )}
          </div>

          <div className="text-xs sm:text-sm font-mono text-slate-400 bg-slate-900 px-2 sm:px-3 py-1 rounded-lg border border-slate-800 hidden md:block">
            {currentTime || '--:--:--'}
          </div>

          <button
            onClick={fetchTelemetry}
            disabled={isRefreshing}
            className="p-1.5 sm:p-2 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white transition disabled:opacity-50"
          >
            <svg className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18.2" />
            </svg>
          </button>
        </div>
      </header>

      {/* FULL-SCREEN MAP CONTAINER */}
      <main className="flex-1 w-full relative overflow-hidden bg-slate-950">
        
        {/* INTERACTIVE LEAFLET MAP */}
        <div ref={mapContainerRef} className="absolute inset-0 w-full h-full z-0" />

        {/* FLOATING LINE SELECTOR - Top Center */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex gap-1.5 p-1.5 rounded-2xl bg-slate-900/65 backdrop-blur-xl border border-slate-800/80 shadow-2xl max-w-[90vw] overflow-x-auto scrollbar-none flex-nowrap">
          <button
            onClick={() => {
              setActiveLine('All');
              setSelectedStationId(null);
              setSelectedTrainId(null);
              setPinnedTrainId(null);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition uppercase shrink-0 ${
              activeLine === 'All'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            Red Completa
          </button>
          {Object.entries(LINE_DETAILS).map(([id, details]) => (
            <button
              key={id}
              onClick={() => {
                setActiveLine(id);
                setSelectedStationId(null);
                setSelectedTrainId(null);
                setPinnedTrainId(null);
              }}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 ${
                activeLine === id
                  ? 'bg-slate-800 text-white shadow-md border border-slate-700'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: details.color }}></span>
              {details.name.replace('Línea ', '')}
            </button>
          ))}
        </div>

        {/* FLOATING METRICS SUMMARY - Top Left */}
        <div className="absolute top-20 md:top-4 left-4 z-10 flex flex-row md:flex-col gap-2 max-w-[calc(100vw-32px)] overflow-x-auto scrollbar-none">
          <div className="bg-slate-900/65 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-2.5 md:p-3.5 shadow-2xl w-36 md:w-48 text-left shrink-0">
            <span className="text-[8px] md:text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Formaciones</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-base md:text-xl font-black text-slate-200">{activeTrains.length}</span>
              <span className="text-[10px] text-slate-500 font-bold ml-1">activas</span>
            </div>
          </div>

          <div className="bg-slate-900/65 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-2.5 md:p-3.5 shadow-2xl w-36 md:w-48 text-left shrink-0">
            <span className="text-[8px] md:text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Demora Promedio</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-sm md:text-lg font-black text-slate-200">
                {averageDelay > 0 ? `${Math.round(averageDelay / 60)}m ${averageDelay % 60}s` : '0s'}
              </span>
            </div>
          </div>

          {delayedTrains.length > 0 && (
            <div className="bg-rose-950/40 backdrop-blur-xl border border-rose-900/40 rounded-2xl p-2.5 md:p-3.5 shadow-2xl w-36 md:w-48 text-left shrink-0">
              <span className="text-[8px] md:text-[10px] font-bold text-rose-400 uppercase tracking-widest block flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping"></span>
                Demoradas
              </span>
              <span className="text-xs md:text-lg font-black text-rose-300 mt-0.5 block truncate">{delayedTrains.length} formación{delayedTrains.length > 1 ? 'es' : ''}</span>
            </div>
          )}
        </div>

        {/* FLOATING STATION DETAILS / COMPACT REPORT PANEL - Bottom Right */}
        {selectedStationId && (
          <div className="fixed bottom-0 left-0 right-0 w-full rounded-t-3xl rounded-b-none border-t border-slate-850 z-30 md:absolute md:bottom-4 md:right-4 md:left-auto md:w-80 md:rounded-2xl md:border bg-slate-900/90 backdrop-blur-xl p-4 shadow-2xl flex flex-col gap-3.5 text-left">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Estación</span>
                <h3 className="text-base font-extrabold text-white leading-tight mt-0.5">{selectedStation?.stopName}</h3>
              </div>
              <button
                onClick={() => { setSelectedStationId(null); setShowReportForm(false); }}
                className="text-[10px] font-bold text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-950 border border-slate-900 hover:bg-slate-900 transition"
              >
                Cerrar
              </button>
            </div>

            <hr className="border-slate-800/80" />

            {/* Arrivals */}
            <div>
              <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1.5">Próximos Arribos</h4>
              <div className="flex flex-col gap-1.5 max-h-24 overflow-y-auto">
                {selectedStationArrivals.length === 0 ? (
                  <p className="text-[10px] text-slate-500 italic py-2 bg-slate-950/40 rounded-lg text-center border border-slate-950">
                    Sin formaciones próximas.
                  </p>
                ) : (
                  selectedStationArrivals.map(arr => (
                    <div key={arr.id} className="px-2.5 py-1.5 rounded-lg bg-slate-950/80 border border-slate-900 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-slate-200">{arr.id}</span>
                        <span className="text-[9px] text-slate-500 font-bold">({LINE_DETAILS[arr.routeId]?.name.replace('Línea ', '')})</span>
                      </div>
                      <span className="font-mono text-cyan-400 font-black">
                        {arr.etaSeconds === 0 ? 'En andén' : `${Math.floor(arr.etaSeconds / 60)} min`}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Passenger feedback */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Reportes en Andén</h4>
                {!showReportForm && (
                  <button
                    onClick={() => setShowReportForm(true)}
                    className="text-[9px] font-extrabold text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5"
                  >
                    + Reportar
                  </button>
                )}
              </div>

              {!showReportForm ? (
                <div className="flex flex-col gap-1.5 max-h-24 overflow-y-auto">
                  {reports.filter(r => r.station === selectedStation?.stopName).length === 0 ? (
                    <p className="text-[10px] text-slate-500 italic py-2 bg-slate-950/40 rounded-lg text-center border border-slate-950">
                      Sin novedades reportadas.
                    </p>
                  ) : (
                    reports
                      .filter(r => r.station === selectedStation?.stopName)
                      .map(r => (
                        <div key={r.id} className="p-2 rounded-lg bg-slate-950/50 border border-slate-900 flex flex-col gap-0.5">
                          <div className="flex justify-between items-center">
                            <span className="px-1 py-0.5 rounded text-[8px] font-extrabold uppercase bg-slate-800 text-indigo-400">
                              {r.category}
                            </span>
                            <span className="text-[8px] text-slate-500 font-mono">
                              {new Date(r.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-300 mt-1 leading-snug">&ldquo;{r.comment}&rdquo;</p>
                        </div>
                      ))
                  )}
                </div>
              ) : (
                <form onSubmit={handleSubmitReport} className="bg-slate-950 border border-slate-850 p-2.5 rounded-xl flex flex-col gap-2">
                  {reportSuccess ? (
                    <div className="text-center py-2 flex flex-col items-center gap-1">
                      <span className="h-6 w-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">✓</span>
                      <p className="text-[10px] text-emerald-400 font-bold">Reportado</p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <select
                          value={reportCategory}
                          onChange={(e) => setReportCategory(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-[10px] p-1.5 rounded-lg outline-none"
                        >
                          <option>Congestión</option>
                          <option>Demoras</option>
                          <option>Seguridad</option>
                          <option>Limpieza</option>
                          <option>Climatización</option>
                        </select>
                      </div>
                      <div>
                        <textarea
                          value={reportComment}
                          onChange={(e) => setReportComment(e.target.value)}
                          placeholder="Descripción breve..."
                          maxLength={100}
                          required
                          rows={1}
                          className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-[10px] p-1.5 rounded-lg outline-none resize-none"
                        />
                      </div>
                      <div className="flex gap-1.5 justify-end">
                        <button
                          type="button"
                          onClick={() => setShowReportForm(false)}
                          className="text-[9px] text-slate-400 px-2 py-1 rounded bg-slate-900 border border-slate-800"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          disabled={isSubmittingReport}
                          className="text-[9px] text-white bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1 rounded font-bold disabled:opacity-50"
                        >
                          {isSubmittingReport ? 'Enviando' : 'Enviar'}
                        </button>
                      </div>
                    </>
                  )}
                </form>
              )}
            </div>
          </div>
        )}

        {/* FLOATING TRAIN DETAILS PANEL - Bottom Right */}
        {selectedTrainId && (() => {
          const train = telemetry.trains.find(t => t.id === selectedTrainId);
          if (!train) return null;
          const details = LINE_DETAILS[train.routeId];
          const isPinned = pinnedTrainId === train.id;

          return (
            <div className="fixed bottom-0 left-0 right-0 w-full rounded-t-3xl rounded-b-none border-t border-slate-850 z-30 md:absolute md:bottom-4 md:right-4 md:left-auto md:w-80 md:rounded-2xl md:border bg-slate-900/90 backdrop-blur-xl p-4 shadow-2xl flex flex-col gap-3.5 text-left transition-all animate-in fade-in slide-in-from-bottom-5 duration-200">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Formación</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <h3 className="text-base font-extrabold text-white leading-tight font-mono">{train.id}</h3>
                    {details && (
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${details.textColor} ${details.bgClass} border ${details.borderClass}`}>
                        {details.name}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { setSelectedTrainId(null); }}
                  className="text-[10px] font-bold text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-950 border border-slate-900 hover:bg-slate-900 transition"
                >
                  Cerrar
                </button>
              </div>

              <hr className="border-slate-800/80" />

              {/* Status & Tracking Button */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Estado</span>
                  <span className={`text-xs font-extrabold mt-0.5 flex items-center gap-1.5 ${train.status === 'STOPPED' ? 'text-amber-400' : 'text-emerald-400'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${train.status === 'STOPPED' ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'}`}></span>
                    {train.status === 'STOPPED' ? 'Detenido en Andén' : 'En Tránsito'}
                  </span>
                </div>

                <button
                  onClick={() => {
                    if (isPinned) {
                      setPinnedTrainId(null);
                    } else {
                      setPinnedTrainId(train.id);
                      setActiveLine(train.routeId); // Focus on the train's line
                    }
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all shadow-md ${
                    isPinned
                      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/10'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/15'
                  }`}
                >
                  <svg className={`w-3.5 h-3.5 ${isPinned ? 'animate-pulse' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    {isPinned ? (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M19 12a7 7 0 11-14 0 7 7 0 0114 0z" />
                    )}
                  </svg>
                  {isPinned ? 'Dejar de Seguir' : 'Seguir Formación'}
                </button>
              </div>

              {/* Destination & ETA */}
              <div className="grid grid-cols-2 gap-3.5 bg-slate-950/40 p-2.5 rounded-xl border border-slate-950">
                <div>
                  <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block">Próxima Parada</span>
                  <span className="text-xs font-extrabold text-slate-200 block truncate mt-0.5">{train.nextStopName}</span>
                </div>
                <div>
                  <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block">Llegada Estimada</span>
                  <span className="text-xs font-black text-cyan-400 block mt-0.5">
                    {train.etaSeconds === 0 ? 'En andén' : `${Math.floor(train.etaSeconds / 60)}m ${train.etaSeconds % 60}s`}
                  </span>
                </div>
              </div>

              {/* Additional Stats */}
              <div className="flex flex-col gap-1.5 text-xs text-slate-400">
                {train.prevStopName && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-medium">Estación anterior:</span>
                    <span className="font-semibold">{train.prevStopName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">Demora actual:</span>
                  <span className={`font-semibold ${train.delaySeconds > 60 ? 'text-rose-400' : 'text-slate-300'}`}>
                    {train.delaySeconds > 0 ? `${Math.floor(train.delaySeconds / 60)}m ${train.delaySeconds % 60}s` : 'Sin demora'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">Progreso en tramo:</span>
                  <span className="font-mono font-semibold">{Math.round(train.progress * 100)}%</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ACTIVE TRACKING BADGE */}
        {pinnedTrain && (
          <div className="absolute top-36 md:top-20 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-indigo-950/80 border border-indigo-500/30 backdrop-blur-md shadow-lg shadow-indigo-950/30 max-w-[90vw]">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
            <span className="text-[10px] sm:text-xs font-bold text-indigo-200 truncate">
              Siguiendo formación <span className="font-mono font-black">{pinnedTrain.id}</span> ({LINE_DETAILS[pinnedTrain.routeId]?.name})
            </span>
            <button
              onClick={() => setPinnedTrainId(null)}
              className="text-[9px] sm:text-[10px] font-black text-indigo-300 hover:text-white px-2 py-0.5 rounded bg-indigo-900/50 border border-indigo-700/30 transition uppercase shrink-0"
            >
              Liberar
            </button>
          </div>
        )}

        {/* FLOATING SERVICE ALERTS - Bottom Left */}
        <div className={`absolute z-10 max-h-48 overflow-y-auto bg-slate-900/65 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-4 shadow-2xl text-left transition-all duration-200 bottom-4 left-4 right-4 md:right-auto w-auto md:w-80 ${
          (selectedStationId || selectedTrainId) ? 'hidden md:block' : 'block'
        }`}>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Estado del Servicio</span>
          
          <div className="flex flex-col gap-2">
            {telemetry.alerts.length === 0 ? (
              <div className="p-3 text-center bg-slate-950/20 rounded-xl border border-slate-950 flex items-center gap-2">
                <span className="h-5 w-5 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold text-[10px]">✓</span>
                <p className="text-xs font-semibold text-slate-400">Red operando con normalidad</p>
              </div>
            ) : (
              telemetry.alerts.map(alert => {
                const isGlobal = alert.routeId === 'Global';
                const details = LINE_DETAILS[alert.routeId];

                return (
                  <div key={alert.id} className="p-2.5 bg-amber-950/15 border border-amber-900/30 rounded-xl flex gap-2 items-start text-xs">
                    <span className="text-amber-500 shrink-0">⚠</span>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[8px] font-extrabold text-amber-400 uppercase tracking-wider">
                          {alert.effect}
                        </span>
                        {!isGlobal && details && (
                          <span className={`px-1 py-0.2 rounded text-[7px] font-bold uppercase ${details.textColor} ${details.bgClass} border ${details.borderClass}`}>
                            {details.name.replace('Línea ', '')}
                          </span>
                        )}
                      </div>
                      <p className="font-bold text-slate-300 mt-0.5 leading-snug">{alert.headerText}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </main>
    </div>
  );
}
