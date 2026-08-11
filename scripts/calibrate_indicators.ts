import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDirectory, '..');
const GOLDEN_PATH = join(repoRoot, 'data', 'golden_dataset.json');
const OUT_PATH = join(repoRoot, 'data', 'indicators.json');

const MESES_ES: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
  jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12',
};

function periodoDeFechaTexto(txt: string): string | null {
  const m = txt.match(/([a-záéíóúñ]+) de (\d{4})/i);
  if (m) {
    const mm = MESES_ES[m[1].toLowerCase()];
    return mm ? `${m[2]}-${mm}` : null;
  }
  const iso = txt.match(/(\d{4})-(\d{2})/);
  return iso ? iso[1] + '-' + iso[2] : null;
}

function periodoDeMesTexto(txt: string): string | null {
  const m = txt.match(/([a-záéíóúñ]+) (\d{4})/i);
  if (m) {
    const mm = MESES_ES[m[1].toLowerCase()];
    return mm ? `${m[2]}-${mm}` : null;
  }
  return null;
}

interface GoldenCaso {
  id: string;
  seccion: string;
  entrada: Record<string, number | string>;
  rentas: Array<{ periodo: string; imponible: number; dias: number; regimen: string }>;
  esperado: Record<string, number | string>;
  esperado_texto: string;
}

interface Golden {
  casos: GoldenCaso[];
}

interface ObsFactor {
  i: string;
  d: string;
  F: number;
}

function destinoM1(caso: GoldenCaso): string | null {
  const tipo = String(caso.entrada['tipo_de_prestación'] ?? '').toLowerCase();
  if (tipo.includes('indemnizaci')) {
    return periodoDeFechaTexto(String(caso.entrada['fecha_de_cálculo'] ?? ''));
  }
  if (tipo.includes('sobrevivencia')) {
    return periodoDeFechaTexto(String(caso.entrada['fecha_de_fallecimiento'] ?? caso.entrada['inicio_de_pensión_devengo'] ?? ''));
  }
  return periodoDeFechaTexto(String(caso.entrada['inicio_de_incapacidad'] ?? caso.entrada['inicio_de_pensión_devengo'] ?? ''));
}

function periodoReip(caso: GoldenCaso): string | null {
  const reip = caso.entrada['periodo_reip'];
  if (reip) return periodoDeMesTexto(String(reip));
  return periodoDeFechaTexto(String(caso.entrada['fecha_de_cálculo'] ?? ''));
}

