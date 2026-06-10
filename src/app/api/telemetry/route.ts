import { NextResponse } from 'next/server';
import { getTelemetryData } from '@/lib/telemetry';

export async function GET() {
  try {
    const data = await getTelemetryData();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('API Telemetry Error:', error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
