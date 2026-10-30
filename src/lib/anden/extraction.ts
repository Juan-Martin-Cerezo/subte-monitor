import { buildFact, isFactKey, validateFact } from "./facts";
import { STATION_NAMES } from "./stations";
import type { Fact } from "./store/types";
import { chat } from "./llm";

const MAX_OUTPUT_TOKENS = 180;

const SYSTEM_PROMPT = [
  "Extraé solo datos que el usuario afirmó explícitamente sobre sí mismo.",
  "El mensaje puede incluir una pregunta: ignorá la pregunta y mirá solo lo que el usuario afirma.",
  "Devolvé un objeto JSON, sin texto alrededor, con cero o más de estas claves:",
  "home_station, work_station, usual_line, usual_departure_time, step_free, max_transfer_minutes.",
  `home_station y work_station tienen que ser uno de estos nombres: ${STATION_NAMES.join(", ")}.`,
  "usual_line: LineaA a LineaH o Premetro. usual_departure_time: HH:MM.",
  "step_free: true o false. max_transfer_minutes: entero de 0 a 120.",
  "Si no hay un dato explícito, devolvé {}. No deduzcas, no completes y no inventes.",
].join(" ");

function parseObject(raw: string): Record<string, unknown> | null {
  const text = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function extractFacts(userId: string, question: string): Promise<Fact[]> {
  let content: string;
  try {
    const result = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Mensaje del usuario: ${question}` },
      ],
      { temperature: 0, maxTokens: MAX_OUTPUT_TOKENS, responseFormat: "json_object" }
    );
    content = result.content;
  } catch {
    return [];
  }

  const parsed = parseObject(content);
  if (!parsed) return [];

  const facts: Fact[] = [];
  for (const [key, raw] of Object.entries(parsed)) {
    if (!isFactKey(key)) continue;
    const value = validateFact(key, raw);
    if (value !== null) facts.push(buildFact(userId, key, value));
  }
  return facts;
}
