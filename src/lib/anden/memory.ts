import { formatFactValue, FACT_LABELS } from './fact-labels';
import { mentionedStations, normalizeName } from './stations';
import { getStore } from './store';
import type { Fact, FactKey, FactValue, Turn } from './store/types';

export interface MemorySnapshot {
  facts: Fact[];
  turns: Turn[];
}

const TRIP_INTENT =
  /(c[oó]mo (llego|voy|viajo)|c[oó]mo ir|ruta|viaje|tarda|demora|planific|conviene)/i;

export async function loadMemory(userId: string, turnLimit = 4): Promise<MemorySnapshot> {
  const store = getStore();
  await store.init();
  const [facts, turns] = await Promise.all([
    store.listFacts(userId),
    store.recentTurns(userId, turnLimit),
  ]);
  return { facts, turns };
}

function factValue(facts: Fact[], key: FactKey): FactValue | undefined {
  return facts.find((fact) => fact.key === key)?.value;
}

interface OriginClause {
  origin: string;
  text: string;
}

export function factsForPrompt(facts: Fact[]): string {
  if (!facts.length) return '';

  const lines = facts.map((fact) => `- ${FACT_LABELS[fact.key]}: ${formatFactValue(fact.key, fact.value)}`);
  const hint =
    'Si la pregunta no aclara el origen, usá la estación de casa. Si no aclara el destino, usá la del trabajo. ' +
    'No aclares que usás datos recordados y no repitas el origen si la pregunta no lo pide.';

  return `Datos que el usuario ya contó:\n${lines.join('\n')}\n${hint}`;
}

export function answerMentionsStation(answer: string, station: string): boolean {
  const target = normalizeName(station);
  return mentionedStations(answer).some((name) => normalizeName(name) === target);
}

export function memoryOriginClause(question: string, facts: Fact[]): OriginClause | null {
  if (!facts.length || !TRIP_INTENT.test(question)) return null;

  const mentioned = mentionedStations(question);
  if (mentioned.length >= 2) return null;

  const home = factValue(facts, 'home_station');
  const work = factValue(facts, 'work_station');
  const spoken = mentioned.map((name) => normalizeName(name));

  if (home && !spoken.includes(normalizeName(String(home)))) {
    return { origin: String(home), text: `Desde ${home}, como siempre.` };
  }
  if (work && !spoken.includes(normalizeName(String(work)))) {
    return { origin: String(work), text: `Desde ${work}, como siempre.` };
  }
  return null;
}
