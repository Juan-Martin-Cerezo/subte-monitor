import { PrismaClient } from "@prisma/client";
import { PrismaNeonHTTP } from "@prisma/adapter-neon";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  // Neon's HTTP driver only works against Neon. Plain PostgreSQL (local, Docker,
  // Supabase) uses Prisma's own connection pool.
  if (url.includes("neon.tech")) {
    return new PrismaClient({ adapter: new PrismaNeonHTTP(url, {}) });
  }

  return new PrismaClient();
}

export const db = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
