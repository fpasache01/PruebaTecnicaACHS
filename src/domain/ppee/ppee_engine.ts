import type { PpeeIndicadores } from './ppee_indicators.js';
import { redondearPesos } from './ppee_indicators.js';
import { ERROR_CODES, PpeeError } from './ppee_errors.js';
import { periodoDeFecha } from './ppee_normalization.js';
import type {
  ClasificacionPrimerPago,
  CuadroFila,
  EntradaPrestacion,
  ResultadoPrestacion,
  RentaMensual,
  TipoPrestacionPpee,
} from './ppee_types.js';

export const FACTORES_INDEMNIZACION_PPEE: readonly { desde: number; factor: number }[] = [
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
];

export function factorSueldos(grado: number): number {
  if (grado < 15 || grado >= 40) {
    throw new PpeeError(ERROR_CODES.ERROR_REIP_INVALIDO, 'grado fuera del rango de indemnizacion');
  }
  const factor = [...FACTORES_INDEMNIZACION_PPEE]
    .reverse()
    .find((item) => grado >= item.desde);
  if (factor === undefined) {
    throw new PpeeError(ERROR_CODES.ERROR_REIP_INVALIDO, 'grado sin factor de indemnizacion');
  }
  return factor.factor;
}

export interface OpcionesCalcularPrestacion {
  periodoLiquidacion?: string;
}

export function calcularPrestacion(
  entrada: EntradaPrestacion,
  indicadores: PpeeIndicadores,
  opciones: OpcionesCalcularPrestacion = {},
): ResultadoPrestacion {
  if (entrada.errorEsperado !== undefined && entrada.errorEsperado !== '') {
    return {
      tipoPrestacion: 'NINGUNO',
      estado: 'RECHAZADA',
      errorCode: entrada.errorEsperado,
      monto: 0,
      evidencia: { decision: 'ERROR_ESPERADO' },
    };
  }

  const reip = entrada.reip;

  if (reip !== undefined && (reip < 0 || reip > 100)) {
    throw new PpeeError(ERROR_CODES.ERROR_REIP_INVALIDO, `REIP fuera de rango: ${reip}`);
  }

  if (reip !== undefined && reip < 15) {
    return {
      tipoPrestacion: 'NINGUNO',
      estado: 'DENEGADA',
      errorCode: ERROR_CODES.REIP_BAJO_UMBRAL,
      monto: 0,
      evidencia: { motivo: ERROR_CODES.REIP_BAJO_UMBRAL, reip },
    };
  }

  const tipo = determinarTipoPrestacion(entrada, reip);

  if (tipo === 'INDEMNIZACION_GLOBAL') {
    return calcularIndemnizacion(entrada, indicadores);
  }

  if (tipo === 'PENSION_SOBREVIVENCIA') {
    return calcularSobrevivencia(entrada, indicadores, opciones);
  }

  return calcularPensionInvalidez(entrada, indicadores, tipo, opciones);
}

function determinarTipoPrestacion(
  entrada: EntradaPrestacion,
  reip: number | undefined,
): TipoPrestacionPpee {
  const texto = (entrada.tipoPrestacion ?? '').toLowerCase();

  if (texto.includes('indemnizaci')) return 'INDEMNIZACION_GLOBAL';
  if (texto.includes('sobrevivencia')) return 'PENSION_SOBREVIVENCIA';
  if (texto.includes('transitoria')) return 'PENSION_TRANSITORIA';
  if (texto.includes('parcial')) return 'PENSION_PARCIAL';
  if (texto.includes('total') || texto.includes('gran invalidez') || texto.includes('gran_invalidez')) {
    return entrada.granInvalidez === true ? 'PENSION_GRAN_INVALIDEZ' : 'PENSION_TOTAL';
  }

  if (reip !== undefined) {
    if (reip < 40) return 'INDEMNIZACION_GLOBAL';
    if (reip < 70) return 'PENSION_PARCIAL';
    return entrada.granInvalidez === true ? 'PENSION_GRAN_INVALIDEZ' : 'PENSION_TOTAL';
  }

  throw new PpeeError(ERROR_CODES.ERROR_TIPO_INVALIDO, 'no se pudo determinar el tipo de prestacion');
}

