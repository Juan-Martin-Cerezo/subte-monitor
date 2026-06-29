'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { AlertData, TrainTelemetry } from '@/lib/telemetry';
import { LINE_META, type LineId } from '../lines';
import type { Station, ReportItem } from '../types';
import { Icon } from '../Icon';
import { classNames, lineShort } from '../utils';

interface Props {
  alerts: AlertData[];
  trainsByLine: Record<string, TrainTelemetry[]>;
  stations?: Station[];
}

const REPORT_CATEGORIES = [
  'Demora excesiva',
  'Estación cerrada',
  'Formación fuera de servicio',
  'Ascensor/escalera mecánica fuera de servicio',
  'Aglomeración / congestión',
  'Incidente de seguridad',
  'Otro',
];

const LINES_FOR_REPORT: { id: LineId; label: string }[] = [
  { id: 'LineaA', label: 'Línea A' },
  { id: 'LineaB', label: 'Línea B' },
  { id: 'LineaC', label: 'Línea C' },
  { id: 'LineaD', label: 'Línea D' },
  { id: 'LineaE', label: 'Línea E' },
  { id: 'LineaH', label: 'Línea H' },
  { id: 'PM-Civico', label: 'Premetro' },
  { id: 'PM-Savio', label: 'Premetro' },
];

const EFFECT_SEVERITY: Record<string, 'critical' | 'warning' | 'info'> = {
  'Sin Servicio': 'critical',
  'Estación Cerrada': 'critical',
  'Servicio Limitado': 'warning',
  'Servicio Demorado': 'warning',
  'Frecuencia Reducida': 'warning',
  'Desvíos': 'warning',
};

