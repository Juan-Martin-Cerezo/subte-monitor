# Anden, the AI layer

Anden adds an assistant layer on top of `subte-monitor` in five stages: an MCP server, retrieval, memory, evals, and a harness. Each stage is additive and runs without a database. This page records what is built and how to check it.

## Stage 1: subte-mcp

`packages/subte-mcp` is a standalone npm package that publishes the live subway data as MCP tools over stdio. It imports nothing from the Next app and uses no database or Prisma. Its only runtime dependencies are `@modelcontextprotocol/sdk` and `zod`.

It reads two public endpoints on the deployed app:

| Endpoint | Used for | Caching |
| --- | --- | --- |
| `/api/bootstrap` | Stations and GTFS stop sequences | 10 minutes, in memory |
| `/api/telemetry` | Trains, alerts, predictions | Never cached |

The base URL comes from `SUBTE_API_BASE` and defaults to the live deployment. Requests time out after 5 seconds and retry once on a network failure. A 4xx response is not retried.

### Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `subway_status` | `line?` | Alerts grouped by line, `stale`, feed age |
| `next_trains` | `station`, `line?`, `limit=3` | Arrivals at one station sorted by ETA |
| `plan_trip` | `from`, `to`, `step_free=false` | Legs, transfers, stop count, minutes |
| `nearby_stations` | `lat`, `lng`, `radius_m=800` | Stations with distance in meters |

Station names match without case or accents, so `Agüero`, `aguero`, and `AGUERO` reach the same station. A name that matches several stations returns the candidates instead of a guess.

The planner runs Dijkstra over two kinds of edge: a ride between adjacent stops costs 2 minutes, a transfer costs 3. Transfers come from stations with the same name on different lines plus the interchange pairs in `packages/subte-mcp/src/data/transfers.json`. The app's `STATION_CONNECTIONS` map in `src/lib/connections.ts` only lists bus and rail links, so the package keeps its own list of underground interchanges. Floor access comes from `packages/subte-mcp/src/data/accessibility.json`, copied from `ACCESSIBILITY_METADATA` in `src/lib/metadata.ts`. With `step_free=true`, transfers at stations without an elevator are removed.

Client setup, request and response examples, and the limits live in [packages/subte-mcp/README.md](../packages/subte-mcp/README.md).

The tool bodies are a thin layer over `packages/subte-mcp/src/core/`. That core has no MCP and no Next imports, and the app uses the same files through the `@subte/core` path. The split is described in stage 4.

### Build and check

Run from the repository root:

```bash
npm --prefix packages/subte-mcp run build
node packages/subte-mcp/test/smoke.mjs
npx tsc --noEmit
```

The smoke test spawns the built server with the SDK client against the live API. It does not need a key. Last run:

```text
tools/list ok: nearby_stations, next_trains, plan_trip, subway_status
subway_status ok: stale=false feedAge=2s alerts=3
subway_status filter ok: ["LineaB"]
next_trains ok: 2 arrivals at Uruguay
next_trains accent/case match ok
plan_trip ok: 7 stops, 1 transfers, 17 min
plan_trip step-free ok: 7 stops, 1 transfers
nearby_stations ok: 11 stations within 800m
error mapping ok: unknown station
error mapping ok: ambiguous station
error mapping ok: same station
error mapping ok: unknown line
smoke test passed against https://subte-monitor.vercel.app
```

Warm medians from a local run, Node 22.23, against the live API:

| Tool | Median call | Response |
| --- | --- | --- |
| `subway_status` | 415 ms | 0.9 KB |
| `next_trains` | 413 ms | 0.4 KB |
| `plan_trip` | 6 ms | 0.4 KB |
| `nearby_stations` | 2 ms | 1.3 KB |

### Limits

- Linea D is simulated by the app instead of coming from the GCBA feed. The server passes through what `/api/telemetry` reports, so D arrivals appear when the simulated feed has them. When a D-only station has no arrivals, the response carries a note saying so.
- Trip durations are estimates from the 2 minute and 3 minute assumptions and exclude the first wait. Use `next_trains` for the real ETA.
- The reference feed is mostly unaccented. Matching removes accents, but a misspelling more than two edits away falls back to a closest-name error.
- Stations missing from the accessibility data count as not step-free, so some step-free trips report no route.

## Stage 2: retrieval and cited answers

`POST /api/anden/ask` answers questions about the network from a committed corpus. Retrieval is BM25 without embeddings or a database. Every factual claim in the answer carries the id of the source that supports it.

### Corpus

The corpus is three JSONL files under `data/corpus/`, one object per line with `{id, title, text, source, kind}`.

