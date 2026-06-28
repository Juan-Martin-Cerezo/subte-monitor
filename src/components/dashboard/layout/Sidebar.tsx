'use client';

import type { TabId } from '../types';
import { LINE_META, type LineId } from '../lines';
import { Icon } from '../Icon';
import { classNames, lineShort } from '../utils';
import type { TrainTelemetry } from '@/lib/telemetry';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  activeLine: LineId | 'All';
  onActiveLineChange: (l: LineId | 'All') => void;
  trainsByLine: Record<string, TrainTelemetry[]>;
  tab: TabId;
  onTabChange: (t: TabId) => void;
}

export function Sidebar({ open, onClose, activeLine, onActiveLineChange, trainsByLine }: SidebarProps) {
  return (
    <>
      {/* Mobile backdrop */}
      <div
        onClick={onClose}
        className={classNames(
          'md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        aria-hidden="true"
      />

      <aside
        className={classNames(
          'fixed md:relative z-50 md:z-auto h-full md:h-auto',
          'w-72 md:w-64 lg:w-72 shrink-0 flex flex-col',
          'bg-surface-container-low/95 md:bg-surface-container-lowest/60 md:backdrop-blur-md',
          'border-r border-outline-variant/10',
          'transition-transform duration-200',
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
        aria-label="Panel de líneas"
      >
        {/* Mobile-only close */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-outline-variant/10">
          <h2 className="text-title-sm font-bold text-on-background">Líneas</h2>
          <button onClick={onClose} aria-label="Cerrar" className="icon-btn !w-8 !h-8">
            <Icon.X size={18} />
          </button>
        </div>

        <div className="hidden md:block px-5 pt-5 pb-3">
          <h2 className="text-label-caps text-outline tracking-widest">Filtrar por línea</h2>
          <p className="text-body-sm text-on-surface-variant mt-1">Mostrar mapa, arribos y estado.</p>
        </div>

        <nav className="flex-1 overflow-y-auto p-2 md:p-3 space-y-0.5">
          <SidebarRow
            active={activeLine === 'All'}
            onClick={() => onActiveLineChange('All')}
            color="#82cfff"
            label="Todas"
            count={Object.values(trainsByLine).reduce((s, t) => s + t.length, 0)}
          />
          {Object.values(LINE_META).map(line => (
            <SidebarRow
              key={line.id}
              active={activeLine === line.id}
              onClick={() => onActiveLineChange(line.id)}
              color={line.color}
              label={line.name}
              count={trainsByLine[line.id]?.length ?? 0}
            />
          ))}
        </nav>

        <div className="hidden md:block p-3 border-t border-outline-variant/10">
          <a
            href="https://www.buenosaires.gob.ar/subte"
            target="_blank"
            rel="noreferrer"
            className="btn-ghost w-full justify-center !border-outline-variant/20 !bg-surface-container"
          >
            <Icon.Compass size={16} />
            Datos abiertos GCBA
          </a>
          <p className="text-[10px] text-outline mt-2 text-center font-mono">© 2026 SBASE</p>
        </div>
      </aside>
    </>
  );
}

function SidebarRow({
  active, onClick, color, label, count,
}: {
  active: boolean;
  onClick: () => void;
  color: string;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={classNames(
        'group w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-all focus-ring',
        active
          ? 'bg-surface-container-high text-on-background'
          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-background'
      )}
    >
      <span
        className="h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-black text-white shrink-0 ring-1 ring-white/10"
        style={{ background: color }}
      >
        {labelShort(label)}
      </span>
      <span className="flex-1 text-left text-body-sm font-medium truncate">{label}</span>
      <span className={classNames(
        'text-[10px] font-mono px-1.5 py-0.5 rounded-md min-w-6 text-center',
        active ? 'bg-primary-container/25 text-primary' : 'bg-surface-container-high text-outline'
      )}>
        {count}
      </span>
    </button>
  );
}

function labelShort(label: string): string {
  if (label.startsWith('Línea')) return label.replace('Línea', '').trim();
  if (label.startsWith('Premetro')) {
    return label.includes('Cívico') ? 'P-C' : 'P-S';
  }
  return label[0] ?? '?';
}
