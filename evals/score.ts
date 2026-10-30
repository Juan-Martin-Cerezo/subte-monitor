import { mentionedStations, normalizeName } from "../src/lib/anden/stations";
import { extractCitations, type FactValue } from "./lib";

export { mentionedStations };

export function sameStation(actual: unknown, expected: unknown): boolean {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  return (
    normalizeName(actual)
      .replace(/\b(estacion|station)\b/g, "")
      .trim() ===
    normalizeName(expected)
      .replace(/\b(estacion|station)\b/g, "")
      .trim()
  );
}

export function sameLine(actual: unknown, expected: unknown): boolean {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const key = (value: string) =>
    normalizeName(value)
      .replace(/^linea/, "")
      .replace(/ /g, "");
  return key(actual) === key(expected);
}

export function valueMatches(key: string, expected: FactValue, actual: unknown): boolean {
  if (typeof expected === "number") {
    const parsed = typeof actual === "number" ? actual : Number(actual);
    return Number.isFinite(parsed) && Math.abs(parsed - expected) < 1e-6;
  }
  if (typeof expected === "boolean") return actual === expected;
  if (key === "from" || key === "to" || key === "station") return sameStation(actual, expected);
  if (key === "line") return sameLine(actual, expected);
  return typeof actual === "string" && normalizeName(actual) === normalizeName(expected);
}

export function planFromEvidence(
  evidence: string[]
): { legs: { board: string; alight: string }[] } | null {
  for (const raw of evidence) {
    try {
      const value = JSON.parse(raw) as { legs?: unknown };
      if (Array.isArray(value?.legs)) return value as { legs: { board: string; alight: string }[] };
    } catch {
      // tool output can be plain text; skip it
    }
  }
  return null;
}

export function stripCitations(text: string): string {
  return text.replace(/\[[^\]\n]*\]/g, " ");
}

export function normalizeNumber(raw: string): string {
  const trimmed = raw.replace(/[.,]+$/, "");
  if (trimmed.includes(":")) return trimmed;
  return trimmed
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(/,/g, ".")
    .replace(/\.0+$/, "")
    .replace(/\.$/, "");
}

export function numbersIn(text: string): string[] {
  const times = text.match(/\b\d{1,2}:\d{2}\b/g) ?? [];
  const withoutTimes = text.replace(/\b\d{1,2}:\d{2}\b/g, " ");
  const plain = withoutTimes.match(/\d[\d.,]*/g) ?? [];
  return [...times, ...plain.map(normalizeNumber)].filter(Boolean);
}

export function supportedNumber(value: string, allowed: Set<string>): boolean {
  if (allowed.has(value)) return true;
  const digits = value.replace(/\D/g, "");
  const numeric = Number(value);
  if (Number.isFinite(numeric) && digits.length >= 1) {
    for (const candidate of allowed) {
      const other = Number(candidate);
      if (!Number.isFinite(other)) continue;
      // tool output reports delaySeconds; answers often restate it in minutes
      if (Math.abs(other - numeric * 60) < 1e-6 || Math.abs(other / 60 - numeric) < 1e-6)
        return true;
    }
  }
  if (digits.length < 2) return false;
  for (const candidate of allowed) {
    const other = candidate.replace(/\D/g, "");
    if (!other) continue;
    if (other === digits) return true;
    if (digits.length >= 3 && (other.startsWith(digits) || digits.startsWith(other))) return true;
  }
  return false;
}

export function linesIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/[Ll](?:ínea|inea)\s*([A-H])\b/g)) {
    const letter = match[1];
    if (letter) found.add(letter.toLowerCase());
  }
  if (/\bpremetro\b|\bpm-(?:civico|savio)\b/i.test(text)) found.add("premetro");
  return found;
}

export function unresolvedCitations(answer: string, sourceIds: Set<string> | string[]): string[] {
  const known = sourceIds instanceof Set ? sourceIds : new Set(sourceIds);
  return extractCitations(answer).filter((id) => !known.has(id));
}

export function unsupportedClaims(answer: string, evidence: string[]): string[] {
  const clean = stripCitations(answer);
  const haystack = ` ${normalizeName(evidence.join("\n"))} `;
  const found: string[] = [];

  for (const station of mentionedStations(clean)) {
    if (!haystack.includes(` ${normalizeName(station)} `)) found.push(`station:${station}`);
  }

  const allowedLines = linesIn(evidence.join("\n"));
  for (const line of linesIn(clean)) {
    if (!allowedLines.has(line)) found.push(`line:${line}`);
  }

  const allowed = new Set(numbersIn(evidence.join("\n")));
  for (const number of numbersIn(clean)) {
    if (!supportedNumber(number, allowed)) found.push(`number:${number}`);
  }

  return found;
}
