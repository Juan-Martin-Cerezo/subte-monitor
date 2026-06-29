# Guide 05: Frontend Leaflet Map & UI Guide

This document explains the frontend architecture of our application, specifically focusing on the Leaflet Map integration, screen layouts, responsive mobile controls, and transfer (connections) logic.

---

## 1. File Location & Layout Structure

The entire frontend user interface is contained inside:
`src/components/SubteDashboard.tsx`

### Screen Navigation (Tabs)
The dashboard uses a state variable called `currentTab` to control which screen is active.
*   `'map'`: Shows the full-screen interactive Leaflet map with live train positions.
*   `'planner'`: Pathfinding routing screen using Dijkstra's algorithm.
*   `'stations'`: Station list directory with live arrival logs and accessibility details.
*   `'status'`: Service alerts, delays, and historical passenger statistics.
*   `'arrivals'`: Boarding timetables grouped by line and direction.

---

## 2. Interactive Leaflet Map Configuration

### A. Dark Mode Street Layout
To create a premium command-center style interface, standard OpenStreetMap street tiles are rendered dark using CSS filters:
```css
.leaflet-tile {
  filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(1.15) grayscale(0.2) !important;
}
```
This filter is applied in the global stylesheet (`src/app/globals.css`). It inverts map elements, shifting blue water to dark blue and white roads to dark grey.

### B. Track and Train Markers Rendering
1.  **Station Circles**: Station stops are plotted on the map using coordinates from our database.
2.  **Track Shapes**: Track lines are drawn on the map using static GTFS track shape segments imported from `src/lib/shapes.ts`.
3.  **Train Markers**: Train icons are customized HTML divs (`L.divIcon`) containing:
    *   A colored circle matching the route color.
    *   A tiny arrow indicating train heading direction.
    *   An ID label displaying the train hash (e.g. `B-4F8A`).

---

## 3. Responsive Mobile Line Selector

*   **Location**: Rendered as a floating horizontal selector at the top of the map view.
*   **Behavior**: Scrollable badge list visible only on mobile screens (`md:hidden`).
*   **Action**: Clicking a badge triggers the `setActiveLine` state, filtering active train markers and zoom bounds for that specific line.

---

## 4. Transfer and Connection Logic

In this application, a **combination/transfer** is strictly defined as:
> An underground tunnel connection that allows passengers to walk to a different subway line. Same-line connections are excluded.

### A. Dijkstra Pathfinding Combinations
When building the pathfinding graph, transfers are created between platforms sharing the same name or listed in `MANUAL_TRANSFERS`, but they are filtered out if both platforms belong to the same route:
```typescript
const shareAnyRoute = r1.some(routeId => r2.includes(routeId));
if (!shareAnyRoute) {
  g[s1.stopId].push({ node: s2.stopId, weight: 3, routeId: null });
}
```

### B. Station Directory Combination Badges
In the stations list pane, when you select a station, it queries `initialStations` to locate connected nodes by name or manual walk-tunnels. It shows their line badges but filters them out if they share the selected station's route ID, ensuring that only cross-line connections are shown.
