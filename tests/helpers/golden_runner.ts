import type { PpeeIndicadores } from '../../src/domain/ppee/ppee_indicators.js';
import { calcularPrestacion } from '../../src/domain/ppee/ppee_engine.js';
import { PpeeError } from '../../src/domain/ppee/ppee_errors.js';
import type { ResultadoPrestacion } from '../../src/domain/ppee/ppee_types.js';
import { esperarCodigoError, mapearCasoAEntrada, type GoldenCaso } from './golden.js';

export interface EvaluacionCaso {
  id: string;
  seccion: string;
  pasa: boolean;
  errorCode?: string;
  tipoPrestacion?: string;
  motivo: string[];
  resultado?: ResultadoPrestacion;
  esperado: Record<string, unknown>;
}

export function evaluarCaso(caso: GoldenCaso, indicadores: PpeeIndicadores): EvaluacionCaso {
  const base: EvaluacionCaso = {
    id: caso.id,
    seccion: caso.seccion,
    pasa: true,
    motivo: [],
    esperado: caso.esperado,
  };

  let resultado: ResultadoPrestacion;
  try {
    resultado = calcularPrestacion(mapearCasoAEntrada(caso), indicadores);
  } catch (error) {
    if (error instanceof PpeeError) {
      const esperado = esperarCodigoError(caso);
      if (esperado !== undefined && error.code === esperado) {
        return {
          ...base,
          pasa: true,
          errorCode: error.code,
          tipoPrestacion: 'RECHAZADA',
        };
      }
      return {
        ...base,
        pasa: false,
        errorCode: error.code,
        tipoPrestacion: 'RECHAZADA',
        motivo: [`error inesperado: ${error.code} (${error.message})`],
      };
    }
    return {
      ...base,
      pasa: false,
      tipoPrestacion: 'ERROR',
      motivo: [`excepcion no tipada: ${(error as Error).message}`],
    };
  }

  base.resultado = resultado;
  base.tipoPrestacion = resultado.tipoPrestacion;
  base.errorCode = resultado.errorCode;

  const esperadoCodigo = esperarCodigoError(caso);
  const esRechazo = esCasoRechazo(caso);

  if (esperadoCodigo !== undefined || esRechazo) {
    const codigo = resultado.errorCode ?? resultado.estado;
    if (esperadoCodigo !== undefined) {
      if (codigo === esperadoCodigo) {
        base.motivo.push(`error correcto: ${codigo}`);
      } else {
        base.pasa = false;
        base.motivo.push(`error esperado ${esperadoCodigo}, obtenido ${codigo ?? 'ninguno'}`);
      }
    } else if (resultado.errorCode !== undefined) {
      base.pasa = false;
      base.motivo.push(`caso de rechazo devolvio error ${resultado.errorCode}`);
    }
    return base;
  }

  const tipoEsperado = tipoPrestacionEsperada(caso);
  if (tipoEsperado !== undefined && normalizarTipo(resultado.tipoPrestacion) !== normalizarTipo(tipoEsperado)) {
    base.pasa = false;
    base.motivo.push(`tipoPrestacion ${resultado.tipoPrestacion} != ${tipoEsperado}`);
  } else if (tipoEsperado !== undefined) {
    base.motivo.push(`tipoPrestacion correcto: ${tipoEsperado}`);
  }

  const criterios = caso.criterios_pasa.filter((c) => c.valor !== undefined);
  if (criterios.length > 0) {
    for (const criterio of criterios) {
      const valorEsperado = criterio.valor as number;
      const tolerancia = criterio.tolerancia ?? 1;
      verificarCriterio(base, resultado, criterio.texto, valorEsperado, tolerancia);
    }
  } else {
    verificarEsperados(base, resultado, caso);
  }

  if (base.motivo.every((m) => m.startsWith('tipoPrestacion correcto') || m.startsWith('error correcto'))) {
    base.motivo = base.motivo.filter((m) => !m.startsWith('tipoPrestacion correcto'));
  }

  return base;
}

