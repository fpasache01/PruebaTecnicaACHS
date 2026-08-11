import { describe, expect, it } from 'vitest';
import { calcularPrestacion } from '../../../../src/domain/ppee/ppee_engine.js';
import { TablasIndicadoresEnMemoria } from '../../../../src/domain/ppee/ppee_indicators.js';
import { ERROR_CODES } from '../../../../src/domain/ppee/ppee_errors.js';
import type { EntradaPrestacion } from '../../../../src/domain/ppee/ppee_types.js';

function indicadoresDePrueba(): TablasIndicadoresEnMemoria {
  const reajuste = new Map<string, number>();
  for (let anio = 2023; anio <= 2026; anio += 1) {
    for (let mes = 1; mes <= 12; mes += 1) {
      reajuste.set(`${anio}-${String(mes).padStart(2, '0')}`, 1);
    }
  }
  reajuste.set('2025-01', 1.0213);
  reajuste.set('2025-05', 1.036);
  const imnr = new Map<string, number>();
  for (let anio = 2023; anio <= 2026; anio += 1) {
    for (let mes = 1; mes <= 12; mes += 1) {
      imnr.set(`${anio}-${String(mes).padStart(2, '0')}`, 296511);
    }
  }
  const tasas = new Map<string, number>([
    ['FONDO_PENSIONES', 0.1],
    ['SALUD_FONASA', 0.07],
    ['LIMITE_MAXIMO_PENSION', 5_000_000],
    ['PENSION_MINIMA', 0],
    ['PGU_MAXIMO', 231732],
    ['PGU_UMBRAL_INFERIOR', 789139],
  ]);
  const comision = new Map<string, Map<string, number>>([
    ['MODELO', new Map([['*', 0.0058]])],
  ]);
  return new TablasIndicadoresEnMemoria(
    new Map(), reajuste, imnr, new Map(), tasas, comision,
  );
}

const indicadores = indicadoresDePrueba();

describe('calcularPrestacion (pipeline PPEE)', () => {
  it('deniega con REIP_BAJO_UMBRAL bajo el 15%', () => {
    const r = calcularPrestacion({ reip: 10 }, indicadores);
    expect(r.tipoPrestacion).toBe('NINGUNO');
    expect(r.errorCode).toBe(ERROR_CODES.REIP_BAJO_UMBRAL);
  });

  it('calcula indemnizacion global por tabla discreta', () => {
    const r = calcularPrestacion(
      { tipoPrestacion: 'Indemnizacion global', reip: 30, sbpForzado: 615441 },
      indicadores,
    );
    expect(r.tipoPrestacion).toBe('INDEMNIZACION_GLOBAL');
    expect(r.factorSueldos).toBe(10.5);
    expect(r.montoIndemnizacion).toBe(Math.round(615441 * 10.5));
  });

  it('calcula SBP desde rentas con depuracion', () => {
    const entrada: EntradaPrestacion = {
      tipoPrestacion: 'Pension de invalidez parcial',
      reip: 55,
      fechaInicioIncapacidad: '2024-02-01',
      fechaInicioPension: '2026-03-01',
      fechaCalculo: '2026-03-31',
      rentas: [
        { periodo: '2024-01', imponible: 575000, dias: 30, regimen: 'AFP_STD' },
      ],
    };
    const r = calcularPrestacion(entrada, indicadores);
    expect(r.evidencia?.sbpAncla).toBe(489070);
    expect(r.tipoPrestacion).toBe('PENSION_PARCIAL');
  });

  it('aplica prorrata del primer mes en el cuadro M3R', () => {
    const entrada: EntradaPrestacion = {
      tipoPrestacion: 'Pension de invalidez total',
      reip: 72,
      sbpForzado: 900000,
      fechaInicioPension: '2026-02-10',
      fechaCalculo: '2026-02-28',
      pensionYaConstituida: true,
    };
    const r = calcularPrestacion(entrada, indicadores);
    expect(r.montoMensual).toBe(630000);
    expect(r.cuadro?.[0]?.devengado).toBe(399000);
  });

  it('aplica descuentos y haberes no imponibles en la liquidacion', () => {
    const entrada: EntradaPrestacion = {
      tipoPrestacion: 'Pension de invalidez total',
      reip: 72,
      sbpForzado: 600000,
      pensionBaseForzada: 420000,
      fechaInicioPension: '2024-06-01',
      fechaCalculo: '2026-04-30',
      pensionYaConstituida: true,
      descuentos: {
        retencionesJudiciales: [25],
        deudaInterna: 20,
        ccaf: 15000,
      },
      edad: 68,
    };
    const r = calcularPrestacion(entrada, indicadores);
    expect(r.liquido).toBe(373896);
  });

  it('rechaza descuento IUSC con EXD-PAG-030', () => {
    expect(() => calcularPrestacion({
      tipoPrestacion: 'Pension de invalidez total',
      reip: 72,
      sbpForzado: 600000,
      descuentos: { iusc: true },
    }, indicadores)).toThrowError(/EXD-PAG-030/);
  });

  it('aplica Art 41 con hijos que activan el incremento', () => {
    const r = calcularPrestacion({
      tipoPrestacion: 'Pension de invalidez parcial',
      reip: 55,
      sbpForzado: 1000000,
      hijosActivosArt41: 4,
      pensionYaConstituida: true,
    }, indicadores);
    expect(r.montoMensual).toBe(500000);
  });

  it('calcula sobrevivencia con distribucion a beneficiarios', () => {
    const r = calcularPrestacion({
      tipoPrestacion: 'Pension de sobrevivencia',
      sbpForzado: 559496,
      fechaFallecimiento: '2025-09-18',
      fechaInicioPension: '2025-09-18',
      fechaCalculo: '2025-11-30',
      beneficiarios: [
        { id: 'C1', tipo: 'CONYUGE', porcentajeNominal: 50, porcentajeEfectivo: 50 },
        { id: 'H1', tipo: 'HIJO', porcentajeNominal: 20, porcentajeEfectivo: 20 },
        { id: 'H2', tipo: 'HIJO', porcentajeNominal: 20, porcentajeEfectivo: 20 },
      ],
    }, indicadores);
    expect(r.pensionBase).toBe(391647);
    expect(r.beneficiarios?.[0]?.monto).toBe(195824);
    expect(r.montoMensual).toBe(352482);
  });
});
