'use client';

import type { TabId } from '../types';
import { Icon, type IconName } from '../Icon';
import { classNames } from '../utils';

interface HeaderProps {
  tab: TabId;
  onTabChange: (t: TabId) => void;
  onMenuToggle: () => void;
  isRefreshing: boolean;
  onRefresh: () => void;
  lastUpdate?: number;
}

const NAV: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'map', label: 'Mapa', icon: 'Map' },
  { id: 'planner', label: 'Planificador', icon: 'Route' },
  { id: 'stations', label: 'Estaciones', icon: 'Pin' },
  { id: 'arrivals', label: 'Arribos', icon: 'Clock' },
  { id: 'status', label: 'Estado', icon: 'Alert' },
];

export function Header({ tab, onTabChange, onMenuToggle, isRefreshing, onRefresh }: HeaderProps) {
  return (
    <>
      {/* Desktop header — full nav */}
      <header className="hidden md:flex h-14 shrink-0 items-center justify-between gap-6 border-b border-outline-variant/10 bg-surface-container-lowest/85 px-5 backdrop-blur-xl z-30">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-container/15 ring-1 ring-primary-container/40">
            <Icon.Subway size={20} className="text-primary" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-title-sm font-bold text-on-background tracking-tight">SUBTE LIVE</span>
            <span className="text-[10px] font-mono text-outline tracking-widest">BUENOS AIRES · v3</span>
          </div>
        </div>

        <nav className="flex items-center gap-1">
          {NAV.map(n => {
            const Icn = Icon[n.icon];
            return (
              <button
                key={n.id}
                onClick={() => onTabChange(n.id)}
                aria-current={tab === n.id ? 'page' : undefined}
                className={classNames(
                  'group relative flex items-center gap-2 rounded-md px-3 py-1.5 text-body-sm font-medium transition-colors focus-ring',
                  tab === n.id
                    ? 'text-primary'
                    : 'text-on-surface-variant hover:text-on-background hover:bg-surface-container-high/60'
                )}
              >
                <Icn size={16} />
                {n.label}
                {tab === n.id && (
                  <span className="absolute -bottom-[14px] left-3 right-3 h-0.5 rounded-full bg-primary shadow-[0_0_10px_var(--color-primary-container)]" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-1">
          <span className="hidden lg:flex items-center gap-2 rounded-md bg-surface-container px-2.5 py-1 text-[10px] font-mono text-on-surface-variant">
            <span className="live-dot" />
            EN VIVO
          </span>
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label="Actualizar"
            className="icon-btn focus-ring"
            title="Actualizar"
          >
            <Icon.Refresh size={18} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
          <button aria-label="Notificaciones" className="icon-btn focus-ring">
            <Icon.Bell size={18} />
          </button>
          <button aria-label="Ajustes" className="icon-btn focus-ring">
            <Icon.Settings size={18} />
          </button>
        </div>
      </header>

      {/* Mobile header — compact, hamburger + live indicator */}
      <header className="md:hidden flex h-12 shrink-0 items-center justify-between border-b border-outline-variant/10 bg-surface-container-lowest/90 px-3 backdrop-blur-xl z-30 safe-area-top">
        <div className="flex items-center gap-2">
          <button
            onClick={onMenuToggle}
            aria-label="Menú"
            className="icon-btn focus-ring !w-9 !h-9"
          >
            <Icon.Menu size={20} />
          </button>
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-container/15 ring-1 ring-primary-container/40">
            <Icon.Subway size={16} className="text-primary" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-bold tracking-tight text-on-background">SUBTE</span>
            <span className="text-[8px] font-mono tracking-widest text-outline">LIVE · BA</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-1.5 rounded-md bg-surface-container px-2 py-1 text-[9px] font-mono text-on-surface-variant">
            <span className="live-dot" />
            EN VIVO
          </span>
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label="Actualizar"
            className="icon-btn !w-9 !h-9 focus-ring"
          >
            <Icon.Refresh size={18} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>
    </>
  );
}
