import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';

export const UID_COOKIE = 'subte_uid';

const UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getUserId(): Promise<string> {
  const jar = await cookies();
  const current = jar.get(UID_COOKIE)?.value;
  if (current && UID_PATTERN.test(current)) return current;

  const id = randomUUID();
  jar.set(UID_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === 'production',
  });
  return id;
}
