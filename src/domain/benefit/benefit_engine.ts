import { obtenerFactorIndemnizacion } from './indemnity_factor_table.js';
import type { OpcionesCalculo, ResultadoBeneficio } from './benefit_types.js';

const PORCENTAJE_PENSION_PARCIAL = 0.35;
const PORCENTAJE_PENSION_TOTAL = 0.70;
const SUPLEMENTO_GRAN_INVALIDEZ = 0.30;

export function calcularBeneficio(
  sbm: number,
  grado: number,
  opciones: OpcionesCalculo = {},
): ResultadoBeneficio {
  validarEntradas(sbm, grado);

  if (grado < 15) {
    return {
      tipoBeneficio: 'NINGUNO',
      monto: 0,
      periodicidad: null,
    };
  }

  if (grado < 40) {
    const factor = obtenerFactorIndemnizacion(grado);

    return {
      tipoBeneficio: 'INDEMNIZACION',
      monto: sbm * factor,
      periodicidad: 'UNICO',
    };
  }

  if (grado < 70) {
    return {
      tipoBeneficio: 'PENSION_PARCIAL',
      monto: sbm * PORCENTAJE_PENSION_PARCIAL,
      periodicidad: 'MENSUAL',
    };
  }

  const porcentajeTotal = opciones.granInvalidez === true
    ? PORCENTAJE_PENSION_TOTAL + SUPLEMENTO_GRAN_INVALIDEZ
    : PORCENTAJE_PENSION_TOTAL;

  return {
    tipoBeneficio: 'PENSION_TOTAL',
    monto: sbm * porcentajeTotal,
    periodicidad: 'MENSUAL',
  };
}

function validarEntradas(sbm: number, grado: number): void {
  if (!Number.isFinite(sbm)) {
    throw new RangeError('sbm must be a finite number');
  }

  if (sbm < 0) {
    throw new RangeError('sbm must be greater than or equal to 0');
  }

  if (!Number.isFinite(grado)) {
    throw new RangeError('grado must be a finite number');
  }

  if (grado < 0 || grado > 100) {
    throw new RangeError('grado must be between 0 and 100');
  }
}
