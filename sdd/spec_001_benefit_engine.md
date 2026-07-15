# Spec 001: Benefit Engine

## Context

ACHS pays economic benefits for permanent incapacity caused by occupational accidents or professional diseases. The benefit type and calculated amount depend on:

- `sbm`: Sueldo Base Mensual.
- `grado`: permanent incapacity percentage.
- `opciones.granInvalidez`: whether the worker requires assistance from third parties.

The attached normative document is the source of truth for business rules. When the prompt and the normative document differ, this spec follows the normative document.

## Public Contract

Implement a TypeScript function:

```ts
function calcularBeneficio(
  sbm: number,
  grado: number,
  opciones?: OpcionesCalculo
): ResultadoBeneficio;
```

### Types

```ts
type TipoBeneficio =
  | 'INDEMNIZACION'
  | 'PENSION_PARCIAL'
  | 'PENSION_TOTAL'
  | 'NINGUNO';

type Periodicidad = 'UNICO' | 'MENSUAL' | null;

interface OpcionesCalculo {
  granInvalidez?: boolean;
}

interface ResultadoBeneficio {
  tipoBeneficio: TipoBeneficio;
  monto: number;
  periodicidad: Periodicidad;
}
```

## Business Rules

### No Benefit

If `grado < 15`, no payment applies.

Expected result:

```ts
{
  tipoBeneficio: 'NINGUNO',
  monto: 0,
  periodicidad: null
}
```

### Global Indemnity

If `15 <= grado < 40`, the worker receives a one-time indemnity.

Formula:

```ts
monto = sbm * factor
```

Factor table:

| Incapacity range | Factor |
| --- | ---: |
| 15.0% to <17.5% | 1.5 |
| 17.5% to <20.0% | 3.0 |
| 20.0% to <22.5% | 4.5 |
| 22.5% to <25.0% | 6.0 |
| 25.0% to <27.5% | 7.5 |
| 27.5% to <30.0% | 9.0 |
| 30.0% to <32.5% | 10.5 |
| 32.5% to <35.0% | 12.0 |
| 35.0% to <37.5% | 13.5 |
| 37.5% to <40.0% | 15.0 |

Expected result:

```ts
{
  tipoBeneficio: 'INDEMNIZACION',
  monto,
  periodicidad: 'UNICO'
}
```

### Partial Disability Pension

If `40 <= grado < 70`, the worker receives a monthly partial disability pension.

Formula:

```ts
monto = sbm * 0.35
```

Expected result:

```ts
{
  tipoBeneficio: 'PENSION_PARCIAL',
  monto,
  periodicidad: 'MENSUAL'
}
```

### Total Disability Pension

If `grado >= 70`, the worker receives a monthly total disability pension.

Base formula:

```ts
monto = sbm * 0.70
```

If `opciones.granInvalidez === true`, add a supplement:

```ts
monto += sbm * 0.30
```

Expected result:

```ts
{
  tipoBeneficio: 'PENSION_TOTAL',
  monto,
  periodicidad: 'MENSUAL'
}
```

## Normative Differences From Prompt

The prompt states:

- Partial disability pension is `30%` of SBM.
- The factor for `22.5%` is `6.5`.

The normative document states:

- Partial disability pension is `35%` of SBM.
- The factor for `22.5%` is `6.0`.

Because the instructions say the normative document is the single source of truth, implementation and tests must use `35%` and `6.0`.

## Validation Rules

The function must validate input before calculating:

- `sbm` must be a finite number.
- `sbm` must be greater than or equal to `0`.
- `grado` must be a finite number.
- `grado` must be between `0` and `100`, inclusive.

Invalid inputs must throw a `RangeError` with a clear message.

## Out of Scope

This first version does not calculate SBM from historical wages. The caller must provide the already calculated SBM.

The following normative topics are also out of scope for this function:

- Pension increases for children.
- Maximum pension caps.
- Concurrences between insurance administrators.
- Revaluations, reliquidations, or prior indemnity discounts.
- Payment deadlines.
- Payment in indemnity installments.
- Wage update factors and historical adjustments.

## Recommended Tooling

Use TypeScript with Vitest for unit testing.

Vitest is recommended because it works naturally with TypeScript, requires little configuration, runs quickly, and provides readable test syntax for interview discussion.

Suggested deliverable structure:

