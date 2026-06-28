const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const lineDStations = await prisma.routeSequence.findMany({
    where: { routeId: 'LineaD' },
    include: { station: true },
    orderBy: { stopSequence: 'asc' }
  });

  console.log("Line D stations in Database:");
  lineDStations.forEach(s => {
    console.log(`Seq: ${s.stopSequence}, Dir: ${s.directionId}, stopId: ${s.stopId}, stopName: ${s.station.stopName}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
