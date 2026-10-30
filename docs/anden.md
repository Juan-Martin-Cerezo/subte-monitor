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

The planner runs Dijkstra over two kinds of edge: a ride between adjacent stops costs 2 minutes, a transfer costs 3. Transfers come from stations with the same name on different lines plus the interchange pairs in `packages/subte-mcp/src/data/transfers.json`, copied from `src/lib/connections.ts`. Floor access comes from `packages/subte-mcp/src/data/accessibility.json`, copied from the app's station accessibility data. With `step_free=true`, transfers at stations without an elevator are removed.

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

## Later stages

Retrieval, memory, evals, and the harness are documented here as they land.
