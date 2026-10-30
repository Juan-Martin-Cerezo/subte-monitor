import type { LlmUsage } from '../llm';

const MAX_STEPS = 6;

export const HARNESS_CONFIG = {
  maxSteps: MAX_STEPS,
  maxToolSteps: MAX_STEPS - 1,
  maxTokens: 12_000,
  maxUsd: 0.02,
  maxMs: 25_000,
  maxStepChars: 4_000,
  maxDetailChars: 800,
} as const;

export const MODEL_PARAMS = {
  temperature: 0,
  toolTokens: 600,
  answerTokens: 400,
} as const;

const PRICING = {
  inputPer1m: 0.27,
  outputPer1m: 1.1,
} as const;

export function costOf(usage: LlmUsage): number {
  const input = ((usage.prompt_tokens ?? 0) / 1_000_000) * PRICING.inputPer1m;
  const output = ((usage.completion_tokens ?? 0) / 1_000_000) * PRICING.outputPer1m;
  return input + output;
}

export function tokensOf(usage: LlmUsage): number {
  return usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0);
}
