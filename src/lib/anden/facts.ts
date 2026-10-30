import { canonicalStation } from './stations';
import type { Fact, FactKey, FactValue } from './store/types';

export const FACT_KEYS: FactKey[] = [
  'home_station',
  'work_station',
  'usual_line',
  'usual_departure_time',
  'step_free',
  'max_transfer_minutes',
];

const DAY_MS = 24 * 60 * 60 * 1000;

const TTL_DAYS: Record<FactKey, number> = {
  home_station: 180,
  work_station: 180,
  usual_line: 180,
  usual_departure_time: 30,
  max_transfer_minutes: 30,
  step_free: 180,
};

export function isFactKey(value: string): value is FactKey {
  return (FACT_KEYS as string[]).includes(value);
}

function normalizeLine(raw: string): string | null {
  const compact = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  const line = /^(linea|line)?([a-h])$/.exec(compact);
  if (line) return `Linea${line[2].toUpperCase()}`;
  if (compact === 'premetro' || compact === 'pm') return 'Premetro';
  return null;
}

function normalizeTime(raw: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

export function validateFact(key: FactKey, raw: unknown): FactValue | null {
  switch (key) {
    case 'home_station':
    case 'work_station':
      return typeof raw === 'string' ? canonicalStation(raw) : null;
    case 'usual_line':
      return typeof raw === 'string' ? normalizeLine(raw) : null;
    case 'usual_departure_time':
      return typeof raw === 'string' ? normalizeTime(raw) : null;
    case 'step_free':
      return typeof raw === 'boolean' ? raw : null;
    case 'max_transfer_minutes': {
      const value = typeof raw === 'number' ? raw : Number(raw);
      return Number.isInteger(value) && value >= 0 && value <= 120 ? value : null;
    }
  }
}

export function buildFact(
  userId: string,
  key: FactKey,
  value: FactValue,
  now = new Date(),
): Fact {
  return {
    userId,
    key,
    value,
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TTL_DAYS[key] * DAY_MS).toISOString(),
  };
}
