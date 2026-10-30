import { promises as fs } from "node:fs";
import path from "node:path";
import { matchLines } from "@subte/core";
import { FACT_KEYS, validateFact } from "../src/lib/anden/facts";
import { TOOLS } from "../src/lib/anden/tools";
import {
  CATEGORIES,
  CATEGORY_COUNTS,
  ROOT,
  TOTAL_CASES,
  loadCases,
  type Category,
  type EvalCase,
  type EvalExpect,
} from "./lib";

const CORPUS_FILES = ["knowledge.jsonl", "alerts.jsonl", "docs.jsonl"].map((name) =>
  path.join(ROOT, "data", "corpus", name)
);

const STATION_KEYS = new Set(["from", "to", "station"]);
const NUMBER_KEYS = new Set(["lat", "lng", "limit"]);
const ARG_KEYS = new Set(["from", "to", "station", "line", "lat", "lng", "step_free", "limit"]);
const EXPECT_KEYS = new Set([
  "tool",
  "first",
  "no_tool",
  "args_contains",
  "cites",
  "abstained",
  "uses_fact",
]);
const ID_PREFIX: Record<Category, string> = {
  tool_selection: "ts-",
  trip_planning: "trip-",
  retrieval_citation: "ret-",
  abstain: "abs-",
  memory: "mem-",
};
const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));

async function corpusIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const file of CORPUS_FILES) {
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { id?: unknown };
        if (typeof entry.id === "string") ids.add(entry.id);
      } catch {
        // corpus files are generated; a broken line is caught by the retrieval eval
      }
    }
  }
  return ids;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function checkCase(
  testCase: EvalCase,
  ids: Set<string>,
  errors: string[],
  negatives: { count: number }
): void {
  const fail = (message: string): void => {
    errors.push(`${testCase.id}: ${message}`);
  };

  if (!testCase.id || typeof testCase.id !== "string") {
    fail("id must be a string");
    return;
  }
  if (!testCase.id.startsWith(ID_PREFIX[testCase.category]))
    fail(`id must start with ${ID_PREFIX[testCase.category]}`);
  if (!CATEGORIES.includes(testCase.category)) fail(`unknown category '${testCase.category}'`);
  if (typeof testCase.question !== "string" || testCase.question.trim().length < 6)
    fail("question is too short");
  if (typeof testCase.notes !== "string" || !testCase.notes.trim()) fail("notes is required");

  const rawExpect: unknown = testCase.expect;
  if (!isObject(rawExpect)) {
    fail("expect must be an object");
    return;
  }
  const expect = rawExpect as EvalExpect;
  for (const key of Object.keys(expect)) {
    if (!EXPECT_KEYS.has(key)) fail(`unknown expect key '${key}'`);
  }
  if (!Object.keys(expect).length) fail("expect is empty");

  if (
    expect.tool !== undefined &&
    (typeof expect.tool !== "string" || !TOOL_NAMES.has(expect.tool))
  ) {
    fail(`unknown tool '${expect.tool}'`);
  }
  if (expect.first !== undefined && typeof expect.first !== "boolean")
    fail("expect.first must be a boolean");
  if (expect.no_tool !== undefined && typeof expect.no_tool !== "boolean")
    fail("expect.no_tool must be a boolean");
  if (expect.no_tool && expect.tool) fail("use either expect.tool or expect.no_tool");
  if (expect.abstained !== undefined && typeof expect.abstained !== "boolean")
    fail("expect.abstained must be a boolean");
  if (expect.uses_fact !== undefined && !FACT_KEYS.includes(expect.uses_fact as never)) {
    fail(`unknown fact '${expect.uses_fact}'`);
  }

  const args: unknown = expect.args_contains;
  if (args !== undefined) {
    if (!isObject(args)) {
      fail("expect.args_contains must be an object");
    } else {
      for (const [key, value] of Object.entries(args)) {
        if (!ARG_KEYS.has(key)) fail(`unknown argument '${key}'`);
        if (
          STATION_KEYS.has(key) &&
          (typeof value !== "string" || !validateFact("home_station", value))
        ) {
          fail(`argument '${key}' is not a known station: ${JSON.stringify(value)}`);
        }
        if (key === "line" && (typeof value !== "string" || !matchLines(value).length)) {
          fail(`argument 'line' is not a known line: ${JSON.stringify(value)}`);
        }
        if (key === "step_free" && typeof value !== "boolean")
          fail("argument step_free must be a boolean");
        if (NUMBER_KEYS.has(key) && typeof value !== "number")
          fail(`argument ${key} must be a number`);
      }
    }
  }

  if (expect.cites !== undefined) {
    if (!Array.isArray(expect.cites) || !expect.cites.length) {
      fail("expect.cites must be a non-empty array");
    } else {
      for (const id of expect.cites) {
        if (typeof id !== "string" || !ids.has(id))
          fail(`citation id is not in the corpus: ${String(id)}`);
      }
    }
  }

  if (testCase.user_facts !== undefined) {
    if (!isObject(testCase.user_facts)) {
      fail("user_facts must be an object");
    } else {
      for (const [key, value] of Object.entries(testCase.user_facts)) {
        if (!FACT_KEYS.includes(key as never)) fail(`unknown fact in user_facts: ${key}`);
        else if (validateFact(key as never, value) === null)
          fail(`invalid value for fact ${key}: ${JSON.stringify(value)}`);
      }
    }
  }

  switch (testCase.category) {
    case "tool_selection": {
      const negative = expect.no_tool === true || expect.tool === "search_knowledge";
      if (negative) negatives.count += 1;
      else if (expect.tool && expect.first !== true)
        fail("positive tool_selection cases must set expect.first");
      break;
    }
    case "trip_planning":
      if (expect.tool !== "plan_trip") fail("trip_planning expects plan_trip");
      if (!expect.args_contains?.from || !expect.args_contains?.to)
        fail("trip_planning needs from and to");
      break;
    case "retrieval_citation":
      if (!expect.cites?.length) fail("retrieval_citation needs expect.cites");
      break;
    case "abstain":
      if (expect.abstained !== true) fail("abstain cases need expect.abstained true");
      break;
    case "memory":
      if (!testCase.user_facts || !Object.keys(testCase.user_facts).length)
        fail("memory cases need user_facts");
      if (!expect.uses_fact) fail("memory cases need expect.uses_fact");
      break;
  }
}

