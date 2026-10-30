import { STATION_NAMES } from "./station-names";

// Same normalization used by the MCP package and the retrieval tokenizer.
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const canonical = new Map(STATION_NAMES.map((name) => [normalizeName(name), name]));
const longestFirst = [...STATION_NAMES].sort((a, b) => b.length - a.length);

export function canonicalStation(value: string): string | null {
  return canonical.get(normalizeName(value)) ?? null;
}

export function mentionedStations(text: string): string[] {
  let haystack = ` ${normalizeName(text)} `;
  const found: string[] = [];

  for (const name of longestFirst) {
    const needle = normalizeName(name);
    const at = haystack.indexOf(` ${needle} `);
    if (at < 0) continue;
    found.push(name);
    haystack = `${haystack.slice(0, at)} ${haystack.slice(at + needle.length + 2)}`;
  }

  return found;
}

export { STATION_NAMES };
