# Guide 01: General Architecture Overview

This document explains the general architecture of the `subte-monitor` application. It details how data flows through our system, how the server communicates with the Buenos Aires City Government's Transit API, and how that information reaches the client browser.

---

## 1. High-Level Data Flow

The flow of data in the system moves through four major stages:

### A. Raw Data Retrieval (Server Side)
Every time a client makes a request to our telemetry endpoint, or every few seconds, our Next.js backend server makes a request to the Government of Buenos Aires Transit API (GCBA API).
*   **Source URL**: `https://apitransporte.buenosaires.gob.ar/subtes/forecastGTFS`
*   **Format**: The data is fetched in GTFS Realtime JSON format.
*   **Content**: This feed provides real-time arrival estimates (predictions) for each line, stop, and direction. For instance, "Train on Line D is expected to arrive at station Agüero in 180 seconds."

### B. Core Telemetry Processing (Server Side)
Because the raw GCBA API does not provide persistent identifiers for physical trains, our server processes this arrival data in real-time before returning it.
*   **Location**: `src/lib/telemetry.ts`
*   **Actions**:
    1.  **Clustering**: Groups various station predictions together to detect distinct physical trains (using the 1D Clustering Algorithm).
    2.  **Stable Hashing**: Assigns stable IDs like `D-8B4A` so a train keeps the same name throughout its run.
    3.  **Holding at the Signal**: Determines whether a train is at a platform (`STOPPED`) or moving (`IN_TRANSIT`), and prevents it from jumping ahead if the API lags.

### C. Live API Endpoint (Next.js App Route)
The processed telemetry data is exposed through a Next.js dynamic App Route.
*   **Route Path**: `/api/telemetry`
*   **Location**: `src/app/api/telemetry/route.ts`
*   **Caches**: Implements a short-lived cache of 1.5 seconds to limit outbound API calls and avoid getting rate-limited by GCBA.

### D. Client-Side Rendering (Browser Side)
The user interface displays this processed telemetry on an interactive map and boarding screens.
*   **Entry Point**: `src/components/SubteDashboard.tsx`
*   **Actions**:
    1.  **Polling**: Fetches `/api/telemetry` every 2 seconds.
    2.  **Map rendering**: Visualizes train markers moving along lines using Leaflet.
    3.  **UI Updates**: Shows boarding departure lists, connection panels, and live arrivals.

---

## 2. Full Data Lifecycle Breakdown

```text
[GCBA Transit API]
       │
       ▼ (Fetch raw GTFS Realtime Forecast / Service Alerts)
[Next.js Backend Server]
       │
       ├─► [Read static database shapes and station IDs via Prisma]
       ├─► [Process with Track-Slot Clustering & Stable ID Hashing]
       ▼
[Next.js REST API Endpoint: /api/telemetry]
       │
       ▼ (Client pulls data every 2000ms using fetch requests)
[Browser UI: SubteDashboard React Component]
       │
       ├─► [Update Leaflet Map Layers with new marker coordinates]
       └─► [Refresh Live Arrival Lists in Station Details Panel]
```

---

## 3. Tech Stack and Code Responsibilities

*   **Next.js 15+ (App Router)**: Serves as our web application framework. It renders components on the server for initial speed (SSR) and handles server-side API routing.
*   **TypeScript**: Provides type safety across our application, helping to catch code typos and parameter mismatches before compilation.
*   **Prisma ORM**: A database client that lets us interact with our PostgreSQL database using simple TypeScript methods instead of writing raw SQL.
*   **Leaflet Map**: A lightweight JavaScript library used to render the full-screen interactive train map on the frontend.
*   **Tailwind CSS**: A utility-first CSS framework used to build our clean, glassmorphic dark-mode design system.
