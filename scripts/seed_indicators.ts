import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim() === '') {
  throw new Error('DATABASE_URL is required to seed indicators');
}

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDirectory, '..');
const data = JSON.parse(readFileSync(join(repoRoot, 'data', 'indicators.json'), 'utf8'));

const pool = new Pool({ connectionString: databaseUrl });

try {
  const reajuste = data.reajustePorMes ?? {};
  for (const [periodo, factor] of Object.entries<number>(reajuste)) {
    await pool.query(
      `INSERT INTO current_ipc (periodo, factor) VALUES ($1, $2)
       ON CONFLICT (periodo) DO UPDATE SET factor = EXCLUDED.factor`,
      [periodo, factor],
    );
  }

  const imnr = data.imnrPorMes ?? {};
  for (const [periodo, valor] of Object.entries<number>(imnr)) {
    await pool.query(
      `INSERT INTO current_imnr (periodo, valor) VALUES ($1, $2)
       ON CONFLICT (periodo) DO UPDATE SET valor = EXCLUDED.valor`,
      [periodo, valor],
    );
  }

  const topes = data.topePesosPorMes ?? {};
  for (const [periodo, tope] of Object.entries<number>(topes)) {
    await pool.query(
      `INSERT INTO current_tope_imponible (vigencia_desde, regimen, tope_uf)
       VALUES ($1, 'AFP_STD', $2)
       ON CONFLICT DO NOTHING`,
      [`${periodo}-01`, tope],
    );
  }

  const tasas = data.tasas ?? {};
  for (const [nombre, valor] of Object.entries<number>(tasas)) {
    await pool.query(
      `INSERT INTO current_tasas (nombre, valor) VALUES ($1, $2)
       ON CONFLICT (nombre) DO UPDATE SET valor = EXCLUDED.valor`,
      [nombre, valor],
    );
  }

  const comisiones = data.comisionPorAfp ?? {};
  for (const [afp, porPeriodo] of Object.entries<Record<string, number>>(comisiones)) {
    const valor = porPeriodo['*'] ?? Object.values(porPeriodo)[0];
    if (valor !== undefined) {
      await pool.query(
        `INSERT INTO current_tasas (nombre, valor) VALUES ($1, $2)
         ON CONFLICT (nombre) DO UPDATE SET valor = EXCLUDED.valor`,
        [`COMISION_${afp}`, valor],
      );
    }
  }

  console.log(`Indicadores sembrados: ${Object.keys(reajuste).length} ipc, ${Object.keys(imnr).length} imnr, ${Object.keys(topes).length} topes`);
} finally {
  await pool.end();
}
