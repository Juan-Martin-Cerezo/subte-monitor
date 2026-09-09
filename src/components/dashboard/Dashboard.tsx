'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { TabId } from './types';
import { useDashboardData } from './useDashboardData';
import { Header } from './layout/Header';
import { Sidebar } from './layout/Sidebar';
import { MobileBottomNav } from './layout/MobileBottomNav';
import { ErrorBoundary } from './ErrorBoundary';
import { PlannerScreen } from './screens/PlannerScreen';
import { StationsScreen } from './screens/StationsScreen';
import { StatusScreen } from './screens/StatusScreen';
import { ArrivalsScreen } from './screens/ArrivalsScreen';
import { EcobiciWidget } from './EcobiciWidget';
import type { EcobiciStation } from '@/lib/ecobici';

const MapScreen = dynamic(() => import('./screens/MapScreen').then(m => ({ default: m.MapScreen })), {
  ssr: false,
  loading: () => <div className="flex-1 flex items-center justify-center bg-background"><div className="skeleton-pulse w-11/12 h-5/6 rounded-2xl" /></div>,
});

export default function Dashboard() {
  const [tab, setTab] = useState<TabId>('map');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ecobiciStations, setEcobiciStations] = useState<EcobiciStation[]>([]);

  const {
    stations,
    sequences,
    telemetry,
    activeLine,
    setActiveLine,
    visibleLines,
    trainsByLine,
    isRefreshing,
    connectionError,
    fetchTelemetry,
    now,
    userReports,
  } = useDashboardData();

  // Poll Ecobici data every 60s
  useEffect(() => {
    let active = true;
    const fetchEcobici = async () => {
      try {
        const res = await fetch('/api/ecobici');
        if (!res.ok) return;
        const data = await res.json();
        if (active && data.stations) setEcobiciStations(data.stations);
      } catch { /* silent */ }
    };
    fetchEcobici();
    const interval = setInterval(fetchEcobici, 60000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const handleTabChange = useCallback((t: TabId) => {
    setTab(t);
    setSidebarOpen(false);
  }, []);

  return (
    <div className="flex h-dvh max-h-dvh w-full flex-col bg-background text-on-background overflow-hidden">
      {/* Header — desktop nav + mobile compact */}
      <Header
        tab={tab}
        onTabChange={handleTabChange}
        onMenuToggle={() => setSidebarOpen(v => !v)}
        isRefreshing={isRefreshing}
        onRefresh={fetchTelemetry}
        lastUpdate={now}
        activeLine={activeLine}
        trainsByLine={trainsByLine}
      />

      {/* Main area: sidebar + content */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Sidebar — desktop always visible, mobile slide-over */}
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          activeLine={activeLine}
          onActiveLineChange={setActiveLine}
          trainsByLine={trainsByLine}
          tab={tab}
          onTabChange={handleTabChange}
        />

        {/* Content area with tab screens */}
        <main className="flex-1 overflow-y-auto scrollbar-thin relative min-h-0 md:pb-0 pb-[60px]">
          {connectionError && (
            <div className="sticky top-0 z-20 mx-3 mt-3 flex items-center gap-2 rounded-md bg-error-container/90 px-3 py-2 text-body-sm text-on-error-container backdrop-blur-md animate-fadeIn">
              <span className="h-2 w-2 rounded-full bg-error shrink-0" />
              Error de conexión — mostrando datos previos
              <button
                onClick={fetchTelemetry}
                className="ml-auto text-body-sm font-bold hover:underline focus-ring"
              >
                Reintentar
              </button>
            </div>
          )}

          <div className={tab !== 'map' ? 'max-w-6xl mx-auto w-full px-2 md:px-4' : 'h-full'}>
            {tab === 'map' && (
              <ErrorBoundary>
                <MapScreen
                  stations={stations}
                  sequences={sequences}
                  telemetry={telemetry}
                  activeLine={activeLine}
                  setActiveLine={setActiveLine}
                  visibleLines={visibleLines}
                  trainsByLine={trainsByLine}
                  userReports={userReports}
                  ecobiciStations={ecobiciStations}
                />
              </ErrorBoundary>
            )}
            {tab === 'planner' && (
              <PlannerScreen stations={stations} sequences={sequences} predictions={telemetry.predictions} userReports={userReports} />
            )}
            {tab === 'stations' && (
              <StationsScreen stations={stations} sequences={sequences} predictions={telemetry.predictions} userReports={userReports} />
            )}
            {tab === 'status' && (
              <StatusScreen alerts={telemetry.alerts} trainsByLine={trainsByLine} stations={stations} userReports={userReports} />
            )}
            {tab === 'arrivals' && (
              <ArrivalsScreen stations={stations} sequences={sequences} predictions={telemetry.predictions} trainsByLine={trainsByLine} />
            )}
          </div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <MobileBottomNav tab={tab} onTabChange={handleTabChange} />

      {/* Global Ecobici widget */}
      {tab === 'map' && <EcobiciWidget stations={ecobiciStations} />}
    </div>
  );
}