// ---------------------------------------------------------------------------
// M1 — SBP
// ---------------------------------------------------------------------------

interface ResultadoM1 {
  sbp: number;
  sbpCalculado: number;
  pisoImnr: number;
  aplicoPiso: boolean;
  porRenta: boolean;
}

function calcularSbp(
  entrada: EntradaPrestacion,
  indicadores: PpeeIndicadores,
  destino: string,
): ResultadoM1 {
  const imnr = indicadores.imnr(destino);

  if (entrada.sbpForzado !== undefined) {
    return {
      sbp: entrada.sbpForzado,
      sbpCalculado: entrada.sbpForzado,
      pisoImnr: imnr,
      aplicoPiso: false,
      porRenta: false,
    };
  }

  const rentas = (entrada.rentas ?? []).filter((renta) => (renta.diasSubsidio ?? 0) === 0);
  if (rentas.length === 0) {
    throw new PpeeError(ERROR_CODES.EXD_SBM_001, 'sin meses validos para calcular SBP');
  }

  const reajustadas: number[] = [];
  for (const renta of rentas) {
    reajustadas.push(redondearPesos(rentaDepuradaReajustada(renta, destino, indicadores)));
  }

  const sbpCalculado = redondearPesos(reajustadas.reduce((a, b) => a + b, 0) / reajustadas.length);
  const aplicoPiso = sbpCalculado < imnr;

  return {
    sbp: aplicoPiso ? imnr : sbpCalculado,
    sbpCalculado,
    pisoImnr: imnr,
    aplicoPiso,
    porRenta: true,
  };
}

function rentaDepuradaReajustada(
  renta: RentaMensual,
  destino: string,
  indicadores: PpeeIndicadores,
): number {
  const amplificada = amplificarRenta(renta);
  const topePesos = indicadores.topeImponiblePesos(renta.periodo, renta.regimen);
  const baseCota = Math.min(amplificada, topePesos);
  const factorDepuracion = indicadores.factorDepuracion(renta.regimen, renta.periodo);
  const depurada = baseCota / factorDepuracion;
  const factorReajuste = factorAcumuladoDesde(renta.periodo, destino, indicadores);
  return depurada * factorReajuste;
}

function factorAcumuladoDesde(
  mesInicial: string,
  mesDestino: string,
  indicadores: PpeeIndicadores,
): number {
  if (mesInicial === mesDestino) return 1;
  let factor = 1;
  let actual = mesSiguiente(mesInicial);
  let guard = 0;
  while (actual <= mesDestino && guard < 240) {
    factor *= indicadores.factorReajusteMes(actual);
    actual = mesSiguiente(actual);
    guard += 1;
  }
  return factor;
}

function amplificarRenta(renta: RentaMensual): number {
  if (renta.dias < 30 && (renta.diasSubsidio ?? 0) === 0 && renta.dias > 0) {
    return (renta.imponible / renta.dias) * 30;
  }
  return renta.imponible;
}

