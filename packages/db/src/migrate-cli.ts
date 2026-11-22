import { Pool } from 'pg';
import { runMigrations } from './migrate.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
try {
  await runMigrations(pool);
  console.log('✓ Askmink PostgreSQL 18 migrations applied successfully.');
} finally {
  await pool.end();
}
