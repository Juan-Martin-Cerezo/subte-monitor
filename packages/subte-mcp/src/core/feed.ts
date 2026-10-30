import type { Telemetry } from './types.ts';

export interface FeedFreshness {
  stale: boolean;
  feedAgeSeconds: number | null;
  feedUpdatedAt: string | null;
}

export function feedFreshness(telemetry: Telemetry): FeedFreshness {
  if (!telemetry.trains.length) {
    return { stale: telemetry.stale === true, feedAgeSeconds: null, feedUpdatedAt: null };
  }

  const newest = Math.max(...telemetry.trains.map(train => train.updatedAt));
  const age = Math.max(0, Math.round(Date.now() / 1000 - newest));

  return {
    stale: telemetry.stale === true,
    feedAgeSeconds: age,
    feedUpdatedAt: new Date(newest * 1000).toISOString(),
  };
}
