import { PostgresStore } from './postgres';
import { SqliteStore } from './sqlite';
import type { AndenStore } from './types';

export type { AndenStore, Fact, FactKey, FactValue, Turn } from './types';

const globalForStore = globalThis as unknown as { andenStore?: AndenStore };

export function getStore(): AndenStore {
  if (!globalForStore.andenStore) {
    globalForStore.andenStore = process.env.DATABASE_URL
      ? new PostgresStore(process.env.DATABASE_URL)
      : new SqliteStore(process.env.ANDEN_SQLITE_PATH);
  }
  return globalForStore.andenStore;
}
