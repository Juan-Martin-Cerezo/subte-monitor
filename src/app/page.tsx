import { db } from '@/lib/db';
import { getTelemetryData } from '@/lib/telemetry';
import SubteDashboard from '@/components/ClientDashboard';

// Force dynamic rendering since we are doing live telemetry fetching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'SUBTE-Monitor | Telemetría en Tiempo Real de Buenos Aires',
  description: 'Monitoreo inteligente y telemetría de la red de subterráneos de Buenos Aires (Subte) utilizando el Algoritmo de Ranuras de Vía Fijas con Stable Hashing.',
};

export default async function Home() {
  // Fetch initial configuration data
  const stations = await db.station.findMany();
  const sequences = await db.routeSequence.findMany({
    orderBy: { stopSequence: 'asc' },
  });

  // Provide quick default telemetry to make page load instant, client updates it immediately
  const initialTelemetry = { trains: [], alerts: [], isMocked: false };

  return (
    <SubteDashboard
      initialStations={stations}
      initialSequences={sequences}
      initialTelemetry={initialTelemetry}
    />
  );
}
