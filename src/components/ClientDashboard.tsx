'use client';

import dynamic from 'next/dynamic';

function DashboardSkeleton() {
  return (
    <div className="flex flex-col h-screen w-screen bg-background overflow-hidden">
      {/* Top bar skeleton */}
      <header className="hidden md:flex h-16 shrink-0 w-full items-center px-6 bg-surface-container/70 border-b border-outline-variant/30">
        <div className="flex items-center gap-4 w-full">
          <div className="w-6 h-6 rounded bg-slate-800 animate-pulse" />
          <div className="flex items-center gap-6 ml-auto">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="w-16 h-3 rounded bg-slate-800 animate-pulse" />
            ))}
          </div>
        </div>
      </header>

      <div className="flex flex-row flex-1 w-full overflow-hidden">
        {/* Sidebar skeleton */}
        <aside className="hidden md:flex w-64 shrink-0 flex-col bg-surface-dim/80 border-r border-outline-variant/20">
          <div className="p-5 border-b border-outline-variant/10 space-y-2">
            <div className="w-28 h-5 rounded bg-slate-800 animate-pulse" />
            <div className="w-16 h-2.5 rounded bg-slate-800/60 animate-pulse" />
          </div>
          <div className="flex-1 p-3 space-y-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map(i => (
              <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full bg-slate-800 animate-pulse" />
                  <div className="w-20 h-3 rounded bg-slate-800 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
                </div>
                <div className="w-5 h-3 rounded bg-slate-800/50 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
              </div>
            ))}
          </div>
        </aside>

        {/* Main content skeleton */}
        <div className="flex-1 flex items-center justify-center bg-surface">
          <div className="flex flex-col items-center gap-5">
            <div className="w-16 h-16 rounded-full bg-slate-800/80 animate-pulse" />
            <div className="w-40 h-4 rounded bg-slate-800/60 animate-pulse" />
            <div className="w-52 h-2.5 rounded bg-slate-800/40 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

const SubteDashboard = dynamic(() => import('./SubteDashboard'), {
  ssr: false,
  loading: () => <DashboardSkeleton />,
});

export default SubteDashboard;