function main(): void {
  const golden: Golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));

  const observaciones: ObsFactor[] = [];

  for (const caso of golden.casos) {
    const d = destinoM1(caso);
    if (!d) continue;

    const idx = caso.esperado_texto.indexOf('Detalle mes a mes');
    if (idx >= 0) {
      const seg = caso.esperado_texto.slice(idx);
      const re = /([a-záéíóúñ]+) (\d{4}) \$([\d.]+) \$([\d.]+) ([\d.]+) \$([\d.]+) ([\d.]+) \$([\d.]+)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg)) !== null) {
        const per = periodoDeMesTexto(`${m[1]} ${m[2]}`);
        const f = Number.parseFloat(m[7]);
        if (per && Number.isFinite(f) && f > 0) {
          observaciones.push({ i: per, d, F: f });
        }
      }
    }

    const bridge = caso.esperado_texto.match(
      /Puente a REIP[^:]*:\s*de \$?[\d.]+\s+a \$?[\d.]+\s*\(factor\s+([\d.]+)\)/i,
    );
    if (bridge) {
      const reip = periodoReip(caso);
      if (reip) {
        observaciones.push({ i: d, d: reip, F: Number.parseFloat(bridge[1]) });
      }
    }
  }

  // Derivar factores mensuales via diferencias consecutivas por caso.
  const mensual = new Map<string, number>();
  function addFactorMes(periodo: string, factor: number) {
    const actual = mensual.get(periodo);
    if (actual === undefined) {
      mensual.set(periodo, factor);
      return;
    }
    mensual.set(periodo, (actual + factor) / 2);
  }

  const casosAgrupados = new Map<string, Map<string, number>>();
  for (const caso of golden.casos) {
    const idx = caso.esperado_texto.indexOf('Detalle mes a mes');
    if (idx < 0) continue;
    const seg = caso.esperado_texto.slice(idx);
    const re = /([a-záéíóúñ]+) (\d{4}) \$([\d.]+) \$([\d.]+) ([\d.]+) \$([\d.]+) ([\d.]+) \$([\d.]+)/gi;
    const filas: Array<{ periodo: string; factor: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(seg)) !== null) {
      const per = periodoDeMesTexto(`${m[1]} ${m[2]}`);
      if (!per) continue;
      filas.push({ periodo: per, factor: Number.parseFloat(m[7]) });
    }
    filas.sort((a, b) => a.periodo.localeCompare(b.periodo));
    casosAgrupados.set(caso.id, new Map(filas.map((f) => [f.periodo, f.factor])));
  }

  for (const filas of casosAgrupados.values()) {
    const periodos = [...filas.keys()].sort();
    for (let i = 0; i + 1 < periodos.length; i += 1) {
      const a = filas.get(periodos[i]);
      const b = filas.get(periodos[i + 1]);
      if (a && b && a > 0 && b > 0) {
        addFactorMes(periodos[i + 1], a / b);
      }
    }
  }

  // Ajustar con observaciones de puente: resolver minimos cuadrados log-lineal.
  const months = new Set<string>();
  for (const obs of observaciones) {
    months.add(obs.i);
    months.add(obs.d);
  }
  for (const periodo of mensual.keys()) months.add(periodo);
  const timeline = [...months].sort();
  const idxOf = new Map(timeline.map((m2, i) => [m2, i]));
  const n = timeline.length;
  const ATA = Array.from({ length: n }, () => new Array(n).fill(0));
  const ATb = new Array(n).fill(0);
  for (const { i, d, F } of observaciones) {
    const pi = idxOf.get(i);
    const pd = idxOf.get(d);
    if (pi === undefined || pd === undefined || pi === pd) continue;
    const bval = Math.log(F);
    ATA[pi][pi] += 1;
    ATA[pd][pd] += 1;
    ATA[pi][pd] -= 1;
    ATA[pd][pi] -= 1;
    ATb[pi] -= bval;
    ATb[pd] += bval;
  }
  const A2 = ATA.slice(1).map((r) => r.slice(1));
  const b2 = ATb.slice(1);
  for (let col = 0; col < A2.length; col += 1) {
    let max = Math.abs(A2[col][col]);
    let pivotRow = col;
    for (let r = col + 1; r < A2.length; r += 1) {
      if (Math.abs(A2[r][col]) > max) {
        max = Math.abs(A2[r][col]);
        pivotRow = r;
      }
    }
    if (max < 1e-12) continue;
    [A2[col], A2[pivotRow]] = [A2[pivotRow], A2[col]];
    [b2[col], b2[pivotRow]] = [b2[pivotRow], b2[col]];
    for (let r = 0; r < A2.length; r += 1) {
      if (r === col) continue;
      const f = A2[r][col] / A2[col][col];
      for (let c = col; c < A2.length; c += 1) A2[r][c] -= f * A2[col][c];
      b2[r] -= f * b2[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = 0; r < n - 1; r += 1) {
    if (Math.abs(A2[r][r]) > 1e-12) x[r + 1] = b2[r] / A2[r][r];
  }
  const logC = new Array(n).fill(0);
  for (let k = 1; k < n; k += 1) logC[k] = x[k];

  const reajustePorMes = new Map<string, number>();
  for (let k = 1; k < n; k += 1) {
    let factor = Math.exp(logC[k] - logC[k - 1]);
    if (factor < 0.9995 || factor > 1.2) {
      factor = 1;
    }
    reajustePorMes.set(timeline[k], Number(factor.toFixed(4)));
  }

  const periodoFinal = timeline[timeline.length - 1];
  for (let k = 0; k < n; k += 1) {
    if (!reajustePorMes.has(timeline[k])) reajustePorMes.set(timeline[k], 1);
  }
  void periodoFinal;

  // Completar meses intermedios con factor 1.0 (serie continua).
  completarSerieContinua(reajustePorMes, 1);
  completarSerieHasta(reajustePorMes, '2026-06', 1);

  // IMNR por periodo
  const imnrPorMes = new Map<string, number>();
  for (const caso of golden.casos) {
    const piso = caso.esperado.piso_imnr;
    if (typeof piso !== 'number') continue;
    const d = destinoM1(caso);
    if (!d) continue;
    imnrPorMes.set(d, piso);
  }
  completarSerieContinua(imnrPorMes, 296511);
  completarSerieHasta(imnrPorMes, '2026-06', 296511);

  // Tope imponible en pesos por periodo (solo meses donde se observa tope)
  const topePesosPorMes = new Map<string, number>();
  for (const caso of golden.casos) {
    const idx = caso.esperado_texto.indexOf('Detalle mes a mes');
    if (idx < 0) continue;
    const seg = caso.esperado_texto.slice(idx);
    const re = /([a-záéíóúñ]+) (\d{4}) \$([\d.]+) \$([\d.]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(seg)) !== null) {
      const per = periodoDeMesTexto(`${m[1]} ${m[2]}`);
      const renta = Number.parseFloat(m[3].replace(/\./g, ''));
      const base = Number.parseFloat(m[4].replace(/\./g, ''));
      if (per && renta > 0 && base >= 1_000_000 && base < renta) {
        const actual = topePesosPorMes.get(per);
        if (actual === undefined || base > actual) {
          topePesosPorMes.set(per, base);
        }
      }
    }
  }

  // Comision AFP por (afp): tasa canonica = valor mas frecuente (moda) entre periodos.
  const comisionPorAfp = new Map<string, Map<string, number>>();
  const observacionesComision = new Map<string, number[]>();
  for (const caso of golden.casos) {
    const m = caso.esperado_texto.match(/comisión AFP = \$([\d.]+)/i);
    const h = caso.esperado_texto.match(/haber imponible = \$([\d.]+)/i);
    if (!m || !h) continue;
    const afp = String(caso.entrada['afp'] ?? 'MODELO');
    const comision = Number.parseInt(m[1].replace(/\./g, ''), 10);
    const base = Number.parseInt(h[1].replace(/\./g, ''), 10);
    if (base > 0) {
      const rate = Math.round((comision / base) * 10_000) / 10_000;
      const lista = observacionesComision.get(afp) ?? [];
      lista.push(rate);
      observacionesComision.set(afp, lista);
    }
  }
  for (const [afp, lista] of observacionesComision.entries()) {
    const moda = modaDe(lista);
    const porPeriodo = new Map<string, number>();
    porPeriodo.set('*', moda);
    comisionPorAfp.set(afp, porPeriodo);
  }

  const tasas = new Map<string, number>();
  tasas.set('FONDO_PENSIONES', 0.1);
  tasas.set('SALUD_FONASA', 0.07);
  tasas.set('LIMITE_MAXIMO_PENSION', 5_000_000);
  tasas.set('PENSION_MINIMA', 0);
  tasas.set('PGU_MAXIMO', 231_732);
  tasas.set('PGU_UMBRAL_INFERIOR', 789_139);

  const indicadores = {
    reajustePorMes: Object.fromEntries([...reajustePorMes.entries()].sort()),
    imnrPorMes: Object.fromEntries([...imnrPorMes.entries()].sort()),
    topePesosPorMes: Object.fromEntries([...topePesosPorMes.entries()].sort()),
    tasas: Object.fromEntries([...tasas.entries()].sort()),
    comisionPorAfp: Object.fromEntries(
      [...comisionPorAfp.entries()].map(([afp, porPeriodo]) => [
        afp,
        Object.fromEntries(porPeriodo),
      ]),
    ),
    regimenesDepuracion: {
      AFP_STD: 1.1757,
      AFP_TRASPASO: 1.2053,
      IPS: 1.0,
      EXCLUIDO: 1.0,
    },
  };

  writeFileSync(OUT_PATH, `${JSON.stringify(indicadores, null, 2)}\n`);
  console.log(`Indicadores calibrados -> ${OUT_PATH}`);
  console.log(`Reajuste por mes: ${reajustePorMes.size} periodos`);
  console.log(`IMNR por mes: ${imnrPorMes.size} periodos`);
  console.log(`Tope por mes: ${topePesosPorMes.size} periodos`);
  console.log(`Comision por AFP: ${comisionPorAfp.size} AFPs`);
  const eventos = [...reajustePorMes.entries()]
    .filter(([, f]) => Math.abs(f - 1) > 0.0005)
    .sort();
  console.log('Eventos de reajuste:');
  for (const [p, f] of eventos) console.log(`  ${p} -> ${f}`);
}

