# Spec 003: Dynamic Formula Rules

## Summary

This spec adds a dynamic formula rules layer to the ACHS benefit API so benefit formulas can be added, listed, disabled, or deleted without changing application code.

PostgreSQL is the primary persistence backend. Every calculation request loads saved formulas from the database, keeps only `enabled = true` formulas, sorts them by ascending `priority`, and applies the first formula whose conditions match the request.

The existing calculation response shape remains unchanged:

```json
{
  "tipoBeneficio": "PENSION_PARCIAL",
  "monto": 370000,
  "periodicidad": "MENSUAL"
}
```

Formula expressions are stored as literal SQL-style expressions, but they must be validated before being saved or evaluated. The implementation must never execute arbitrary unvalidated SQL.

## PostgreSQL Model

### Formula Rules Table

Use `periodicity`, not `periocity`, for the database column and API field.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE benefit_formulas (
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

CREATE INDEX benefit_formulas_enabled_priority_idx
  ON benefit_formulas (enabled, priority);
```

Field meaning:

- `id`: unique formula identifier.
- `formula_name`: human-readable formula name.
- `priority`: lower numbers run first.
- `formula`: validated SQL-style numeric expression.
- `enabled`: disabled formulas remain saved but are ignored by calculation.
- `beneficiary_type`: formula audience, such as `WORKER`.
- `periodicity`: response periodicity, such as `UNICO`, `MENSUAL`, or `null`.
- `benefit_type`: response benefit type, such as `INDEMNIZACION`, `PENSION_PARCIAL`, `PENSION_TOTAL`, or `NINGUNO`.
- `conditions`: matching criteria, such as incapacity range and `granInvalidez`.

Example `conditions`:

```json
{
  "gradoMin": 40,
  "gradoMaxExclusive": 70,
  "granInvalidez": false
}
```

### Formula Variables Table

Formula variables are database-registered so new variables can be added without changing the `benefit_formulas` schema.

```sql
CREATE TABLE formula_variables (
  variable_name TEXT PRIMARY KEY,
  data_type TEXT NOT NULL CHECK (data_type IN ('numeric', 'boolean', 'text')),
  source TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Seed required variables:

```sql
INSERT INTO formula_variables (variable_name, data_type, source, enabled, description) VALUES
  ('sbm', 'numeric', 'calculation_input.sbm', true, 'Sueldo base mensual'),
  ('grado', 'numeric', 'calculation_input.grado', true, 'Incapacity percentage'),
  ('gran_invalidez', 'boolean', 'calculation_input.granInvalidez', true, 'Whether gran invalidez applies'),
  ('factor', 'numeric', 'matched_formula.factor', true, 'Indemnity factor or formula-specific factor');
```

The database registry defines which variable names are allowed in formulas. The application still owns how each `source` is resolved. Unsupported `source` values must be rejected or treated as non-evaluable.

## Formula Rules

Allowed formula examples:

```sql
0
sbm * 0.35
sbm * 0.70
sbm * 1.00
sbm * factor
sbm * 0.35 + cargas * 10000
```

Allowed formula syntax:

- numeric literals
- registered variable names
- parentheses
- `+`, `-`, `*`, `/`

Rejected formula syntax:

- semicolons
- SQL comments
- subqueries
- table references
- function calls
- DDL or DML keywords
- unknown or disabled variables

Formula validation must happen before insert or update. A formula such as `sbm * unknown_variable` must be rejected unless `unknown_variable` exists in `formula_variables`, is enabled, and has a supported `source`.

Formula evaluation must use parameterized SQL with a controlled context. Do not concatenate request values directly into SQL.

Recommended evaluation shape:

```sql
WITH ctx AS (
  SELECT
    $1::numeric AS sbm,
    $2::numeric AS grado,
    $3::boolean AS gran_invalidez,
    $4::numeric AS factor
)
SELECT (<validated_formula>)::numeric AS monto
FROM ctx;
```

If extra variables exist, the implementation must add them to the controlled context only after resolving them from approved application sources.

## Default Formulas

Seed PostgreSQL with formulas that reproduce the behavior from `spec_001_benefit_engine.md`:

- No benefit for `0 <= grado < 15`, formula `0`.
- Indemnity factor formulas for `15 <= grado < 40`, using the normative factor table.
- Partial pension for `40 <= grado < 70`, formula `sbm * 0.35`.
- Total pension for `70 <= grado <= 100`, formula `sbm * 0.70`.
- Total pension with `granInvalidez = true`, formula `sbm * 1.00`, with higher priority than normal total pension.

Example seed row:

```sql
INSERT INTO benefit_formulas (
  formula_name,
  priority,
  formula,
  enabled,
  beneficiary_type,
  periodicity,
  benefit_type,
  conditions
) VALUES (
  'Partial disability pension',
  200,
  'sbm * 0.35',
  true,
  'WORKER',
  'MENSUAL',
  'PENSION_PARCIAL',
  '{"gradoMin": 40, "gradoMaxExclusive": 70}'::jsonb
);
```

## Public API

### Health Check

```http
GET /health
```

Successful response:

```json
{
  "status": "ok"
}
```

### Calculate Benefit

```http
POST /api/benefits/calculate
Content-Type: application/json
```

Request body:

```json
{
  "sbm": 1000000,
  "grado": 45,
  "granInvalidez": false,
  "beneficiaryType": "WORKER",
  "beneficiary": {
    "cargas": 2
  }
}
```

Fields:

- `sbm`: required finite number, greater than or equal to `0`.
- `grado`: required finite number between `0` and `100`, inclusive.
- `granInvalidez`: optional boolean.
- `beneficiaryType`: optional string used to match `beneficiary_type`.
- `beneficiary`: optional object used to resolve registered formula variables.

Successful response `200` keeps the existing shape:

```json
{
  "tipoBeneficio": "PENSION_PARCIAL",
  "monto": 370000,
  "periodicidad": "MENSUAL"
}
```

### List Formula Rules

```http
GET /api/benefits/rules
```

Successful response `200`:

```json
[
  {
    "id": "71c4f1cc-4db5-41ab-ae9e-9e65052bbf4b",
    "formulaName": "Partial pension with dependent supplement",
    "priority": 150,
    "formula": "sbm * 0.35 + cargas * 10000",
    "enabled": true,
    "beneficiaryType": "WORKER",
    "periodicity": "MENSUAL",
    "benefitType": "PENSION_PARCIAL",
    "conditions": {
      "gradoMin": 40,
      "gradoMaxExclusive": 70
    }
  }
]
```

Rules must be returned sorted by ascending `priority`.

### Add Formula Rule

```http
POST /api/benefits/rules
Content-Type: application/json
```

Request body:

```json
{
  "formulaName": "Partial pension with dependent supplement",
  "priority": 150,
  "formula": "sbm * 0.35 + cargas * 10000",
  "enabled": true,
  "beneficiaryType": "WORKER",
  "periodicity": "MENSUAL",
  "benefitType": "PENSION_PARCIAL",
  "conditions": {
    "gradoMin": 40,
    "gradoMaxExclusive": 70
  }
}
```

Successful response `201` returns the saved formula rule with generated `id`.

### Delete Formula Rule

```http
DELETE /api/benefits/rules/{id}
```

Successful response `204` has no response body.

If the formula rule does not exist, return `404`:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "formula rule not found: 71c4f1cc-4db5-41ab-ae9e-9e65052bbf4b"
  }
}
```

### List Formula Variables

```http
GET /api/benefits/formula-variables
```

Successful response `200`:

```json
[
  {
    "variableName": "sbm",
    "dataType": "numeric",
    "source": "calculation_input.sbm",
    "enabled": true,
    "description": "Sueldo base mensual"
  }
]
```

### Create Or Enable Formula Variable

```http
POST /api/benefits/formula-variables
Content-Type: application/json
```

Request body:

```json
{
  "variableName": "cargas",
  "dataType": "numeric",
  "source": "beneficiary.cargas",
  "enabled": true,
  "description": "Number of beneficiary dependents"
}
```

Successful response `201`:

```json
{
  "variableName": "cargas",
  "dataType": "numeric",
  "source": "beneficiary.cargas",
  "enabled": true,
  "description": "Number of beneficiary dependents"
}
```

If the variable already exists, the endpoint may update or enable it and return `200`.

## API Usage Examples

### 1. Create Or Enable Formula Variable

```http
POST /api/benefits/formula-variables
Content-Type: application/json
```

```json
{
  "variableName": "cargas",
  "dataType": "numeric",
  "source": "beneficiary.cargas",
  "enabled": true,
  "description": "Number of beneficiary dependents"
}
```

### 2. Add Formula Rule

```http
POST /api/benefits/rules
Content-Type: application/json
```

```json
{
  "formulaName": "Partial pension with dependent supplement",
  "priority": 150,
  "formula": "sbm * 0.35 + cargas * 10000",
  "enabled": true,
  "beneficiaryType": "WORKER",
  "periodicity": "MENSUAL",
  "benefitType": "PENSION_PARCIAL",
  "conditions": {
    "gradoMin": 40,
    "gradoMaxExclusive": 70
  }
}
```

### 3. Calculate Benefit

```http
POST /api/benefits/calculate
Content-Type: application/json
```

```json
{
  "sbm": 1000000,
  "grado": 45,
  "granInvalidez": false,
  "beneficiaryType": "WORKER",
  "beneficiary": {
    "cargas": 2
  }
}
```

If the formula above is the first matching enabled formula, the amount is:

```text
1000000 * 0.35 + 2 * 10000 = 370000
```

Successful response `200`:

```json
{
  "tipoBeneficio": "PENSION_PARCIAL",
  "monto": 370000,
  "periodicidad": "MENSUAL"
}
```

### 4. Delete Formula Rule

```http
DELETE /api/benefits/rules/71c4f1cc-4db5-41ab-ae9e-9e65052bbf4b
```

Successful response `204` has no body.

## Interface Conventions

- API JSON uses camelCase fields, such as `formulaName`, `beneficiaryType`, and `variableName`.
- Database columns use snake_case fields, such as `formula_name`, `beneficiary_type`, and `variable_name`.
- Reject misspelled `periocity`; use `periodicity`.
- Conditions remain JSON because matching rules may grow independently from formula fields.
- Formula variables are configured through API/database metadata, but values are resolved by approved application sources.

## Dev Container

Use Docker Compose for API and PostgreSQL development.

Recommended `.devcontainer/devcontainer.json`:

```json
{
  "name": "achs-benefit-engine",
  "dockerComposeFile": "docker-compose.yml",
  "service": "app",
  "workspaceFolder": "/workspaces/PruebaTecnicaACHS",
  "postCreateCommand": "npm install",
  "forwardPorts": [3000],
  "customizations": {
    "vscode": {
      "extensions": [
        "vitest.explorer",
        "dbaeumer.vscode-eslint"
      ]
    }
  }
}
```

Recommended `.devcontainer/docker-compose.yml`:

```yaml
services:
  app:
    image: mcr.microsoft.com/devcontainers/typescript-node:22
    command: sleep infinity
    volumes:
      - ..:/workspaces/PruebaTecnicaACHS:cached
    environment:
      DATABASE_URL: postgres://achs:achs@postgres:5432/achs_benefits
      RULE_STORE: postgres
    depends_on:
      - postgres

  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: achs_benefits
      POSTGRES_USER: achs
      POSTGRES_PASSWORD: achs
    ports:
      - "5433:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  postgres-data:
