'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { Map as LeafletMap, Marker, Polyline, LayerGroup, DivIcon } from 'leaflet';
// Leaflet JS is safe to statically import here — the entire component is
// loaded via next/dynamic({ssr:false}) which excludes it from SSR.
import L from 'leaflet';
import { LINE_META, ALL_LINE_IDS, type LineId } from '../lines';
import { classNames, formatEta, lineShort } from '../utils';
import { Icon } from '../Icon';
import type { Station, RouteSequence, ReportItem } from '../types';
import type { TrainTelemetry } from '@/lib/telemetry';
import { LINE_SHAPES } from '@/lib/shapes';
import { SUBTE_LINES_GEOM } from '@/lib/metadata_extended';
import { SAFETY_ZONES, type SafetyZone, getSafetyZonesForStation } from '@/lib/safety_zones';

interface Props {
  stations: Station[];
  sequences: RouteSequence[];
  telemetry: { trains: TrainTelemetry[]; alerts: unknown[]; predictions: unknown[] };
  activeLine: LineId | 'All';
  setActiveLine: (l: LineId | 'All') => void;
  visibleLines: LineId[];
  trainsByLine: Record<string, TrainTelemetry[]>;
  userReports: ReportItem[];
}

function arrowSvgIcon(color: string, directionId: number, size = 28): string {
  const flip = directionId === 0 ? '' : 'scale(-1,1)';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" style="transform:${flip};filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6))">
    <path d="M4 2 L20 12 L4 22 Z" fill="${color}"/>
    <path d="M8 6 L16 12 L8 18 Z" fill="rgba(255,255,255,0.25)"/>
  </svg>`;
}

export function MapScreen({ stations, sequences, telemetry, activeLine, setActiveLine, visibleLines, trainsByLine, userReports }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const mapUserMovedRef = useRef(false);
  const isProgrammaticMoveRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [mapUserMoved, setMapUserMoved] = useState(false);
  const [showSafetyZones, setShowSafetyZones] = useState(true);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [selectedTrain, setSelectedTrain] = useState<TrainTelemetry | null>(null);
  const [pinnedTrainId, setPinnedTrainId] = useState<string | null>(null);
  const trainMarkersRef = useRef<Map<string, Marker>>(new Map());
  const stationsGroupRef = useRef<LayerGroup | null>(null);
  const tracksGroupRef = useRef<LayerGroup | null>(null);
  const trainsGroupRef = useRef<LayerGroup | null>(null);
  const reportsGroupRef = useRef<LayerGroup | null>(null);
  const safetyGroupRef = useRef<LayerGroup | null>(null);

  // ----- Init map -----
  useEffect(() => {
    // Ensure Leaflet CSS is loaded (for Vercel production, @import in globals.css may not resolve)
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    if (mapInstanceRef.current) return;
    const container = mapContainerRef.current;
    if (!container) return;
    if ((container as unknown as { _leaflet_id?: number })._leaflet_id) return;

    try {
    const map = L.map(container, {
      center: [-34.6037, -58.3816],
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    });
    mapInstanceRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
      className: 'dark-tiles',
    }).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);

    const handleUserInteraction = () => {
      if (isProgrammaticMoveRef.current) return;
      if (!mapUserMovedRef.current) {
        mapUserMovedRef.current = true;
        setMapUserMoved(true);
      }
    };
    map.on('dragend zoomend movestart', handleUserInteraction);
    map.on('zoomstart movestart', () => container.classList.add('map-zooming'));
    map.on('zoomend moveend', () => container.classList.remove('map-zooming'));

    stationsGroupRef.current = L.layerGroup().addTo(map);
    tracksGroupRef.current = L.layerGroup().addTo(map);
    trainsGroupRef.current = L.layerGroup().addTo(map);
    reportsGroupRef.current = L.layerGroup().addTo(map);
    safetyGroupRef.current = L.layerGroup().addTo(map);

    // Fit bounds on first ready
    map.whenReady(() => {
      const latlngs: [number, number][] = stations.map(s => [s.latitude, s.longitude]);
      if (latlngs.length) {
        isProgrammaticMoveRef.current = true;
        map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], animate: false });
        setTimeout(() => { isProgrammaticMoveRef.current = false; }, 600);
      }
    });

    setMapReady(true);
    } catch (err) {
      console.error('[MapScreen] Map init threw:', err);
      setMapError(true);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  // ----- Draw lines + stations -----
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !tracksGroupRef.current || !stationsGroupRef.current) return;
    function draw() {
      tracksGroupRef.current!.clearLayers();
      stationsGroupRef.current!.clearLayers();

      // Underlay physical tracks for context
      SUBTE_LINES_GEOM.forEach(t => {
        L.polyline(t.coords, {
          color: '#1f2937',
          weight: 2.5,
          opacity: 0.4,
          dashArray: '4 6',
        }).addTo(tracksGroupRef.current!);
      });

      // Render only selected line's track
      const drawLineIds: LineId[] = activeLine === 'All'
        ? ALL_LINE_IDS
        : ([activeLine] as LineId[]);
      drawLineIds.forEach((lineId: LineId) => {
        const points = LINE_SHAPES[lineId];
        if (points && points.length > 1) {
          L.polyline(points, {
            color: LINE_META[lineId as LineId]?.color || '#82cfff',
            weight: activeLine === 'All' ? 5 : 9,
            opacity: activeLine === 'All' ? 0.9 : 1,
            lineCap: 'round',
            lineJoin: 'round',
          }).addTo(tracksGroupRef.current!);
        }
      });

      // Stations of the selected line only (or all if 'All')
      const activeStations = activeLine === 'All'
        ? stations
        : stations.filter(s =>
            sequences.some(seq => seq.stopId === s.stopId && seq.routeId === activeLine)
          );

      // Group by name to show one marker per name, with line badges
      const byName = new Map<string, Station[]>();
      activeStations.forEach(s => {
        if (!byName.has(s.stopName)) byName.set(s.stopName, []);
        byName.get(s.stopName)!.push(s);
      });

      byName.forEach(group => {
        const first = group[0];
        if (!first) return;
        const passingLineIds = Array.from(
          new Set(
            group
              .map(s => sequences.find(seq => seq.stopId === s.stopId)?.routeId)
              .filter((id): id is LineId => !!id)
          )
        );

        const isSelected = group.some(s => s.stopId === selectedStation?.stopId);
        const lineColor = LINE_META[passingLineIds[0] as LineId]?.color || '#82cfff';

        const html = `
          <div style="position:relative;width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
            <span style="position:absolute;width:26px;height:26px;border-radius:50%;background:${isSelected ? lineColor : 'rgba(20,20,20,0.85)'};border:3px solid ${lineColor};box-shadow:${isSelected ? `0 0 0 6px ${lineColor}44, 0 4px 14px rgba(0,0,0,0.7)` : '0 2px 8px rgba(0,0,0,0.6)'};transition:all 200ms;"></span>
          </div>
        `;
        const marker: Marker = L.marker([first.latitude, first.longitude], {
          icon: L.divIcon({ className: 'custom-station-icon', html, iconSize: [26, 26], iconAnchor: [13, 13] }),
        });
        marker.on('click', () => {
          setSelectedStation(first);
          setSelectedTrain(null);
        });
        marker.addTo(stationsGroupRef.current!);
      });
    }
    draw();
  }, [activeLine, sequences, stations, selectedStation?.stopId]);

  // ----- Draw report markers -----
  useEffect(() => {
    if (!mapInstanceRef.current || !reportsGroupRef.current) return;
    const group = reportsGroupRef.current;
    group.clearLayers();

    // Filter stations for active line
    const activeStations = activeLine === 'All'
      ? stations
      : stations.filter(s => sequences.some(seq => seq.stopId === s.stopId && seq.routeId === activeLine));

    // Group by name (one marker per station name)
    const reportsByName = new Map<string, ReportItem[]>();
    userReports.forEach(r => {
      if (!reportsByName.has(r.station)) reportsByName.set(r.station, []);
      reportsByName.get(r.station)!.push(r);
    });

    const byName = new Map<string, Station[]>();
    activeStations.forEach(s => {
      if (!byName.has(s.stopName)) byName.set(s.stopName, []);
      byName.get(s.stopName)!.push(s);
    });

    byName.forEach((groupStations, name) => {
      const reports = reportsByName.get(name);
      if (!reports?.length) return;
      const first = groupStations[0];
      if (!first) return;
      // Offset alert icon slightly above the station marker
      const offset = 0.0012; // ~120m
      const icon = L.divIcon({
        className: '',
        html: `<div style="position:relative;width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5));" title="${reports.map(r => r.category).join(', ')}">⚠</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const marker = L.marker([first.latitude + offset, first.longitude], { icon });
      const detailHtml = reports.map(r =>
        `<div style="margin-bottom:6px;border-bottom:1px solid #333;padding-bottom:4px;">
          <strong style="color:#f59e0b;">${r.category}</strong>
          <span style="color:#888;font-size:11px;margin-left:8px;">${r.line}</span>
          <p style="margin:4px 0 0;font-size:13px;color:#ccc;">${r.comment || ''}</p>
        </div>`
      ).join('');
      marker.bindPopup(`<div style="min-width:200px;color:#e0e0e0;font-family:sans-serif;"><h4 style="margin:0 0 6px;color:#fff;">${name}</h4>${detailHtml}</div>`);
      marker.addTo(group);
    });

    return () => { group.clearLayers(); };
  }, [userReports, stations, sequences, activeLine]);

  // ----- Draw safety / danger zones (Urban Corridors / Street Blocks) -----
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !safetyGroupRef.current) return;
    const group = safetyGroupRef.current;
    group.clearLayers();

    if (!showSafetyZones) return;

    // Filter zones by active line if not 'All'
    const activeZones = activeLine === 'All'
      ? SAFETY_ZONES
      : SAFETY_ZONES.filter(z => z.lines.includes(activeLine as LineId));

    activeZones.forEach(zone => {
      // 1. Polygon representing urban street block / corridor
      const polygon = L.polygon(zone.polygon, {
        color: '#ef4444',
        fillColor: '#ef4444',
        fillOpacity: 0.18,
        weight: 1.8,
        dashArray: '4 4',
        lineJoin: 'round',
        lineCap: 'round',
      });

      // 2. Interactive danger beacon in the zone center
      const icon = L.divIcon({
        className: 'custom-station-icon',
        html: `
          <div style="position:relative;width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;" title="Zona de riesgo: ${zone.name}">
            <span class="safety-zone-beacon" style="position:absolute;width:26px;height:26px;border-radius:50%;background:rgba(239,68,68,0.25);border:1.5px solid #ef4444;"></span>
            <span style="position:relative;width:10px;height:10px;border-radius:50%;background:#ef4444;box-shadow:0 0 10px #ef4444;"></span>
          </div>
        `,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });

      const marker = L.marker(zone.center, { icon });

      const popupHtml = `
        <div style="font-family:Inter,system-ui;min-width:240px;max-width:290px;padding:4px 2px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;">
            <span style="background:${zone.riskLevel === 'CRITICO' ? '#991b1b' : '#7f1d1d'};color:#fecaca;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;letter-spacing:0.5px;">
              ⚠️ ${zone.riskLevel === 'CRITICO' ? 'ZONA CRÍTICA' : 'PRECAUCIÓN'}
            </span>
            <span style="color:#ef4444;font-size:10px;font-weight:700;text-transform:uppercase;">Robos de Subte</span>
          </div>
          <h4 style="margin:0 0 3px;font-size:13px;font-weight:700;color:#fff;">${zone.name}</h4>
          <p style="margin:0 0 6px;font-size:11px;color:#94a3b8;font-style:italic;">📍 ${zone.corridor}</p>
          <p style="margin:0 0 8px;font-size:11px;color:#f87171;font-weight:600;line-height:1.35;">${zone.primaryRisk}</p>
          
          <div style="margin-bottom:8px;background:rgba(255,255,255,0.04);border-radius:6px;padding:6px;">
            <div style="font-size:10px;font-weight:700;color:#cbd5e1;text-transform:uppercase;margin-bottom:3px;">Modalidades habituales:</div>
            <ul style="margin:0;padding-left:14px;font-size:11px;color:#cbd5e1;line-height:1.4;">
              ${zone.modalities.map(m => `<li>${m}</li>`).join('')}
            </ul>
          </div>

          <div style="background:rgba(239,68,68,0.12);border-left:3px solid #ef4444;border-radius:4px;padding:5px 7px;">
            <div style="font-size:10px;font-weight:700;color:#fca5a5;text-transform:uppercase;">Consejo de prevención:</div>
            <p style="margin:2px 0 0;font-size:11px;color:#fecaca;line-height:1.35;">${zone.tips[0]}</p>
          </div>
          ${zone.hotTimes ? `<div style="margin-top:6px;font-size:10px;color:#94a3b8;text-align:right;">⏰ ${zone.hotTimes}</div>` : ''}
        </div>
      `;

      polygon.bindPopup(popupHtml);
      marker.bindPopup(popupHtml);

      polygon.addTo(group);
      marker.addTo(group);
    });

    return () => {
      group.clearLayers();
    };
  }, [showSafetyZones, activeLine]);

  // ----- Draw trains -----
  useEffect(() => {
    if (!mapReady) return;
    const map = mapInstanceRef.current;
    if (!map || !trainsGroupRef.current) return;
    const filteredTrains = activeLine === 'All'
      ? telemetry.trains
      : telemetry.trains.filter(t => t.routeId === activeLine);
    const activeTrainIds = new Set(filteredTrains.map(t => t.id));

      // Remove gone
      for (const [id, marker] of trainMarkersRef.current.entries()) {
        if (!activeTrainIds.has(id)) {
          marker.remove();
          trainMarkersRef.current.delete(id);
        }
      }

      filteredTrains.forEach(train => {
        const color = LINE_META[train.routeId as LineId]?.color || '#82cfff';
        const isSelected = selectedTrain?.id === train.id;
        const isPinned = pinnedTrainId === train.id;

        // Rotation: compute heading from prev→next station if available.
        let heading = train.directionId === 0 ? 0 : 180;
        if (train.prevStopId && train.nextStopId) {
          const prev = stations.find(s => s.stopId === train.prevStopId);
          const next = stations.find(s => s.stopId === train.nextStopId);
          if (prev && next) {
            const dx = next.longitude - prev.longitude;
            const dy = next.latitude - prev.latitude;
            if (Math.abs(dx) > 0.00001 || Math.abs(dy) > 0.00001) {
              heading = -Math.atan2(dy, dx) * (180 / Math.PI);
            }
          }
        }

        const ring = isPinned ? `
          <div style="position:absolute;inset:-6px;border:2px dashed ${color};border-radius:50%;animation:ringRotate 6s linear infinite;"></div>
        ` : '';
        const glow = isSelected ? `box-shadow:0 0 0 4px ${color}55;` : '';

        const isStopped = train.status === 'STOPPED';
        const opacity = isStopped ? 0.75 : 1;
        const trainW = isStopped ? 24 : 32;
        const html = `
          <div style="position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center;cursor:pointer;transform:rotate(${heading}deg);opacity:${opacity};transition:opacity 300ms;">
            ${ring}
            <div style="position:relative;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 0 4px rgba(0,0,0,0.7)) ${isSelected ? `drop-shadow(0 0 8px ${color}88)` : ''};">
              ${arrowSvgIcon(color, train.directionId, trainW)}
            </div>
            ${isStopped ? `<span style="position:absolute;bottom:-1px;left:50%;margin-left:-5px;width:10px;height:10px;background:#00f0ff;border-radius:50%;box-shadow:0 0 0 2px #131313, 0 0 10px #00f0ff;animation:pulse 1.4s ease-in-out infinite;"></span>` : ''}
          </div>
        `;
        const icon: DivIcon = L.divIcon({
          className: 'custom-train-icon',
          html,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });

        const etaMin = Math.max(0, Math.floor(train.etaSeconds / 60));
        const tooltip = `
          <div style="font-family:Inter,system-ui;font-size:11px;">
            <div style="font-weight:700;color:${color};">${LINE_META[train.routeId as LineId]?.name ?? train.routeId}</div>
            <div style="color:#e5e2e1;font-weight:600;">${train.id}</div>
            <div style="color:#bdc8d1;margin-top:2px;">${train.status === 'STOPPED' ? 'En andén' : '→'} ${train.nextStopName}</div>
            <div style="color:#82cfff;font-weight:700;margin-top:2px;">${formatEta(train.etaSeconds)}</div>
          </div>
        `;

        let marker = trainMarkersRef.current.get(train.id);
        if (marker) {
          marker.setLatLng([train.latitude, train.longitude]);
          marker.setIcon(icon);
          marker.setTooltipContent(tooltip);
        } else {
          marker = L.marker([train.latitude, train.longitude], { icon, zIndexOffset: 1000 })
            .addTo(trainsGroupRef.current!);
          marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -8], opacity: 0.96 });
          marker.on('click', () => {
            setSelectedTrain(train);
            setSelectedStation(null);
          });
          trainMarkersRef.current.set(train.id, marker);
        }
      });
  }, [activeLine, telemetry.trains, selectedTrain?.id, pinnedTrainId, stations, mapReady]);

  // Track pinned train
  useEffect(() => {
    if (!mapInstanceRef.current || !pinnedTrainId || mapUserMovedRef.current) return;
    const train = telemetry.trains.find(t => t.id === pinnedTrainId);
    if (!train) return;
    const map = mapInstanceRef.current;
    const zoom = map.getZoom() || 14;
    isProgrammaticMoveRef.current = true;
    map.setView([train.latitude, train.longitude], zoom, { animate: true });
    setTimeout(() => { isProgrammaticMoveRef.current = false; }, 500);
  }, [telemetry.trains, pinnedTrainId]);

  // Invalidate size on tab swap (CLAUDE.md mandate)
  useEffect(() => {
    if (!mapReady) return;
    const t = setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize({ animate: false });
      }
    }, 120);
    return () => clearTimeout(t);
  }, [mapReady]);

  const handleResetMap = useCallback(() => {
    if (!mapInstanceRef.current) return;
    mapUserMovedRef.current = false;
    setMapUserMoved(false);
    const latlngs: [number, number][] = stations.map(s => [s.latitude, s.longitude]);
    isProgrammaticMoveRef.current = true;
    mapInstanceRef.current.fitBounds(L.latLngBounds(latlngs), {
      padding: [40, 40],
      animate: true,
    });
    setTimeout(() => { isProgrammaticMoveRef.current = false; }, 500);
  }, [stations]);

  const visibleTrains = telemetry.trains;
  const upcomingForStation = useMemo(() => {
    if (!selectedStation) return [];
    return telemetry.trains
      .filter(t => t.nextStopId === selectedStation.stopId || t.prevStopId === selectedStation.stopId)
      .sort((a, b) => a.etaSeconds - b.etaSeconds)
      .slice(0, 4);
  }, [selectedStation, telemetry.trains]);

  const stationSafetyZones = useMemo(() => {
    if (!selectedStation) return [];
    return getSafetyZonesForStation(selectedStation.stopName);
  }, [selectedStation]);

  return (
    <div className="flex h-full flex-col">
      {/* Map header — line filter chips, scrollable, touch-friendly */}
      <div className="px-2 md:px-5 py-2 md:py-3 border-b border-outline-variant/10 bg-surface-container-lowest/80 backdrop-blur-2xl">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none -mx-1 px-1">
          <button
            onClick={() => setActiveLine('All')}
            className={classNames(
              'shrink-0 flex items-center gap-1.5 px-3 py-2 md:py-1.5 rounded-full text-[11px] md:text-body-sm font-semibold transition-all active:scale-90',
              'border',
              activeLine === 'All'
                ? 'bg-primary-container text-on-primary-container border-primary-container shadow-[0_0_0_1px_var(--color-primary-container)]'
                : 'bg-surface-container/80 text-on-surface-variant border-outline-variant/20'
            )}
          >
            <Icon.Eye size={14} />
            Todas
          </button>
          {Object.values(LINE_META).map(line => {
            const count = trainsByLine[line.id]?.length ?? 0;
            const isActive = activeLine === line.id;
            return (
              <button
                key={line.id}
                onClick={() => setActiveLine(line.id)}
                className={classNames(
                  'shrink-0 flex items-center gap-1.5 px-3 py-2 md:py-1.5 rounded-full text-[11px] md:text-body-sm font-semibold transition-all active:scale-90',
                  'border',
                  isActive
                    ? 'text-white border-transparent shadow-sm'
                    : 'bg-surface-container/80 text-on-surface-variant border-outline-variant/20'
                )}
                style={isActive ? { background: line.color } : {}}
              >
                <span
                  className="flex items-center justify-center rounded-full text-[9px] font-black text-white shrink-0"
                  style={{ background: line.color, width: 18, height: 18 }}
                >
                  {lineShort(line.id)}
                </span>
                {line.short}
                <span className="text-[9px] font-mono opacity-70">{count}</span>
              </button>
            );
          })}

          {/* Safety zones toggle button */}
          <div className="flex items-center pl-1.5 shrink-0 border-l border-outline-variant/20 ml-1">
            <button
              onClick={() => setShowSafetyZones(v => !v)}
              className={classNames(
                'shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 md:py-1 rounded-full text-[11px] md:text-body-sm font-semibold transition-all active:scale-90 border',
                showSafetyZones
                  ? 'bg-error-container/40 text-error border-error/50 shadow-[0_0_8px_rgba(239,68,68,0.2)]'
                  : 'bg-surface-container/60 text-outline border-outline-variant/20 hover:text-on-surface'
              )}
              title={showSafetyZones ? 'Ocultar zonas de riesgo de robos' : 'Mostrar zonas de riesgo de robos'}
            >
              <Icon.Shield size={14} className={showSafetyZones ? 'text-error animate-pulse' : 'text-outline'} />
              <span>Seguridad</span>
              {showSafetyZones && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="relative flex-1 min-h-[280px]">
        {/* Container div — ALWAYS mounted, never unmounts. Leaflet attaches here. */}
        <div ref={mapContainerRef} className="absolute inset-0 z-0" />

        {mapError ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-surface-container-lowest p-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-error-container/20">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-error">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-title-sm text-on-surface mb-1">Error al cargar el mapa</p>
              <p className="text-body-sm text-outline mb-4 max-w-xs">
                No se pudo inicializar Leaflet. Verifica tu conexión o intenta recargar.
              </p>
              <button
                onClick={() => { setMapError(false); setRetryCount(c => c + 1); }}
                className="btn-primary text-sm"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                </svg>
                Reintentar
              </button>
            </div>
          </div>
        ) : !mapReady && !mapError ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 md:gap-4 map-skeleton-placeholder px-6">
              <div className="flex flex-col items-center gap-3 text-center">
                {mapReady ? (
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-container/60 ring-1 ring-outline-variant/10">
                    <svg className="animate-spin-slow text-primary/60" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                  </div>
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-container/60 ring-1 ring-outline-variant/10">
                    <svg className="animate-spin-slow text-primary/50" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M2 12h4" /><path d="M18 12h4" /><path d="M12 2v4" /><path d="M12 18v4" />
                      <path d="M4.93 4.93l2.83 2.83" /><path d="M16.24 16.24l2.83 2.83" />
                      <path d="M4.93 19.07l2.83-2.83" /><path d="M16.24 7.76l2.83-2.83" />
                    </svg>
                  </div>
                )}
                <div>
                  <p className="text-title-sm md:text-title-md text-on-surface mb-0.5">{mapReady ? 'Cargando formaciones' : 'Cargando mapa'}</p>
                  <p className="text-body-sm text-outline/60 max-w-[200px] mx-auto">{mapReady ? 'Esperando datos de los trenes en vivo' : 'Conectando con la red de Subte'}</p>
                </div>
              </div>
              {!mapReady && (
                <div className="w-40 md:w-48 h-[3px] rounded-full bg-surface-container-highest overflow-hidden">
                  <div className="h-full w-1/3 rounded-full bg-primary/50 animate-shimmer-bar" />
                </div>
              )}
            </div>
        ) : null}
        <div className="map-vignette" />

        {/* Recenter button — appears when user has moved the map */}
        {mapUserMoved && (
          <button
            onClick={handleResetMap}
            className="absolute top-3 left-3 z-20 glass-panel flex items-center gap-2 px-3 py-2 text-body-sm font-medium text-on-surface hover:bg-surface-container-high transition focus-ring"
            aria-label="Recentrar mapa"
          >
            <Icon.Compass size={14} />
            Recentrar
          </button>
        )}

        {/* Live trains counter (top-left, only when not moved) */}
        {!mapUserMoved && (
          <div className="absolute top-3 left-3 z-20 glass-panel px-3 py-2 flex items-center gap-2 text-body-sm">
            <span className="live-dot" />
            <span className="font-mono">
              <strong className="text-primary">{visibleTrains.length}</strong>
              <span className="text-on-surface-variant"> formaciones</span>
            </span>
          </div>
        )}
      </div>

      {/* Selection panel — station or train */}
      {(selectedStation || selectedTrain) && (
        <div className="border-t border-outline-variant/10 bg-surface-container-lowest/90 backdrop-blur-xl p-3 md:p-4 z-20 animate-fade-in">
          <div className="max-w-3xl mx-auto flex items-start gap-3">
            {selectedStation && (
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Icon.Pin size={14} className="text-primary shrink-0" />
                  <p className="text-label-caps text-outline tracking-widest">Estación</p>
                  <button
                    onClick={() => { setSelectedStation(null); setSelectedTrain(null); }}
                    className="ml-auto icon-btn !w-7 !h-7"
                    aria-label="Cerrar"
                  >
                    <Icon.X size={14} />
                  </button>
                </div>
                <h3 className="text-headline-sm font-bold text-on-background mt-0.5">{selectedStation.stopName}</h3>
                <div className="mt-2 flex gap-2 flex-wrap">
                  {Array.from(new Set(
                    sequences
                      .filter(s => s.stopId === selectedStation.stopId)
                      .map(s => s.routeId)
                  )).map((lineId: string) => (
                    <span key={lineId} className="line-badge" style={{ background: LINE_META[lineId as LineId]?.color }}>
                      {lineShort(lineId)}
                    </span>
                  ))}
                </div>

                {/* Safety / Insecurity Alert Card */}
                {stationSafetyZones.length > 0 && (
                  <div className="mt-2.5 p-2.5 rounded-lg bg-error-container/20 border border-error-container/40 flex items-start gap-2.5 animate-fade-in">
                    <div className="p-1 rounded bg-error/20 text-error shrink-0 mt-0.5">
                      <Icon.Shield size={16} />
                    </div>
                    <div className="flex-1 min-w-0 text-xs">
                      <div className="flex items-center gap-1.5 font-bold text-error">
                        <span>⚠️ Zona identificada de precaución / robos frecuentes</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-error-container/40 text-on-error-container font-mono">
                          {stationSafetyZones[0].riskLevel}
                        </span>
                      </div>
                      <p className="text-on-surface-variant mt-0.5 text-[11px] font-medium">{stationSafetyZones[0].primaryRisk}</p>
                      <p className="text-error/90 mt-1 font-semibold text-[11px]">
                        💡 Prevención: {stationSafetyZones[0].tips[0]}
                      </p>
                    </div>
                  </div>
                )}

                {upcomingForStation.length > 0 && (
                  <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                    {upcomingForStation.map(t => (
                      <div key={t.id} className="inner-card flex items-center gap-2 p-2.5">
                        <span className="line-badge shrink-0" style={{ background: LINE_META[t.routeId as LineId]?.color }}>
                          {lineShort(t.routeId)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-body-sm font-medium text-on-background truncate">{t.id}</p>
                          <p className="text-[10px] text-on-surface-variant truncate">→ {t.nextStopName}</p>
                        </div>
                        <span className="text-label font-mono text-primary shrink-0">{formatEta(t.etaSeconds)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {selectedTrain && (
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Icon.Train size={14} style={{ color: LINE_META[selectedTrain.routeId as LineId]?.color }} className="shrink-0" />
                  <p className="text-label-caps text-outline tracking-widest">Formación</p>
                  <button
                    onClick={() => { setSelectedStation(null); setSelectedTrain(null); }}
                    className="ml-auto icon-btn !w-7 !h-7"
                    aria-label="Cerrar"
                  >
                    <Icon.X size={14} />
                  </button>
                </div>
                <h3 className="text-headline-sm font-bold text-on-background mt-0.5 font-mono">
                  {selectedTrain.id} <span className="text-on-surface-variant text-body-md">·</span> {LINE_META[selectedTrain.routeId as LineId]?.name}
                </h3>
                <p className="text-body-sm text-on-surface-variant mt-1">
                  <span className="inline-flex items-center gap-1.5">
                    <span style={{ color: LINE_META[selectedTrain.routeId as LineId]?.color }} className="text-[13px] font-bold">
                      {selectedTrain.directionId === 0 ? '▶' : '◀'}
                    </span>
                    <strong className="text-on-background">{selectedTrain.nextStopName}</strong>
                    {selectedTrain.status !== 'STOPPED' && <span className="text-outline">· llegada {formatEta(selectedTrain.etaSeconds)}</span>}
                  </span>
                </p>
                <div className="mt-2 flex items-center gap-3 text-body-sm">
                  <span className="text-label-caps text-outline">Arribo</span>
                  <span className="font-mono font-bold text-primary">{formatEta(selectedTrain.etaSeconds)}</span>
                  {selectedTrain.delaySeconds > 0 && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-error-container/20 text-error">
                      +{Math.round(selectedTrain.delaySeconds / 60)}m demora
                    </span>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (pinnedTrainId === selectedTrain.id) setPinnedTrainId(null);
                    else {
                      setPinnedTrainId(selectedTrain.id);
                      mapUserMovedRef.current = false;
                      setMapUserMoved(false);
                    }
                  }}
                  className={classNames(
                    'mt-2.5 w-full rounded-md py-1.5 text-body-sm font-semibold transition flex items-center justify-center gap-1.5',
                    pinnedTrainId === selectedTrain.id
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-primary-container/15 text-primary border border-primary-container/30 hover:bg-primary-container/25'
                  )}
                >
                  <Icon.Eye size={14} />
                  {pinnedTrainId === selectedTrain.id ? 'Dejar de seguir' : 'Seguir formación'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
