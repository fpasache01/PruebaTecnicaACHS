import { describe, expect, it } from 'vitest';
import { calcularBeneficio } from '../../../../src/domain/benefit/benefit_engine.js';
import { FACTORES_INDEMNIZACION } from '../../../../src/domain/benefit/indemnity_factor_table.js';

const SBM = 1_000_000;

describe('calcularBeneficio', () => {
  describe('no benefit', () => {
    it('returns no benefit for 0% incapacity', () => {
      expect(calcularBeneficio(SBM, 0)).toEqual({
        tipoBeneficio: 'NINGUNO',
        monto: 0,
        periodicidad: null,
      });
    });

    it('returns no benefit immediately before the 15% threshold', () => {
      expect(calcularBeneficio(SBM, 14.99)).toEqual({
        tipoBeneficio: 'NINGUNO',
        monto: 0,
        periodicidad: null,
      });
    });
  });

  describe('global indemnity', () => {
    it.each([
      [15, 1.5, 1_500_000],
      [17.49, 1.5, 1_500_000],
      [17.5, 3.0, 3_000_000],
      [20, 4.5, 4_500_000],
      [22.5, 6.0, 6_000_000],
      [25, 7.5, 7_500_000],
      [27.5, 9.0, 9_000_000],
      [30, 10.5, 10_500_000],
      [32.5, 12.0, 12_000_000],
      [35, 13.5, 13_500_000],
      [37.5, 15.0, 15_000_000],
      [39.99, 15.0, 15_000_000],
    ])(
      'returns a one-time indemnity for grado %s with factor %s',
      (grado, factor, monto) => {
        expect(calcularBeneficio(SBM, grado)).toEqual({
          tipoBeneficio: 'INDEMNIZACION',
          monto,
          periodicidad: 'UNICO',
        });
        expect(monto).toBe(SBM * factor);
      },
    );

    it('represents every indemnity threshold as explicit factor data', () => {
      expect(FACTORES_INDEMNIZACION).toEqual([
        { desde: 15.0, factor: 1.5 },
        { desde: 17.5, factor: 3.0 },
        { desde: 20.0, factor: 4.5 },
        { desde: 22.5, factor: 6.0 },
        { desde: 25.0, factor: 7.5 },
        { desde: 27.5, factor: 9.0 },
        { desde: 30.0, factor: 10.5 },
        { desde: 32.5, factor: 12.0 },
        { desde: 35.0, factor: 13.5 },
        { desde: 37.5, factor: 15.0 },
      ]);
    });

    it('uses normative factor 6.0 at 22.5%', () => {
      expect(calcularBeneficio(SBM, 22.5).monto).toBe(6_000_000);
    });
  });

  describe('partial disability pension', () => {
    it('returns a monthly partial pension at the 40% threshold', () => {
      expect(calcularBeneficio(SBM, 40)).toEqual({
        tipoBeneficio: 'PENSION_PARCIAL',
        monto: 350_000,
        periodicidad: 'MENSUAL',
      });
    });

    it('returns a monthly partial pension immediately before the 70% threshold', () => {
      expect(calcularBeneficio(SBM, 69.99)).toEqual({
        tipoBeneficio: 'PENSION_PARCIAL',
        monto: 350_000,
        periodicidad: 'MENSUAL',
      });
    });

    it('uses normative partial pension percentage 35%', () => {
      expect(calcularBeneficio(SBM, 40).monto).toBe(350_000);
    });
  });

  describe('total disability pension', () => {
    it('returns a monthly total pension at the 70% threshold', () => {
      expect(calcularBeneficio(SBM, 70)).toEqual({
        tipoBeneficio: 'PENSION_TOTAL',
        monto: 700_000,
        periodicidad: 'MENSUAL',
      });
    });

    it('returns a monthly total pension at 100% incapacity', () => {
      expect(calcularBeneficio(SBM, 100)).toEqual({
        tipoBeneficio: 'PENSION_TOTAL',
        monto: 700_000,
        periodicidad: 'MENSUAL',
      });
    });
  });

  describe('gran invalidez', () => {
    it('adds a 30% supplement to total disability pension', () => {
      expect(calcularBeneficio(SBM, 70, { granInvalidez: true })).toEqual({
        tipoBeneficio: 'PENSION_TOTAL',
        monto: 1_000_000,
        periodicidad: 'MENSUAL',
      });
    });

    it('does not add the supplement to partial disability pension', () => {
      expect(calcularBeneficio(SBM, 40, { granInvalidez: true })).toEqual({
        tipoBeneficio: 'PENSION_PARCIAL',
        monto: 350_000,
        periodicidad: 'MENSUAL',
      });
    });

    it('does not add the supplement to global indemnity', () => {
      expect(calcularBeneficio(SBM, 20, { granInvalidez: true })).toEqual({
        tipoBeneficio: 'INDEMNIZACION',
        monto: 4_500_000,
        periodicidad: 'UNICO',
      });
    });
  });

  describe('validation', () => {
    it.each([
      [-1, 15],
      [Number.NaN, 15],
      [Number.POSITIVE_INFINITY, 15],
      [SBM, -1],
      [SBM, 100.01],
      [SBM, Number.NaN],
      [SBM, Number.POSITIVE_INFINITY],
    ])('throws RangeError for invalid inputs sbm=%s grado=%s', (sbm, grado) => {
      expect(() => calcularBeneficio(sbm, grado)).toThrow(RangeError);
    });
  });
});
