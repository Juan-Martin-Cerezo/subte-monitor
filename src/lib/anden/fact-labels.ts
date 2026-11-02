import type { FactKey, FactValue } from "./store/types";

export const FACT_LABELS: Record<FactKey, string> = {
  home_station: "Casa",
  work_station: "Trabajo",
  usual_line: "Línea habitual",
  usual_departure_time: "Hora de salida",
  step_free: "Sin escaleras",
  max_transfer_minutes: "Combinación máxima",
};

export function formatFactValue(key: FactKey, value: FactValue): string {
  if (key === "step_free") return value ? "Sí" : "No";
  if (key === "max_transfer_minutes") return `${value} min`;
  if (key === "usual_line") return String(value).replace(/^Linea/, "Línea ");
  return String(value);
}
