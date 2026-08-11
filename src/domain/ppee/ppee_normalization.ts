import { ERROR_CODES, PpeeError } from './ppee_errors.js';

const MESES_ES: Record<string, string> = {
  enero: '01',
  febrero: '02',
  marzo: '03',
  abril: '04',
  mayo: '05',
  junio: '06',
  julio: '07',
  agosto: '08',
  septiembre: '09',
  octubre: '10',
  noviembre: '11',
  diciembre: '12',
};

/**
 * Normaliza un RUT chileno: "10.001.001-0" -> "10001001-0".
 * Valida digito verificador modulo 11.
 */
export function normalizarRut(valor: string): string {
  const limpio = valor.replace(/\./g, '').replace(/\s+/g, '').toUpperCase();
  const match = limpio.match(/^(\d{1,8})-?([0-9K])$/);
  if (match === null) {
    throw new PpeeError(ERROR_CODES.ERROR_RUT_INVALIDO, `RUT invalido: ${valor}`);
  }
  const cuerpo = match[1];
  const dvEsperado = calcularDv(cuerpo);
  if (dvEsperado !== match[2]) {
    throw new PpeeError(ERROR_CODES.ERROR_RUT_INVALIDO, `RUT invalido (DV): ${valor}`);
  }
  return `${cuerpo}-${dvEsperado}`;
}

export function esRutValido(valor: string): boolean {
  const limpio = valor.replace(/\./g, '').replace(/\s+/g, '').toUpperCase();
  const match = limpio.match(/^(\d{1,8})-?([0-9K])$/);
  if (match === null) return false;
  return calcularDv(match[1]) === match[2];
}

function calcularDv(cuerpo: string): string {
  let suma = 0;
  let multiplo = 2;
  for (let i = cuerpo.length - 1; i >= 0; i -= 1) {
    suma += Number(cuerpo[i]) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }
  const resto = suma % 11;
  const dv = 11 - resto;
  if (dv === 11) return '0';
  if (dv === 10) return 'K';
  return String(dv);
}

/**
 * Normaliza fechas en formato "1 de marzo de 2026", "18 de septiembre de 2025",
 * "2026-06-15", "15/06/2025" o "junio 2025" a ISO "YYYY-MM-DD" (o "YYYY-MM").
 */
export function normalizarFecha(valor: string, incluirDia = true): string {
  const texto = valor.trim();

  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso !== null) return texto;

  const espanol = texto.match(
    /^(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})$/i,
  );
  if (espanol !== null) {
    const mes = MESES_ES[espanol[2].toLowerCase()];
    if (mes === undefined) {
      throw new PpeeError(ERROR_CODES.ERROR_FECHA_INVALIDA, `mes invalido: ${espanol[2]}`);
    }
    const dia = Number(espanol[1]);
    if (dia < 1 || dia > 31) {
      throw new PpeeError(ERROR_CODES.ERROR_FECHA_INVALIDA, `dia invalido: ${valor}`);
    }
    return `${espanol[3]}-${mes}-${String(dia).padStart(2, '0')}`;
  }

  const slash = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash !== null) {
    return `${slash[3]}-${String(Number(slash[2])).padStart(2, '0')}-${String(Number(slash[1])).padStart(2, '0')}`;
  }

  const mesAnio = texto.match(/^([a-záéíóúñ]+)\s+(\d{4})$/i);
  if (mesAnio !== null) {
    const mes = MESES_ES[mesAnio[1].toLowerCase()];
    if (mes === undefined) {
      throw new PpeeError(ERROR_CODES.ERROR_FECHA_INVALIDA, `mes invalido: ${mesAnio[1]}`);
    }
    const periodo = `${mesAnio[2]}-${mes}`;
    return incluirDia ? `${periodo}-01` : periodo;
  }

  throw new PpeeError(ERROR_CODES.ERROR_FECHA_INVALIDA, `fecha invalida: ${valor}`);
}

export function periodoDeFecha(fechaIso: string): string {
  return fechaIso.slice(0, 7);
}

/** Normaliza un monto con formato chileno: "$700.000" -> 700000. */
export function normalizarMonto(valor: unknown): number {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor !== 'string') {
    throw new PpeeError(ERROR_CODES.ERROR_MONTO_INVALIDO, `monto invalido: ${String(valor)}`);
  }
  const limpio = valor.replace(/\$/g, '').replace(/\./g, '').replace(/\s+/g, '').replace(/[^\d,]/g, '');
  const numero = Number.parseFloat(limpio.replace(',', '.'));
  if (!Number.isFinite(numero)) {
    throw new PpeeError(ERROR_CODES.ERROR_MONTO_INVALIDO, `monto invalido: ${valor}`);
  }
  return Math.round(numero);
}

export function normalizarPorcentaje(valor: unknown): number {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor !== 'string') {
    throw new PpeeError(ERROR_CODES.ERROR_REIP_INVALIDO, `porcentaje invalido: ${String(valor)}`);
  }
  const limpio = valor.replace(/%/g, '').replace(/\./g, '.').trim();
  const numero = Number.parseFloat(limpio);
  if (!Number.isFinite(numero)) {
    throw new PpeeError(ERROR_CODES.ERROR_REIP_INVALIDO, `porcentaje invalido: ${valor}`);
  }
  return numero;
}

export function aBooleano(valor: unknown): boolean {
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'string') {
    return /^(s[ií]|true|1)$/i.test(valor.trim());
  }
  return false;
}