| File | Entries | Contents |
| --- | --- | --- |
| `knowledge.jsonl` | 133 | Lines and stations, first and last train hours, fares and SUBE discounts, accessibility per station, transfer rules, how the app treats Linea D |
| `alerts.jsonl` | 3 | GCBA alerts from the live feed, with `first_seen` and `last_seen` |
| `docs.jsonl` | 73 | This repository's Markdown chunked on headings, 303 to 900 characters, prefixed with the heading path |

`data/corpus/labels.jsonl` holds 26 hand-written `{query, expected_ids}` pairs used by the retrieval eval. They were written against the corpus, not generated from retriever output.

Rebuild the generated files with:

```bash
npm run anden:corpus
```

The builder regenerates `docs.jsonl`, then merges alerts by id. It is safe to run from cron: the same alert id updates `last_seen` instead of adding a line, and an unreachable feed leaves the existing file in place. `npm run anden:poll-alerts` runs only the alert merge.

### Retrieval

`src/lib/anden/retrieval/` contains the tokenizer and a hand-written BM25 index.

- `k1 = 1.5`, `b = 0.75`, title tokens counted twice.
- Exact phrase bonus on the raw question, both in the title and the text.
- The index is built once per process and rebuilt when a corpus file changes its mtime or size.
- `search(query, k=6)` returns `{id, title, text, source, score}`.
- The tokenizer lowercases, strips accents, drops Spanish stopwords and single characters, and folds `línea B` into `lineab` so a line question matches `LineaB` in route ids.

### Answering

The request body is `{question, session_id?}`. The endpoint retrieves six sources, renders them as `[S1]` to `[S6]` with their ids, and asks the model to answer in Spanish using only those sources.

- `fetch` to the chat completions endpoint, `temperature 0.2`, `max_tokens 400`, 20 second timeout, no streaming.
- Key from `ANDEN_LLM_KEY`, then `~/.config/b2first/ai.env` (`B2_AI_KEY`, `B2_AI_PROVIDER`, `B2_AI_MODEL`). The key is never logged.
- Citations are checked in code. An id outside the retrieved set is stripped and sets `citations_valid` to false.
- A factual answer with no valid citation is retried once with a stricter instruction. If the retry still cites nothing, the endpoint replies exactly `No tengo información sobre eso.` and sets `abstained`.
- No sources yields the same abstention without calling the model.

### Check

```bash
npm run anden:corpus
npm run anden:retrieval-eval
npm run dev
curl -s -X POST localhost:3000/api/anden/ask -H 'content-type: application/json' -d '{"question":"¿hasta qué hora funciona la línea B?"}'
npx tsc --noEmit
```

Eval output on the committed corpus:

```text
queries: 26
recall@5: 0.962 (threshold 0.75)
MRR: 0.849
```

Answer from the curl above, shortened:

```json
{
  "answer": "La Línea B funciona hasta las 23:32 de lunes a viernes (último tren desde Leandro N. Alem) y hasta las 23:00 desde Juan Manuel de Rosas - Villa Urquiza [kb:ultimo-tren-linea-b]. Los sábados hasta las 23:56 y 23:25, y los domingos y feriados hasta las 22:31 y 22:00 [kb:ultimo-tren-linea-b].",
  "abstained": false,
  "citations_valid": true,
  "usage": { "prompt_tokens": 782, "completion_tokens": 106, "total_tokens": 888 }
}
```

### Limits

- Retrieval is lexical. A question that shares no terms with the corpus will miss, and a Spanish question against an English document can miss even when the answer is there.
- The alert corpus is a snapshot. Refreshing it needs network access to the live API.
- Answers were one shot before stage 3. From stage 3 on, the last turns and typed facts are part of the request.
- Alert labels can drift because the alert file follows the live feed.

## Stage 3: memory

Anden keeps a small set of typed facts and the last turns of a conversation, so a follow-up question does not repeat the origin. Everything is visible and deletable from the app.

### Storage

`src/lib/anden/store/` has one interface and two adapters.

- `sqlite.ts` is the default. It uses `node:sqlite`, writes to `.anden/anden.db` (gitignored) and enables WAL on `init()`.
- `postgres.ts` is used only when `DATABASE_URL` is set. It talks to Neon over HTTP with `@neondatabase/serverless`, which is already a dependency, and creates the same two tables.
- `index.ts` picks the adapter once per process and exposes `getStore()`.

The user id comes from the `subte_uid` cookie: a random uuid, httpOnly, one year, same site lax. There is no login and no other personal data.

```text
anden_facts(user_id, key, value, updated_at, expires_at)  primary key (user_id, key)
anden_turns(id, user_id, question, answer, created_at)
```

