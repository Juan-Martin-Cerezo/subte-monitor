'use client';

import type { TabId } from '../types';
import { Icon, type IconName } from '../Icon';
import { classNames } from '../utils';

interface Props { tab: TabId; onTabChange: (t: TabId) => void; }

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'map',       label: 'Mapa',        icon: 'Map' },
  { id: 'planner',   label: 'Planear',     icon: 'Route' },
  { id: 'stations',  label: 'Estaciones',  icon: 'Pin' },
  { id: 'arrivals',  label: 'Arribos',     icon: 'Clock' },
  { id: 'status',    label: 'Estado',      icon: 'Alert' },
];

export function MobileBottomNav({ tab, onTabChange }: Props) {
  return (
    <nav
      className="md:hidden shrink-0 z-40 grid grid-cols-5 border-t border-outline-variant/10 bg-surface-container-lowest/98 backdrop-blur-2xl thumb-safe-bottom min-h-0"
      aria-label="Navegación principal"
    >
      {TABS.map(t => {
        const active = tab === t.id;
        const Icn = Icon[t.icon];
        return (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            aria-current={active ? 'page' : undefined}
            className={classNames(
              'relative flex flex-col items-center justify-center gap-0 touch-target transition-all duration-150 active:scale-95 py-0.5',
              active ? 'text-primary' : 'text-on-surface-variant active:text-on-surface'
            )}
          >
            {active && (
              <>
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-10 rounded-full bg-primary shadow-[0_0_10px_var(--color-primary-container)]" />
                <span className="absolute inset-0 rounded-lg bg-primary/5" />
              </>
            )}
            <Icn size={active ? 20 : 18} />
            <span className="text-[clamp(7px,1.8vw,9px)] font-semibold leading-tight">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
