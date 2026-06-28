'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { Map as LeafletMap, Marker, Polyline, LayerGroup, DivIcon } from 'leaflet';
import { LINE_META, type LineId } from '../lines';
import { classNames, formatEta, lineShort } from '../utils';
import { Icon } from '../Icon';
import type { Station, RouteSequence } from '../types';
import type { TrainTelemetry } from '@/lib/telemetry';
import { LINE_SHAPES } from '@/lib/shapes';
import { SUBTE_LINES_GEOM } from '@/lib/metadata_extended';

interface Props {
  stations: Station[];
  sequences: RouteSequence[];
  telemetry: { trains: TrainTelemetry[]; alerts: unknown[]; predictions: unknown[] };
  activeLine: LineId | 'All';
  setActiveLine: (l: LineId | 'All') => void;
  visibleLines: LineId[];
  trainsByLine: Record<string, TrainTelemetry[]>;
}

export function MapScreen({ stations, sequences, telemetry, activeLine, setActiveLine, visibleLines, trainsByLine }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const mapUserMovedRef = useRef(false);
  const isProgrammaticMoveRef = useRef(false);
  const [mapUserMoved, setMapUserMoved] = useState(false);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [selectedTrain, setSelectedTrain] = useState<TrainTelemetry | null>(null);
  const [pinnedTrainId, setPinnedTrainId] = useState<string | null>(null);
  const trainMarkersRef = useRef<Map<string, Marker>>(new Map());
  const stationsGroupRef = useRef<LayerGroup | null>(null);
  const tracksGroupRef = useRef<LayerGroup | null>(null);
  const trainsGroupRef = useRef<LayerGroup | null>(null);

  // Active lines for the map — always ALL rendered but emphasized by activeLine.
  const activeLines = useMemo(() => {
    if (activeLine === 'All') return Object.keys(LINE_META);
    return [activeLine];
  }, [activeLine]);

  // ----- Init map -----
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;
    const container = mapContainerRef.current;
    if ((container as unknown as { _leaflet_id?: number })._leaflet_id) return;

    let isMounted = true;

    import('leaflet').then(L => {
      if (!isMounted) return;
      if (mapInstanceRef.current) return;
      if ((container as unknown as { _leaflet_id?: number })._leaflet_id) return;

      const map = L.map(container, {
        center: [-34.6037, -58.3816],
        zoom: 13,
        zoomControl: false,
        attributionControl: true,
        preferCanvas: true,
      });
      mapInstanceRef.current = map;

      // Carto dark tiles — they pair perfectly with the dark theme.
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '© OSM · © CARTO',
        subdomains: 'abcd',
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

      // Fit bounds on first ready
      map.whenReady(() => {
        const latlngs: [number, number][] = stations.map(s => [s.latitude, s.longitude]);
        if (latlngs.length) {
          isProgrammaticMoveRef.current = true;
          map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], animate: false });
          setTimeout(() => { isProgrammaticMoveRef.current = false; }, 600);
        }
      });
    });

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Draw lines + stations -----
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !tracksGroupRef.current || !stationsGroupRef.current) return;
    let isMounted = true;
    import('leaflet').then(L => {
      if (!isMounted) return;
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

      // Render active lines
      activeLines.forEach(lineId => {
        const points = LINE_SHAPES[lineId];
        if (points && points.length > 1) {
          L.polyline(points, {
            color: LINE_META[lineId as LineId]?.color || '#82cfff',
            weight: activeLine === 'All' ? 4 : 7,
            opacity: activeLine === 'All' ? 0.75 : 1,
            lineCap: 'round',
            lineJoin: 'round',
          }).addTo(tracksGroupRef.current!);
        }
      });

      // Stations of the active line
      const activeSeqs = sequences.filter(s => activeLines.includes(s.routeId));
      const activeStopIds = new Set(activeSeqs.map(s => s.stopId));
      const activeStations = stations.filter(s => activeStopIds.has(s.stopId));

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
          <div style="position:relative;width:18px;height:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
            <span style="position:absolute;width:18px;height:18px;border-radius:50%;background:${isSelected ? lineColor : 'rgba(20,20,20,0.85)'};border:2px solid ${lineColor};box-shadow:${isSelected ? `0 0 0 4px ${lineColor}33, 0 4px 10px rgba(0,0,0,0.6)` : '0 2px 6px rgba(0,0,0,0.5)'};transition:all 200ms;"></span>
          </div>
        `;
        const marker: Marker = L.marker([first.latitude, first.longitude], {
          icon: L.divIcon({ className: 'custom-station-icon', html, iconSize: [18, 18], iconAnchor: [9, 9] }),
        });
        marker.on('click', () => {
          setSelectedStation(first);
          setSelectedTrain(null);
        });
        marker.addTo(stationsGroupRef.current!);
      });
    });
    return () => { isMounted = false; };
  }, [activeLine, activeLines, sequences, stations, selectedStation?.stopId]);

  // ----- Draw trains -----
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !trainsGroupRef.current) return;
    let isMounted = true;
    import('leaflet').then(L => {
      if (!isMounted) return;
      const activeTrainIds = new Set(telemetry.trains.map(t => t.id));

      // Remove gone
      for (const [id, marker] of trainMarkersRef.current.entries()) {
        if (!activeTrainIds.has(id)) {
          marker.remove();
          trainMarkersRef.current.delete(id);
        }
      }

      telemetry.trains.forEach(train => {
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

        const html = `
          <div style="position:relative;width:30px;height:30px;display:flex;align-items:center;justify-content:center;cursor:pointer;transform:rotate(${heading}deg);">
            ${ring}
            <div style="position:relative;width:22px;height:22px;border-radius:6px;background:${color};border:1.5px solid rgba(255,255,255,0.4);box-shadow:0 0 0 2px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.5), ${isSelected ? `0 0 12px ${color}AA` : ''};display:flex;align-items:center;justify-content:center;${glow}">
              <span style="color:#fff;font-size:9px;font-weight:900;font-family:monospace;">${lineShort(train.routeId)}</span>
            </div>
            ${train.status === 'STOPPED' ? `<span style="position:absolute;top:-3px;right:-3px;width:8px;height:8px;background:#00aeef;border-radius:50%;box-shadow:0 0 0 2px #131313, 0 0 8px #00aeef;animation:pulse 1.4s ease-in-out infinite;"></span>` : ''}
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
    });
    return () => { isMounted = false; };
  }, [telemetry.trains, selectedTrain?.id, pinnedTrainId, stations]);

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
    const t = setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize({ animate: false });
      }
    }, 120);
    return () => clearTimeout(t);
  }, []);

  const handleResetMap = useCallback(() => {
    if (!mapInstanceRef.current) return;
    mapUserMovedRef.current = false;
    setMapUserMoved(false);
    const latlngs: [number, number][] = stations.map(s => [s.latitude, s.longitude]);
    isProgrammaticMoveRef.current = true;
    mapInstanceRef.current.fitBounds((window as any).L.latLngBounds(latlngs), {
      padding: [40, 40],
      animate: true,
    });
    setTimeout(() => { isProgrammaticMoveRef.current = false; }, 500);
  }, [stations]);

  const visibleTrains = telemetry.trains.filter(t => activeLines.includes(t.routeId));
  const upcomingForStation = useMemo(() => {
    if (!selectedStation) return [];
    return telemetry.trains
      .filter(t => t.nextStopId === selectedStation.stopId || t.prevStopId === selectedStation.stopId)
      .sort((a, b) => a.etaSeconds - b.etaSeconds)
      .slice(0, 4);
  }, [selectedStation, telemetry.trains]);

  return (
    <div className="flex h-full flex-col">
      {/* Map header — line filter chips, scrollable on mobile */}
      <div className="px-3 md:px-5 py-3 border-b border-outline-variant/10 bg-surface-container-lowest/60 backdrop-blur-md">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none -mx-1 px-1">
          <button
            onClick={() => setActiveLine('All')}
            className={classNames(
              'pill-chip shrink-0',
              activeLine === 'All' && 'pill-chip-active'
            )}
          >
            <Icon.Eye size={14} />
            Todas
          </button>
          {Object.values(LINE_META).map(line => {
            const count = trainsByLine[line.id]?.length ?? 0;
            return (
              <button
                key={line.id}
                onClick={() => setActiveLine(line.id)}
                className={classNames(
                  'pill-chip shrink-0',
                  activeLine === line.id && 'pill-chip-active'
                )}
                style={activeLine === line.id ? { background: line.color, color: '#fff', borderColor: line.color } : {}}
              >
                <span className="line-badge" style={{ background: line.color, width: 18, height: 18, fontSize: 9 }}>
                  {lineShort(line.id)}
                </span>
                {line.short}
                <span className="text-[9px] font-mono opacity-80">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Map */}
      <div className="relative flex-1 min-h-[280px]">
        <div ref={mapContainerRef} className="absolute inset-0 z-0" />
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
                  {selectedTrain.status === 'STOPPED' ? 'En andén' : 'En viaje a'} <strong className="text-on-background">{selectedTrain.nextStopName}</strong>
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