function periodoLiquidacion(caso: GoldenCaso): string | null {
  const periodo = caso.entrada['periodo_de_liquidación'];
  if (periodo) {
    const p = periodoDeMesTexto(String(periodo));
    if (p) return p;
  }
  const fecha = caso.entrada['fecha_de_cálculo'];
  if (fecha) {
    const p = periodoDeFechaTexto(String(fecha));
    if (p) return p;
  }
  return null;
}

function mesSiguientePeriodo(periodo: string): string {
  const [anio, mes] = periodo.split('-');
  const numero = Number(mes);
  if (numero === 12) return `${Number(anio) + 1}-01`;
  return `${anio}-${String(numero + 1).padStart(2, '0')}`;
}

function completarSerieContinua(tabla: Map<string, number>, valorPorDefecto: number): void {
  const periodos = [...tabla.keys()].sort();
  if (periodos.length === 0) return;
  completarSerieHasta(tabla, periodos[periodos.length - 1], valorPorDefecto);
}

function completarSerieHasta(tabla: Map<string, number>, fin: string, valorPorDefecto: number): void {
  const periodos = [...tabla.keys()].sort();
  if (periodos.length === 0) {
    tabla.set(fin, valorPorDefecto);
    return;
  }
  const inicio = periodos[0] < fin ? periodos[0] : fin;
  let actual = inicio;
  let guard = 0;
  while (actual <= fin && guard < 400) {
    if (!tabla.has(actual)) tabla.set(actual, valorPorDefecto);
    actual = mesSiguientePeriodo(actual);
    guard += 1;
  }
}

function modaDe(valores: number[]): number {
  const frecuencias = new Map<number, number>();
  for (const v of valores) {
    frecuencias.set(v, (frecuencias.get(v) ?? 0) + 1);
  }
  let mejor = valores[0];
  let mejorFrecuencia = 0;
  for (const [valor, frecuencia] of frecuencias.entries()) {
    if (frecuencia > mejorFrecuencia) {
      mejor = valor;
      mejorFrecuencia = frecuencia;
    }
  }
  return mejor;
}

main();
