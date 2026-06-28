// Lightweight bootstrap endpoint — returns stations and route sequences once on app load.
// Telemetry is polled separately every 2s via /api/telemetry.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const [stations, sequences] = await Promise.all([
      db.station.findMany(),
      db.routeSequence.findMany({ orderBy: { stopSequence: 'asc' } }),
    ]);
    return NextResponse.json({ stations, sequences });
  } catch (err) {
    return NextResponse.json(
      { stations: [], sequences: [], error: String(err) },
      { status: 200 }
    );
  }
}
