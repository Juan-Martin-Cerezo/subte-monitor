// IMPORT PRISMA CLIENT
// Here, we import 'PrismaClient' from the auto-generated Prisma package.
// PrismaClient is the main database adapter class that lets us query our PostgreSQL database.
import { PrismaClient } from '@prisma/client';

// GLOBAL OBJECT DECLARATION FOR NEXT.JS HOT RELOADING
// In Next.js development, files are compiled and re-run on every code save.
// To prevent establishing a brand new database connection on every hot-reload (which would exhaust Postgres' connection limit),
// we declare a type-safe reference to the global process context that will store our client singleton.
const globalForPrisma = global as unknown as { prisma: PrismaClient };

// DATABASE CLIENT SINGLETON INITIALIZATION
// We check if a database client instance is already saved in the global context.
// If it is, we reuse it (`globalForPrisma.prisma`). If it isn't (e.g. on server start), we instantiate a new `PrismaClient()`.
export const db = globalForPrisma.prisma || new PrismaClient();

// CONTEXT ASSIGNMENT IN DEVELOPMENT
// If the environment is not production (i.e. we are running the app locally in development mode),
// we save our database client instance back to the global context so it persists between hot-reloads.
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
