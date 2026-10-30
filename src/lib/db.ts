import { PrismaClient } from '@prisma/client';
import { PrismaNeonHTTP } from '@prisma/adapter-neon';

const globalForPrisma = global as unknown as { prisma?: PrismaClient };

let cached: PrismaClient | null = globalForPrisma.prisma ?? null;

function connect(): PrismaClient {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const adapter = new PrismaNeonHTTP(url, {});
  cached = new PrismaClient({ adapter });
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = cached;
  return cached;
}

// El cliente se crea en el primer acceso: importar este módulo no debe tocar la base.
export const db = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = connect();
    const value = Reflect.get(client, property) as unknown;
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
