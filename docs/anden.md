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
- Answers are one shot, with no conversation memory yet.
- Alert labels can drift because the alert file follows the live feed.

## Later stages

Memory, evals, and the harness are documented here as they land.
