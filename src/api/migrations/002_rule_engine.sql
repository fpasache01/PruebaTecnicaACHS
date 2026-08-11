-- 002: Rule engine extension (spec_004 / spec_005)
-- Tipos de regla, action, condiciones enriquecidas, overlap y tablas de indicadores.
-- Idempotente: seguro re-ejecutar sobre 001.

-- ---------------------------------------------------------------------------
-- 1. Extender benefit_formulas
-- ---------------------------------------------------------------------------
ALTER TABLE benefit_formulas
  ADD COLUMN IF NOT EXISTS rule_type TEXT NOT NULL DEFAULT 'FORMULA'
    CHECK (rule_type IN ('FORMULA', 'DECISION', 'COMPOSITE', 'MAPPING', 'EFFECT'));

ALTER TABLE benefit_formulas
  ADD COLUMN IF NOT EXISTS action JSONB;

ALTER TABLE benefit_formulas
  ADD COLUMN IF NOT EXISTS description TEXT;

-- ---------------------------------------------------------------------------
-- 2. Variables nuevas para el motor extendido (indicators.*, parametros.*,
--    rule.* (encadenamiento), prestacion.*, ficha.*)
-- ---------------------------------------------------------------------------
INSERT INTO formula_variables (variable_name, data_type, source, enabled, description) VALUES
  ('uf', 'numeric', 'indicators.uf', true, 'UF del periodo (unidad de fomento)'),
  ('ipc', 'numeric', 'indicators.ipc', true, 'Factor de reajuste IPC / Reajuste_rentas_SBM'),
  ('imnr', 'numeric', 'indicators.imnr', true, 'Ingreso Mínimo No Remuneracional'),
  ('tope_imponible', 'numeric', 'indicators.topeImponible', true, 'Tope imponible en pesos del mes'),
  ('tasa_afp', 'numeric', 'parametros.tasaAfp', true, 'Comision AFP vigente'),
  ('tasa_fondo', 'numeric', 'parametros.tasaFondo', true, 'Tasa fondo de pensiones (10%)'),
  ('tasa_salud', 'numeric', 'parametros.tasaSalud', true, 'Tasa cotizacion salud (FONASA 7%)'),
  ('factor_depuracion', 'numeric', 'parametros.factorDepuracion', true, 'Factor DL 3.501 segun regimen'),
  ('sbp', 'numeric', 'prestacion.sbp', true, 'Sueldo base promedio (output M1)'),
  ('hijos', 'numeric', 'ficha.hijos', true, 'Numero de hijos causantes'),
  ('cargas', 'numeric', 'ficha.cargas', true, 'Numero de cargas')
ON CONFLICT (variable_name) DO UPDATE SET
  data_type = EXCLUDED.data_type,
  source = EXCLUDED.source,
  enabled = EXCLUDED.enabled,
  description = EXCLUDED.description,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. Tablas de indicadores (freeze 2026-06-15 / marco MN-TEST-16744-BASE)
-- ---------------------------------------------------------------------------

-- UF por dia calendario (o ultimo dia disponible del mes).
CREATE TABLE IF NOT EXISTS current_uf (
  fecha DATE PRIMARY KEY,
  valor NUMERIC(18, 6) NOT NULL,
  creado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Factor de reajuste de rentas (Reajuste_rentas_SBM / IPC), mes a mes.
-- periodo = 'YYYY-MM'; factor = variacion del periodo vs el anterior (1.0 = base).
CREATE TABLE IF NOT EXISTS current_ipc (
  periodo TEXT PRIMARY KEY,
  factor NUMERIC(12, 6) NOT NULL,
  creado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ingreso Minimo No Remuneracional por periodo (piso del SBP) + umbral 50% sobrevivencia.
CREATE TABLE IF NOT EXISTS current_imnr (
  periodo TEXT PRIMARY KEY,
  valor NUMERIC(18, 2) NOT NULL,
  umbral_50_sv NUMERIC(18, 2),
  creado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tope imponible por vigencia y regimen (en UF).
CREATE TABLE IF NOT EXISTS current_tope_imponible (
  id SERIAL PRIMARY KEY,
  vigencia_desde DATE NOT NULL,
  vigencia_hasta DATE,
  regimen TEXT NOT NULL DEFAULT 'AFP_STD',
  tope_uf NUMERIC(12, 4) NOT NULL,
  creado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS current_tope_imponible_regimen_idx
  ON current_tope_imponible (regimen, vigencia_desde);

-- Tasas / parametros numericos (comision AFP, fondo, salud, DL 3.501, PGU cotas).
CREATE TABLE IF NOT EXISTS current_tasas (
  nombre TEXT PRIMARY KEY,
  valor NUMERIC(18, 8) NOT NULL,
  vigencia_desde DATE,
  vigencia_hasta DATE,
  creado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. Registro de ejecuciones (EFFECT / auditoria)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rule_runs (
  id BIGSERIAL PRIMARY KEY,
  rule_id TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  resultado JSONB NOT NULL,
  ejecutado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rule_runs_rule_id_idx ON rule_runs (rule_id);

-- ---------------------------------------------------------------------------
-- 5. Deteccion de overlap entre reglas habilitadas (riesgo spec_004)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW rule_overlaps AS
SELECT
  a.id AS rule_id_a,
  a.formula_name AS name_a,
  a.priority AS priority_a,
  a.rule_type AS rule_type_a,
  b.id AS rule_id_b,
  b.formula_name AS name_b,
  b.priority AS priority_b,
  b.rule_type AS rule_type_b
FROM benefit_formulas a
JOIN benefit_formulas b ON a.id < b.id
  AND a.enabled = true
  AND b.enabled = true
  AND a.beneficiary_type = b.beneficiary_type
  AND a.benefit_type = b.benefit_type
  AND (
    a.conditions->>'gradoMin' IS NULL
    OR b.conditions->>'gradoMaxExclusive' IS NULL
    OR (a.conditions->>'gradoMin')::numeric < (b.conditions->>'gradoMaxExclusive')::numeric
  )
  AND (
    b.conditions->>'gradoMin' IS NULL
    OR a.conditions->>'gradoMaxExclusive' IS NULL
    OR (b.conditions->>'gradoMin')::numeric < (a.conditions->>'gradoMaxExclusive')::numeric
  )
  AND (
    a.conditions->>'granInvalidez' IS NULL
    OR b.conditions->>'granInvalidez' IS NULL
    OR a.conditions->>'granInvalidez' = b.conditions->>'granInvalidez'
  );