- `benefit_engine.ts`: implementation and exported types.
- `benefit_engine.test.ts`: unit tests.

If the evaluator requires a single `.ts` file or Gist, place the implementation first and the Vitest test cases below it in the same file.

Suggested `package.json` scripts:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

## Containerized Development

Use a Dev Container to make the development and test environment reproducible.

Recommended container setup:

- Node.js 22.
- TypeScript installed as a dev dependency.
- Vitest installed as a dev dependency.
- Dependencies installed with `npm install`.
- Tests executed with `npm test`.
- No forwarded ports are required because this is a pure calculation engine with unit tests.

Suggested `.devcontainer/devcontainer.json`:

```json
{
  "name": "achs-benefit-engine",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:22",
  "postCreateCommand": "npm install",
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

## Test Plan

The test plan must prove that the calculation engine follows the benefit thresholds, factor table, pension percentages, validation rules, and documented normative differences.

### Test Strategy

- Use unit tests only; the engine is a pure calculation function and does not require integration tests.
- Group tests by business behavior: no benefit, indemnity, partial pension, total pension, gran invalidez, and invalid inputs.
- Use explicit boundary values around each legal threshold: `15`, `17.5`, `20`, `22.5`, `25`, `27.5`, `30`, `32.5`, `35`, `37.5`, `40`, and `70`.
- Use `sbm = 1_000_000` in most tests so expected amounts are easy to verify manually during the interview.
- Add at least one decimal value immediately before each major boundary, such as `14.99`, `39.99`, and `69.99`.

### Execution

Run tests locally or inside the Dev Container:

```bash
npm install
npm test
```

For development feedback:

```bash
npm run test:watch
```

### Pass Criteria

- `npm test` exits successfully.
- All benefit type boundaries are covered.
- All indemnity factor thresholds are covered.
- Invalid numerical inputs throw `RangeError`.
- Tests explicitly verify that the implementation uses `35%` for partial pension and factor `6.0` for `22.5%`, matching the normative document.
- The test names describe the business rule being protected, not only the implementation detail.

## Unit Test Scenarios

Use `sbm = 1_000_000` for most examples.

### No Benefit

- `grado = 0`: returns `NINGUNO`, amount `0`, periodicity `null`.
- `grado = 14.99`: returns `NINGUNO`, amount `0`, periodicity `null`.

### Indemnity Factors

- `grado = 15`: factor `1.5`, amount `1_500_000`.
- `grado = 17.49`: factor `1.5`, amount `1_500_000`.
- `grado = 17.5`: factor `3.0`, amount `3_000_000`.
- `grado = 22.5`: factor `6.0`, amount `6_000_000`.
- `grado = 37.5`: factor `15.0`, amount `15_000_000`.
- `grado = 39.99`: factor `15.0`, amount `15_000_000`.

### Pension Boundaries

- `grado = 40`: returns `PENSION_PARCIAL`, amount `350_000`, periodicity `MENSUAL`.
- `grado = 69.99`: returns `PENSION_PARCIAL`, amount `350_000`, periodicity `MENSUAL`.
- `grado = 70`: returns `PENSION_TOTAL`, amount `700_000`, periodicity `MENSUAL`.
- `grado = 100`: returns `PENSION_TOTAL`, amount `700_000`, periodicity `MENSUAL`.

### Gran Invalidez

- `grado = 70`, `granInvalidez = true`: returns `PENSION_TOTAL`, amount `1_000_000`.
- `grado = 40`, `granInvalidez = true`: supplement does not apply; amount remains `350_000`.
- `grado = 20`, `granInvalidez = true`: supplement does not apply; indemnity factor rules remain unchanged.

### Validation

- Negative `sbm` throws `RangeError`.
- `NaN` `sbm` throws `RangeError`.
- Infinite `sbm` throws `RangeError`.
- Negative `grado` throws `RangeError`.
- `grado > 100` throws `RangeError`.
- `NaN` `grado` throws `RangeError`.
- Infinite `grado` throws `RangeError`.

## Acceptance Criteria

- The calculation function is deterministic and has no side effects.
- Every boundary between benefit types is covered by tests.
- Every indemnity factor threshold is represented in code as explicit data, not hidden in nested conditionals.
- Tests document the normative differences from the prompt.
- The implementation can be discussed from a single TypeScript solution file plus unit tests.
