CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS benefit_formulas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_name TEXT NOT NULL,
  priority INTEGER NOT NULL,
  formula TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  beneficiary_type TEXT NOT NULL,
  periodicity TEXT,
  benefit_type TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS benefit_formulas_enabled_priority_idx
  ON benefit_formulas (enabled, priority);

CREATE UNIQUE INDEX IF NOT EXISTS benefit_formulas_formula_name_idx
  ON benefit_formulas (formula_name);

CREATE TABLE IF NOT EXISTS formula_variables (
  variable_name TEXT PRIMARY KEY,
  data_type TEXT NOT NULL CHECK (data_type IN ('numeric', 'boolean', 'text')),
  source TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO formula_variables (variable_name, data_type, source, enabled, description) VALUES
  ('sbm', 'numeric', 'calculation_input.sbm', true, 'Sueldo base mensual'),
  ('grado', 'numeric', 'calculation_input.grado', true, 'Incapacity percentage'),
  ('gran_invalidez', 'boolean', 'calculation_input.granInvalidez', true, 'Whether gran invalidez applies'),
  ('factor', 'numeric', 'matched_formula.factor', true, 'Formula-specific factor')
ON CONFLICT (variable_name) DO UPDATE SET
  data_type = EXCLUDED.data_type,
  source = EXCLUDED.source,
  enabled = EXCLUDED.enabled,
  description = EXCLUDED.description,
  updated_at = now();

INSERT INTO benefit_formulas (
  formula_name,
  priority,
  formula,
  enabled,
  beneficiary_type,
  periodicity,
  benefit_type,
  conditions
) VALUES
  ('No benefit below 15%', 100, '0', true, 'WORKER', NULL, 'NINGUNO', '{"gradoMin": 0, "gradoMaxExclusive": 15}'::jsonb),
  ('Indemnity factor from 15%', 110, 'sbm * 1.5', true, 'WORKER', 'UNICO', 'INDEMNIZACION', '{"gradoMin": 15, "gradoMaxExclusive": 17.5}'::jsonb),
  ('Indemnity factor from 17.5%', 111, 'sbm * 3', true, 'WORKER', 'UNICO', 'INDEMNIZACION', '{"gradoMin": 17.5, "gradoMaxExclusive": 20}'::jsonb),
  ('Indemnity factor from 20%', 112, 'sbm * 4.5', true, 'WORKER', 'UNICO', 'INDEMNIZACION', '{"gradoMin": 20, "gradoMaxExclusive": 22.5}'::jsonb),
  ('Indemnity factor from 22.5%', 113, 'sbm * 6', true, 'WORKER', 'UNICO', 'INDEMNIZACION', '{"gradoMin": 22.5, "gradoMaxExclusive": 25}'::jsonb),
  ('Indemnity factor from 25%', 114, 'sbm * 7.5', true, 'WORKER', 'UNICO', 'INDEMNIZACION', '{"gradoMin": 25, "gradoMaxExclusive": 27.5}'::jsonb),
  ('Indemnity factor from 27.5%', 115, 'sbm * 9', true, 'WORKER', 'UNICO', 'INDEMNIZACION', '{"gradoMin": 27.5, "gradoMaxExclusive": 30}'::jsonb),
  ('Indemnity factor from 30%', 116, 'sbm * 10.5', true, 'WORKER', 'UNICO', 'INDEMNIZACION', '{"gradoMin": 30, "gradoMaxExclusive": 32.5}'::jsonb),
  ('Indemnity factor from 32.5%', 117, 'sbm * 12', true, 'WORKER', 'UNICO', 'INDEMNIZACION', '{"gradoMin": 32.5, "gradoMaxExclusive": 35}'::jsonb),
  ('Indemnity factor from 35%', 118, 'sbm * 13.5', true, 'WORKER', 'UNICO', 'INDEMNIZACION', '{"gradoMin": 35, "gradoMaxExclusive": 37.5}'::jsonb),
  ('Indemnity factor from 37.5%', 119, 'sbm * 15', true, 'WORKER', 'UNICO', 'INDEMNIZACION', '{"gradoMin": 37.5, "gradoMaxExclusive": 40}'::jsonb),
  ('Partial disability pension', 200, 'sbm * 0.35', true, 'WORKER', 'MENSUAL', 'PENSION_PARCIAL', '{"gradoMin": 40, "gradoMaxExclusive": 70}'::jsonb),
  ('Total disability pension with gran invalidez', 290, 'sbm * 1', true, 'WORKER', 'MENSUAL', 'PENSION_TOTAL', '{"gradoMin": 70, "granInvalidez": true}'::jsonb),
  ('Total disability pension', 300, 'sbm * 0.7', true, 'WORKER', 'MENSUAL', 'PENSION_TOTAL', '{"gradoMin": 70}'::jsonb)
ON CONFLICT (formula_name) DO NOTHING;