function verificarEsperados(
  base: EvaluacionCaso,
  resultado: ResultadoPrestacion,
  caso: GoldenCaso,
): void {
  const campos: Array<[string, number | undefined]> = [
    ['pension_mensual', resultado.montoMensual],
    ['monto_indem', resultado.montoIndemnizacion],
    ['liquido_final', resultado.liquido],
    ['neto_primer_pago', resultado.netoPrimerPago],
    ['sbp_reip', resultado.sbp],
  ];
  for (const [clave, valor] of campos) {
    const esperado = caso.esperado[clave];
    if (typeof esperado === 'number' && valor !== undefined && !dentroTolerancia(valor, esperado, 1)) {
      base.pasa = false;
      base.motivo.push(`${clave}: ${valor} != ${esperado}`);
    } else if (typeof esperado === 'number' && valor === undefined) {
      base.pasa = false;
      base.motivo.push(`${clave}: sin valor en motor (esperado ${esperado})`);
    }
  }
}

function verificarCriterio(
  base: EvaluacionCaso,
  resultado: ResultadoPrestacion,
  texto: string,
  esperado: number,
  tolerancia: number,
): void {
  const obtenido = campoDeCriterio(texto, resultado);
  if (obtenido === undefined) {
    base.pasa = false;
    base.motivo.push(`criterio "${texto}": no se pudo mapear a salida`);
    return;
  }
  if (!dentroTolerancia(obtenido, esperado, tolerancia)) {
    base.pasa = false;
    base.motivo.push(`criterio "${texto}": ${obtenido} != ${esperado} (±${tolerancia})`);
  } else {
    base.motivo.push(`criterio "${texto}": ${obtenido} ok`);
  }
}

function campoDeCriterio(texto: string, resultado: ResultadoPrestacion): number | undefined {
  if (/sueldo base|SBP/i.test(texto)) return resultado.sbp;
  if (/pensión base|pensión del mes|pensión mensual/i.test(texto)) {
    return resultado.montoMensual ?? resultado.pensionBase;
  }
  if (/líquido del mes|líquido final/i.test(texto)) return resultado.liquido;
  if (/neto primer pago/i.test(texto)) return resultado.netoPrimerPago;
  if (/montoindemnizacion|monto único|indemnizaci/i.test(texto)) return resultado.montoIndemnizacion;
  if (/beneficiario\s+([A-Z][A-Z0-9_]*)/i.test(texto)) {
    const id = texto.match(/beneficiario\s+([A-Z][A-Z0-9_]*)/i)?.[1];
    const b = resultado.beneficiarios?.find((x) => x.id === id);
    return b?.monto;
  }
  if (/factor de sueldos/i.test(texto)) return resultado.factorSueldos;
  return undefined;
}

function dentroTolerancia(valor: number, esperado: number, tolerancia: number): boolean {
  return Math.abs(valor - esperado) <= tolerancia;
}

function tipoPrestacionEsperada(caso: GoldenCaso): string | undefined {
  const texto = (caso.escenario + caso.esperado_texto).toLowerCase();
  if (texto.includes('indemnización global')) return 'INDEMNIZACION_GLOBAL';
  if (texto.includes('sobrevivencia')) return 'PENSION_SOBREVIVENCIA';
  if (texto.includes('transitoria')) return 'PENSION_TRANSITORIA';
  if (texto.includes('gran invalidez') || texto.includes('gran_invalidez')) return 'PENSION_GRAN_INVALIDEZ';
  if (texto.includes('invalidez parcial')) return 'PENSION_PARCIAL';
  if (texto.includes('invalidez total')) return 'PENSION_TOTAL';
  if (caso.seccion === 'IND') return 'INDEMNIZACION_GLOBAL';
  return undefined;
}

function normalizarTipo(tipo: string): string {
  return tipo.replace(/_/g, '').toUpperCase();
}

function esCasoRechazo(caso: GoldenCaso): boolean {
  const texto = (caso.escenario + caso.esperado_texto).toLowerCase();
  return /denegad|rechaz|sin derecho|reip[^a-z]?bajo|0%|sin prestaci|reip ?= ?0/i.test(texto)
    || caso.seccion === 'ERR'
    || caso.seccion === 'NEG'
    || caso.tipo === 'rechazo'
    || caso.tipo === 'negativo';
}