| Fact | Value | TTL |
| --- | --- | --- |
| `home_station`, `work_station` | Canonical station name | 180 days |
| `step_free` | Boolean | 180 days |
| `usual_line` | `LineaA` to `LineaH`, `Premetro` | 180 days |
| `usual_departure_time` | `HH:MM` | 30 days |
| `max_transfer_minutes` | Integer, 0 to 120 | 30 days |

`listFacts` deletes expired rows before it selects, so an expired fact is invisible immediately and removed lazily. Station names are checked against `src/lib/anden/station-names.ts`, generated from `gtfs.zip` with `npm run anden:stations`. That is the same station set `/api/bootstrap` serves. A misspelled or invented station is dropped.

Turns are stored truncated to 500 characters. Each user keeps the last 8, and anything older than 24 hours is deleted on write and before a read.

### Extraction

After a successful answer, `extractFacts` makes one model call with `response_format: json_object`, temperature 0 and `max_tokens` 180. The prompt lists the six keys and the station catalogue. The model returns only facts the user stated explicitly, or `{}`. The message may contain a question, and the prompt tells the model to ignore it and read only the statements. Unknown keys and invalid values are discarded in code.

The extraction call is best effort. A failure is caught and the answer is returned unchanged.

### Ask flow

`POST /api/anden/ask` now reads memory before answering and writes it after.

- It loads the facts and the last 4 turns. Past turns go into the message history.
- The facts go into the system prompt. If the question does not state an origin, the model assumes `home_station`. If it does not state a destination, it assumes `work_station`.
- For a trip question with fewer than two station names, the endpoint prepends one short clause, for example `Desde Pueyrredon, como siempre.` It skips the clause when the answer already names that station. The clause is added after citation checks, so it never carries a citation.
- An abstained answer is not stored and does not trigger extraction.
- After a normal answer, extracted facts are upserted with fresh TTLs and the turn is saved.

### Memory surface

```text
GET    /api/anden/memory                 -> { facts: [{key, value, updated_at, expires_at}], turns }
DELETE /api/anden/memory?key=home_station -> { deleted: true }
DELETE /api/anden/memory                 -> { deleted: n }
```

`DELETE` without `key` removes facts and turns for that cookie and returns the number of rows. An unknown key returns 400 and a missing fact returns 404 with `deleted: false`.

The settings gear in the header opens a panel in Spanish. It lists each fact with its expiry, a delete button per row and `Borrar todo` with an inline confirmation. The panel closes on Escape, traps Tab inside the dialog and is reachable from the desktop and mobile headers.

### Check

```bash
npm test -- tests/anden-memory.test.mjs
npx tsc --noEmit
npm run dev
```

The test file runs on `node:sqlite` with no network and no model key:

```text
# Subtest: put, list and delete one fact
ok 1 - put, list and delete one fact
# Subtest: expired facts stay hidden and are removed lazily
ok 2 - expired facts stay hidden and are removed lazily
# Subtest: delete all removes facts and turns for one user
ok 3 - delete all removes facts and turns for one user
# Subtest: two users do not see each other
ok 4 - two users do not see each other
# Subtest: invalid station and malformed values are rejected
ok 5 - invalid station and malformed values are rejected
# Subtest: turns keep the last eight, newest last, and truncate text
ok 6 - turns keep the last eight, newest last, and truncate text
# Subtest: turns older than a day are dropped
ok 7 - turns older than a day are dropped
1..7
# tests 7
# pass 7
# fail 0
```

Manual run against the dev server, with a cookie jar:

```bash
curl -s -c jar -b jar -X POST localhost:3000/api/anden/ask \
  -H 'content-type: application/json' \
  -d '{"question":"Salgo siempre de Pueyrredón y voy a Plaza de Mayo. ¿Hasta qué hora funciona la línea B?"}'
curl -s -c jar -b jar localhost:3000/api/anden/memory
curl -s -c jar -b jar -X POST localhost:3000/api/anden/ask \
  -H 'content-type: application/json' \
  -d '{"question":"¿Qué línea me conviene para ir a Plaza de Mayo?"}'
```

Second answer:

```json
{
  "answer": "Desde Pueyrredon, como siempre. Te conviene la Línea A, que tiene una estación en Plaza de Mayo [kb:linea-a-estaciones].",
  "abstained": false,
  "citations_valid": true
}
```

Memory after the two questions:

```json
{
  "facts": [
    { "key": "home_station", "value": "Pueyrredon", "updated_at": "2026-10-30T01:20:45.749Z", "expires_at": "2027-04-28T01:20:45.749Z" },
    { "key": "work_station", "value": "Plaza de Mayo", "updated_at": "2026-10-30T01:20:45.749Z", "expires_at": "2027-04-28T01:20:45.749Z" }
  ],
  "turns": 2
}
```

Deletes:

```text
DELETE /api/anden/memory?key=home_station -> {"deleted":true}
DELETE /api/anden/memory                 -> {"deleted":3}
```

After the second delete, `GET /api/anden/memory` returns `{"facts":[],"turns":0}`.

Observed timings from the dev log on this machine:

| Request | Time |
| --- | --- |
| `POST /api/anden/ask` with memory | 2.5 s, 2.4 s |
| `GET /api/anden/memory` | 16 to 64 ms |
| `DELETE /api/anden/memory` | 23 to 43 ms |

### Limits

- Extraction is one model call and it is strict. A vague sentence can produce no fact. An explicit `mi casa es X` or `salgo de X` is reliable.
- Memory supplies the origin and destination. The answer still comes from the BM25 corpus, so a route question outside the corpus abstains even when the stations are known.
- The Postgres adapter is implemented but was not run against a live Neon database here, because this environment has no `DATABASE_URL`. The sqlite adapter is the tested path.
- Identity is the cookie. Clearing cookies loses access to the stored facts.
- The panel lists and deletes memory. There is no in-app question box yet.

## Stage 4: evals

This stage answers one question with numbers: how often is Anden wrong. The answer is reproducible with a small set of commands and no database.

### Shared core

The tool logic moved out of the MCP transport into `packages/subte-mcp/src/core/`:

| File | Contents |
| --- | --- |
| `client.ts` | HTTP client, bootstrap cache, timeouts and API errors |
| `feed.ts` | Feed freshness from the telemetry payload |
| `lines.ts`, `names.ts` | Line matching and station name normalisation |
| `network.ts` | Station index, name resolution, Dijkstra planner, nearby search |
| `status.ts`, `next-trains.ts`, `plan-trip.ts`, `nearby.ts` | One exported function per tool |
| `types.ts`, `index.ts` | Payload types and the public surface |

The core imports no MCP SDK and no Next module. The four MCP tools now only declare the schema and delegate to it. The app reaches the same files through the `@subte/core` path in `tsconfig.json`, so there is one implementation of each tool.

Core files import each other with `.ts` extensions. Turbopack resolves them directly from source, and the package build rewrites them to `.js` through `rewriteRelativeImportExtensions`. Without that, the app build and the Node ESM build need different specifiers.

### Agent

`src/lib/anden/agent/run.ts` exports `runAgent({question, userId})`.

- One function calling loop, at most 4 tool calls, `temperature 0`, `max_tokens 600`, no streaming.
- Tools come from `src/lib/anden/tools/`: `subway_status`, `next_trains`, `plan_trip`, `nearby_stations` and `search_knowledge`. The last one wraps the BM25 index and returns source ids.
- Memory facts go into the system prompt and the last 4 turns go into the message history before the question.
- A tool error is returned to the model as text, so it can choose another tool.
- The stage 2 citation checker still runs on the answer. When the only successful tool was `search_knowledge` and the answer has no valid citation, the agent makes one repair call. If the repair still cites nothing, it abstains with `No tengo información sobre eso.`
- The returned object is `{answer, steps, sources, abstained, citationsValid, usage, evidence}`. `evidence` holds the tool output the model saw and is used by the evals. The HTTP route does not expose it.

`POST /api/anden/ask` is now a wrapper around `runAgent`. It keeps the stage 2 response fields and adds `steps`, one entry per tool call with `tool`, `args`, `ok` and `ms`.

### Golden set

`evals/cases.jsonl` has 50 hand written cases. Every station name and corpus id was checked against the real files.

| Category | Cases | Expectation |
| --- | ---: | --- |
| `tool_selection` | 15 | 11 positive cases where the tool must be called first, plus 4 negatives where `search_knowledge` or no tool is right |
| `trip_planning` | 10 | `plan_trip` with `from` and `to`, and the returned legs must not use the destination as origin. 2 cases are step-free |
| `retrieval_citation` | 10 | The answer cites an expected corpus id and does not abstain |
| `abstain` | 10 | Impossible or out-of-scope questions, including a line and station pair that does not exist |
| `memory` | 5 | Seeded `user_facts`, a question without an origin, and `expect.uses_fact: home_station` |

`npm run evals:validate` checks the schema without a key or network. It checks counts, unique ids, tool and fact names, station arguments and that every expected citation exists in the corpus.

### Runner

`evals/run.ts` is plain TypeScript run with `tsx`. There is no test framework.