function ReportForm({ stations }: { stations: Station[] }) {
  const [line, setLine] = useState('');
  const [station, setStation] = useState('');
  const [category, setCategory] = useState(REPORT_CATEGORIES[0]);
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const stationNames = stations.length > 0
    ? Array.from(new Set(stations.map(s => s.stopName))).sort()
    : [];

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!line || !station) return;
    setStatus('sending');
    setErrorMsg('');
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line, station, category, comment: comment.trim() || category }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Error al enviar');
      }
      setStatus('done');
      setLine('');
      setStation('');
      setCategory(REPORT_CATEGORIES[0]);
      setComment('');
      setTimeout(() => setStatus('idle'), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error de conexión');
      setStatus('error');
    }
  }, [line, station, category, comment]);

  if (status === 'done') {
    return (
      <div className="bento-card p-6 text-center animate-fade-in">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary-container/15 mb-3">
          <Icon.Check size={24} className="text-primary" />
        </span>
        <p className="text-headline-sm font-bold text-on-background">Reporte enviado</p>
        <p className="text-body-sm text-on-surface-variant mt-1">Gracias por contribuir.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bento-card p-4 md:p-6 flex flex-col gap-4">
      <h3 className="text-title-md font-bold text-on-background">Reportar incidencia</h3>
      <p className="text-body-sm text-on-surface-variant -mt-2">Ayudá a otros pasajeros reportando problemas en la red.</p>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Line */}
        <div className="flex flex-col gap-1.5">
          <label className="text-label-caps text-outline tracking-widest">Línea</label>
          <select
            value={line}
            onChange={e => setLine(e.target.value)}
            className="input-field py-2.5"
            required
          >
            <option value="">Seleccionar línea</option>
            {LINES_FOR_REPORT.map(l => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </div>

        {/* Station */}
        <div className="flex flex-col gap-1.5">
          <label className="text-label-caps text-outline tracking-widest">Estación</label>
          <select
            value={station}
            onChange={e => setStation(e.target.value)}
            className="input-field py-2.5"
            required
            disabled={stationNames.length === 0}
          >
            <option value="">
              {stationNames.length === 0 ? 'Sin datos de estaciones' : 'Seleccionar estación'}
            </option>
            {stationNames.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Category */}
      <div className="flex flex-col gap-1.5">
        <label className="text-label-caps text-outline tracking-widest">Categoría</label>
        <div className="flex flex-wrap gap-2">
          {REPORT_CATEGORIES.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={classNames(
                'px-3 py-2 md:py-1.5 rounded-lg text-[11px] font-medium transition-colors active:scale-95 touch-target',
                category === c
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Comment (optional) */}
      <div className="flex flex-col gap-1.5">
        <label className="text-label-caps text-outline tracking-widest">Comentario <span className="text-outline/50">(opcional)</span></label>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          className="input-field py-2.5 resize-none"
          rows={3}
          placeholder="Detalles adicionales..."
          maxLength={500}
        />
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={status === 'sending' || !line || !station}
          className="btn-primary"
        >
          {status === 'sending' ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
              Enviando...
            </span>
          ) : 'Enviar reporte'}
        </button>
        {status === 'error' && (
          <p className="text-body-sm text-error">{errorMsg}</p>
        )}
      </div>
    </form>
  );
}

export function StatusScreen({ alerts, trainsByLine, stations }: Props) {
  const totalTrains = Object.values(trainsByLine).reduce((s, t) => s + t.length, 0);
  const lineIds = Object.keys(LINE_META) as LineId[];

  // User-submitted reports — fetch every 60s, expire after 2h
  const [userReports, setUserReports] = useState<ReportItem[]>([]);
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch('/api/reports');
      if (!res.ok) return;
      const data: ReportItem[] = await res.json();
      const now = Date.now();
      setUserReports(data.filter(r => now - new Date(r.createdAt).getTime() < TWO_HOURS));
    } catch { /* silent — polls keep retrying */ }
  }, []);
  useEffect(() => { fetchReports(); const id = setInterval(fetchReports, 60_000); return () => clearInterval(id); }, [fetchReports]);

  const totalAlerts = alerts.length + userReports.length;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 max-w-6xl mx-auto w-full">
      <header>
        <p className="text-label-caps text-outline tracking-widest">Subte Live</p>
        <h1 className="text-headline-lg font-bold text-on-background tracking-tight mt-0.5">Estado de Red</h1>
        <p className="text-body-md text-on-surface-variant mt-1">Información en vivo sobre el servicio y alertas activas.</p>
      </header>

      {/* Health summary — bento grid */}
      <section className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        <div className="bento-card-highlight p-4 col-span-2 sm:col-span-1 lg:col-span-1">
          <p className="text-label-caps text-primary tracking-widest">Formaciones</p>
          <p className="text-data-lg font-bold text-on-background mt-1">{totalTrains}</p>
          <p className="text-[10px] text-on-surface-variant mt-0.5">activas en este momento</p>
        </div>
        <div className="bento-card p-4 col-span-2 sm:col-span-1 lg:col-span-1">
          <p className="text-label-caps text-outline tracking-widest">Alertas</p>
          <p className={classNames(
            'text-data-lg font-bold mt-1',
            alerts.length === 0 ? 'text-primary' : 'text-error'
          )}>
            {totalAlerts}
          </p>
          <p className="text-[10px] text-on-surface-variant mt-0.5">
            {totalAlerts === 0 ? 'sin alertas activas' : 'incidencias reportadas'}
          </p>
        </div>
        <div className="bento-card p-4 col-span-2 sm:col-span-1 lg:col-span-1">
          <p className="text-label-caps text-outline tracking-widest">Líneas</p>
          <p className="text-data-lg font-bold text-on-background mt-1">{lineIds.length}</p>
          <p className="text-[10px] text-on-surface-variant mt-0.5">en operación (Subte + Premetro)</p>
        </div>
        <div className="bento-card p-4 col-span-2 sm:col-span-1 lg:col-span-1">
          <p className="text-label-caps text-outline tracking-widest">Actualización</p>
          <p className="text-data-md font-bold text-primary mt-1 flex items-center gap-1.5">
            <span className="live-dot" />
            cada 2s
          </p>
          <p className="text-[10px] text-on-surface-variant mt-0.5">polling API GCBA</p>
        </div>
      </section>

      {/* Per-line health */}
      <section>
        <h2 className="text-title-md font-bold text-on-background mb-3">Salud por línea</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {lineIds.map(lineId => {
            const line = LINE_META[lineId];
            const trains = trainsByLine[lineId] ?? [];
            const hasAlert = alerts.some(a => a.routeId === lineId) || userReports.some(r => r.line === lineId);
            return (
              <article
                key={lineId}
                className={classNames(
                  'bento-card p-3 flex items-center gap-3',
                  hasAlert && 'border-error/40'
                )}
              >
                <span className="line-badge shrink-0" style={{ background: line.color }}>
                  {lineShort(lineId)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-body-sm font-bold text-on-background truncate">{line.name}</p>
                  <p className="text-[10px] text-on-surface-variant truncate">
                    {line.endLabel}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-label font-mono text-primary">{trains.length}</p>
                  <p className="text-[9px] text-outline uppercase tracking-wider">
                    {hasAlert ? '⚠ alerta' : 'OK'}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Alerts list */}
      <section>
        <h2 className="text-title-md font-bold text-on-background mb-3">Alertas de servicio</h2>
        {totalAlerts === 0 ? (
          <div className="bento-card p-8 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary-container/15 mb-3">
              <Icon.Check size={24} className="text-primary" />
            </span>
            <p className="text-headline-sm font-bold text-on-background">Servicio normal</p>
            <p className="text-body-sm text-on-surface-variant mt-1">No hay alertas activas en este momento.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {alerts.length > 0 && (
              <ul className="flex flex-col gap-2">
                {alerts.map(alert => {
              const severity = EFFECT_SEVERITY[alert.effect] ?? 'info';
              const line = alert.routeId && alert.routeId in LINE_META ? LINE_META[alert.routeId as LineId] : null;
              return (
                <li
                  key={alert.id}
                  className={classNames(
                    'bento-card p-4 flex items-start gap-3',
                    severity === 'critical' && 'border-error/50',
                    severity === 'warning' && 'border-amber-500/40',
                  )}
                >
                  <span
                    className={classNames(
                      'mt-0.5 flex h-8 w-8 items-center justify-center rounded-md shrink-0',
                      severity === 'critical' ? 'bg-error-container/30 text-error' :
                      severity === 'warning' ? 'bg-amber-500/15 text-amber-300' :
                      'bg-primary-container/15 text-primary'
                    )}
                  >
                    <Icon.Alert size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={classNames(
                          'text-[10px] font-bold uppercase tracking-widest font-mono px-1.5 py-0.5 rounded',
                          severity === 'critical' ? 'bg-error-container/30 text-error' :
                          severity === 'warning' ? 'bg-amber-500/15 text-amber-300' :
                          'bg-primary-container/15 text-primary'
                        )}
                      >
                        {alert.effect}
                      </span>
                      {line && (
                        <span
                          className="line-badge"
                          style={{ background: line.color }}
                        >
                          {lineShort(line.id)}
                        </span>
                      )}
                      <span className="text-[10px] text-outline">{alert.cause}</span>
                    </div>
                    <h3 className="text-body-md font-bold text-on-background mt-1.5 leading-snug">{alert.headerText}</h3>
                    {alert.descriptionText && (
                      <p className="text-body-sm text-on-surface-variant mt-1 leading-relaxed">{alert.descriptionText}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
            )}
            {userReports.length > 0 && (
              <div>
                <p className="text-label-caps text-outline tracking-widest mb-2 flex items-center gap-1.5">
                  <Icon.Alert size={12} />
                  Reportes de la comunidad ({userReports.length})
                </p>
                <ul className="flex flex-col gap-2">
                  {userReports.map(r => {
                    const line = r.line && r.line in LINE_META ? LINE_META[r.line as LineId] : null;
                    const minutesAgo = Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 60000);
                    const timeLabel = minutesAgo < 1 ? 'Ahora' : minutesAgo < 60 ? `hace ${minutesAgo} min` : `hace ${Math.floor(minutesAgo / 60)}h`;
                    return (
                      <li key={r.id} className="bento-card p-4 flex items-start gap-3 border-amber-500/30">
                        <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md shrink-0 bg-amber-500/15 text-amber-300">
                          <Icon.Alert size={16} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-bold uppercase tracking-widest font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
                              {r.category}
                            </span>
                            {line && (
                              <span className="line-badge" style={{ background: line.color }}>
                                {lineShort(r.line as LineId)}
                              </span>
                            )}
                            <span className="text-[10px] text-outline">{timeLabel}</span>
                          </div>
                          <p className="text-body-sm font-semibold text-on-background mt-1.5">{r.station}</p>
                          {r.comment && (
                            <p className="text-body-sm text-on-surface-variant mt-0.5 leading-relaxed">{r.comment}</p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Report form */}
      {stations && stations.length > 0 && (
        <section>
          <h2 className="text-title-md font-bold text-on-background mb-3">Reportar incidencia</h2>
          <ReportForm stations={stations} />
        </section>
      )}
    </div>
  );
}
