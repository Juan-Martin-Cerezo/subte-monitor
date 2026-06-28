// Subte line metadata + helpers — single source of truth for all screens.

export type LineId =
  | 'LineaA' | 'LineaB' | 'LineaC' | 'LineaD' | 'LineaE' | 'LineaH'
  | 'PM-Civico' | 'PM-Savio';

export interface LineMeta {
  id: LineId;
  name: string;
  short: string;
  color: string;
  endLabel: string;
}

export const LINE_META: Record<LineId, LineMeta> = {
  LineaA:    { id: 'LineaA',    name: 'Línea A', short: 'A',  color: '#00aeef', endLabel: 'Plaza de Mayo ↔ San Pedrito' },
  LineaB:    { id: 'LineaB',    name: 'Línea B', short: 'B',  color: '#ed1c24', endLabel: 'L. N. Alem ↔ J. M. de Rosas' },
  LineaC:    { id: 'LineaC',    name: 'Línea C', short: 'C',  color: '#0050b5', endLabel: 'Constitución ↔ Retiro' },
  LineaD:    { id: 'LineaD',    name: 'Línea D', short: 'D',  color: '#008a54', endLabel: 'Catedral ↔ Congreso de Tucumán' },
  LineaE:    { id: 'LineaE',    name: 'Línea E', short: 'E',  color: '#6c2b85', endLabel: 'Retiro ↔ Plaza de los Virreyes' },
  LineaH:    { id: 'LineaH',    name: 'Línea H', short: 'H',  color: '#ffcd00', endLabel: 'Hospitales ↔ Facultad de Derecho' },
  'PM-Civico': { id: 'PM-Civico', name: 'Premetro (Cívico)', short: 'P-C', color: '#ffbd33', endLabel: 'Plaza de Mayo ↔ Centro Cívico' },
  'PM-Savio':  { id: 'PM-Savio',  name: 'Premetro (Savio)',  short: 'P-S', color: '#ffbd33', endLabel: 'Int. Saguier ↔ Gral. Savio' },
};

export const ALL_LINE_IDS: LineId[] = ['LineaA', 'LineaB', 'LineaC', 'LineaD', 'LineaE', 'LineaH', 'PM-Civico', 'PM-Savio'];
export const SUBTE_LINE_IDS: LineId[] = ['LineaA', 'LineaB', 'LineaC', 'LineaD', 'LineaE', 'LineaH'];

export function normalizeStationKey(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

// Stations sharing a name across lines, or known transfers.
export const MANUAL_TRANSFERS: Record<string, string[]> = {
  'Perú': ['Catedral', 'Bolívar'],
  'Catedral': ['Perú', 'Bolívar'],
  'Bolívar': ['Perú', 'Catedral'],
  'Avenida de Mayo': ['Lima'],
  'Lima': ['Avenida de Mayo'],
  'Carlos Pellegrini': ['9 de Julio', 'Diagonal Norte'],
  '9 de Julio': ['Carlos Pellegrini', 'Diagonal Norte'],
  'Diagonal Norte': ['Carlos Pellegrini', '9 de Julio'],
  'Plaza Miserere': ['Once'],
  'Once': ['Plaza Miserere'],
  'Humberto 1°': ['Jujuy'],
  'Jujuy': ['Humberto 1°'],
  'Santa Fe': ['Pueyrredón'],
  'Pueyrredón': ['Santa Fe', 'Corrientes'],
  'Corrientes': ['Pueyrredón'],
  'Intendente Saguier': ['Plaza de los Virreyes'],
  'Plaza de los Virreyes': ['Intendente Saguier'],
};