async function main(): Promise<void> {
  const cases = await loadCases();
  const ids = await corpusIds();
  const errors: string[] = [];
  const seen = new Set<string>();
  const counts = new Map<Category, number>();
  const negatives = { count: 0 };

  for (const testCase of cases) {
    if (typeof testCase.id === "string") {
      if (seen.has(testCase.id)) errors.push(`${testCase.id}: duplicate id`);
      seen.add(testCase.id);
    }
    if (CATEGORIES.includes(testCase.category)) {
      counts.set(testCase.category, (counts.get(testCase.category) ?? 0) + 1);
    }
    checkCase(testCase, ids, errors, negatives);
  }

  if (cases.length !== TOTAL_CASES)
    errors.push(`expected ${TOTAL_CASES} cases, found ${cases.length}`);
  for (const category of CATEGORIES) {
    const found = counts.get(category) ?? 0;
    if (found !== CATEGORY_COUNTS[category]) {
      errors.push(`expected ${CATEGORY_COUNTS[category]} ${category} cases, found ${found}`);
    }
  }
  if (negatives.count !== 4)
    errors.push(`expected 4 negative tool_selection cases, found ${negatives.count}`);

  if (errors.length) {
    console.error(`case schema invalid: ${errors.length} problem(s)`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`cases: ${cases.length}`);
  for (const category of CATEGORIES) console.log(`  ${category}: ${counts.get(category)}`);
  console.log(`corpus ids available: ${ids.size}`);
  console.log("case schema ok");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
