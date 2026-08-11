import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim() === '') {
  throw new Error('DATABASE_URL is required to seed RDN');
}

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDirectory, '..');
const seedData = JSON.parse(readFileSync(join(repoRoot, 'data', 'rdn_seed.json'), 'utf8'));

interface RdnSeedRow {
  id: string;
  ruleType: string;
  formulaName: string;
  description: string;
  formula: string;
  enabled: boolean;
  beneficiaryType: string;
  periodicity: string | null;
  benefitType: string;
  conditions: Record<string, unknown>;
  action: Record<string, unknown>;
}

const pool = new Pool({ connectionString: databaseUrl });

try {
  // Limpia filas RDN antiguas (nombres generados con "CODE · descripcion") para re-seed consistente.
  await pool.query(
    `DELETE FROM benefit_formulas
     WHERE formula_name LIKE '% · %' OR formula_name = ANY($1::text[])`,
    [seedData.rdn.map((r: RdnSeedRow) => r.id)],
  );

  for (const regla of seedData.rdn as RdnSeedRow[]) {
    await pool.query(
      `
        INSERT INTO benefit_formulas (
          formula_name,
          priority,
          formula,
          enabled,
          beneficiary_type,
          periodicity,
          benefit_type,
          conditions,
          rule_type,
          action,
          description
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11)
        ON CONFLICT (formula_name) DO UPDATE SET
          formula = EXCLUDED.formula,
          enabled = EXCLUDED.enabled,
          conditions = EXCLUDED.conditions,
          rule_type = EXCLUDED.rule_type,
          action = EXCLUDED.action,
          description = EXCLUDED.description,
          updated_at = now()
      `,
      [
        regla.formulaName,
        900,
        regla.formula,
        regla.enabled,
        regla.beneficiaryType,
        regla.periodicity,
        regla.benefitType,
        JSON.stringify(regla.conditions),
        regla.ruleType,
        JSON.stringify(regla.action),
        regla.description ?? null,
      ],
    );
  }
  console.log(`Seeded ${seedData.rdn.length} RDN rules`);
} finally {
  await pool.end();
}
