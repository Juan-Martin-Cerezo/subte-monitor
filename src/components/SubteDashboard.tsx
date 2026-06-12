'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { TrainTelemetry, AlertData } from '@/lib/telemetry';

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

  const projectX = (lon: number) => {
    return ((lon - finalMinLon) / (finalMaxLon - finalMinLon)) * svgWidth;
  };

  const projectY = (lat: number) => {
    return (1 - (lat - finalMinLat) / (finalMaxLat - finalMinLat)) * svgHeight;
  };

  // Helper function to calculate heading angle of a train based on its route direction
  const getTrainHeading = (train: TrainTelemetry) => {
    const nextStation = initialStations.find(s => s.stopId === train.nextStopId);
    const prevStation = train.prevStopId ? initialStations.find(s => s.stopId === train.prevStopId) : null;

    let x1: number | null = null;
    let y1: number | null = null;
    let x2: number | null = null;
    let y2: number | null = null;

    if (prevStation && nextStation) {
      x1 = projectX(prevStation.longitude);
      y1 = projectY(prevStation.latitude);
      x2 = projectX(nextStation.longitude);
      y2 = projectY(nextStation.latitude);
    } else if (nextStation) {
      x1 = projectX(train.longitude);
      y1 = projectY(train.latitude);
      x2 = projectX(nextStation.longitude);
      y2 = projectY(nextStation.latitude);
    }

    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        return Math.atan2(dy, dx) * (180 / Math.PI);
      }
    }

    return train.directionId === 0 ? 0 : 180;
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
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md h-16 shrink-0 flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              SUBTE-MONITOR Live Map
            </h1>
            <p className="text-xs text-slate-500 font-medium">Algoritmo Fixed-Slot & Stable Hashing</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800">
            {connectionError ? (
              <>
                <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse"></span>
                <span className="text-xs font-semibold text-rose-400 uppercase tracking-wider">
                  Reconectando...
                </span>
              </>
            ) : (
              <>
                <span className={`h-2 w-2 rounded-full ${telemetry.isMocked ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500 animate-ping'}`}></span>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  {telemetry.isMocked ? 'Simulación Activa' : 'API GCBA Conectada'}
                </span>
              </>
            )}
          </div>

          <div className="text-sm font-mono text-slate-400 bg-slate-900 px-3 py-1 rounded-lg border border-slate-800">
            {currentTime || '--:--:--'}
          </div>

          <button
            onClick={fetchTelemetry}
            disabled={isRefreshing}
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white transition disabled:opacity-50"
          >
            <svg className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18.2" />
            </svg>
          </button>
        </div>
      </header>

      {/* FULL-SCREEN MAP CONTAINER */}
      <main className="flex-1 w-full relative overflow-hidden bg-slate-950">
        
        {/* INTERACTIVE SVG MAP */}
        <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-slate-950 p-6 z-0">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-full max-w-full max-h-full transition-all duration-300 drop-shadow-2xl select-none"
          >
            <defs>
              <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              
              <filter id="train-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Grid Mesh */}
            <g stroke="#0f172a" strokeWidth="0.5" opacity="0.45">
              {Array.from({ length: 11 }).map((_, i) => (
                <line key={`v-${i}`} x1={(i * svgWidth) / 10} y1="0" x2={(i * svgWidth) / 10} y2={svgHeight} />
              ))}
              {Array.from({ length: 11 }).map((_, i) => (
                <line key={`h-${i}`} x1="0" y1={(i * svgHeight) / 10} x2={svgWidth} y2={(i * svgHeight) / 10} />
              ))}
            </g>

            {/* DRAW TRACKS */}
            {Object.entries(LINE_DETAILS).map(([lineId, details]) => {
              if (!activeLines.includes(lineId)) return null;

              const lineSeqs = initialSequences.filter(s => s.routeId === lineId && s.directionId === 0);
              if (lineSeqs.length === 0) return null;

              const points = lineSeqs
                .map(seq => {
                  const station = initialStations.find(s => s.stopId === seq.stopId);
                  if (!station) return null;
                  return `${projectX(station.longitude)},${projectY(station.latitude)}`;
                })
                .filter(Boolean)
                .join(' ');

              return (
                <polyline
                  key={`track-${lineId}`}
                  points={points}
                  fill="none"
                  stroke={details.color}
                  strokeWidth={activeLine === lineId ? 6.5 : 4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={activeLine === 'All' ? 0.75 : 0.95}
                  filter="url(#neon-glow)"
                  className="transition-all duration-300"
                />
              );
            })}

            {/* DRAW STATIONS */}
            {Array.from(stationsByName.entries()).map(([, group]) => {
              const activeGroupStations = group.filter(s => {
                const seq = initialSequences.find(seq => seq.stopId === s.stopId);
                return seq && activeLines.includes(seq.routeId);
              });

              if (activeGroupStations.length === 0) return null;

              const s = activeGroupStations[0];
              const x = projectX(s.longitude);
              const y = projectY(s.latitude);
              const isSelected = activeGroupStations.some(gs => gs.stopId === selectedStationId);

              const seq = initialSequences.find(seq => seq.stopId === s.stopId);
              const lineColor = seq ? LINE_DETAILS[seq.routeId]?.color : '#475569';

              return (
                <g
                  key={`station-group-${s.stopId}`}
                  className="cursor-pointer group"
                  onClick={() => {
                    setSelectedStationId(s.stopId);
                    setSelectedTrainId(null);
                  }}
                  onMouseEnter={() => {
                    const lines = activeGroupStations.map(gs => {
                      const sq = initialSequences.find(q => q.stopId === gs.stopId);
                      return sq ? LINE_DETAILS[sq.routeId]?.name : '';
                    }).filter(Boolean).join(', ');

                    setHoveredEntity({
                      type: 'station',
                      name: s.stopName,
                      detail: `Conexión: ${lines}`,
                      x: x,
                      y: y - 10
                    });
                  }}
                  onMouseLeave={() => setHoveredEntity(null)}
                >
                  {isSelected && (
                    <circle
                      cx={x}
                      cy={y}
                      r={12}
                      fill="none"
                      stroke="#fff"
                      strokeWidth={2}
                      className="animate-pulse"
                    />
                  )}

                  <circle
                    cx={x}
                    cy={y}
                    r={isSelected ? 7.5 : 6}
                    fill="#090d16"
                    stroke={lineColor}
                    strokeWidth={3}
                    className="group-hover:scale-125 transition-transform duration-200"
                  />
                  
                  <circle
                    cx={x}
                    cy={y}
                    r={2.5}
                    fill={isSelected ? '#fff' : '#cbd5e1'}
                  />

                  {(activeLine !== 'All' || isSelected) && (
                    <text
                      x={x + 10}
                      y={y + 4}
                      fill="#94a3b8"
                      fontSize="9"
                      fontWeight="bold"
                      className="pointer-events-none drop-shadow-md select-none group-hover:fill-white font-sans transition-colors"
                    >
                      {s.stopName}
                    </text>
                  )}
                </g>
              );
            })}

            {/* DRAW TRAINS */}
            {activeTrains.map(train => {
              const x = projectX(train.longitude);
              const y = projectY(train.latitude);
              const color = LINE_DETAILS[train.routeId]?.color || '#fff';
              const isSelected = selectedTrainId === train.id;
              const isPinned = pinnedTrainId === train.id;
              const heading = getTrainHeading(train);

              return (
                <g
                  key={`train-${train.id}`}
                  className="cursor-pointer group"
                  onClick={() => {
                    setSelectedTrainId(train.id);
                    setSelectedStationId(null);
                  }}
                  onMouseEnter={() => {
                    setHoveredEntity({
                      type: 'train',
                      name: `Tren ${train.id}`,
                      detail: `${train.status === 'STOPPED' ? 'Detenido en' : 'Rumbo a'} ${train.nextStopName} (ETA: ${Math.round(train.etaSeconds / 60)}m)`,
                      x: x,
                      y: y - 12
                    });
                  }}
                  onMouseLeave={() => setHoveredEntity(null)}
                >
                  <g transform={`translate(${x}, ${y})`}>
                    {/* Active Tracking Ring (rotating dashed circle) */}
                    {isPinned && (
                      <circle
                        cx={0}
                        cy={0}
                        r={15}
                        fill="none"
                        stroke={color}
                        strokeWidth={2}
                        strokeDasharray="4 2"
                        className="animate-spin"
                        style={{ animationDuration: '6s' }}
                      />
                    )}

                    {/* Selection Ring (steady highlight) */}
                    {isSelected && !isPinned && (
                      <circle
                        cx={0}
                        cy={0}
                        r={14}
                        fill="none"
                        stroke="#fff"
                        strokeWidth={1.5}
                      />
                    )}

                    {/* Rotated subgroup for direction indicator nose, circle and inner chevron */}
                    <g transform={`rotate(${heading})`}>
                      {/* Directional nose pointing forward */}
                      <polygon
                        points="8.5,-4 13.5,0 8.5,4"
                        fill={color}
                      />

                      {/* Main Train Dot */}
                      <circle
                        cx={0}
                        cy={0}
                        r={9.5}
                        fill="#090d16"
                        stroke={color}
                        strokeWidth={3}
                        filter="url(#train-glow)"
                        className="group-hover:scale-110 transition-transform duration-200"
                      />

                      {/* Inner Direction Chevron */}
                      <path
                        d="M-3,-4.5 L2.5,0 L-3,4.5 L-1.2,0 Z"
                        fill={color}
                      />
                    </g>

                    {/* Upright Train ID text */}
                    <text
                      x={0}
                      y={-17}
                      fill={isPinned ? '#fff' : color}
                      fontSize="10"
                      fontWeight="black"
                      textAnchor="middle"
                      className="pointer-events-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] font-mono tracking-tight"
                    >
                      {train.id}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* SVG Tooltip Overlay */}
            {hoveredEntity && (
              <g
                transform={`translate(${hoveredEntity.x}, ${hoveredEntity.y - 12})`}
                className="pointer-events-none transition-all duration-150"
              >
                {/* Tooltip Background */}
                <rect
                  x="-100"
                  y="-50"
                  width="200"
                  height="45"
                  rx="10"
                  fill="#0b0f19"
                  stroke="#334155"
                  strokeWidth="1.5"
                  opacity="0.95"
                  filter="url(#neon-glow)"
                />
                
                {/* Icon indicator dot */}
                <circle
                  cx="-86"
                  cy="-34"
                  r="3.5"
                  fill={hoveredEntity.type === 'train' ? '#6366f1' : '#06b6d4'}
                />

                {/* Title */}
                <text
                  x="-76"
                  y="-31"
                  fill="#f8fafc"
                  fontSize="9"
                  fontWeight="900"
                  fontFamily="sans-serif"
                  letterSpacing="0.5"
                >
                  {hoveredEntity.name.toUpperCase()}
                </text>

                {/* Detail */}
                <text
                  x="-86"
                  y="-15"
                  fill="#94a3b8"
                  fontSize="8"
                  fontWeight="600"
                  fontFamily="sans-serif"
                >
                  {hoveredEntity.detail}
                </text>
              </g>
            )}
          </svg>
        </div>

        {/* FLOATING LINE SELECTOR - Top Center */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex gap-1.5 p-1.5 rounded-2xl bg-slate-900/65 backdrop-blur-xl border border-slate-800/80 shadow-2xl">
          <button
            onClick={() => {
              setActiveLine('All');
              setSelectedStationId(null);
              setSelectedTrainId(null);
              setPinnedTrainId(null);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition uppercase ${
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
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
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
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
          <div className="bg-slate-900/65 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-3.5 shadow-2xl w-48 text-left">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Formaciones</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl font-black text-slate-200">{activeTrains.length}</span>
              <span className="text-xs text-slate-500 font-bold">activas</span>
            </div>
          </div>

          <div className="bg-slate-900/65 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-3.5 shadow-2xl w-48 text-left">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Demora Promedio</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-lg font-black text-slate-200">
                {averageDelay > 0 ? `${Math.round(averageDelay / 60)}m ${averageDelay % 60}s` : '0s'}
              </span>
            </div>
          </div>

          {delayedTrains.length > 0 && (
            <div className="bg-rose-950/40 backdrop-blur-xl border border-rose-900/40 rounded-2xl p-3 shadow-2xl w-48 text-left">
              <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest block flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping"></span>
                Demoradas
              </span>
              <span className="text-lg font-black text-rose-300 mt-0.5 block">{delayedTrains.length} formación</span>
            </div>
          )}
        </div>

        {/* FLOATING STATION DETAILS / COMPACT REPORT PANEL - Bottom Right */}
        {selectedStationId && (
          <div className="absolute bottom-4 right-4 z-10 w-80 bg-slate-900/85 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 shadow-2xl flex flex-col gap-3.5 text-left">
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
            <div className="absolute bottom-4 right-4 z-10 w-80 bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 shadow-2xl flex flex-col gap-3.5 text-left transition-all animate-in fade-in slide-in-from-bottom-5 duration-200">
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
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 rounded-full bg-indigo-950/80 border border-indigo-500/30 backdrop-blur-md shadow-lg shadow-indigo-950/30">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
            <span className="text-xs font-bold text-indigo-200">
              Siguiendo formación <span className="font-mono font-black">{pinnedTrain.id}</span> ({LINE_DETAILS[pinnedTrain.routeId]?.name})
            </span>
            <button
              onClick={() => setPinnedTrainId(null)}
              className="text-[10px] font-black text-indigo-300 hover:text-white px-2 py-0.5 rounded bg-indigo-900/50 border border-indigo-700/30 transition uppercase"
            >
              Liberar
            </button>
          </div>
        )}

        {/* FLOATING SERVICE ALERTS - Bottom Left */}
        <div className="absolute bottom-4 left-4 z-10 w-80 max-h-48 overflow-y-auto bg-slate-900/65 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-4 shadow-2xl text-left">
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
