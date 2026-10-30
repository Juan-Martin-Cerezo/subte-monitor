import { ALERTS_PATH, readJsonl, writeJsonl, type CorpusEntry } from "./corpus";

const DEFAULT_BASE = "https://subte-monitor.vercel.app";
const TIMEOUT_MS = 10_000;

interface FeedAlert {
  id?: string;
  routeId?: string;
  headerText?: string;
  descriptionText?: string;
  cause?: string;
  effect?: string;
}

interface TelemetryResponse {
  alerts?: FeedAlert[];
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function alertText(alert: FeedAlert): string {
  const lines = [clean(alert.descriptionText)];
  if (clean(alert.cause)) lines.push(`Causa: ${clean(alert.cause)}`);
  if (clean(alert.effect)) lines.push(`Efecto: ${clean(alert.effect)}`);
  return lines.filter(Boolean).join("\n");
}

export async function fetchAlerts(): Promise<FeedAlert[]> {
  const base = (process.env.SUBTE_API_BASE ?? DEFAULT_BASE).replace(/\/+$/, "");
  const response = await fetch(`${base}/api/telemetry`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`telemetry returned ${response.status}`);

  const data = (await response.json()) as TelemetryResponse;
  return Array.isArray(data.alerts) ? data.alerts : [];
}

function toEntry(alert: FeedAlert, now: string): CorpusEntry | null {
  const feedId = clean(alert.id);
  const title = clean(alert.headerText);
  if (!feedId || !title) return null;

  return {
    id: `alert:${feedId}`,
    title,
    text: alertText(alert),
    source: "feed:alert",
    kind: "alert",
    first_seen: now,
    last_seen: now,
  };
}

export async function mergeAlerts(): Promise<{ added: number; updated: number; total: number }> {
  const existing = await readJsonl<CorpusEntry>(ALERTS_PATH);
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  const now = new Date().toISOString();

  let added = 0;
  let updated = 0;

  for (const alert of await fetchAlerts()) {
    const entry = toEntry(alert, now);
    if (!entry) continue;

    const previous = byId.get(entry.id);
    if (previous) {
      byId.set(entry.id, {
        ...previous,
        title: entry.title,
        text: entry.text,
        first_seen: previous.first_seen ?? now,
        last_seen: now,
      });
      updated += 1;
    } else {
      byId.set(entry.id, entry);
      added += 1;
    }
  }

  const rows = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  await writeJsonl(ALERTS_PATH, rows);
  return { added, updated, total: rows.length };
}
