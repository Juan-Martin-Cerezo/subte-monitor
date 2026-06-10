import { db } from '@/lib/db';
import { getTelemetryData } from '@/lib/telemetry';
import SubteDashboard from '@/components/SubteDashboard';

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

  // Fetch initial telemetry
  let initialTelemetry: {
    trains: import('@/lib/telemetry').TrainTelemetry[];
    alerts: import('@/lib/telemetry').AlertData[];
    isMocked: boolean;
  } = { trains: [], alerts: [], isMocked: false };
  try {
    initialTelemetry = await getTelemetryData();
  } catch (error) {
    console.error('Failed to get initial telemetry on server:', error);
  }

  return (
    <SubteDashboard
      initialStations={stations}
      initialSequences={sequences}
      initialTelemetry={initialTelemetry}
    />
  );
}
