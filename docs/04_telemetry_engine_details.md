# Guide 04: Telemetry & Stateful Tracking Engine

This document outlines the telemetry processing algorithms inside `src/lib/telemetry.ts` that convert plain station arrivals into a real-time tracking visualization.

---

## 1. The Challenge of Tracking Without Train IDs

The Buenos Aires Transit API (GCBA API) does not tell us: "Train A is currently at coordinates X, Y". Instead, it sends an array of estimated arrivals:
*   "Train will arrive at Station 1 in 60 seconds."
*   "Train will arrive at Station 2 in 180 seconds."

To reconstruct the actual physical trains, the engine performs the following processing sequence every time `/api/telemetry` is called.

---

## 2. Core Tracking Algorithms

### A. DBSCAN 1D (Spatial-Temporal Clustering)
1.  For every arrival estimate, we calculate its projected starting time from the terminal:
    $$\text{Start Time} = \text{Arrival Time} - (\text{Stop Sequence} \times 88.5\text{ seconds})$$
    where $88.5$ seconds is the average travel time between adjacent stations.
2.  If multiple station predictions point to the same projected start time (within a **180-second** window), they are grouped together.
3.  Each cluster represents **one physical train** currently traveling on the tracks.

### B. Stable ID Hashing
To assign a permanent ID to a train without maintaining complex database sessions:
1.  We calculate the average projected start time for the cluster.
2.  We round this time into slots of **150 seconds** to tolerate slight prediction fluctuations.
3.  We generate an MD5 hash using the line, direction, and rounded time slot:
    $$\text{Hash} = \text{MD5}(\text{routeId} + \text{directionId} + \text{roundedStart})$$
    We take the first 4 characters of this hash to create a stable ID like `D-A4FC`.

### C. Holding at the Signal (Anti-Teleportation)
To prevent trains from "jumping" positions when the API updates slowly:
1.  We measure `etaEnPaquete` (the arrival estimate relative to the API's own feed timestamp).
2.  A train is only marked as `STOPPED` at a station when `etaEnPaquete` is $\le 15$ seconds.
3.  While `IN_TRANSIT`, progress is calculated locally using the server time:
    $$\text{Progress} = \text{Math.max}\left(0.0, \text{Math.min}\left(0.95, 1 - \frac{\text{secondsToArrival}}{90}\right)\right)$$
    Note the ceiling at **0.95 (95%)**. If local time keeps ticking but the API feed does not update to confirm the train has arrived, the train remains held at 95% of the track instead of jumping to the next station.

### D. Dead Reckoning
If a train disappears from the API feed for a short period (up to 40 seconds), the engine continues to project its location using its last known velocity rather than letting it vanish instantly. If the API returns completely empty (no service or nighttime closure), the cache is cleared (`trackerDB.clear()`), and all trains are removed immediately.

---

## 3. Server Cache Configuration

The telemetry server cache prevents overloading the external transit API:
*   **Cache Limit**: 1.5 seconds.
*   **Behavior**: If multiple users request map updates within 1.5 seconds, they all receive the same cached data, reducing server load.