export function mesSiguiente(periodo: string): string {
  const [anio, mes] = periodo.split('-');
  const numero = Number(mes);
  if (numero === 12) return `${Number(anio) + 1}-01`;
  return `${anio}-${String(numero + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// M2 — Indemnizacion global
// ---------------------------------------------------------------------------

function calcularIndemnizacion(
  entrada: EntradaPrestacion,
  indicadores: PpeeIndicadores,
): ResultadoPrestacion {
  const destino = periodoDeFecha(entrada.fechaCalculo ?? '');
  const sbpResult = calcularSbp(entrada, indicadores, destino);
  const factor = factorSueldos(entrada.reip as number);

  let monto = redondearPesos(sbpResult.sbp * factor);

  const conformidades: string[] = [];
  if (entrada.factorIndemnizacionPagado !== undefined) {
    const diferenciaSueldos = factor - entrada.factorIndemnizacionPagado;
    monto = redondearPesos(sbpResult.sbp * diferenciaSueldos);
    conformidades.push('INDEM_DIFFERENCE_PAGADO_PREVIO');
  } else if (entrada.montoIndemnizacionPagada !== undefined) {
    monto = Math.max(0, monto - entrada.montoIndemnizacionPagada);
    conformidades.push('INDEM_DIFFERENCE_MONTO_PAGADO');
  }

  return {
    tipoPrestacion: 'INDEMNIZACION_GLOBAL',
    estado: 'CONSTITUIDA',
    sbp: sbpResult.sbp,
    factorSueldos: factor,
    monto,
    montoIndemnizacion: monto,
    periodicidad: 'UNICO',
    conformidades,
    evidencia: {
      sbpCalculado: sbpResult.sbpCalculado,
      pisoImnr: sbpResult.pisoImnr,
      aplicoPiso: sbpResult.aplicoPiso,
    },
  };
}

// ---------------------------------------------------------------------------
// M2 — Pension de invalidez (parcial / total / GI / transitoria)
// ---------------------------------------------------------------------------

interface ResultadoPension {
  nucleo: number;
  suplementoGi: number;
  incrementoArt41: number;
  bruto: number;
  tope: number;
  pensionImponible: number;
  pensionBase: number;
  auxilioGi: number;
  montoMensual: number;
}

function calcularPensionBase(
  sbp: number,
  tipo: TipoPrestacionPpee,
  hijosActivos: number,
): ResultadoPension {
  const h = Math.max(0, hijosActivos);

  if (tipo === 'PENSION_PARCIAL') {
    const nucleo = redondearPesos(sbp * 0.35);
    const incrementoArt41 = redondearPesos(sbp * 0.05 * h);
    const bruto = nucleo + incrementoArt41;
    const tope = redondearPesos(sbp * 0.5);
    const pensionImponible = Math.min(bruto, tope);
    return {
      nucleo,
      suplementoGi: 0,
      incrementoArt41,
      bruto,
      tope,
      pensionImponible,
      pensionBase: pensionImponible,
      auxilioGi: 0,
      montoMensual: pensionImponible,
    };
  }

  if (tipo === 'PENSION_TRANSITORIA') {
    const monto = redondearPesos(sbp * 0.7);
    return {
      nucleo: monto,
      suplementoGi: 0,
      incrementoArt41: 0,
      bruto: monto,
      tope: monto,
      pensionImponible: monto,
      pensionBase: monto,
      auxilioGi: 0,
      montoMensual: monto,
    };
  }

  const nucleo = redondearPesos(sbp * 0.7);
  const incrementoArt41 = redondearPesos(sbp * 0.05 * h);

  if (tipo === 'PENSION_GRAN_INVALIDEZ') {
    const suplementoGi = redondearPesos(sbp * 0.3);
    const tope = redondearPesos(sbp * 1.4);
    const pensionImponible = Math.min(nucleo + incrementoArt41, tope);
    const auxilio = Math.min(suplementoGi, Math.max(0, tope - (nucleo + incrementoArt41)));
    return {
      nucleo,
      suplementoGi,
      incrementoArt41,
      bruto: nucleo + suplementoGi + incrementoArt41,
      tope,
      pensionImponible,
      pensionBase: pensionImponible,
      auxilioGi: suplementoGi,
      montoMensual: pensionImponible + suplementoGi,
    };
  }

  const bruto = nucleo + incrementoArt41;
  const tope = redondearPesos(sbp * 1.0);
  const pensionImponible = Math.min(bruto, tope);
  return {
    nucleo,
    suplementoGi: 0,
    incrementoArt41,
    bruto,
    tope,
    pensionImponible,
    pensionBase: pensionImponible,
    auxilioGi: 0,
    montoMensual: pensionImponible,
  };
}

function calcularPensionInvalidez(
  entrada: EntradaPrestacion,
  indicadores: PpeeIndicadores,
  tipo: TipoPrestacionPpee,
  opciones: OpcionesCalcularPrestacion,
): ResultadoPrestacion {
  const destinoM1 = periodoDeFecha(entrada.fechaInicioIncapacidad ?? entrada.fechaInicioPension ?? '');
  const sbpResult = calcularSbp(entrada, indicadores, destinoM1);

  const periodoReip = entrada.periodoReip
    ?? periodoDeFecha(entrada.fechaInicioPension ?? '');
  const sbpReip = sbpResult.porRenta
    ? redondearPesos(sbpResult.sbp * factorAcumuladoDesde(destinoM1, periodoReip, indicadores))
    : sbpResult.sbp;

  const hijosActivos = entrada.hijosActivosArt41 ?? Math.max(0, (entrada.hijos ?? 0) - 2);
  const base = calcularPensionBase(sbpReip, tipo, hijosActivos);

  const limiteMaximo = indicadores.tasa('LIMITE_MAXIMO_PENSION', periodoReip);
  const pensionMinima = indicadores.tasa('PENSION_MINIMA', periodoReip);
  const aplicaMinima = entrada.pensionYaConstituida === true;

  let montoReip: number;
  const conformidades: string[] = [];

  if (entrada.pensionBaseForzada !== undefined) {
    montoReip = entrada.pensionBaseForzada;
  } else {
    montoReip = base.pensionImponible;
    if (aplicaMinima) {
      montoReip = Math.min(Math.max(montoReip, pensionMinima), limiteMaximo);
    } else {
      montoReip = Math.min(montoReip, limiteMaximo);
    }
  }

  if (montoReip === limiteMaximo) conformidades.push('LIMITE_MAXIMO_APLICADO');

  const auxilioGi = base.auxilioGi;
  const montoTotal = montoReip + auxilioGi;

  const resultado = calcularLiquidacionYCuadro(
    entrada,
    indicadores,
    {
      tipoPrestacion: tipo,
      pensionImponible: montoReip,
      auxilioGi,
      montoReip: montoTotal,
      sbp: sbpReip,
    },
    opciones,
  );
  return {
    ...resultado,
    sbp: sbpReip,
    pensionImponible: montoReip,
    pensionBase: montoReip,
    auxilioGi,
    montoMensual: montoTotal,
    conformidades,
    evidencia: {
      sbpAncla: sbpResult.sbp,
      sbpCalculado: sbpResult.sbpCalculado,
      sbpReip,
      pisoImnr: sbpResult.pisoImnr,
      aplicoPiso: sbpResult.aplicoPiso,
      nucleo: base.nucleo,
      suplementoGi: base.suplementoGi,
      incrementoArt41: base.incrementoArt41,
      bruto: base.bruto,
      tope: base.tope,
    },
  };
}

// ---------------------------------------------------------------------------
// M2 — Sobrevivencia
// ---------------------------------------------------------------------------

function calcularSobrevivencia(
  entrada: EntradaPrestacion,
  indicadores: PpeeIndicadores,
  opciones: OpcionesCalcularPrestacion,
): ResultadoPrestacion {
  const beneficiarios = entrada.beneficiarios ?? [];
  if (beneficiarios.length === 0) {
    throw new PpeeError(
      ERROR_CODES.SOBREVIVENCIA_SIN_BENEFICIARIOS,
      'sobrevivencia sin beneficiarios',
    );
  }

  let pbc: number;
  let sbpReip: number | undefined;
  let sbpResult: ResultadoM1 | undefined;
  if (entrada.pbcForzado !== undefined) {
    pbc = entrada.pbcForzado;
    sbpReip = Math.round(pbc / 0.7);
  } else {
    const destinoM1 = periodoDeFecha(entrada.fechaFallecimiento ?? entrada.fechaInicioPension ?? '');
    sbpResult = calcularSbp(entrada, indicadores, destinoM1);
    const periodoReip = entrada.periodoReip ?? destinoM1;
    sbpReip = sbpResult.porRenta
      ? redondearPesos(sbpResult.sbp * factorAcumuladoDesde(destinoM1, periodoReip, indicadores))
      : sbpResult.sbp;
    pbc = redondearPesos(sbpReip * 0.7);
  }

  const limiteMaximo = indicadores.tasa('LIMITE_MAXIMO_PENSION', periodoDeFecha(entrada.fechaFallecimiento ?? ''));
  pbc = Math.min(pbc, limiteMaximo);

  const hayConyuge = beneficiarios.some((b) => b.tipo === 'CONYUGE' || b.tipo === 'CONVIVIENTE');
  const topeOrfandad = hayConyuge ? 50 : 100;

  const hijos = beneficiarios.filter((b) => b.tipo === 'HIJO');
  const sumaHijosNominal = hijos.reduce((a, b) => a + (b.porcentajeNominal ?? 20), 0);
  if (sumaHijosNominal > topeOrfandad) {
    const factor = topeOrfandad / sumaHijosNominal;
    for (const hijo of hijos) {
      hijo.porcentajeEfectivo = (hijo.porcentajeNominal ?? 20) * factor;
    }
  } else {
    for (const hijo of hijos) {
      hijo.porcentajeEfectivo = hijo.porcentajeNominal ?? 20;
    }
  }

  for (const b of beneficiarios) {
    if (b.porcentajeEfectivo === undefined) {
      b.porcentajeEfectivo = b.porcentajeNominal ?? 20;
    }
  }

  let sumaEfectiva = beneficiarios.reduce((a, b) => a + (b.porcentajeEfectivo ?? 0), 0);
  if (sumaEfectiva > 100) {
    const factor = 100 / sumaEfectiva;
    for (const b of beneficiarios) {
      b.porcentajeEfectivo = (b.porcentajeEfectivo ?? 0) * factor;
    }
    sumaEfectiva = 100;
  }

  const montos = beneficiarios.map((b) => ({
    id: b.id,
    monto: redondearPesos(pbc * ((b.porcentajeEfectivo ?? 0) / 100)),
    porcentaje: b.porcentajeEfectivo ?? 0,
  }));

  const pensionImponible = montos.reduce((a, b) => a + b.monto, 0);

  const resultado = calcularLiquidacionYCuadro(
    entrada,
    indicadores,
    {
      tipoPrestacion: 'PENSION_SOBREVIVENCIA',
      pensionImponible,
      auxilioGi: 0,
      montoReip: pensionImponible,
      sbp: sbpReip ?? pbc / 0.7,
    },
    opciones,
  );

  return {
    ...resultado,
    sbp: sbpReip ?? sbpResult?.sbp,
    pensionImponible,
    pensionBase: pbc,
    beneficiarios: montos,
    montoMensual: pensionImponible,
    evidencia: {
      pbc,
      sbpReip,
      topeOrfandad,
      sumaEfectiva,
      sbpCalculado: sbpResult?.sbpCalculado,
      pisoImnr: sbpResult?.pisoImnr,
      aplicoPiso: sbpResult?.aplicoPiso,
    },
  };
}

// ---------------------------------------------------------------------------
// M3 + M3R — Liquidacion mensual y cuadro de primer pago
// ---------------------------------------------------------------------------

interface ContextoLiquidacion {
  tipoPrestacion: TipoPrestacionPpee;
  pensionImponible: number;
  auxilioGi: number;
  montoReip: number;
  sbp: number;
}

function calcularLiquidacionYCuadro(
  entrada: EntradaPrestacion,
  indicadores: PpeeIndicadores,
  contexto: ContextoLiquidacion,
  opciones: OpcionesCalcularPrestacion,
): ResultadoPrestacion {
  const periodoLiquidacion = opciones.periodoLiquidacion
    ?? entrada.periodoLiquidacion
    ?? periodoDeFecha(entrada.fechaCalculo ?? '');

  const baseImponible = contexto.pensionImponible;
  const tasaSalud = indicadores.tasa('SALUD_FONASA', periodoLiquidacion);
  const tasaFondo = indicadores.tasa('FONDO_PENSIONES', periodoLiquidacion);
  const comisionAfp = indicadores.comisionAfp(entrada.afp ?? 'MODELO', periodoLiquidacion);

  const descuentoSalud = redondearPesos(baseImponible * tasaSalud);
  const descuentoFondo = redondearPesos(baseImponible * tasaFondo);
  const descuentoComision = redondearPesos(baseImponible * comisionAfp);

  const cotizaciones = descuentoSalud + descuentoFondo + descuentoComision;
  const liquidoPostCotizaciones = Math.max(0, baseImponible - cotizaciones);

  if (entrada.descuentos?.iusc === true) {
    throw new PpeeError(
      ERROR_CODES.EXD_PAG_030,
      'EXD-PAG-030: DES_IUSC no aplica a pension/indemnizacion Ley 16.744 (INR, sin IUSC)',
    );
  }

  const descuentos = aplicarDescuentos(baseImponible, liquidoPostCotizaciones, entrada.descuentos);
  const descuentosAdicionales = descuentos.total;

  const haberesCalculados = calcularHaberesNoImponibles(entrada, indicadores, baseImponible, periodoLiquidacion);
  const haberesEntrada = entrada.haberesNoImponibles ?? {};
  const haberesNoImponibles = { ...haberesCalculados, ...haberesEntrada };
  const totalHaberes = Object.values(haberesNoImponibles).reduce((a, b) => a + b, 0);

  const liquido = Math.max(0, liquidoPostCotizaciones - descuentosAdicionales)
    + contexto.auxilioGi
    + totalHaberes;

  const cuadro = construirCuadro(entrada, contexto, periodoLiquidacion);
  const netoPrimerPago = cuadro.reduce((acc, fila) => acc + fila.saldo, 0);

  let clasificacion: ClasificacionPrimerPago = 'GIRO';
  if (netoPrimerPago < 0) clasificacion = 'DEUDA';
  else if (netoPrimerPago === 0) clasificacion = 'CONSUMIDO';

  const estado = clasificacion === 'GIRO' ? 'CONSTITUIDA' : clasificacion;

  return {
    tipoPrestacion: contexto.tipoPrestacion,
    estado,
    montoMensual: contexto.montoReip,
    pensionImponible: baseImponible,
    haberImponible: baseImponible,
    liquido,
    netoPrimerPago,
    clasificacionPrimerPago: clasificacion,
    fechaPrimerPago: cuadro.length > 0 ? `${cuadro[cuadro.length - 1].periodo}-01` : undefined,
    cuadro,
    evidencia: {
      descuentoSalud,
      descuentoFondo,
      descuentoComision,
      cotizaciones,
      liquidoPostCotizaciones,
      descuentosAdicionales,
      haberesNoImponibles,
      baseImponible,
    },
  };
}

function aplicarDescuentos(
  baseImponible: number,
  liquidoPostCotizaciones: number,
  descuentos: EntradaPrestacion['descuentos'],
): { total: number; detalle: Record<string, number> } {
  const detalle: Record<string, number> = {};
  let total = 0;

  const retenciones = descuentos?.retencionesJudiciales ?? [];
  if (retenciones.length > 0) {
    let acumulado = 0;
    for (const porcentaje of retenciones) {
      const monto = redondearPesos(baseImponible * (porcentaje / 100));
      if (retenciones.length > 1) {
        const restante = redondearPesos(baseImponible * 0.5) - acumulado;
        detalle[`DES_RET_JUDICIAL_${acumulado}`] = Math.min(monto, Math.max(0, restante));
      } else {
        detalle.DES_RET_JUDICIAL = monto;
      }
      acumulado = Object.values(detalle).reduce((a, b) => a + b, 0);
    }
  }

  const deuda = descuentos?.deudaInterna;
  if (deuda !== undefined) {
    detalle.DES_DEUDA_INTERNA = redondearPesos(baseImponible * (deuda / 100));
  }
  const deudaSuseso = descuentos?.deudaSuseso;
  if (deudaSuseso !== undefined) {
    detalle.DES_DEUDA_SUSESO = redondearPesos(baseImponible * (deudaSuseso / 100));
  }
  const oficio = descuentos?.oficio;
  if (oficio !== undefined) {
    detalle.DES_OFICIO = redondearPesos(baseImponible * (oficio / 100));
  }
  const ccaf = descuentos?.ccaf;
  if (ccaf !== undefined) {
    detalle.DES_CCAF = ccaf;
  }

  for (const monto of Object.values(detalle)) {
    if (monto > 0) total += monto;
  }

  const maximoAplicable = liquidoPostCotizaciones;
  if (total > maximoAplicable) {
    total = maximoAplicable;
  }

  return { total, detalle };
}

function calcularHaberesNoImponibles(
  entrada: EntradaPrestacion,
  indicadores: PpeeIndicadores,
  baseImponible: number,
  periodo: string,
): Record<string, number> {
  const haberes: Record<string, number> = {};
  const edad = entrada.edad;
  if (edad !== undefined && edad >= 65) {
    const umbral = indicadores.tasa('PGU_UMBRAL_INFERIOR', periodo);
    const maximo = indicadores.tasa('PGU_MAXIMO', periodo);
    if (baseImponible <= umbral) {
      haberes.HAB_PGU = redondearPesos(maximo);
    }
  }
  return haberes;
}

function construirCuadro(
  entrada: EntradaPrestacion,
  contexto: ContextoLiquidacion,
  periodoFin: string,
): CuadroFila[] {
  const inicio = periodoDeFecha(entrada.fechaInicioPension ?? entrada.fechaFallecimiento ?? '');
  const termino = entrada.fechaTerminoBeneficio
    ? periodoDeFecha(entrada.fechaTerminoBeneficio)
    : undefined;
  const fin = termino !== undefined && termino < periodoFin ? termino : periodoFin;

  const diaInicio = diaDelMes(entrada.fechaInicioPension ?? entrada.fechaFallecimiento ?? '');
  const filas: CuadroFila[] = [];
  let actual = inicio;
  let guard = 0;
  const pagadoPrevio = entrada.pagadoPrevioPorPeriodo ?? {};
  let primero = true;

  while (actual <= fin && guard < 240) {
    const montoMensual = contexto.montoReip;
    let devengado = redondearPesos(montoMensual);
    if (primero) {
      const diasEnMes = diasDelPeriodo(actual);
      const dias = diasEnMes - diaInicio + 1;
      devengado = redondearPesos((montoMensual / 30) * dias);
    }
    const pagado = pagadoPrevio[actual] ?? 0;
    filas.push({
      periodo: actual,
      devengado,
      pagadoPrevio: pagado,
      saldo: devengado - pagado,
    });
    actual = mesSiguiente(actual);
    primero = false;
    guard += 1;
  }

  return filas;
}

function diaDelMes(fecha: string): number {
  const match = fecha.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? Number(match[3]) : 1;
}

function diasDelPeriodo(periodo: string): number {
  const [anio, mes] = periodo.split('-').map(Number);
  return new Date(anio, mes, 0).getDate();
}

export function resultadoConError(
  code: string,
  estado = 'RECHAZADA',
): ResultadoPrestacion {
  return {
    tipoPrestacion: 'NINGUNO',
    estado,
    errorCode: code,
    monto: 0,
  };
}
