import { NextResponse } from 'next/server';
import { isFactKey } from '@/lib/anden/facts';
import { getUserId } from '@/lib/anden/identity';
import { getStore } from '@/lib/anden/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await getUserId();
  const store = getStore();
  await store.init();

  const [facts, turns] = await Promise.all([
    store.listFacts(userId),
    store.recentTurns(userId, 8),
  ]);

  return NextResponse.json({
    facts: facts.map(({ key, value, updatedAt, expiresAt }) => ({
      key,
      value,
      updated_at: updatedAt,
      expires_at: expiresAt,
    })),
    turns: turns.length,
  });
}

export async function DELETE(request: Request) {
  const userId = await getUserId();
  const store = getStore();
  await store.init();

  const key = new URL(request.url).searchParams.get('key');
  if (key) {
    if (!isFactKey(key)) {
      return NextResponse.json({ error: 'Clave desconocida.' }, { status: 400 });
    }
    const deleted = await store.deleteFact(userId, key);
    return NextResponse.json({ deleted }, { status: deleted ? 200 : 404 });
  }

  return NextResponse.json({ deleted: await store.deleteAll(userId) });
}