| Flag | Effect |
| --- | --- |
| `--subset N` | N cases, one per category in rotation |
| `--category X` | One category |
| `--seed-facts` | Seed memory facts in a temporary sqlite database |
| `--max-cost USD` | Stop and exit 1 before the run passes the limit |
| `--out path` | JSON output path |
| `--write-readme` | Replace the table between the evals markers in `README.md` |
| `--gate` | Exit 1 when `hallucination_rate > 0.10` or `tool_accuracy < 0.85` |

Scores are `tool_accuracy`, `arg_accuracy`, `citation_validity`, `abstain_correctness`, `hallucination_rate`, `p50_ms`, `p95_ms`, `tokens` and `cost_usd`. The detailed output goes to `evals/results/latest.json`. The cost uses `evals/config.json`, currently 0.27 USD per 1M input tokens and 1.10 USD per 1M output tokens. That is an assumption for the configured model and has to change with the provider.

The hallucination check is deterministic. It compares station names and line names against the question, the tool output and the seeded facts, and numbers against the same evidence. Citation ids are stripped first. A number reported in seconds by a tool is accepted when the answer restates it in minutes. `evals/README.md` describes the limits of this check and what is not measured.

### Results

The stage commands, run from the repository root on 2026-10-30:

```bash
npm run evals -- --subset 10 --max-cost 0.20
npm run anden:retrieval-eval
npm test -- tests/anden-memory.test.mjs
node packages/subte-mcp/test/smoke.mjs
npx tsc --noEmit
```

Eval subset:

```text
cases: 10
tool_accuracy: 1
arg_accuracy: 1
citation_validity: 1
abstain_correctness: 1
hallucination_rate: 0
p50_ms: 2776 p95_ms: 9513
tokens: 30582
cost_usd: 0.009064 of 0.2 USD
```

The full set, run with `npm run evals -- --seed-facts --write-readme --max-cost 0.20`:

```text
cases: 50
tool_accuracy: 1
arg_accuracy: 1
citation_validity: 1
abstain_correctness: 1
hallucination_rate: 0
p50_ms: 2626 p95_ms: 4152
tokens: 142992
cost_usd: 0.042452 of 0.2 USD
```

Per category:

| Set | Cases | tool acc | arg acc | citation validity | abstain | hallucination | p50 ms | p95 ms | cost USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| all | 50 | 100% | 100% | 100% | 100% | 0% | 2626 | 4152 | 0.0425 |
| tool_selection | 15 | 100% | 100% | n/a | 100% | 0% | 2948 | 4470 | 0.0123 |
| trip_planning | 10 | 100% | 100% | n/a | 100% | 0% | 2616 | 3014 | 0.0087 |
| retrieval_citation | 10 | n/a | n/a | 100% | 100% | 0% | 2554 | 3192 | 0.0099 |
| abstain | 10 | n/a | n/a | n/a | 100% | 0% | 2146 | 12445 | 0.0070 |
| memory | 5 | 100% | n/a | n/a | 100% | 0% | 2577 | 2739 | 0.0045 |

Retrieval eval:

```text
queries: 26
recall@5: 0.962 (threshold 0.75)
MRR: 0.849
```

Memory tests: 7 pass, 0 fail. The MCP smoke test ends with `smoke test passed against https://subte-monitor.vercel.app`. `npx tsc --noEmit` exits 0.

The root `README.md` carries the same summary table between `<!-- evals:start -->` and `<!-- evals:end -->`. History is kept by git, not by extra result files.

### CI

`.github/workflows/evals.yml` runs the offline parts on push and pull request: `tsc`, `npm run anden:retrieval-eval`, the memory tests and `npm run evals:validate`. It needs no key. The live eval runs on `workflow_dispatch` with `ANDEN_LLM_KEY` from secrets, `--subset 15 --max-cost 0.10 --gate`. The job fails above 10 percent hallucination or below 85 percent tool accuracy.

### Limits

- The hallucination check is a proxy. It can miss a wrong claim that reuses a supported number, for example a price from the wrong monthly tier of the same table. It can also flag a correct figure that the model computed and that never appears in the evidence.
- The live API is part of the measurement. `p95` includes upstream latency, and an outage turns a case into a failure rather than a skip.
- A subset run is a sample. The 10 case run and the 50 case run can differ.
- Memory cases need `--seed-facts`. Without it they are left out of the pool.
- Live evals need a model key. The offline CI job does not run the model.
- There is no second model judge. The stage allows one as a second opinion, but it is not the primary metric, so it is not part of the score.

## Later stages

The harness in stage 5 is documented here as it lands.

