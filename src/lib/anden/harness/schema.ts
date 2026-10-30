import { z } from 'zod';

export const TOOL_NAMES = [
  'subway_status',
  'next_trains',
  'plan_trip',
  'nearby_stations',
  'search_knowledge',
] as const;

export const STEP_KINDS = ['plan', 'tool', 'retrieve', 'memory', 'answer'] as const;

export const planSchema = z.object({
  question: z.string().trim().min(1).max(500),
  tools: z.array(z.enum(TOOL_NAMES)).min(1),
  maxSteps: z.number().int().min(1).max(6),
  useMemory: z.boolean(),
});

export type Plan = z.infer<typeof planSchema>;

export const toolArgsSchemas = {
  subway_status: z.object({ line: z.string().min(1).max(40).optional() }).strict(),
  next_trains: z
    .object({
      station: z.string().min(2).max(80),
      line: z.string().min(1).max(40).optional(),
      limit: z.coerce.number().int().min(1).max(20).optional(),
    })
    .strict(),
  plan_trip: z
    .object({
      from: z.string().min(2).max(80),
      to: z.string().min(2).max(80),
      step_free: z.boolean().optional(),
    })
    .strict(),
  nearby_stations: z
    .object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      radius_m: z.coerce.number().int().min(1).max(50_000).optional(),
    })
    .strict(),
  search_knowledge: z
    .object({
      query: z.string().min(2).max(300),
      k: z.coerce.number().int().min(1).max(10).optional(),
    })
    .strict(),
} as const;

export type ToolValidation = { ok: true } | { ok: false; error: string };

export function validateToolArgs(name: string, args: Record<string, unknown>): ToolValidation {
  const schema = toolArgsSchemas[name as keyof typeof toolArgsSchemas];
  if (!schema) return { ok: false, error: `unknown tool '${name}'` };

  const parsed = schema.safeParse(args);
  if (parsed.success) return { ok: true };

  const error = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`)
    .join('; ');
  return { ok: false, error };
}

export const traceStepSchema = z.object({
  step: z.number().int().positive(),
  kind: z.enum(STEP_KINDS),
  input: z.string(),
  output: z.string(),
  ok: z.boolean(),
  ms: z.number().int().min(0),
  tokensIn: z.number().int().min(0),
  tokensOut: z.number().int().min(0),
});
