# Anden, the AI layer

Anden adds an assistant layer on top of `subte-monitor` in five stages: an MCP server, retrieval, memory, evals, and a harness. Each stage is additive and runs without a database. This page records what is built and how to check it.

## Architecture

```text
                    ┌──────────────┐   ┌──────────────┐
                    │   /anden     │   │   /traces    │
                    │  chat page   │   │  table page  │
                    └──────┬───────┘   └──────┬───────┘
                           │                  │
                    ┌──────▼──────────────────▼───────┐
                    │  POST /api/anden/ask             │
                    │  GET  /api/anden/traces[/id]     │
                    └──────┬───────────────────┬──────┘
                           │                   │
                    ┌──────▼───────┐    ┌──────▼───────┐
                    │ harness      │    │ trace store  │
                    │ plan · budget│───▶│ sqlite / pg  │
                    │ guards·retry │    └──────────────┘
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ agent loop   │◀──▶ chat completions
                    │ runAgent     │
                    └──┬────┬───┬──┘
                       │    │   │
              ┌────────▼┐ ┌─▼────────┐ ┌▼─────────────┐
              │ tools/  │ │ retrieval│ │ memory       │
              │ @subte/ │ │ BM25     │ │ sqlite / pg  │
              │ core    │ │ corpus   │ │              │
              └────┬────┘ └──────────┘ └──────────────┘
                   │
              ┌────▼─────────────┐
              │ live app API     │
              │ bootstrap ·      │
              │ telemetry        │
              └──────────────────┘
```

The CLI in `scripts/anden/` calls the harness directly, without HTTP. The MCP package is a second client of the live app API and does not import the Next app.

## What each stage taught

| Stage | What landed | What it taught |
| --- | --- | --- |
| 1 | `subte-mcp` over stdio | The live API carries a useful server. Linea D is simulated and the feed can be slow. |
| 2 | BM25 retrieval with citations | Lexical search covers Spanish transit vocabulary. Citations catch claims the sources do not support. |
| 3 | Typed facts and turns | A remembered origin removes real repetition. Strict extraction beats guessing. |
| 4 | 50 hand-written cases and a runner | Tool selection is measurable. The hallucination proxy has blind spots. |
| 5 | Harness, traces and chat | A cost and time bound is what makes the agent usable. A trace makes a failure explainable. |

## Stage 1: subte-mcp

`packages/subte-mcp` is a standalone npm package that publishes the live subway data as MCP tools over stdio. It imports nothing from the Next app and uses no database or Prisma. Its only runtime dependencies are `@modelcontextprotocol/sdk` and `zod`.

It reads two public endpoints on the deployed app:

| Endpoint | Used for | Caching |
| --- | --- | --- |
| `/api/bootstrap` | Stations and GTFS stop sequences | 10 minutes, in memory |
| `/api/telemetry` | Trains, alerts, predictions | Never cached |

The base URL comes from `SUBTE_API_BASE` and defaults to the live deployment. Requests time out after 12 seconds and retry once on a network failure. A 4xx response is not retried. The timeout matches the app's own upstream budget: `/api/telemetry` waits up to 8 seconds for GCBA before it falls back to its cache, so a shorter client timeout would abort every slow refresh.

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
- The panel lists and deletes memory. The question box arrives in stage 5 at `/anden`.

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

