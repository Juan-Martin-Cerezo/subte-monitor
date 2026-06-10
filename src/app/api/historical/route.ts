import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const line = searchParams.get('line');

    if (!line) {
      return NextResponse.json(
        { error: 'El parámetro "line" es obligatorio' },
        { status: 400 }
      );
    }

    // Fetch historical data for the selected line
    const flowData = await db.historicalFlow.findMany({
      where: { line },
      orderBy: { hour: 'asc' }
    });

    // Group passenger flow and count congestion levels by hour
    const hourlyStatsMap: Record<number, { hour: number; totalFlow: number; count: number; congestionScore: number }> = {};

    flowData.forEach(item => {
      const h = item.hour;
      if (!hourlyStatsMap[h]) {
        hourlyStatsMap[h] = { hour: h, totalFlow: 0, count: 0, congestionScore: 0 };
      }

      // Convert congestion level to numerical score to average it later
      // Rojo = 3, Amarillo = 2, Verde = 1
      let score = 1;
      if (item.congestionLevel === 'Rojo') score = 3;
      else if (item.congestionLevel === 'Amarillo') score = 2;

      hourlyStatsMap[h].totalFlow += item.passengerFlow;
      hourlyStatsMap[h].congestionScore += score;
      hourlyStatsMap[h].count += 1;
    });

    const hourlyStats = Object.values(hourlyStatsMap).map(item => {
      const avgScore = item.congestionScore / item.count;
      let congestionLevel = 'Verde';
      if (avgScore >= 2.5) congestionLevel = 'Rojo';
      else if (avgScore >= 1.5) congestionLevel = 'Amarillo';

      return {
        hour: item.hour,
        passengerFlow: Math.round(item.totalFlow / item.count),
        congestionLevel
      };
    }).sort((a, b) => a.hour - b.hour);

    return NextResponse.json({
      line,
      hourlyStats,
      rawStats: flowData
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('API Historical GET Error:', error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
