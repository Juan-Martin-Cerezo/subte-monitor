import type { LineId } from "./lines";

export function isLineId(s: string | null | undefined): s is LineId {
  if (!s) return false;
  return (
    s === "LineaA" ||
    s === "LineaB" ||
    s === "LineaC" ||
    s === "LineaD" ||
    s === "LineaE" ||
    s === "LineaH" ||
    s === "PM-Civico" ||
    s === "PM-Savio"
  );
}

export function lineShort(lineId: string | null | undefined): string {
  if (!lineId) return "?";
  if (lineId === "PM-Civico") return "P-C";
  if (lineId === "PM-Savio") return "P-S";
  return lineId.replace("Linea", "").replace("Line", "").replace("linea", "").replace("line", "");
}

export function classNames(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function formatEta(seconds: number): string {
  if (seconds <= 0) return "AHORA";
  const m = Math.floor(seconds / 60);
  if (m < 1) return "<1 min";
  return `${m} min`;
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
