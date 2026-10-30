import ClientDashboard from "@/components/ClientDashboard";

// Force dynamic rendering — we serve live telemetry.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Subte Live · Buenos Aires en Tiempo Real",
  description:
    "Telemetría en vivo de la red de subterráneos de Buenos Aires: mapa interactivo, planificador, próximos arribos y alertas.",
};

export default async function Home() {
  return <ClientDashboard />;
}
