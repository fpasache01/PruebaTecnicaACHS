import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cargarIndicadoresDesdeJson } from '../../src/domain/ppee/ppee_indicators.js';
import { evaluarCaso } from '../helpers/golden_runner.js';
import { cargarGoldenDataset } from '../helpers/golden.js';

function cargarIndicadores(): ReturnType<typeof cargarIndicadoresDesdeJson> {
  const raw = readFileSync(new URL('../../data/indicators.json', import.meta.url), 'utf8');
  return cargarIndicadoresDesdeJson(JSON.parse(raw));
}

const indicadores = cargarIndicadores();

describe('golden dataset (267 casos)', () => {
  const golden = cargarGoldenDataset();

  it('tiene exactamente 267 casos y las 14 secciones esperadas', () => {
    expect(golden.casos).toHaveLength(267);
    const ids = new Set(golden.casos.map((c) => c.id));
    expect(ids.size).toBe(267);
    const porSeccion = golden.casos.reduce<Record<string, number>>((acc, c) => {
      acc[c.seccion] = (acc[c.seccion] ?? 0) + 1;
      return acc;
    }, {});
    expect(porSeccion).toEqual({
      IND: 20, PEN: 52, SOB: 23, ERR: 2, FR: 20, SBP: 25,
      NEG: 20, REC: 15, SOBE: 15, TEC: 15, PENE: 20, REGI: 16,
      AGR: 14, NRM: 10,
    });
  });

  it('reproduce los casos madre con tolerancia ±$1', () => {
    const casosMadre: Array<[string, Partial<Record<string, number>>]> = [
      ['GDS-CM-01', { sbp: 573124, pension: 200593, liquido: 165329, neto: 207279 }],
      ['GDS-CM-04', { montoIndem: 6462131 }],
      ['GDS-CM-06', { pension: 397166, liquido: 327343 }],
      ['GDS-CM-07', { liquido: 290516, neto: 697706 }],
      ['GDS-CM-11', { pension: 219720, liquido: 179578, neto: 259160 }],
      ['GDS-NEG-001', { error: 1 }],
      ['GDS-FR-001', { error: 1 }],
      ['GDS-CM-04-V-TOPE', { montoIndem: 31208121 }],
    ];

    for (const [id, esperados] of casosMadre) {
      const caso = golden.casos.find((c) => c.id === id);
      expect(caso, `caso ${id} no encontrado`).toBeDefined();
      const evaluacion = evaluarCaso(caso!, indicadores);

      if ('error' in esperados) {
        expect(evaluacion.errorCode, `${id}: ${evaluacion.motivo.join('; ')}`).toBeDefined();
        continue;
      }

      expect(evaluacion.pasa, `${id}: ${evaluacion.motivo.join('; ')}`).toBe(true);
      const r = evaluacion.resultado;
      if (esperados.sbp !== undefined) {
        expect(Math.abs((r?.sbp ?? 0) - esperados.sbp)).toBeLessThanOrEqual(1);
      }
      if (esperados.pension !== undefined) {
        expect(Math.abs((r?.montoMensual ?? 0) - esperados.pension)).toBeLessThanOrEqual(1);
      }
      if (esperados.liquido !== undefined) {
        expect(Math.abs((r?.liquido ?? 0) - esperados.liquido)).toBeLessThanOrEqual(1);
      }
      if (esperados.neto !== undefined) {
        expect(Math.abs((r?.netoPrimerPago ?? 0) - esperados.neto)).toBeLessThanOrEqual(1);
      }
      if (esperados.montoIndem !== undefined) {
        expect(Math.abs((r?.montoIndemnizacion ?? 0) - esperados.montoIndem)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('mantiene el piso de casos conformes (baseline de regresion)', () => {
    const evaluaciones = golden.casos.map((caso) => evaluarCaso(caso, indicadores));
    const conformes = evaluaciones.filter((e) => e.pasa).length;
    const erroresNoTipados = evaluaciones.filter(
      (e) => e.tipoPrestacion === 'ERROR',
    ).length;

    expect(conformes).toBeGreaterThanOrEqual(140);
    expect(erroresNoTipados).toBe(0);
  });

  it('ejecuta todos los casos sin excepciones no tipadas', () => {
    for (const caso of golden.casos) {
      const evaluacion = evaluarCaso(caso, indicadores);
      expect(
        evaluacion.tipoPrestacion,
        `${caso.id}: ${evaluacion.motivo.join('; ')}`,
      ).not.toBe('ERROR');
    }
  });
});
