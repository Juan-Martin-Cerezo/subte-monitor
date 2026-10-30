import type { LlmUsage } from '../llm';
import { costOf, HARNESS_CONFIG, tokensOf } from './config';

type BudgetStop = 'tokens' | 'cost' | 'time';

interface Limits {
  maxToolSteps: number;
  maxTokens: number;
  maxUsd: number;
  maxMs: number;
}

interface BudgetSpent {
  steps: number;
  tokens: number;
  costUsd: number;
  ms: number;
}

export class Budget {
  private readonly startedAt = Date.now();
  private readonly limits: Limits;
  private stepCount = 0;
  private tokenCount = 0;
  private usdCount = 0;

  constructor(limits: Limits = HARNESS_CONFIG) {
    this.limits = limits;
  }

  addUsage(usage: LlmUsage): void {
    this.tokenCount += tokensOf(usage);
    this.usdCount += costOf(usage);
  }

  consumeStep(): boolean {
    if (this.stepCount >= this.limits.maxToolSteps) return false;
    this.stepCount += 1;
    return true;
  }

  elapsed(): number {
    return Date.now() - this.startedAt;
  }

  stopReason(): BudgetStop | null {
    if (this.tokenCount >= this.limits.maxTokens) return 'tokens';
    if (this.usdCount >= this.limits.maxUsd) return 'cost';
    if (this.elapsed() >= this.limits.maxMs) return 'time';
    return null;
  }

  exhausted(): boolean {
    return this.stopReason() !== null;
  }

  spent(): BudgetSpent {
    return {
      steps: this.stepCount,
      tokens: this.tokenCount,
      costUsd: this.usdCount,
      ms: this.elapsed(),
    };
  }
}
