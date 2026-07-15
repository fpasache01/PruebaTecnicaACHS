import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../../src/api/app.js';

describe('benefits API', () => {
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
  });

  describe('GET /openapi.json', () => {
    it('returns an OpenAPI document containing the calculation endpoint', async () => {
      const response = await request(app)
        .get('/openapi.json')
        .expect(200);

      expect(response.body.openapi).toBe('3.0.3');
      expect(response.body.paths).toHaveProperty('/api/benefits/calculate');
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
