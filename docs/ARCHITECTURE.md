# Architecture

One Next.js application and one PostgreSQL database. The browser never talks to the GCBA API or to the database directly: the server polls the feed, reconstructs train positions and returns a ready-to-render payload.

```
GCBA GTFS-Realtime ──┐
GCBA service alerts ─┼─► /api/telemetry ─► telemetry.ts ─► dashboard
GCBA GBFS (Ecobici) ─┘                          │
                                                ▼
                                          PostgreSQL
                                     (stations, sequences,
                                      user reports)
```

## Runtime pieces

| Route            | Role                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/`              | Server entry point. Renders the dashboard shell; every screen is a client component.                                          |
| `/api/bootstrap` | Stations and route sequences, requested once on load. Returns empty arrays with an `error` field instead of failing the page. |
| `/api/telemetry` | The hot path. Fetches the realtime feed, reconstructs positions, returns trains, arrivals and alerts.                         |
| `/api/reports`   | `GET` lists the last 20 reports, optionally by line. `POST` stores a user report.                                             |
| `/api/ecobici`   | GBFS v3 discovery plus station status, cached for 60 seconds.                                                                 |

The dashboard polls `/api/telemetry` every two seconds. The server caches the processed payload for 1.5 seconds, so several clients viewing the same map share one upstream request.

## Telemetry pipeline

`src/lib/telemetry.ts` is the core of the project.

1. **Fetch.** `forecastGTFS` and `serviceAlerts` are requested in parallel with the operator key, an 8 second abort timeout and `cache: no-store`.
2. **Fall back.** If the upstream fails or returns an empty entity list, the last good payload is reused and flagged as stale instead of blanking the map.
3. **Cluster.** The feed reports arrival predictions per stop, so the same train appears once for every downstream station. Predictions are grouped by trip and direction, then clustered on a single dimension (predicted arrival time) so each physical train yields one record.
4. **Identify.** A stable id is derived from route, direction and trip start time. Markers therefore keep their identity between polls instead of jumping between positions.
5. **Position.** The predicted time for the next stop is mapped to a distance along the line's GTFS shape, and the coordinates are interpolated on that segment. Direction decides which end of the shape is the origin.
6. **Derive.** ETA, delay and the next and previous stop come from the same cluster, so every field on screen is consistent with the marker it belongs to.

Alerts are parsed separately into `AlertData` (route, header, description, cause, effect) and matched to lines.

## Data model

`prisma/schema.prisma` has three models:

| Model           | Fields                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Station`       | `stopId` (primary key), `stopName`, `latitude`, `longitude`.                                                                           |
| `RouteSequence` | `routeId`, `directionId`, `stopSequence`, `stopId`, with unique constraints on the stop order and on the stop per route and direction. |
| `Report`        | `line`, `station`, `category`, `comment`, `createdAt`.                                                                                 |

Stations and sequences are static: they come from `gtfs.zip` through `prisma/seed.ts`, which parses the GTFS text files and bulk inserts them. Reports are the only data written at runtime.

## Static datasets

Four files under `src/lib/` hold compiled reference data. They are generated, not hand-edited:

| File                   | Content                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `shapes.ts`            | Polyline per line and direction, from GTFS `shapes.txt`.                                                         |
| `metadata.ts`          | Station metadata, including lifts and escalators for accessibility.                                              |
| `metadata_extended.ts` | Extended per-station data (neighbourhood, transfer notes, facilities).                                           |
| `connections.ts`       | Nearby bus and train connections per station, built by `scripts/build-connections.ts` from the City's open data. |
| `safety_zones.ts`      | Zones used by the status screen to contextualise incidents.                                                      |

They are large but static, which keeps the serverless hot path free of extra queries.

## Frontend

`src/components/ClientDashboard.tsx` mounts the shell: header, sidebar, bottom navigation on mobile, and one active screen at a time. `useDashboardData.ts` owns polling, loading and error state; screens receive data through props and keep their own view state.

The map is Leaflet with a dark tile layer. Lines are drawn from the GTFS shapes, stations from `/api/bootstrap` and trains from the telemetry payload. Train icons are rotated according to the direction of travel.

The planner runs entirely in the browser. It builds an adjacency list from stations and sequences, connects consecutive stops on the same line, links stations that share a name, and runs a multi-source Dijkstra from the origin. Transfers carry a penalty; step-free mode raises the penalty for transfers at stations without accessible access.

## Configuration

| Variable                                 | Notes                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`                           | Required. Neon hosts use the HTTP driver, everything else uses Prisma's pool. |
| `SUBTE_CLIENT_ID`, `SUBTE_CLIENT_SECRET` | Required by the telemetry and seed paths. No defaults.                        |

## Known limitations

- No automated tests. The clustering and interpolation functions are pure and easy to cover with fixtures.
- The planner graph is rebuilt on the client when the step-free toggle changes; with the current dataset it takes a few milliseconds, but it is the first thing to memoise if the network data grows.
- `connections.ts` is generated from a snapshot of the City's open data; regenerating it is a manual step.
- Reports are unauthenticated. A public instance needs rate limiting and moderation.