```

## Implementation Changes

Add domain formula support:

- Define formula rule types, validation, matching, and formula evaluation contracts.
- Keep `calcularBeneficio(sbm, grado, opciones?)` as a compatibility function using default formulas.
- Add a formula-aware calculation function used by the API.

Add PostgreSQL persistence:

- Implement a PostgreSQL repository for formula rules.
- Implement a PostgreSQL repository for formula variables.
- Use `DATABASE_URL` for connection configuration.
- Use `RULE_STORE=postgres` as the default production rule store.
- Add migrations and seed data for default formulas and variables.

Add routes:

- `GET /api/benefits/rules`
- `POST /api/benefits/rules`
- `DELETE /api/benefits/rules/:id`
- `GET /api/benefits/formula-variables`
- `POST /api/benefits/formula-variables`

Update OpenAPI:

- Document formula rule schemas.
- Document formula variable schemas.
- Document optional `beneficiaryType` and `beneficiary` calculation fields.

## Error Contract

Validation errors return `400`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "formula references unknown variable: cargas"
  }
}
```

Missing formula rule deletes return `404`:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "formula rule not found: missing-rule-id"
  }
}
```

Unexpected errors return `500 INTERNAL_SERVER_ERROR` without exposing internals.

## Test Plan

Run:

```bash
npm run db:migrate
npm test
npm run typecheck
```

Required scenarios:

- Migration creates `benefit_formulas` and `formula_variables`.
- Seeded formulas reproduce current calculation behavior.
- Seeded variables include `sbm`, `grado`, `gran_invalidez`, and `factor`.
- `GET /api/benefits/rules` returns formulas sorted by priority.
- `POST /api/benefits/rules` stores a valid formula rule.
- A newly added enabled formula affects future calculations.
- Disabled formulas are ignored by calculation.
- `DELETE /api/benefits/rules/:id` deletes a formula rule.
- `GET /api/benefits/formula-variables` returns configured variables.
- `POST /api/benefits/formula-variables` creates or enables a variable.
- Formulas using registered enabled variables are accepted.
- Formulas using unknown or disabled variables are rejected.
- Dangerous formula strings are rejected.
- Existing calculation endpoint validation remains unchanged.

## Acceptance Criteria

- Benefit calculation uses saved enabled PostgreSQL formulas by default for every client request.
- Formula rules can be listed, added, and deleted through REST endpoints.
- Formula variables can be listed and created or enabled through REST endpoints.
- Literal SQL-style formulas are validated before storage and evaluation.
- Existing calculation response shape remains unchanged.
- Default seeded formulas reproduce the original normative behavior.
- OpenAPI documents formulas, variables, and calculation context fields.
- The Dev Container includes PostgreSQL.
