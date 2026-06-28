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
      className="md:hidden shrink-0 z-40 grid grid-cols-5 border-t border-outline-variant/10 bg-surface-container-lowest/95 backdrop-blur-xl safe-area-bottom"
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
              'relative flex flex-col items-center justify-center gap-0.5 min-h-[52px] py-2 transition-colors focus-ring',
              active ? 'text-primary' : 'text-on-surface-variant'
            )}
          >
            {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary-container)]" />}
            <Icn size={20} />
            <span className="text-[10px] font-medium">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
