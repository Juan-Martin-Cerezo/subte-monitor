/**
 * Ecobici GBFS v3.0 client with in-memory caching.
 * Source: https://buenosaires.publicbikesystem.net/customer/gbfs/v3.0/gbfs.json
 */

const GBFS_URL = "https://buenosaires.publicbikesystem.net/customer/gbfs/v3.0/gbfs.json";
const CACHE_TTL_MS = 60_000;

interface GbfsFeed {
  name: string;
  url: string;
}

interface GbfsDiscovery {
  data: {
    feeds: GbfsFeed[];
  };
}

interface LocalizedName {
  text: string;
  language: string;
}

interface StationInformation {
  data: {
    stations: Array<{
      station_id: string;
      name: LocalizedName[];
      lat: number;
      lon: number;
      capacity: number;
    }>;
  };
}

interface StationStatus {
  data: {
    stations: Array<{
      station_id: string;
      num_vehicles_available: number;
      num_docks_available: number;
      is_renting: boolean;
      is_installed: boolean;
    }>;
  };
}

export interface EcobiciStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  bikesAvailable: number;
  docksAvailable: number;
  capacity: number;
  active: boolean;
}

interface CacheEntry {
  stations: EcobiciStation[];
  timestamp: number;
}

let cache: CacheEntry | null = null;

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function getEcobiciStations(): Promise<EcobiciStation[]> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.stations;
  }

  try {
    const discoveryRes = await fetchWithTimeout(GBFS_URL);
    if (!discoveryRes.ok) throw new Error(`GBFS discovery failed: ${discoveryRes.status}`);
    const discovery: GbfsFeed[] = ((await discoveryRes.json()) as GbfsDiscovery).data.feeds;

    const infoFeed = discovery.find((f) => f.name === "station_information");
    const statusFeed = discovery.find((f) => f.name === "station_status");

    if (!infoFeed || !statusFeed) throw new Error("Missing GBFS feeds");

    const [infoRes, statusRes] = await Promise.all([
      fetchWithTimeout(infoFeed.url),
      fetchWithTimeout(statusFeed.url),
    ]);

    if (!infoRes.ok || !statusRes.ok) throw new Error("GBFS fetch failed");

    const info = (await infoRes.json()) as StationInformation;
    const status = (await statusRes.json()) as StationStatus;

    const statusMap = new Map(status.data.stations.map((s) => [s.station_id, s]));

    const stations: EcobiciStation[] = info.data.stations
      .map((station) => {
        const st = statusMap.get(station.station_id);
        const nameObj = station.name.find((n) => n.language === "es") ?? station.name[0];
        return {
          id: station.station_id,
          name: nameObj?.text ?? station.station_id,
          lat: station.lat,
          lng: station.lon,
          bikesAvailable: st?.num_vehicles_available ?? 0,
          docksAvailable: st?.num_docks_available ?? 0,
          capacity: station.capacity,
          active: (st?.is_renting ?? false) && (st?.is_installed ?? false),
        };
      })
      .filter((s) => s.active);

    cache = { stations, timestamp: Date.now() };
    return stations;
  } catch (err) {
    console.error("[ecobici] fetch error:", err);
    return cache?.stations ?? [];
  }
}
