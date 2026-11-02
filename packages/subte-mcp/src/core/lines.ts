const LINE_IDS = [
  "LineaA",
  "LineaB",
  "LineaC",
  "LineaD",
  "LineaE",
  "LineaH",
  "PM-Civico",
  "PM-Savio",
] as const;

export type LineId = (typeof LINE_IDS)[number];

export function matchLines(input: string): LineId[] {
  const key = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

  const byShort: Record<string, LineId | undefined> = {
    a: "LineaA",
    b: "LineaB",
    c: "LineaC",
    d: "LineaD",
    e: "LineaE",
    h: "LineaH",
  };

  const short = byShort[key];
  if (short) return [short];
  if (key === "lineaa") return ["LineaA"];
  if (key === "lineab") return ["LineaB"];
  if (key === "lineac") return ["LineaC"];
  if (key === "linead") return ["LineaD"];
  if (key === "lineae") return ["LineaE"];
  if (key === "lineah") return ["LineaH"];
  if (key === "pmcivico" || key === "premetrocivico" || key === "civico") return ["PM-Civico"];
  if (key === "pmsavio" || key === "premetrosavio" || key === "savio") return ["PM-Savio"];
  if (key === "premetro" || key === "pm") return ["PM-Civico", "PM-Savio"];

  return [];
}

export function lineLabel(lineId: string): string {
  if (lineId === "PM-Civico") return "Premetro Cívico";
  if (lineId === "PM-Savio") return "Premetro Savio";
  if (lineId.startsWith("Linea")) return `Línea ${lineId.slice(5)}`;
  return lineId;
}
