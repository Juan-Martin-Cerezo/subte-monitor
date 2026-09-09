import { NextResponse } from 'next/server';
import { getEcobiciStations } from '@/lib/ecobici';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const stations = await getEcobiciStations();
    return NextResponse.json({ stations, updatedAt: Date.now() });
  } catch (err) {
    return NextResponse.json(
      { stations: [], updatedAt: Date.now(), error: String(err) },
      { status: 200 }
    );
  }
}