`POST /api/anden/ask` called `runAgent` directly in stage 4. Stage 5 routes it through the harness. The response keeps the stage 2 fields and adds `steps`, one entry per tool call with `tool`, `args`, `ok` and `ms`, plus `trace_id`, `trace_steps`, `total_ms`, `tokens`, `cost_usd`, `truncated` and `citations`.

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
p50_ms: 2685 p95_ms: 4359
tokens: 143103
cost_usd: 0.042479 of 0.2 USD
```

Per category:

| Set | Cases | tool acc | arg acc | citation validity | abstain | hallucination | p50 ms | p95 ms | cost USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| all | 50 | 100% | 100% | 100% | 100% | 0% | 2685 | 4359 | 0.0425 |
| tool_selection | 15 | 100% | 100% | n/a | 100% | 0% | 2916 | 5015 | 0.0123 |
| trip_planning | 10 | 100% | 100% | n/a | 100% | 0% | 2662 | 3233 | 0.0087 |
| retrieval_citation | 10 | n/a | n/a | 100% | 100% | 0% | 2657 | 3180 | 0.0100 |
| abstain | 10 | n/a | n/a | n/a | 100% | 0% | 2043 | 11562 | 0.0071 |
| memory | 5 | 100% | n/a | n/a | 100% | 0% | 2559 | 2703 | 0.0045 |

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

## Stage 5: harness, traces and chat

The agent is the same one from stage 4. This stage wraps it in a harness that plans, bounds, guards and records every question, then exposes it to a person.

### Harness

`src/lib/anden/harness/` holds the loop around `runAgent`.

| File | Contents |
| --- | --- |
| `config.ts` | Budget numbers, model parameters and token prices |
| `schema.ts` | Zod schemas for the plan, the five tool argument sets and every stored step |
| `plan.ts` | Deterministic plan. `nearby_stations` is offered only when the question carries coordinates |
| `budget.ts` | Steps, tokens, cost and wall clock |
| `index.ts` | `runHarness({question, userId})` |

A question runs as `plan -> memory -> (tool | retrieve | answer)`. The plan, the memory read, every model decision, every tool call and the final answer are recorded as steps. A step is validated with zod before it is stored.

| Limit | Value | On hit |
| --- | --- | --- |
| Executed steps | 6. Five tool or retrieval calls plus the answer | Stop calling tools and answer with what is there |
| Tokens | 12,000 per question | Return the partial answer with `truncated: true` |
| Cost | USD 0.02 per question | Same |
| Wall clock | 25 s | Same |

The budget is checked before each model call and each tool call, not inside a call, so one slow request can push the total past 25 s. The harness does not throw on a budget hit: it returns the best answer it has and marks the trace `truncated`.

Guards run before a tool executes:

- Arguments are validated with zod. An invalid call goes back to the model as a tool error.
- The same tool with identical arguments is rejected inside one attempt. The duplicate set resets between attempts so a retry can repeat the call.
- Arguments that contain the memory block are rejected. A remembered station can still arrive as a structured `from` or `to`.

One retry is allowed for a transport error inside a tool or a thrown network error. The error text is appended to the next system prompt. A clean abstention is not retried. A run that ends in a dead end after invalid tool arguments is retried once with the validation error in the prompt.

`runAgent` takes optional `budget`, `memory`, `notes`, `allowedTools`, `maxToolCalls`, `beforeTool` and `onStep`. The evals keep calling it with no options, so stage 4 behavior and numbers are unchanged.

### Traces

Every question writes one row to `anden_traces` and the steps as JSON. The row stores the question, the steps, the totals, the model, a SHA-256 of the system prompt and the request parameters. That is enough to reproduce the run without storing the key or the whole prompt.

```text
GET /api/anden/traces?limit=50   -> { traces: [{ trace_id, question, steps, total_ms, tokens, cost_usd, ok, created_at }] }
GET /api/anden/traces/[id]       -> full trace, each step input and output cut at 800 chars
```

Both routes are scoped to the `subte_uid` cookie. The list counts memory, tool, retrieval and answer steps. The deterministic plan is not counted. The detail page shows every step, including the plan.

`/traces` is a server component with a plain table. The question links to `/traces/[id]`. There is no chart library and no client state. A visitor without a cookie sees an empty state until they ask a question.

### Chat

`/anden` is a client page with an input, the answer and one disclosure line under it:

```text
3 pasos · 6 fuentes · 3.1 s · $0.001
```

The disclosure expands with `<details>` to the tools used, the citations with their titles, the token count and a link to the trace. The empty state lists three real questions as buttons that fill the input. The page is not streaming: a request takes 3 to 6 seconds and streaming would add more state than it removes. Copy is Spanish and describes what Anden did, not a persona. All custom controls carry the shared focus ring, and the reduced-motion rule in `globals.css` covers the only animation.

The layout is mobile first. At 320 px the form stacks, the disclosure wraps and the citation line breaks on words.

### CLI

```bash
npm run anden:ask -- "¿está andando la línea B ahora?"
npm run anden:trace -- <trace_id>
```

`ask.ts` prints the answer, the tool calls, the sources, the token and cost totals, then the trace id. `trace.ts` prints the stored trace with the model, the prompt hash, the parameters and every step, cut at 800 chars. Both use the same sqlite store as the app.

### Check

Run from the repository root. These are the commands used for this stage:

```bash
npm run anden:ask -- "¿está andando la línea B ahora?"
npm run anden:ask -- "hasta qué hora funciona el subte"
npm run anden:trace -- f6a5f1a1-c628-413b-bff0-6b4a87ec4ddf
npm run evals -- --subset 10 --max-cost 0.20
node packages/subte-mcp/test/smoke.mjs
npx tsc --noEmit
npm run build
```

The line B question:

```text
Sí, la línea B está operando, con una alerta: la estación Medrano está cerrada por obras de renovación integral.

Pasos (1):
  1. subway_status(line="LineaB") ok 1633ms
Fuentes: 0
tokens: 2415 · costo: $0.000710 · 4556ms
trace: 9996df17-95c5-47da-b2f9-d92814d02236
```

The service hours question, shortened:

```text
El horario de cierre varía según la línea y el día: ... la Línea B a las 23:32 desde Leandro N. Alem y 23:00 desde Juan Manuel de Rosas [kb:ultimo-tren-linea-a] [kb:ultimo-tren-linea-b]. Los fines de semana y feriados el último tren sale más temprano; decime qué línea te interesa y te paso el detalle.

