import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/api/app.js';
import { InMemoryBenefitFormulaRepository } from '../../../src/api/benefit_formula_repository.js';
import {
  DEFAULT_BENEFIT_FORMULAS,
  DEFAULT_FORMULA_VARIABLES,
  type BenefitFormulaRule,
  type FormulaVariable,
} from '../../../src/domain/benefit/benefit_rules.js';

let rules: BenefitFormulaRule[];
let variables: FormulaVariable[];
let repository: InMemoryBenefitFormulaRepository;
let app: ReturnType<typeof createApp>;

describe('benefits API', () => {
  beforeEach(() => {
    rules = [...DEFAULT_BENEFIT_FORMULAS];
    variables = [...DEFAULT_FORMULA_VARIABLES];
    repository = new InMemoryBenefitFormulaRepository(rules, variables);
    app = createApp({
      formulaRepository: repository,
      variableRepository: repository,
    });
  });

  describe('GET /health', () => {
    it('returns API health status', async () => {
      await request(app)
        .get('/health')
        .expect(200)
        .expect({ status: 'ok' });
    });
  });

  describe('POST /api/benefits/calculate', () => {
    it.each([
      [
        'no benefit',
        { sbm: 1_000_000, grado: 14.99 },
        { tipoBeneficio: 'NINGUNO', monto: 0, periodicidad: null },
      ],
      [
        'global indemnity',
        { sbm: 1_000_000, grado: 22.5 },
        { tipoBeneficio: 'INDEMNIZACION', monto: 6_000_000, periodicidad: 'UNICO' },
      ],
      [
        'partial pension',
        { sbm: 1_000_000, grado: 40 },
        { tipoBeneficio: 'PENSION_PARCIAL', monto: 350_000, periodicidad: 'MENSUAL' },
      ],
      [
        'total pension',
        { sbm: 1_000_000, grado: 70 },
        { tipoBeneficio: 'PENSION_TOTAL', monto: 700_000, periodicidad: 'MENSUAL' },
      ],
      [
        'total pension with gran invalidez',
        { sbm: 1_000_000, grado: 70, granInvalidez: true },
        { tipoBeneficio: 'PENSION_TOTAL', monto: 1_000_000, periodicidad: 'MENSUAL' },
      ],
    ])('returns the expected result for %s', async (_name, body, expectedResult) => {
      await request(app)
        .post('/api/benefits/calculate')
        .send(body)
        .expect(200)
        .expect(expectedResult);
    });

    it.each([
      ['missing sbm', { grado: 15 }, 'sbm is required'],
      ['missing grado', { sbm: 1_000_000 }, 'grado is required'],
      ['non-number sbm', { sbm: '1000000', grado: 15 }, 'sbm must be a number'],
      ['non-number grado', { sbm: 1_000_000, grado: '15' }, 'grado must be a number'],
      ['negative sbm', { sbm: -1, grado: 15 }, 'sbm must be greater than or equal to 0'],
      ['out-of-range grado', { sbm: 1_000_000, grado: 100.01 }, 'grado must be between 0 and 100'],
      [
        'non-boolean granInvalidez',
        { sbm: 1_000_000, grado: 70, granInvalidez: 'true' },
        'granInvalidez must be a boolean',
      ],
      [
        'non-string beneficiaryType',
        { sbm: 1_000_000, grado: 70, beneficiaryType: 123 },
        'beneficiaryType must be a string',
      ],
      [
        'non-object beneficiary',
        { sbm: 1_000_000, grado: 70, beneficiary: 'invalid' },
        'beneficiary must be an object',
      ],
    ])('returns validation error for %s', async (_name, body, message) => {
      await request(app)
        .post('/api/benefits/calculate')
        .send(body)
        .expect(400)
        .expect({
          error: {
            code: 'VALIDATION_ERROR',
            message,
          },
        });
    });

    it('returns validation error for invalid JSON', async () => {
      await request(app)
        .post('/api/benefits/calculate')
        .set('Content-Type', 'application/json')
        .send('{')
        .expect(400)
        .expect({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'request body must be valid JSON',
          },
        });
    });

    it('uses a newly added enabled formula for future calculations', async () => {
      await request(app)
        .post('/api/benefits/rules')
        .send({
          formulaName: 'Total pension over 85%',
          priority: 10,
          formula: 'sbm * 0.9',
          enabled: true,
          beneficiaryType: 'WORKER',
          periodicity: 'MENSUAL',
          benefitType: 'PENSION_TOTAL',
          conditions: {
            gradoMin: 85,
          },
        })
        .expect(201);

      await request(app)
        .post('/api/benefits/calculate')
        .send({ sbm: 1_000_000, grado: 85 })
        .expect(200)
        .expect({
          tipoBeneficio: 'PENSION_TOTAL',
          monto: 900_000,
          periodicidad: 'MENSUAL',
        });
    });

    it('uses registered beneficiary variables in formulas', async () => {
      await request(app)
        .post('/api/benefits/formula-variables')
        .send({
          variableName: 'cargas',
          dataType: 'numeric',
          source: 'beneficiary.cargas',
          enabled: true,
          description: 'Number of beneficiary dependents',
        })
        .expect(201);

      await request(app)
        .post('/api/benefits/rules')
        .send({
          formulaName: 'Partial pension with dependent supplement',
          priority: 150,
          formula: 'sbm * 0.35 + cargas * 10000',
          enabled: true,
          beneficiaryType: 'WORKER',
          periodicity: 'MENSUAL',
          benefitType: 'PENSION_PARCIAL',
          conditions: {
            gradoMin: 40,
            gradoMaxExclusive: 70,
          },
        })
        .expect(201);

      await request(app)
        .post('/api/benefits/calculate')
        .send({
          sbm: 1_000_000,
          grado: 45,
          beneficiaryType: 'WORKER',
          beneficiary: {
            cargas: 2,
          },
        })
        .expect(200)
        .expect({
          tipoBeneficio: 'PENSION_PARCIAL',
          monto: 370_000,
          periodicidad: 'MENSUAL',
        });
    });

    it('ignores disabled dynamic formulas during calculation', async () => {
      await request(app)
        .post('/api/benefits/rules')
        .send({
          formulaName: 'Disabled over 85%',
          priority: 10,
          formula: 'sbm * 0.9',
          enabled: false,
          beneficiaryType: 'WORKER',
          periodicity: 'MENSUAL',
          benefitType: 'PENSION_TOTAL',
          conditions: {
            gradoMin: 85,
          },
        })
        .expect(201);

      await request(app)
        .post('/api/benefits/calculate')
        .send({ sbm: 1_000_000, grado: 85 })
        .expect(200)
        .expect({
          tipoBeneficio: 'PENSION_TOTAL',
          monto: 700_000,
          periodicidad: 'MENSUAL',
        });
    });
  });

  describe('GET /api/benefits/rules', () => {
    it('returns saved formulas sorted by priority', async () => {
      const response = await request(app)
        .get('/api/benefits/rules')
        .expect(200);

      expect(response.body[0]).toMatchObject({
        id: 'no-benefit',
        priority: 100,
      });
      expect(response.body.at(-1)).toMatchObject({
        id: 'total-pension',
        priority: 300,
      });
    });
  });

  describe('POST /api/benefits/rules', () => {
    it('adds a valid formula rule', async () => {
      const response = await request(app)
        .post('/api/benefits/rules')
        .send({
          formulaName: 'Fixed special benefit',
          priority: 5,
          formula: '123000',
          enabled: true,
          beneficiaryType: 'WORKER',
          periodicity: 'UNICO',
          benefitType: 'INDEMNIZACION',
          conditions: {
            gradoMin: 10,
            gradoMaxExclusive: 11,
          },
        })
        .expect(201);

      expect(response.body).toMatchObject({
        formulaName: 'Fixed special benefit',
        priority: 5,
        formula: '123000',
      });
      expect(response.body.id).toEqual(expect.any(String));
    });

    it('returns validation error for invalid formula payloads', async () => {
      await request(app)
        .post('/api/benefits/rules')
        .send({
          formulaName: 'Invalid rule',
          priority: '10',
          formula: '1000',
          enabled: true,
          beneficiaryType: 'WORKER',
          periodicity: 'UNICO',
          benefitType: 'INDEMNIZACION',
          conditions: {
            gradoMin: 10,
          },
        })
        .expect(400)
        .expect({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'priority must be a finite number',
          },
        });
    });

    it('rejects formulas that reference unknown variables', async () => {
      await request(app)
        .post('/api/benefits/rules')
        .send({
          formulaName: 'Unknown variable',
          priority: 5,
          formula: 'sbm * unknown_variable',
          enabled: true,
          beneficiaryType: 'WORKER',
          periodicity: 'UNICO',
          benefitType: 'INDEMNIZACION',
          conditions: {
            gradoMin: 10,
          },
        })
        .expect(400)
        .expect({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'formula references unknown variable: unknown_variable',
          },
        });
    });

    it('rejects dangerous formula strings', async () => {
      await request(app)
        .post('/api/benefits/rules')
        .send({
          formulaName: 'Dangerous formula',
          priority: 5,
          formula: 'sbm; drop table benefit_formulas',
          enabled: true,
          beneficiaryType: 'WORKER',
          periodicity: 'UNICO',
          benefitType: 'INDEMNIZACION',
          conditions: {
            gradoMin: 10,
          },
        })
        .expect(400)
        .expect({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'formula contains forbidden SQL syntax',
          },
        });
    });
  });

  describe('GET /api/benefits/formula-variables', () => {
    it('returns configured formula variables', async () => {
      const response = await request(app)
        .get('/api/benefits/formula-variables')
        .expect(200);

      expect(response.body).toContainEqual(
        expect.objectContaining({
          variableName: 'sbm',
          dataType: 'numeric',
          source: 'calculation_input.sbm',
        }),
      );
    });
  });

  describe('POST /api/benefits/formula-variables', () => {
    it('creates a formula variable', async () => {
      await request(app)
        .post('/api/benefits/formula-variables')
        .send({
          variableName: 'cargas',
          dataType: 'numeric',
          source: 'beneficiary.cargas',
          enabled: true,
          description: 'Number of beneficiary dependents',
        })
        .expect(201)
        .expect({
          variableName: 'cargas',
          dataType: 'numeric',
          source: 'beneficiary.cargas',
          enabled: true,
          description: 'Number of beneficiary dependents',
        });
    });

    it('updates an existing formula variable', async () => {
      await request(app)
        .post('/api/benefits/formula-variables')
        .send({
          variableName: 'sbm',
          dataType: 'numeric',
          source: 'calculation_input.sbm',
          enabled: false,
          description: 'Disabled SBM',
        })
        .expect(200)
        .expect({
          variableName: 'sbm',
          dataType: 'numeric',
          source: 'calculation_input.sbm',
          enabled: false,
          description: 'Disabled SBM',
        });
    });
  });

  describe('DELETE /api/benefits/rules/:id', () => {
    it('deletes an existing formula rule', async () => {
      await request(app)
        .delete('/api/benefits/rules/partial-pension')
        .expect(204);

      await request(app)
        .get('/api/benefits/rules')
        .expect(200)
        .expect((response) => {
          expect(response.body).not.toContainEqual(
            expect.objectContaining({ id: 'partial-pension' }),
          );
        });
    });

    it('returns not found for a missing formula rule', async () => {
      await request(app)
        .delete('/api/benefits/rules/missing-rule')
        .expect(404)
        .expect({
          error: {
            code: 'NOT_FOUND',
            message: 'formula rule not found: missing-rule',
          },
        });
    });
  });

  describe('GET /openapi.json', () => {
    it('returns an OpenAPI document containing the formula endpoints', async () => {
      const response = await request(app)
        .get('/openapi.json')
        .expect(200);

      expect(response.body.openapi).toBe('3.0.3');
      expect(response.body.paths).toHaveProperty('/api/benefits/calculate');
      expect(response.body.paths).toHaveProperty('/api/benefits/rules');
      expect(response.body.paths).toHaveProperty('/api/benefits/formula-variables');
    });
  });

  describe('GET /docs', () => {
    it('serves Swagger UI content', async () => {
      const response = await request(app)
        .get('/docs/')
        .expect(200);

      expect(response.text).toContain('Swagger UI');
    });

    it('serves Swagger UI content from /api-docs alias', async () => {
      const response = await request(app)
        .get('/api-docs/')
        .expect(200);

      expect(response.text).toContain('Swagger UI');
    });
  });
});
