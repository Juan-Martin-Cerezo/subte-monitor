import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAgent, type AgentResult } from '../src/lib/anden/agent/run';
import { buildFact, validateFact } from '../src/lib/anden/facts';
import { LlmConfigError, type LlmUsage } from '../src/lib/anden/llm';
import { getStore } from '../src/lib/anden/store';
import type { FactKey } from '../src/lib/anden/store/types';
import { mentionedStations, normalizeName } from '../src/lib/anden/stations';
import {
  CATEGORIES,
  README_PATH,
  RESULTS_PATH,
  ROOT,
  costOf,
  extractCitations,
  loadCases,
  loadConfig,
  percentile,
  round,
  type Category,
  type EvalCase,
  type EvalConfig,
} from './lib';
import {
  planFromEvidence,
  sameStation,
  unsupportedClaims,
  unresolvedCitations,
  valueMatches,
} from './score';

interface Options {
  subset: number | null;
  category: Category | null;
  seedFacts: boolean;
  maxCost: number;
  out: string;
  writeReadme: boolean;
  gate: boolean;
}

interface Checks {
  tool?: boolean;
  args?: boolean;
  citations?: boolean;
  abstain: boolean;
  legs?: boolean;
  uses_fact?: boolean;
  hallucination: boolean;
}

interface CaseRow {
  id: string;
  category: Category;
  question: string;
  notes: string;
  actual: {
    answer: string;
    abstained: boolean;
    citations: string[];
    citations_valid: boolean;
    steps: { tool: string; args: Record<string, unknown>; ok: boolean; ms: number }[];
    sources: string[];
  } | null;
  error?: string;
  checks: Checks;
  unsupported: string[];
  usage: LlmUsage;
  cost_usd: number;
  ms: number;
}

interface Metrics {
  cases: number;
  tool_accuracy: number | null;
  arg_accuracy: number | null;
  citation_validity: number | null;
  abstain_correctness: number;
  hallucination_rate: number;
  p50_ms: number;
  p95_ms: number;
  tokens: number;
  cost_usd: number;
  failed: string[];
}

const HELP = `Usage: npm run evals -- [options]

  --subset N        run N cases, one per category in rotation
  --category X      only tool_selection, trip_planning, retrieval_citation, abstain or memory
  --seed-facts      load the user_facts of memory cases into sqlite
  --max-cost USD    stop once the accumulated cost passes USD
  --out path        write the JSON result somewhere other than evals/results/latest.json
  --write-readme    write the scoreboard into README.md between the evals markers
  --gate            exit 1 when hallucination_rate > 0.10 or tool_accuracy < 0.85
`;

