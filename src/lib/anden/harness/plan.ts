import { HARNESS_CONFIG } from './config';
import { planSchema, TOOL_NAMES, type Plan } from './schema';

const COORDINATES = /-?\d{1,3}[.,]\d{2,}/;
const COORDINATE_WORDS = /(latitud|longitud|coordenad|grados|ubicad|cerca|distancia)/i;

export function buildPlan(question: string): Plan {
  // nearby_stations only helps when the question actually carries coordinates
  const offerNearby = COORDINATES.test(question) && COORDINATE_WORDS.test(question);

  return planSchema.parse({
    question,
    tools: TOOL_NAMES.filter((name) => name !== 'nearby_stations' || offerNearby),
    maxSteps: HARNESS_CONFIG.maxSteps,
    useMemory: true,
  });
}
