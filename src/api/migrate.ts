import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim() === '') {
  throw new Error('DATABASE_URL is required to run migrations');
}

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(currentDirectory, 'migrations', '001_dynamic_formula_rules.sql');
const sql = await readFile(migrationPath, 'utf8');
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(sql);
  console.log('Database migrations applied');
} finally {
  await pool.end();
}
