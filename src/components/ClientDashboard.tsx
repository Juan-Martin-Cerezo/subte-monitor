'use client';

import dynamic from 'next/dynamic';

// Dashboard is fully client-side (Leaflet + telemetry polling).
// Disable SSR to avoid hydration mismatches and bundle the map lazily.
const Dashboard = dynamic(() => import('./dashboard/Dashboard'), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh w-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-surface-container-high">
          <span className="material-symbols-outlined text-primary text-3xl">directions_subway</span>
          <span className="absolute inset-0 rounded-full border-2 border-primary/30 animate-spin-slow" />
        </div>
        <p className="text-label-caps tracking-widest text-on-surface-variant">SUBTE LIVE</p>
      </div>
    </div>
  ),
});

export default function ClientDashboard() {
  return <Dashboard />;
}
