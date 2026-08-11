import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim() === '') {
  throw new Error('DATABASE_URL is required to run migrations');
}

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(currentDirectory, 'migrations');
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith('.sql'))
  .sort();

const pool = new Pool({ connectionString: databaseUrl });

try {
  for (const file of migrationFiles) {
    const sql = await readFile(join(migrationsDirectory, file), 'utf8');
    await pool.query(sql);
    console.log(`Applied migration: ${file}`);
  }
  console.log('Database migrations applied');
} finally {
  await pool.end();
}
