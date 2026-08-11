import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/api/app.js';
import { InMemoryBenefitFormulaRepository } from '../../../src/api/benefit_formula_repository.js';
import { TablasIndicadoresEnMemoria } from '../../../src/domain/ppee/ppee_indicators.js';
import {
  DEFAULT_BENEFIT_FORMULAS,
  DEFAULT_FORMULA_VARIABLES,
} from '../../../src/domain/benefit/benefit_rules.js';

function indicadoresDePrueba(): TablasIndicadoresEnMemoria {
  const reajuste = new Map<string, number>();
  for (let anio = 2024; anio <= 2026; anio += 1) {
    for (let mes = 1; mes <= 12; mes += 1) {
      reajuste.set(`${anio}-${String(mes).padStart(2, '0')}`, 1);
    }
  }
  const imnr = new Map<string, number>();
  for (let anio = 2024; anio <= 2026; anio += 1) {
    for (let mes = 1; mes <= 12; mes += 1) {
      imnr.set(`${anio}-${String(mes).padStart(2, '0')}`, 296511);
    }
  }
  const tasas = new Map<string, number>([
    ['FONDO_PENSIONES', 0.1],
    ['SALUD_FONASA', 0.07],
    ['LIMITE_MAXIMO_PENSION', 5_000_000],
    ['PENSION_MINIMA', 0],
  ]);
  const comision = new Map<string, Map<string, number>>([
    ['MODELO', new Map([['*', 0.0058]])],
  ]);
  return new TablasIndicadoresEnMemoria(
    new Map(), reajuste, imnr, new Map(), tasas, comision,
  );
}

describe('PPEE API', () => {
  const repository = new InMemoryBenefitFormulaRepository(
    [...DEFAULT_BENEFIT_FORMULAS],
    [...DEFAULT_FORMULA_VARIABLES],
  );
  const app = createApp({
    formulaRepository: repository,
    variableRepository: repository,
    ppeeIndicadores: indicadoresDePrueba(),
  });

  it('POST /api/ppee/calculate calcula una indemnizacion global', async () => {
    const response = await request(app)
      .post('/api/ppee/calculate')
      .send({
        tipoPrestacion: 'Indemnización global',
        reip: 30,
        sbpForzado: 615441,
      })
      .expect(200);

    expect(response.body.tipoPrestacion).toBe('INDEMNIZACION_GLOBAL');
    expect(response.body.montoIndemnizacion).toBe(6462131);
    expect(response.body.factorSueldos).toBe(10.5);
  });

  it('POST /api/ppee/calculate deniega bajo el umbral', async () => {
    const response = await request(app)
      .post('/api/ppee/calculate')
      .send({ reip: 10 })
      .expect(200);

    expect(response.body.errorCode).toBe('REIP_BAJO_UMBRAL');
  });

  it('POST /api/ppee/calculate devuelve error tipado en 400', async () => {
    const response = await request(app)
      .post('/api/ppee/calculate')
      .send({
        tipoPrestacion: 'Pensión de invalidez total',
        reip: 72,
        sbpForzado: 600000,
        fechaInicioPension: '2024-06-01',
        fechaCalculo: '2026-04-30',
        descuentos: { iusc: true },
      })
      .expect(400);

    expect(response.body.error.code).toBe('EXD-PAG-030');
  });
});
