import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export * from './schema.js';
export { runMigrations } from './migrate.js';

export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type AskminkDb = ReturnType<typeof createDb>;
