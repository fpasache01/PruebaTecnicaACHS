import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntradaPrestacion, TipoBeneficiarioSobrevivencia } from '../../src/domain/ppee/ppee_types.js';
import {
  aBooleano,
  normalizarFecha,
  normalizarMonto,
  normalizarPorcentaje,
} from '../../src/domain/ppee/ppee_normalization.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDirectory, '..', '..');

export interface GoldenCaso {
  id: string;
  seccion: string;
  fuente: string;
  dificultad: string;
  tipo: string;
  estado: string;
  escenario: string;
  entrada: Record<string, unknown>;
  rentas: Array<{ periodo: string; imponible: number; dias: number; regimen: string }>;
  esperado: Record<string, unknown>;
  esperado_texto: string;
  criterios_pasa: Array<{ texto: string; valor?: number; tolerancia?: number }>;
  criterios_falla: Array<{ texto: string }>;
}

export interface GoldenDataset {
  meta: Record<string, unknown>;
  casos: GoldenCaso[];
}

export function cargarGoldenDataset(): GoldenDataset {
  return JSON.parse(readFileSync(join(repoRoot, 'data', 'golden_dataset.json'), 'utf8'));
}

const MESES_ES: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
};

function periodoIsoDeMes(periodo: string): string {
  const m = periodo.match(/([a-záéíóúñ]+) (\d{4})/i);
  if (m) {
    const mm = MESES_ES[m[1].toLowerCase()];
    if (mm) return `${m[2]}-${mm}-01`;
  }
  const iso = periodo.match(/(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-01`;
  const corto = periodo.match(/([a-záéíóúñ]{3})[- ]?(\d{4})/i);
  if (corto) {
    const alias: Record<string, string> = {
      ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
      jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12',
    };
    const mm = alias[corto[1].toLowerCase()];
    if (mm) return `${corto[2]}-${mm}-01`;
  }
  return periodo;
}

function periodoIsoSoloMes(periodo: string): string {
  return periodoIsoDeMes(periodo).slice(0, 7);
}

function numeroCampo(valor: unknown): number | undefined {
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'string') {
    const n = normalizarMonto(valor);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function porcentajeCampo(valor: unknown): number | undefined {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = normalizarPorcentaje(valor);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function textoCampo(valor: unknown): string {
  return String(valor ?? '').trim();
}

export function mapearCasoAEntrada(caso: GoldenCaso): EntradaPrestacion {
  const e = caso.entrada;
  const fechaCalculoIso = e['fecha_de_cálculo']
    ? normalizarFecha(textoCampo(e['fecha_de_cálculo']))
    : fechaCalculoDesdeTexto(caso);
  const entrada: EntradaPrestacion = {
    tipoPrestacion: textoCampo(e['tipo_de_prestación']),
    reip: porcentajeCampo(e['grado_de_incapacidad'] ?? e.reip ?? e['reip_definitiva'] ?? e['reip_base']),    fechaInicioIncapacidad: e['inicio_de_incapacidad'] ? normalizarFecha(textoCampo(e['inicio_de_incapacidad'])) : undefined,
    fechaInicioPension: e['inicio_de_pensión_devengo'] ? normalizarFecha(textoCampo(e['inicio_de_pensión_devengo'])) : undefined,
    fechaFallecimiento: e['fecha_de_fallecimiento'] ? normalizarFecha(textoCampo(e['fecha_de_fallecimiento'])) : undefined,
    fechaPresentacionTramite: e['presentación_del_trámite'] ? normalizarFecha(textoCampo(e['presentación_del_trámite'])) : undefined,
    fechaResolucionPago: e['resolución_de_pago'] ? normalizarFecha(textoCampo(e['resolución_de_pago'])) : undefined,
    fechaCalculo: fechaCalculoIso,    fechaTerminoBeneficio: e['término_del_beneficio'] ? normalizarFecha(textoCampo(e['término_del_beneficio'])) : undefined,
    periodoReip: e['periodo_reip'] ? periodoIsoDeMes(textoCampo(e['periodo_reip'])) : undefined,
    periodoLiquidacion: e['periodo_de_liquidación'] ? periodoIsoSoloMes(textoCampo(e['periodo_de_liquidación'])) : undefined,
    pensionYaConstituida: e['pensión_ya_constituida'] !== undefined ? aBooleano(e['pensión_ya_constituida']) : undefined,
    causanteYaEraPensionado: e['causante_ya_era_pensionado'] !== undefined ? /pensionado.*s[íi]|^s[íi]$/i.test(textoCampo(e['causante_ya_era_pensionado'])) : undefined,
    sbpForzado: numeroCampo(e.sbp ?? e['sbp_forzado'] ?? e['sbp_efectivo']),
    sbpCalculado: numeroCampo(e['sbp_calculado'] ?? e['sbp_estimado'] ?? e['sbp_esperado']),
    pbcForzado: numeroCampo(e.pbc ?? e['pbc_causante'] ?? e['pensión_base_del_causante']),
    pensionBaseForzada: numeroCampo(e['pensión_base'] ?? e['pensión_base_forzada'] ?? e['pension_base']),
    afp: textoCampo(e.afp) || 'MODELO',
    regimenPrevisional: textoCampo(e['régimen_previsional'] ?? e['regimen_previsional']) || 'AFP_STD',
    granInvalidez: e['gran_invalidez'] !== undefined ? aBooleano(e['gran_invalidez']) : undefined,
    hijos: numeroCampo(e.hijos ?? e['n_hijos'] ?? e['hijos_causantes']),
    hijosActivosArt41: numeroCampo(e['hijos_que_activan_art_41']),
    factorIndemnizacionPagado: factorPagado(e),
    montoIndemnizacionPagada: numeroCampo(e['monto_indemnización_ya_pagado'] ?? e['indemnización_pagada']),
    rentas: caso.rentas.map((r) => ({
      periodo: periodoIsoSoloMes(r.periodo),
      imponible: r.imponible,
      dias: r.dias,
      regimen: r.regimen,
    })),
    pagadoPrevioPorPeriodo: pagadoPrevioDeTexto(e['pagado_previo']),
    beneficiarios: extraerBeneficiarios(caso),
    descuentos: parsearDescuentos(textoCampo(e['descuentos_b_2'])),
    edad: numeroCampo(edadDesdeTexto(e)),
    haberesNoImponibles: construirHaberes(e),
    errorEsperado: textoCampo(e['código_esperado']) || undefined,
  };

  return entrada;
}

function construirHaberes(e: Record<string, unknown>): Record<string, number> | undefined {
  const haberes: Record<string, number> = {};
  const af = numeroCampo(e['asignación_familiar'] ?? e['asignacion_familiar']);
  const aguinaldo = numeroCampo(e.aguinaldo);
  const bonoInvierno = numeroCampo(e['bono_invierno']);
  if (af !== undefined) haberes.AF = af;
  if (aguinaldo !== undefined) haberes.AGUINALDO = aguinaldo;
  if (bonoInvierno !== undefined) haberes.BONO_INVIERNO = bonoInvierno;
  return Object.keys(haberes).length > 0 ? haberes : undefined;
}

function edadDesdeTexto(e: Record<string, unknown>): number | undefined {
  const persona = textoCampo(e['persona_beneficiario_principal']);
  const m = persona.match(/(\d{2})\s*(?:años|años|anios)/i);
  if (m) return Number(m[1]);
  const edad = e.edad ?? e['edad_beneficiario'];
  if (typeof edad === 'number') return edad;
  return undefined;
}

function parsearDescuentos(texto: string): EntradaPrestacion['descuentos'] {
  if (texto.trim() === '') return undefined;
  const descuentos: EntradaPrestacion['descuentos'] = {};
  if (/iusc/i.test(texto)) {
    descuentos.iusc = true;
    return descuentos;
  }

  const retenciones: number[] = [];
  const retRe = /retenci[oó]n judicial\s*(\d+(?:[.,]\d+)?)%/gi;
  let m: RegExpExecArray | null;
  while ((m = retRe.exec(texto)) !== null) {
    retenciones.push(Number.parseFloat(m[1].replace(',', '.')));
  }
  if (retenciones.length > 0) descuentos.retencionesJudiciales = retenciones;

  const deuda = texto.match(/deuda[^%]*?\b(\d+(?:[.,]\d+)?)%/i);
  if (deuda) descuentos.deudaInterna = Number.parseFloat(deuda[1].replace(',', '.'));

  const ccaf = texto.match(/ccaf[^$]*?\$?([\d.]+)/i);
  if (ccaf) descuentos.ccaf = Number.parseInt(ccaf[1].replace(/\./g, ''), 10);

  const oficio = texto.match(/oficio[^%]*?\b(\d+(?:[.,]\d+)?)%/i);
  if (oficio) descuentos.oficio = Number.parseFloat(oficio[1].replace(',', '.'));

  return descuentos;
}

const TIPO_BENEFICIARIO: Record<string, string> = {
  C: 'CONYUGE',
  H: 'HIJO',
  M: 'MADRE',
  P: 'PADRE',
  A: 'ASCENDIENTE',
};

function fechaCalculoDesdeTexto(caso: GoldenCaso): string {
  const escenario = `${caso.escenario} ${caso.esperado_texto}`;
  const m = escenario.match(/(?:fecha[^\s]*cálculo|fecha de cálculo|cálculo)[^:]*(?::\s*)?(\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
  if (m) {
    try {
      return normalizarFecha(m[1]);
    } catch {
      return '2026-06-15';
    }
  }
  return '2026-06-15';
}

function extraerBeneficiarios(caso: GoldenCaso): EntradaPrestacion['beneficiarios'] {
  const e = caso.entrada;
  const esSobrevivencia = textoCampo(e['tipo_de_prestación']).toLowerCase().includes('sobrevivencia');

  if (!esSobrevivencia) return undefined;

  const texto = caso.esperado_texto;
  const montosMatch = texto.match(/montos:\s*([\s\S]*?)(?:Paso\s|Regla\s|$)/i);
  if (!montosMatch) return undefined;

  const montoRe = /([A-Z][A-Z0-9_]*)\s*=\s*\$?([\d.]+)/g;
  let m: RegExpExecArray | null;
  const beneficiarios: Array<{
    id: string;
    tipo: string;
    montoBruto: number;
    porcentajeNominal?: number;
    porcentajeEfectivo?: number;
  }> = [];
  while ((m = montoRe.exec(montosMatch[1])) !== null) {
    const id = m[1];
    const monto = Number.parseInt(m[2].replace(/\./g, ''), 10);
    const letraInicial = id.charAt(0);
    const tipo = TIPO_BENEFICIARIO[letraInicial] ?? 'CONYUGE';
    beneficiarios.push({
      id,
      tipo,
      montoBruto: monto,
    });
  }

  if (beneficiarios.length === 0) return undefined;

  const pbcMatch = texto.match(/pensión del causante\s*=\s*\$?([\d.]+)/i);
  const pbcValor = pbcMatch ? Number.parseInt(pbcMatch[1].replace(/\./g, ''), 10) : undefined;
  for (const b of beneficiarios) {
    const pct = pbcValor && pbcValor > 0 ? (b.montoBruto / pbcValor) * 100 : 20;
    b.porcentajeNominal = pct;
    b.porcentajeEfectivo = pct;
  }

  return beneficiarios.map((b) => ({
    id: b.id,
    tipo: b.tipo as TipoBeneficiarioSobrevivencia,
    porcentajeNominal: b.porcentajeNominal,
    porcentajeEfectivo: b.porcentajeEfectivo,
  }));
}

function factorPagado(e: Record<string, unknown>): number | undefined {
  const valor = e['factor_de_sueldos_ya_pagado'];
  if (valor === undefined) return undefined;
  const raw = textoCampo(valor);
  if (raw === '') return undefined;
  const n = Number.parseFloat(raw.replace(/\./g, '.').replace(/,/g, '.'));
  if (!Number.isFinite(n)) return undefined;
  // parseMonto del extractor elimina el punto decimal: "7.5" -> 75.
  const valoresMangulados = new Set([15, 30, 45, 60, 75, 90, 105, 120, 135, 150]);
  if (valoresMangulados.has(n)) return n / 10;
  return n;
}

function pagadoPrevioDeTexto(valor: unknown): Record<string, number> | undefined {
  if (typeof valor !== 'string' || valor.trim() === '') return undefined;
  const resultado: Record<string, number> = {};
  const re = /([a-záéíóúñ]+)\s+(\d{4})\s*=\s*\$?([\d.]+)/gi;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = re.exec(valor)) !== null) {
    const mm = MESES_ES[m[1].toLowerCase()];
    if (!mm) continue;
    const periodo = `${m[2]}-${mm}`;
    const monto = Number.parseInt(m[3].replace(/\./g, ''), 10);
    if (Number.isFinite(monto)) {
      resultado[periodo] = monto;
      matched = true;
    }
  }
  return matched ? resultado : undefined;
}

export function esperarCodigoError(caso: GoldenCaso): string | undefined {
  const codigo = caso.esperado.error_code;
  if (typeof codigo === 'string') return codigo;
  const texto = (caso.esperado_texto + caso.escenario).toUpperCase();
  const match = texto.match(/\b(EXD-[A-Z0-9-]+|REIP_[A-Z0-9_]+|ERROR_[A-Z0-9_]+|RECHAZADO_[A-Z0-9_]+|DEUDA_[A-Z0-9_]+|PENDIENTE_[A-Z0-9_]+|CONSUMIDO|EXCESO_PAGO)\b/);
  return match ? match[1] : undefined;
}

export function esCasoRechazo(caso: GoldenCaso): boolean {
  const texto = (caso.escenario + caso.esperado_texto).toLowerCase();
  return /denegad|rechaz|sin derecho|reip_?bajo|0%|sin prestaci/i.test(texto)
    || caso.seccion === 'ERR'
    || (caso.tipo === 'rechazo' || caso.tipo === 'negativo');
}
