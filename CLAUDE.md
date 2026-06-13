# Subte Monitor - Developer & AI Agent Guidelines

## Critical Database Safety Guards
*   **WARNING**: Do NOT point `DATABASE_URL` to Kermingo's database endpoint under any circumstances! Doing so will wipe production ticket sales data.
*   **DATABASE SHIELD**: The project has a security validation gate in `prisma.config.ts`. Do NOT remove, disable, or bypass this file or its validation logic. It is there to protect the Kermingo database from being accidentally overwritten.
*   **DO NOT TOUCH** the `prisma.config.ts` file or modify the guard code that halts execution if `DATABASE_URL` contains `kermingo`.

## Build & Run Commands
- Run development server: `npm run dev`
- Build for production: `npm run build`
- Start production server: `npm run start`
- Lint checks: `npm run lint`

## Database Commands
- Generate Prisma Client: `npx prisma generate`
- Push schema to DB: `npx prisma db push`
- Run database seed: `npx prisma db seed`

## Project Architecture & Core Algorithms

### 1. Raw GTFS-RT Telemetry & Caching
- **Client updates**: The frontend polls `/api/telemetry` every **2 seconds** (`2000ms`).
- **Server Cache**: Exists as a global singleton `subteCache` inside `src/lib/telemetry.ts` with a cache limit of **1.5 seconds** (`cacheLimitSeconds = 1.5`). This ensures that client requests every 2s trigger a fresh GCBA API fetch, but near-instantaneous requests share cache.

### 2. Fixed-Track Slot & Clustering Algorithm
- **No Physical Train IDs**: The GCBA API only returns arrival estimates for each station.
- **Clustering (DBSCAN 1D)**: Arrivals are grouped into virtual trains by projecting back their nominal start times: `t_inicio = stop.arrivalTime - stop.stopSequence * 88.5`. Predictions within a **180s** difference are grouped into the same train cluster.
- **Stable ID Hashing**: Trip IDs (`[Línea]-[4-HEX]`) are generated statelessly based on MD5 hash of `routeId + directionId + rounded_t_inicio_150s`.
- **Trip Matching Tolerance**: The tracking engine uses a matching window of **600 seconds (10 minutes)** to compare new clusters against historical `t_inicio` values. This ensures active trains keep the same ID even if they experience severe delays or linear travel speed drift.

### 3. Holding at the Signal & Progress Decay
- **Anti-Teleportation**: Arrivals to a platform are only confirmed when `etaEnPaquete` (relative to the package timestamp) is <= 15s (`status = 'STOPPED'`, `progress = 0.0`).
- **In-Transit Decay**: While in transit, position is interpolated along the high-resolution shapes: `progress = Math.max(0.0, Math.min(0.95, 1 - (segundosParaArriboLocal / 90)))`.
- **Crystal Ceiling (0.95)**: If the API prediction lags and local time ticks forward, the train remains held at 95% progress until the API confirms the arrival, preventing teleportation.

### 4. Leaflet Map Safety
- **Resize Hook Guard**: When swapping tabs (`currentTab`), Leaflet's `invalidateSize` must be called inside a timeout. **CRITICAL**: Always guard `mapInstanceRef.current` check *inside* the async timeout to prevent null reference errors if the user switches tabs rapidly.
```typescript
useEffect(() => {
  if (currentTab === 'map' && mapInstanceRef.current) {
    const timer = setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize({ animate: false });
        if (!mapUserMovedRef.current) fitMapBounds();
      }
    }, 100);
    return () => clearTimeout(timer);
  }
}, [currentTab]);
```

### 5. Integrations & Metadata
- **Accessibility Stats**: Lifts and escalator metadata is loaded via `src/lib/metadata.ts` (compiled from `NUEVADATA/estaciones-accesibles.csv`) and matches the station `stopName` normalized (stripped of accents and spaces, all lowercase).
- **Annual Passengers Stats**: Displayed as custom interactive sparklines on the "Estado" tab, sourced from `ANNUAL_TRIPS_METADATA`.
- **Premetro Branches**: Supported routes are `PM-Civico` and `PM-Savio`. Both branches are rendered using the orange theme.
