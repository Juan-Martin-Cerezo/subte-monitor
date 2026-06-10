import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const line = searchParams.get('line');

    const reports = await db.report.findMany({
      where: line ? { line } : {},
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    return NextResponse.json(reports);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('API Reports GET Error:', error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { line, station, category, comment } = body;

    if (!line || !station || !category || !comment) {
      return NextResponse.json(
        { error: 'Todos los campos son obligatorios: line, station, category, comment' },
        { status: 400 }
      );
    }

    const report = await db.report.create({
      data: {
        line,
        station,
        category,
        comment
      }
    });

    return NextResponse.json(report, { status: 201 });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('API Reports POST Error:', error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