Pasos (1):
  1. search_knowledge(query="horario último tren hasta qué hora funciona el subte") ok 15ms
Fuentes (6):
  - kb:ultimo-tren-linea-c · Último tren de la Línea C
  - kb:ultimo-tren-linea-d · Último tren de la Línea D
  - kb:ultimo-tren-linea-h · Último tren de la Línea H
  - kb:ultimo-tren-linea-e · Último tren de la Línea E
  - kb:ultimo-tren-linea-a · Último tren de la Línea A
  - kb:ultimo-tren-linea-b · Último tren de la Línea B
tokens: 3254 · costo: $0.001032 · 3698ms
trace: f6a5f1a1-c628-413b-bff0-6b4a87ec4ddf
```

The stored trace, shortened:

```text
hasta qué hora funciona el subte
2026-10-30T02:27:06.187Z · 3698ms · 3254 tokens · $0.001032 · ok
modelo: deepseek-chat
prompt: sha256:e9477dcd6b234d3d38c0aa38a7d298462274f462d9daedb7af147c94b5f3f286
params: {"temperature":0,"max_tokens":600,"answer_max_tokens":400,"max_steps":6,...,"notes":null}

#1 plan ok 0ms tokens 0/0
#2 memory ok 2ms tokens 0/0
#3 plan ok 1378ms tokens 1080/49
#4 retrieve ok 15ms tokens 0/0
#5 answer ok 2298ms tokens 1989/136
```

Eval subset:

```text
cases: 10
tool_accuracy: 1
arg_accuracy: 1
citation_validity: 1
abstain_correctness: 1
hallucination_rate: 0
p50_ms: 2685 p95_ms: 11585
tokens: 30587
cost_usd: 0.009069 of 0.2 USD
```

The MCP smoke test ends with `smoke test passed against https://subte-monitor.vercel.app`. `npx tsc --noEmit` exits 0. `npm run build` exits 0 with no `DATABASE_URL` and lists `/anden`, `/traces`, `/traces/[id]` and the three `/api/anden` routes.

### Limits

- The wall clock is checked between steps. One 20 s model timeout can push a question past 25 s.
- Cost uses the same assumed token prices as the evals. A provider change makes the number wrong until `config.ts` is updated.
- The duplicate guard is per attempt. A run that needs the same call twice with identical arguments is blocked and must change the question or the arguments.
- Traces are scoped to the cookie. Clearing cookies loses the history. There is no shared view across users.
- `/anden` keeps the thread in memory. A reload starts with an empty page. The facts and the last turns still reach the model through the store.
- Streaming is not implemented.

## Run everything locally

No database and no `.env` are needed. The default store is `node:sqlite` in `.anden/anden.db`, which is gitignored.

```bash
npm install
npx tsc --noEmit
npm run anden:retrieval-eval
npm test -- tests/anden-memory.test.mjs
npm run evals:validate
npm run anden:ask -- "¿está andando la línea B ahora?"
npm run dev
```

The chat is at `http://localhost:3000/anden` and the traces are at `http://localhost:3000/traces`.

A model key is needed for the live paths. Set `ANDEN_LLM_KEY` for an endpoint that speaks the chat completions format, or leave the fallback file at `~/.config/b2first/ai.env` with `B2_AI_KEY`. The offline checks (`evals:validate`, the retrieval eval, the memory tests, `tsc`) run without a key. The MCP smoke test needs the package built once:

```bash
npm --prefix packages/subte-mcp run build
node packages/subte-mcp/test/smoke.mjs
```

Postgres is optional. Set `DATABASE_URL` to use the Neon adapters for memory and traces. The build does not touch the database: the Prisma client in `src/lib/db.ts` is created on first use, not at import. `npm run anden:corpus` is only needed when the knowledge base or the docs change.

## Known limits

- Retrieval is lexical. A question with no shared terms with the corpus will miss, and a Spanish question against an English document can miss even when the answer is there.
- The alert corpus is a snapshot. Refreshing it needs network access to the live API.
- The live API is part of the measurement. A slow or failing feed turns a case into an abstention or a failure, not a skip.
- The hallucination check is a proxy. It can miss a wrong claim that reuses a supported number and can flag a correct computed figure that is not in the evidence.
- Memory extraction is one strict model call. A vague sentence can produce no fact.
- The Postgres adapters for memory and traces are implemented but were not run against a live Neon database here, because this environment has no `DATABASE_URL`. The sqlite path is the tested one.
- Identity is a cookie. There is no login and no way to recover the stored facts after clearing it.
- The harness budget bounds cost and time. It does not make the model correct, and the evals are the place where correctness is measured.


