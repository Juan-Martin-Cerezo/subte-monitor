# subte-mcp

MCP server for the Buenos Aires subway. It exposes live train arrivals, official service alerts, a step-free trip planner, and nearby stations as four tools that any MCP client can call. It talks to the public `subte-monitor` HTTP API over HTTPS and needs no database, no API key, and no copy of the Next.js app.

## Install

Run it directly with `npx`:

```bash
npx -y subte-mcp
```

The process speaks MCP over stdio. It is meant to be launched by a client, not by hand.

From a local checkout:

```bash
npm --prefix packages/subte-mcp install
npm --prefix packages/subte-mcp run build
node packages/subte-mcp/dist/index.js
```

## Client setup

Claude Desktop, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "subte": {
      "command": "npx",
      "args": ["-y", "subte-mcp"]
    }
  }
}
```

Cursor, in `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "subte": {
      "command": "npx",
      "args": ["-y", "subte-mcp"],
      "env": {
        "SUBTE_API_BASE": "https://subte-monitor.vercel.app"
      }
    }
  }
}
```

`SUBTE_API_BASE` is optional. Point it at another deployment of the same API if you run one. The default is the live deployment above.

For a local checkout, use `"command": "node"` and the absolute path to `packages/subte-mcp/dist/index.js` in `args`.

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `subway_status` | `line?` | Official alerts grouped by line, `stale` flag, feed age in seconds. |
| `next_trains` | `station`, `line?`, `limit=3` | Upcoming arrivals at one station, sorted by ETA. |
| `plan_trip` | `from`, `to`, `step_free=false` | Legs with board/alight stations, total stops, transfers, estimated minutes. |
| `nearby_stations` | `lat`, `lng`, `radius_m=800` | Stations inside the radius, sorted by distance in meters. |

Descriptions in `tools/list` state when to use each tool and when not to. Errors come back as `isError: true` with a message that names the closest stations, the valid lines, or the candidates when a station name is ambiguous.

Station names match case and accent insensitively: `Agüero`, `aguero`, and `AGUERO` all reach the same station. A partial name that matches several stations returns the candidate list instead of a guess.

### `subway_status`

Call with no arguments for the whole network, or `{"line": "LineaB"}` to filter. `B`, `LineaB`, and `Premetro` are accepted.

```json
{
  "generatedAt": "2026-10-30T00:33:41.124Z",
  "stale": false,
  "feedAgeSeconds": 2,
  "feedUpdatedAt": "2026-10-30T00:33:39.000Z",
  "alertCount": 3,
  "alerts": {
    "LineaB": [
      {
        "id": "Alert_LineaB",
        "header": "Estación Medrano cerrada por obras de renovación integral.",
        "description": "Estación Medrano cerrada por obras de renovación integral.",
        "cause": "Operativo Policial",
        "effect": "Modificación de Servicio"
      }
    ],
    "LineaC": [
      {
        "id": "Alert_LineaC",
        "header": "Estación Lavalle cerrada por obras de renovación integral.",
        "description": "Estación Lavalle cerrada por obras de renovación integral.",
        "cause": "Operativo Policial",
        "effect": "Modificación de Servicio"
      }
    ],
    "LineaE": [
      {
        "id": "Alert_LineaE",
        "header": "Entre Ríos y Urquiza cerradas por obras de renovación integral.",
        "description": "Entre Ríos y Urquiza cerradas por obras de renovación integral.",
        "cause": "Otro",
        "effect": "Servicio Limitado"
      }
    ]
  }
}
```

### `next_trains`

```json
{"station": "Uruguay", "limit": 3}
```

```json
{
  "station": "Uruguay",
  "lines": ["LineaB"],
  "stale": false,
  "feedAgeSeconds": 1,
  "feedUpdatedAt": "2026-10-30T00:34:11.000Z",
  "arrivals": [
    {
      "line": "LineaB",
      "directionId": 1,
      "destination": "Leandro N. Alem",
      "etaSeconds": 0,
      "etaMinutes": 0,
      "delaySeconds": 60,
      "stopId": "1090N"
    },
    {
      "line": "LineaB",
      "directionId": 0,
      "destination": "Juan Manuel de Rosas",
      "etaSeconds": 353,
      "etaMinutes": 6,
      "delaySeconds": 420,
      "stopId": "1090S"
    }
  ]
}
```

### `plan_trip`

```json
{"from": "Agüero", "to": "Plaza de Mayo"}
```

```json
{
  "from": "Agüero",
  "to": "Plaza de Mayo",
  "stepFree": false,
  "totalStops": 7,
  "transferCount": 1,
  "durationMinutes": 17,
  "assumption": "2 min per stop, 3 min per transfer",
  "legs": [
    {
      "line": "LineaD",
      "board": "Agüero",
      "alight": "Catedral",
      "stops": 6
    },
    {
      "line": "LineaA",
      "board": "Peru",
      "alight": "Plaza de Mayo",
      "stops": 1
    }
  ],
  "transferPoints": [
    {
      "from": "Catedral",
      "to": "Peru",
      "fromLine": "LineaD",
      "toLine": "LineaA",
      "walkMinutes": 3,
      "accessible": true
    }
  ]
}
```

The planner runs Dijkstra over the GTFS stop sequences. Ride edges cost 2 minutes, transfer edges cost 3. Transfers come from same-name stations across lines and a copied list of known interchange pairs. `step_free=true` drops transfers at stations without an elevator in the app's accessibility data.

### `nearby_stations`

```json
{"lat": -34.6037, "lng": -58.3816, "radius_m": 800}
```

The response is trimmed here to its first three stations.

```json
{
  "lat": -34.6037,
  "lng": -58.3816,
  "radiusM": 800,
  "count": 11,
  "stations": [
    {
      "name": "Carlos Pellegrini",
      "latitude": -34.603701386103,
      "longitude": -58.381378501576,
      "distanceMeters": 20,
      "lines": ["LineaB"]
    },
    {
      "name": "9 de Julio",
      "latitude": -34.604348245572,
      "longitude": -58.380351886286,
      "distanceMeters": 135,
      "lines": ["LineaD"]
    },
    {
      "name": "Diagonal Norte",
      "latitude": -34.604795306773,
      "longitude": -58.379235416539,
      "distanceMeters": 248,
      "lines": ["LineaC"]
    }
  ]
}
```

## Measured results

Three warm calls per tool from a local run on 2026-10-30, Node 22.23, against the live API. Warm means the reference feed was already in memory.

| Tool | Median call | Response |
| --- | --- | --- |
| `subway_status` | 748 ms | 0.9 KB |
| `next_trains` | 415 ms | 0.4 KB |
| `plan_trip` | 8 ms | 0.4 KB |
| `nearby_stations` | 2 ms | 1.4 KB |

The two tools that only need reference data are effectively local after the first call. The network time is the upstream telemetry request.

## How it works

The server calls two public endpoints: `/api/bootstrap` for stations and stop sequences, and `/api/telemetry` for trains, alerts, and predictions. The reference payload is cached in memory for 10 minutes, and telemetry is fetched on every call. There is no database, no key, and no import from the app.

## Limits

- The feed refreshes upstream. `feedAgeSeconds` and `stale` tell you how fresh the last update is. The client allows 5 seconds per request and retries once on a network failure.
- Linea D is not part of the live telemetry feed. `next_trains` returns an empty list and a note for D-only stations. Reference data and alerts for D are still available.
- Trip durations are estimates, not guarantees. The model uses 2 minutes per stop and 3 minutes per transfer and does not include waiting for the first train. Use `next_trains` for the real ETA.
- Station names come from the reference feed, which is mostly unaccented. Matching removes accents and case, so both spellings work.
- Step-free routing depends on the app's elevator metadata. Stations missing from that data are treated as not step-free, so some step-free trips can report no route.

## Checks

```bash
npm --prefix packages/subte-mcp run build
node packages/subte-mcp/test/smoke.mjs
npx tsc --noEmit
```

The smoke test spawns the built server with the official SDK client, lists the tools, calls all four against the live API, checks the result shapes, and exercises four error paths. It needs network access and no key. Last run:

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