function parseOptions(argv: string[]): Options {
  const options: Options = {
    subset: null,
    category: null,
    seedFacts: false,
    maxCost: Number.NaN,
    out: RESULTS_PATH,
    writeReadme: false,
    gate: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const equals = arg.indexOf('=');
    const flag = equals > 0 ? arg.slice(0, equals) : arg;
    const inline = equals > 0 ? arg.slice(equals + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`${flag} needs a value`);
      index += 1;
      return next;
    };

    switch (flag) {
      case '--subset': {
        const parsed = Number(value());
        if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--subset must be a positive integer');
        options.subset = parsed;
        break;
      }
      case '--category': {
        const parsed = value() as Category;
        if (!CATEGORIES.includes(parsed)) throw new Error(`--category must be one of ${CATEGORIES.join(', ')}`);
        options.category = parsed;
        break;
      }
      case '--seed-facts':
        options.seedFacts = true;
        break;
      case '--max-cost': {
        const parsed = Number(value());
        if (!Number.isFinite(parsed) || parsed < 0) throw new Error('--max-cost must be a non-negative number');
        options.maxCost = parsed;
        break;
      }
      case '--out':
        options.out = path.resolve(ROOT, value());
        break;
      case '--write-readme':
        options.writeReadme = true;
        break;
      case '--gate':
        options.gate = true;
        break;
      case '--help':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown option ${flag}`);
    }
  }

  return options;
}

function stratified(cases: EvalCase[], limit: number): EvalCase[] {
  const groups = new Map<Category, EvalCase[]>();
  for (const testCase of cases) {
    const group = groups.get(testCase.category) ?? [];
    group.push(testCase);
    groups.set(testCase.category, group);
  }

  const selected: EvalCase[] = [];
  const order = CATEGORIES.filter((category) => groups.has(category));
  for (let index = 0; selected.length < limit; index += 1) {
    let added = false;
    for (const category of order) {
      const group = groups.get(category) ?? [];
      const testCase = group[index];
      if (!testCase) continue;
      selected.push(testCase);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected;
}

function selectCases(cases: EvalCase[], options: Options): EvalCase[] {
  let pool = options.category ? cases.filter((testCase) => testCase.category === options.category) : [...cases];
  if (!options.seedFacts) pool = pool.filter((testCase) => testCase.category !== 'memory');
  return options.subset ? stratified(pool, options.subset) : pool;
}

function evaluate(testCase: EvalCase, result: AgentResult): { checks: Checks; unsupported: string[] } {
  const expect = testCase.expect;
  const checks: Checks = { abstain: false, hallucination: false };

  if (expect.no_tool) checks.tool = result.steps.length === 0;
  else if (expect.tool) {
    checks.tool = expect.first
      ? result.steps[0]?.tool === expect.tool
      : result.steps.some((step) => step.tool === expect.tool);
  }

  if (expect.args_contains) {
    const step = result.steps.find((candidate) => candidate.tool === expect.tool);
    checks.args = Boolean(step) &&
      Object.entries(expect.args_contains).every(([key, value]) => valueMatches(key, value, step?.args[key]));
  }

  if (expect.cites) {
    const cited = extractCitations(result.answer);
    const sourceIds = new Set(result.sources.map((source) => source.id));
    const resolves = unresolvedCitations(result.answer, sourceIds).length === 0;
    const hit = expect.cites.some((id) => cited.includes(id));
    checks.citations = !result.abstained && result.citationsValid && resolves && hit;
  }

  checks.abstain = expect.abstained === true ? result.abstained : !result.abstained;

  if (expect.tool === 'plan_trip' && expect.args_contains?.from && expect.args_contains?.to) {
    const plan = planFromEvidence(result.evidence);
    const from = expect.args_contains.from;
    const to = expect.args_contains.to;
    const first = plan?.legs[0];
    checks.legs = Boolean(plan && first) &&
      sameStation(first?.board, from) &&
      (plan?.legs ?? []).every((leg) => !sameStation(leg.board, to));
  }

  if (expect.uses_fact) {
    const value = testCase.user_facts?.[expect.uses_fact];
    const inArgs = result.steps.some((step) =>
      Object.values(step.args).some((actual) =>
        typeof value === 'string' ? sameStation(actual, value) : actual === value,
      ),
    );
    const inAnswer = typeof value === 'string'
      ? mentionedStations(result.answer).some((name) => normalizeName(name) === normalizeName(value))
      : result.answer.includes(String(value));
    checks.uses_fact = value !== undefined && (inArgs || inAnswer);
  }

  const evidence = [
    testCase.question,
    ...result.evidence,
    ...Object.entries(testCase.user_facts ?? {}).map(([key, value]) => `${key} ${String(value)}`),
  ];
  const unsupported = unsupportedClaims(result.answer, evidence);
  checks.hallucination = unsupported.length > 0;

  return { checks, unsupported };
}

function ratio(values: boolean[]): number | null {
  return values.length ? round(values.filter(Boolean).length / values.length) : null;
}

function failedCheck(name: string, value: boolean | undefined): boolean {
  if (value === undefined) return false;
  return name === 'hallucination' ? value === true : value === false;
}

function summarize(rows: CaseRow[]): Metrics {
  const tool = rows.filter((row) => row.checks.tool !== undefined).map((row) => row.checks.tool === true);
  const args = rows.filter((row) => row.checks.args !== undefined).map((row) => row.checks.args === true);
  const citations = rows
    .filter((row) => row.checks.citations !== undefined)
    .map((row) => row.checks.citations === true);
  const latencies = rows.map((row) => row.ms);

  return {
    cases: rows.length,
    tool_accuracy: ratio(tool),
    arg_accuracy: ratio(args),
    citation_validity: ratio(citations),
    abstain_correctness: rows.length ? round(rows.filter((row) => row.checks.abstain).length / rows.length) : 0,
    hallucination_rate: rows.length ? round(rows.filter((row) => row.checks.hallucination).length / rows.length) : 0,
    p50_ms: percentile(latencies, 50),
    p95_ms: percentile(latencies, 95),
    tokens: rows.reduce((sum, row) => sum + (row.usage.total_tokens ?? 0), 0),
    cost_usd: round(rows.reduce((sum, row) => sum + row.cost_usd, 0), 6),
    failed: rows
      .filter((row) => Object.entries(row.checks).some(([name, value]) => failedCheck(name, value)))
      .map((row) => row.id),
  };
}

function percent(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value * 100)}%`;
}

function metricsTable(rows: CaseRow[], metrics: Metrics, label: string): string {
  return [
    `| ${label} | ${rows.length} | ${percent(metrics.tool_accuracy)} | ${percent(metrics.arg_accuracy)} | ` +
      `${percent(metrics.citation_validity)} | ${percent(metrics.abstain_correctness)} | ` +
      `${percent(metrics.hallucination_rate)} | ${metrics.p50_ms} | ${metrics.p95_ms} | ${metrics.tokens} | ` +
      `${metrics.cost_usd.toFixed(4)} |`,
  ].join('');
}

function readmeSection(rows: CaseRow[], metrics: Metrics, byCategory: Record<string, Metrics>, date: string): string {
  const lines = [
    '<!-- evals:start -->',
    '## Anden evals',
    '',
    `Generated by \`npm run evals\` on ${date}. ${rows.length} cases against the live model. ` +
      'Each row is a hand-written case; the detail per case is in `evals/results/latest.json`.',
    '',
    '| Set | Cases | tool acc | arg acc | citation validity | abstain | hallucination | p50 ms | p95 ms | tokens | cost USD |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    metricsTable(rows, metrics, 'all'),
    ...CATEGORIES.flatMap((category) => {
      const categoryRows = rows.filter((row) => row.category === category);
      const categoryMetrics = byCategory[category];
      return categoryMetrics && categoryRows.length ? [metricsTable(categoryRows, categoryMetrics, category)] : [];
    }),
    '',
  ];

  if (metrics.failed.length) {
    lines.push(`Failed checks: ${metrics.failed.join(', ')}.`, '');
  }

  lines.push(
    'Thresholds used by CI: `hallucination_rate <= 0.10` and `tool_accuracy >= 0.85`.',
    '<!-- evals:end -->',
  );

  return lines.join('\n');
}

async function writeReadme(section: string): Promise<void> {
  let current = '';
  try {
    current = await fs.readFile(README_PATH, 'utf8');
  } catch {
    current = '# subte-monitor\n';
  }

  const start = '<!-- evals:start -->';
  const end = '<!-- evals:end -->';
  const startAt = current.indexOf(start);
  const endAt = current.indexOf(end);

  const next = startAt >= 0 && endAt > startAt
    ? `${current.slice(0, startAt)}${section}${current.slice(endAt + end.length)}`.replace(/\n{3,}/g, '\n\n')
    : `${current.replace(/\s+$/, '')}\n\n${section}\n`;

  await fs.writeFile(README_PATH, next, 'utf8');
}

function printCostTable(rows: CaseRow[]): void {
  console.log('');
  console.log('| case | tokens | cost USD | ms |');
  console.log('| --- | ---: | ---: | ---: |');
  for (const row of rows) {
    console.log(`| ${row.id} | ${row.usage.total_tokens ?? 0} | ${row.cost_usd.toFixed(6)} | ${row.ms} |`);
  }
  console.log(`| total | ${rows.reduce((sum, row) => sum + (row.usage.total_tokens ?? 0), 0)} | ` +
    `${rows.reduce((sum, row) => sum + row.cost_usd, 0).toFixed(6)} | |`);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const config: EvalConfig = await loadConfig();
  const maxCost = Number.isFinite(options.maxCost) ? options.maxCost : config.max_cost_usd;
  if (maxCost <= 0) throw new Error('max cost must be greater than zero');

  const allCases = await loadCases();
  const selected = selectCases(allCases, options);

  if (!selected.length) {
    console.error(
      options.category === 'memory' && !options.seedFacts
        ? 'memory cases need --seed-facts'
        : 'no cases selected',
    );
    process.exitCode = 2;
    return;
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'anden-evals-'));
  process.env.ANDEN_SQLITE_PATH = path.join(tempDir, 'anden.db');
  delete process.env.DATABASE_URL;

  const store = getStore();
  await store.init();

  const rows: CaseRow[] = [];
  let spent = 0;
  let abortedByCost = false;

  try {
    for (const testCase of selected) {
      if (spent > maxCost) {
        abortedByCost = true;
        break;
      }

      const userId = `eval-${testCase.id}`;
      await store.deleteAll(userId);
      if (options.seedFacts && testCase.user_facts) {
        for (const [key, raw] of Object.entries(testCase.user_facts)) {
          const value = validateFact(key as FactKey, raw);
          if (value !== null) await store.putFact(buildFact(userId, key as FactKey, value));
        }
      }

      const started = Date.now();
      let result: AgentResult;
      let error: string | undefined;

      try {
        result = await runAgent({ question: testCase.question, userId });
      } catch (caught) {
        if (caught instanceof LlmConfigError) throw caught;
        error = caught instanceof Error ? caught.message : String(caught);
        result = {
          answer: '',
          steps: [],
          sources: [],
          abstained: false,
          citationsValid: false,
          usage: {},
          evidence: [],
          truncated: false,
        };
      }

      const ms = Date.now() - started;
      const { checks, unsupported } = evaluate(testCase, result);
      const cost = costOf(result.usage, config);
      spent += cost;

      const row: CaseRow = {
        id: testCase.id,
        category: testCase.category,
        question: testCase.question,
        notes: testCase.notes,
        actual: {
          answer: result.answer,
          abstained: result.abstained,
          citations: extractCitations(result.answer),
          citations_valid: result.citationsValid,
          steps: result.steps,
          sources: result.sources.map((source) => source.id),
        },
        ...(error ? { error } : {}),
        checks,
        unsupported,
        usage: result.usage,
        cost_usd: cost,
        ms,
      };
      rows.push(row);

      const failed = Object.entries(checks)
        .filter(([name, value]) => failedCheck(name, value))
        .map(([name]) => name);
      console.log(
        `${testCase.id} ${failed.length ? `FAIL ${failed.join(',')}` : 'ok'} ${ms}ms ` +
          `$${cost.toFixed(6)}${error ? ` error=${error}` : ''}`,
      );
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  if (spent > maxCost) abortedByCost = true;

  const metrics = summarize(rows);
  const byCategory: Record<string, Metrics> = {};
  for (const category of CATEGORIES) {
    const categoryRows = rows.filter((row) => row.category === category);
    if (categoryRows.length) byCategory[category] = summarize(categoryRows);
  }

  const date = new Date().toISOString().slice(0, 10);
  const gateApplied = options.gate;
  const gatePassed = !gateApplied || (
    metrics.cases > 0 &&
    metrics.tool_accuracy !== null &&
    metrics.tool_accuracy >= 0.85 &&
    metrics.hallucination_rate <= 0.1
  );

  const payload = {
    generated_at: new Date().toISOString(),
    cases_requested: selected.length,
    subset: options.subset,
    category: options.category,
    seeded_facts: options.seedFacts,
    cases: rows,
    metrics,
    by_category: byCategory,
    cost: {
      currency: config.currency,
      input_per_1m: config.input_per_1m,
      output_per_1m: config.output_per_1m,
      assumption: config.assumption,
      max_cost_usd: maxCost,
      spent_usd: metrics.cost_usd,
    },
    aborted_by_cost: abortedByCost,
    gate: { applied: gateApplied, passed: gatePassed, hallucination_max: 0.1, tool_accuracy_min: 0.85 },
  };

  await fs.mkdir(path.dirname(options.out), { recursive: true });
  await fs.writeFile(options.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  if (options.writeReadme) await writeReadme(readmeSection(rows, metrics, byCategory, date));

  console.log('');
  console.log(`cases: ${metrics.cases}`);
  console.log(`tool_accuracy: ${metrics.tool_accuracy === null ? 'n/a' : metrics.tool_accuracy}`);
  console.log(`arg_accuracy: ${metrics.arg_accuracy === null ? 'n/a' : metrics.arg_accuracy}`);
  console.log(`citation_validity: ${metrics.citation_validity === null ? 'n/a' : metrics.citation_validity}`);
  console.log(`abstain_correctness: ${metrics.abstain_correctness}`);
  console.log(`hallucination_rate: ${metrics.hallucination_rate}`);
  console.log(`p50_ms: ${metrics.p50_ms} p95_ms: ${metrics.p95_ms}`);
  console.log(`tokens: ${metrics.tokens}`);
  console.log(`cost_usd: ${metrics.cost_usd.toFixed(6)} of ${maxCost} ${config.currency}`);
  printCostTable(rows);

  if (options.writeReadme) console.log(`readme: ${path.relative(ROOT, README_PATH)}`);
  console.log(`result: ${path.relative(ROOT, options.out)}`);

  if (abortedByCost) {
    console.error(`stopped: cost passed the ${maxCost} ${config.currency} limit`);
    process.exitCode = 1;
  } else if (gateApplied && !gatePassed) {
    console.error(
      `gate failed: hallucination_rate=${metrics.hallucination_rate} (max 0.10), ` +
        `tool_accuracy=${metrics.tool_accuracy ?? 'n/a'} (min 0.85)`,
    );
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  if (error instanceof LlmConfigError) {
    console.error('no model key configured: set ANDEN_LLM_KEY or ~/.config/b2first/ai.env');
    process.exitCode = 2;
    return;
  }
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
