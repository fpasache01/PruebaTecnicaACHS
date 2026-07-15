# Spec 002: API Implementation

## Summary

This spec adds a basic HTTP API around the existing pure TypeScript benefit engine. The API must expose the calculation use case through Express, document the contract with Swagger/OpenAPI, and add API integration tests while preserving `spec_001_benefit_engine.md` as the domain-engine source of record.

The API must not duplicate benefit business rules. All benefit calculations must delegate to `calcularBeneficio` from `src/domain/benefit/benefit_engine.ts`.

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
  "grado": 70,
  "granInvalidez": true
}
```

Fields:

- `sbm`: required finite number, greater than or equal to `0`.
- `grado`: required finite number between `0` and `100`, inclusive.
- `granInvalidez`: optional boolean.

Successful response `200`:

```json
{
  "tipoBeneficio": "PENSION_TOTAL",
  "monto": 1000000,
  "periodicidad": "MENSUAL"
}
```

The successful response intentionally mirrors the existing `ResultadoBeneficio` domain result without an extra wrapper.

### OpenAPI Document

```http
GET /openapi.json
```

Returns an OpenAPI 3 document describing:

- `GET /health`
- `POST /api/benefits/calculate`
- `GET /openapi.json`

### Swagger UI

```http
GET /docs
```

Serves Swagger UI for the OpenAPI document.

## Error Contract

Invalid JSON, missing required fields, non-number values, and invalid numeric ranges must return `400`.

Response shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "grado must be between 0 and 100"
  }
}
```

Rules:

- Domain `RangeError` exceptions must be translated into `400 VALIDATION_ERROR` responses.
- Unexpected errors must not expose internal details.
- The API layer may validate request shape before calling the domain function, but it must not reimplement benefit threshold logic.

## Implementation Changes

Use Express for the application layer.

Recommended production files:

```text
src/
  api/
    app.ts
    openapi.ts
    server.ts
```

Responsibilities:

- `app.ts`: create and export the Express app, configure JSON parsing, register API routes, register Swagger UI, and register error handling.
- `openapi.ts`: export the static OpenAPI 3 document.
- `server.ts`: read `PORT` from the environment, default to `3000`, and start the app.

Recommended dependencies:

```json
{
  "dependencies": {
    "express": "latest",
    "swagger-ui-express": "latest"
  },
  "devDependencies": {
    "@types/express": "latest",
    "@types/supertest": "latest",
    "@types/swagger-ui-express": "latest",
    "supertest": "latest",
    "tsx": "latest"
  }
}
```

Recommended scripts:

```json
{
  "scripts": {
    "dev": "tsx src/api/server.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

## Containerized Development

Update the Dev Container recommendation for API development:

- Node.js 22.
- Dependencies installed with `npm install`.
- Tests executed with `npm test`.
- Type checking executed with `npm run typecheck`.
- Forward port `3000` so Swagger UI and the API can be opened from the host.

Suggested `.devcontainer/devcontainer.json` addition:

```json
{
  "forwardPorts": [3000]
}
```

## Test Plan

The test plan must keep the existing domain unit tests as the business-rule safety net and add API integration coverage for the HTTP contract.

### Existing Domain Tests

Keep the current domain tests unchanged:

- No benefit thresholds.
- Indemnity factor thresholds.
- Partial pension at `35%`.
- Total pension at `70%`.
- Gran invalidez supplement.
- Invalid domain inputs.

### API Integration Tests

Use Vitest and Supertest.

Recommended test file:

```text
tests/integration/api/benefits_api.test.ts
```

Required scenarios:

- `GET /health` returns `200` and `{ "status": "ok" }`.
- `POST /api/benefits/calculate` returns `NINGUNO` for `grado` below `15`.
- `POST /api/benefits/calculate` returns `INDEMNIZACION` for an indemnity case.
- `POST /api/benefits/calculate` returns `PENSION_PARCIAL` for a partial pension case.
- `POST /api/benefits/calculate` returns `PENSION_TOTAL` for a total pension case.
- `POST /api/benefits/calculate` applies `granInvalidez` for total pension.
- Missing `sbm` returns `400`.
- Missing `grado` returns `400`.
- Non-number `sbm` returns `400`.
- Non-number `grado` returns `400`.
- Negative `sbm` returns `400`.
- Out-of-range `grado` returns `400`.
- Invalid JSON returns `400`.
- `GET /openapi.json` returns `200` and contains the `/api/benefits/calculate` path.
- `GET /docs` returns `200` and serves Swagger UI content.

### Acceptance Commands

Run:

```bash
npm test
npm run typecheck
```

Pass criteria:

- All existing domain unit tests pass.
- All API integration tests pass.
- TypeScript type checking passes.
- Swagger UI is available at `/docs`.
- The OpenAPI document is available at `/openapi.json`.

## Acceptance Criteria

- A basic Express API is available over the existing benefit engine.
- The API delegates benefit calculations to the domain layer.
- Successful calculation responses return the existing `ResultadoBeneficio` shape.
- Validation failures return the documented `VALIDATION_ERROR` shape.
- Swagger documentation describes the public endpoints.
- The test plan covers both domain behavior and HTTP behavior.
- `spec_001_benefit_engine.md` remains unchanged.
