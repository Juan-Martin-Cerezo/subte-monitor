'use client';

import { useState, useMemo } from 'react';
import type { Station, RouteSequence } from '../types';
import { LINE_META, MANUAL_TRANSFERS, type LineId, normalizeStationKey } from '../lines';
import { Icon } from '../Icon';
import { classNames, formatEta, lineShort } from '../utils';
import { ACCESSIBILITY_METADATA } from '@/lib/metadata';
import { ARTWORK_METADATA, PREMETRO_STATION_DETAILS } from '@/lib/metadata_extended';
import type { Prediction } from '@/lib/telemetry';

interface Props {
  stations: Station[];
  sequences: RouteSequence[];
  predictions: Prediction[];
}

export function StationsScreen({ stations, sequences, predictions }: Props) {
  const [search, setSearch] = useState('');
  const [lineFilter, setLineFilter] = useState<LineId | 'All'>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetailMobile, setShowDetailMobile] = useState(false);

  const filteredStations = useMemo(() => {
    let result = stations;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(s => s.stopName.toLowerCase().includes(q));
    }
    if (lineFilter !== 'All') {
      const validStopIds = new Set(sequences.filter(s => s.routeId === lineFilter).map(s => s.stopId));
      result = result.filter(s => validStopIds.has(s.stopId));
    }
    const seen = new Set<string>();
    return result
      .filter(s => { if (seen.has(s.stopName)) return false; seen.add(s.stopName); return true; })
      .sort((a, b) => a.stopName.localeCompare(b.stopName));
  }, [stations, sequences, search, lineFilter]);

  const selected = useMemo(
    () => stations.find(s => s.stopId === selectedId) ?? filteredStations[0] ?? null,
    [selectedId, stations, filteredStations]
  );

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* List */}
      <aside
        className={classNames(
          'w-full md:w-[380px] lg:w-[420px] shrink-0 flex flex-col border-r border-outline-variant/10 bg-surface-container-lowest/40',
          selected && showDetailMobile ? 'hidden md:flex' : 'flex'
        )}
      >
        <div className="p-4 border-b border-outline-variant/10 space-y-3">
          <div>
            <p className="text-label-caps text-outline tracking-widest">Subte Live</p>
            <h1 className="text-headline-md font-bold text-on-background mt-0.5">Estaciones</h1>
          </div>

          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-outline">
              <Icon.Search size={16} />
            </span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar estación…"
              className="w-full bg-surface-container-low border border-outline-variant/15 rounded-md pl-9 pr-3 py-2 text-body-sm text-on-background placeholder:text-outline focus-ring focus:border-primary-container"
              type="search"
            />
          </div>

          <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-1 px-1">
            <button
              onClick={() => setLineFilter('All')}
              className={classNames(
                'shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-semibold transition-all active:scale-90 border',
                lineFilter === 'All'
                  ? 'bg-primary-container text-on-primary-container border-primary-container'
                  : 'bg-surface-container/80 text-on-surface-variant border-outline-variant/20'
              )}
            >
              Todas
            </button>
            {Object.values(LINE_META).map(l => (
              <button
                key={l.id}
                onClick={() => setLineFilter(l.id)}
                className={classNames(
                  'shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-semibold transition-all active:scale-90 border',
                  lineFilter === l.id ? 'text-white border-transparent' : 'bg-surface-container/80 text-on-surface-variant border-outline-variant/20'
                )}
                style={lineFilter === l.id ? { background: l.color } : {}}
              >
                <span className="flex items-center justify-center rounded-full text-[9px] font-black text-white shrink-0" style={{ background: l.color, width: 18, height: 18 }}>
                  {lineShort(l.id)}
                </span>
                {l.short}
              </button>
            ))}
          </div>
        </div>

        <ul className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
          {filteredStations.length === 0 && (
            <li className="p-6 text-center text-on-surface-variant text-body-sm">Sin resultados.</li>
          )}
          {filteredStations.map(s => {
            const lines = Array.from(new Set(sequences.filter(seq => seq.stopId === s.stopId).map(seq => seq.routeId))) as LineId[];
            const isSel = selected?.stopId === s.stopId;
            return (
              <li key={s.stopId}>
                <button
                  onClick={() => { setSelectedId(s.stopId); setShowDetailMobile(true); }}
                  className={classNames(
                    'w-full text-left flex items-center gap-3 px-3 py-3 md:py-2.5 rounded-md transition focus-ring touch-target',
                    isSel ? 'bg-surface-container-high ring-1 ring-primary-container/30' : 'hover:bg-surface-container'
                  )}
                >
                  <span className="flex-1 min-w-0">
                    <p className={classNames(
                      'text-body-md font-semibold truncate',
                      isSel ? 'text-primary' : 'text-on-background'
                    )}>
                      {s.stopName}
                    </p>
                    <p className="text-[10px] text-outline font-mono uppercase tracking-wide truncate">
                      {s.stopId}
                    </p>
                  </span>
                  <div className="flex gap-0.5">
                    {lines.slice(0, 3).map(l => (
                      <span key={`l-${s.stopId}-${l}`} className="line-badge" style={{ background: LINE_META[l].color }}>
                        {lineShort(l)}
                      </span>
                    ))}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Detail */}
      <section
        className={classNames(
          'flex-1 min-w-0 overflow-y-auto p-4 md:p-6',
          selected && showDetailMobile ? 'block' : 'hidden md:block'
        )}
      >
        {selected ? (
          <StationDetail
            station={selected}
            sequences={sequences}
            stations={stations}
            predictions={predictions}
            onBack={() => setShowDetailMobile(false)}
          />
        ) : (
          <p className="text-center text-on-surface-variant mt-20">Seleccioná una estación.</p>
        )}
      </section>
    </div>
  );
}

function StationDetail({
  station, sequences, stations, predictions, onBack,
}: {
  station: Station;
  sequences: RouteSequence[];
  stations: Station[];
  predictions: Prediction[];
  onBack: () => void;
}) {
  const passingLines = Array.from(new Set(
    sequences.filter(s => s.stopId === station.stopId).map(s => s.routeId)
  )) as LineId[];

  const accessKey = normalizeStationKey(station.stopName);
  const access = ACCESSIBILITY_METADATA[accessKey];
  const artworks = ARTWORK_METADATA[accessKey] ?? [];
  const pmDetail = PREMETRO_STATION_DETAILS[accessKey];

  // Connections — stations on the same name or via manual transfers, on different lines.
  const connections = useMemo(() => {
    const here = station.stopName;
    const hereLines = new Set(passingLines);
    return stations.filter(s => {
      if (s.stopId === station.stopId) return false;
      const isSameName = s.stopName === here;
      const isManual = MANUAL_TRANSFERS[here]?.includes(s.stopName);
      if (!isSameName && !isManual) return false;
      const otherLines = sequences.filter(seq => seq.stopId === s.stopId).map(seq => seq.routeId);
      return otherLines.some(l => !hereLines.has(l as LineId));
    });
  }, [station, sequences, stations, passingLines]);

  const liveHere = useMemo(
    () => predictions
      .filter(p => p.stationName === station.stopName && p.etaSeconds >= 0 && p.etaSeconds < 1800)
      .sort((a, b) => a.etaSeconds - b.etaSeconds)
      .slice(0, 6),
    [predictions, station.stopName]
  );

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <button
          onClick={onBack}
          className="md:hidden flex items-center justify-center !w-10 !h-10 active:scale-90 transition-transform focus-ring"
          aria-label="Volver"
        >
          <Icon.Arrow size={20} className="rotate-180" />
        </button>
        <div className="flex-1">
          <p className="text-label-caps text-outline tracking-widest">Estación</p>
          <h1 className="text-headline-lg font-bold text-on-background tracking-tight mt-0.5">{station.stopName}</h1>
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {passingLines.map(l => (
              <span key={`pl-${l}`} className="pill-chip" style={{ background: LINE_META[l].color, color: '#fff', borderColor: LINE_META[l].color }}>
                <span className="font-bold">{lineShort(l)}</span>
                {LINE_META[l].name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Bento grid */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {/* Connections */}
        <div className="bento-card p-4 lg:col-span-1">
          <h3 className="text-title-sm font-bold text-on-background flex items-center gap-2 mb-3">
            <Icon.Transfer size={16} className="text-primary" />
            Conexiones
          </h3>
          {connections.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">Sin combinaciones con otras líneas.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {connections.map(c => {
                const cLines = Array.from(new Set(sequences.filter(s => s.stopId === c.stopId).map(s => s.routeId))) as LineId[];
                return (
                  <li key={c.stopId} className="inner-card p-2.5 flex items-center gap-2">
                    <span className="text-body-sm font-semibold text-on-background truncate flex-1">{c.stopName}</span>
                    <div className="flex gap-0.5">
                      {cLines.slice(0, 3).map(l => (
                        <span key={`cl-${c.stopId}-${l}`} className="line-badge" style={{ background: LINE_META[l].color }}>
                          {lineShort(l)}
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Accessibility */}
        <div className="bento-card p-4">
          <h3 className="text-title-sm font-bold text-on-background flex items-center gap-2 mb-3">
            <Icon.Accessibility size={16} className="text-primary" />
            Accesibilidad
          </h3>
          {access ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="inner-card p-3 text-center">
                <p className="text-data-lg font-bold text-primary">{access.ascensores}</p>
                <p className="text-label-caps text-outline mt-1">Ascensores</p>
              </div>
              <div className="inner-card p-3 text-center">
                <p className="text-data-lg font-bold text-primary">{access.escaleras}</p>
                <p className="text-label-caps text-outline mt-1">Escaleras mec.</p>
              </div>
            </div>
          ) : (
            <p className="text-body-sm text-on-surface-variant">Sin datos de accesibilidad registrados.</p>
          )}
        </div>

        {/* Live arrivals */}
        <div className="bento-card p-4 lg:col-span-1">
          <h3 className="text-title-sm font-bold text-on-background flex items-center gap-2 mb-3">
            <Icon.Clock size={16} className="text-primary" />
            Próximos arribos
          </h3>
          {liveHere.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">Sin arribos en los próximos 30 min.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-outline-variant/10">
              {liveHere.map((p, i) => (
                <li key={`a-${i}`} className="flex items-center gap-2 py-1.5">
                  <span className="line-badge" style={{ background: LINE_META[p.routeId as LineId]?.color }}>
                    {lineShort(p.routeId)}
                  </span>
                  <span className="text-body-sm text-on-background truncate flex-1">→ {p.destinationName}</span>
                  <span className="font-mono text-body-sm font-bold text-primary tabular-nums">{formatEta(p.etaSeconds)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Premetro details */}
        {pmDetail && (
          <div className="bento-card p-4 lg:col-span-3">
            <h3 className="text-title-sm font-bold text-on-background flex items-center gap-2 mb-3">
              <Icon.Compass size={16} className="text-orange-400" />
              Detalle Premetro
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
              {pmDetail.address && (
                <div>
                  <p className="text-label-caps text-outline">Dirección</p>
                  <p className="text-body-sm text-on-background">{pmDetail.address}</p>
                </div>
              )}
              {pmDetail.comuna && (
                <div>
                  <p className="text-label-caps text-outline">Comuna</p>
                  <p className="text-body-sm text-on-background">{pmDetail.comuna}</p>
                </div>
              )}
              {pmDetail.barrio && (
                <div>
                  <p className="text-label-caps text-outline">Barrio</p>
                  <p className="text-body-sm text-on-background">{pmDetail.barrio}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Artworks */}
        {artworks.length > 0 && (
          <div className="bento-card p-4 lg:col-span-3">
            <h3 className="text-title-sm font-bold text-on-background flex items-center gap-2 mb-3">
              <span className="text-primary">◆</span>
              Patrimonio Artístico ({artworks.length})
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {artworks.map((art, i) => (
                <article key={`art-${i}`} className="inner-card p-3">
                  <div className="flex justify-between items-start gap-2">
                    <h4 className="text-body-sm font-bold text-on-background leading-snug">{art.nombre || 'Sin título'}</h4>
                    {art.periodo && (
                      <span className="px-1.5 py-0.5 rounded bg-primary-container/15 text-primary text-[9px] font-bold font-mono shrink-0">
                        {art.periodo}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-primary font-bold font-mono mt-1">{art.artistas}</p>
                  {art.tecnica && (
                    <p className="text-[11px] text-on-surface-variant mt-1">
                      <span className="text-outline font-bold">Técnica:</span> {art.tecnica}
                    </p>
                  )}
                  {art.observaciones && (
                    <p className="text-[11px] text-on-surface-variant italic mt-1.5 border-l border-outline-variant/20 pl-2 leading-relaxed">
                      {art.observaciones}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
