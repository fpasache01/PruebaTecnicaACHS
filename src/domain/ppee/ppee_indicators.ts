import { Pool } from 'pg';

export interface TasaVigencia {
  nombre: string;
  valor: number;
  vigenciaDesde?: string;
  vigenciaHasta?: string;
}

/**
 * Proveedor de indicadores (series de parametros) que necesita el pipeline PPEE.
 * El engine usa exclusivamente esta interfaz: permite inyectar tablas en memoria
 * (tests / golden) o la base de datos (current_uf, current_ipc, ...).
 */
export interface PpeeIndicadores {
  ufUltimoDiaMes(periodo: string): number;
  factorReajusteMes(periodo: string): number;
  imnr(periodo: string): number;
  topeImponiblePesos(periodo: string, regimen: string): number;
  factorDepuracion(regimen: string, periodo: string): number;
  tasa(nombre: string, periodo?: string): number;
  comisionAfp(afp: string, periodo: string): number;
}

const MESES: readonly string[] = [
  '01', '02', '03', '04', '05', '06',
  '07', '08', '09', '10', '11', '12',
];

export function periodoAnterior(periodo: string): string {
  const [anio, mes] = periodo.split('-');
  const numeroMes = Number(mes);
  if (numeroMes === 1) {
    return `${Number(anio) - 1}-12`;
  }
  return `${anio}-${String(numeroMes - 1).padStart(2, '0')}`;
}

export function periodoPosterior(periodo: string): string {
  const [anio, mes] = periodo.split('-');
  const numeroMes = Number(mes);
  if (numeroMes === 12) {
    return `${Number(anio) + 1}-01`;
  }
  return `${anio}-${String(numeroMes + 1).padStart(2, '0')}`;
}

export function periodosEntre(inicio: string, fin: string): string[] {
  const result: string[] = [];
  let actual = inicio;
  while (actual <= fin && result.length < 200) {
    result.push(actual);
    actual = periodoPosterior(actual);
  }
  return result;
}

/** Indices de un periodo en un arreglo ordenado de periodos */
function indicesPara(periodos: string[], periodo: string): { desde: number; hasta: number } {
  const desde = periodos.indexOf(periodo);
  if (desde === -1) {
    throw new RangeError(`indicador no disponible para el periodo: ${periodo}`);
  }
  return { desde, hasta: desde };
}

export function factorAcumulado(
  tabla: Map<string, number>,
  mesInicial: string,
  mesDestino: string,
): number {
  if (mesInicial === mesDestino) return 1;
  const periodos = [...tabla.keys()].sort();
  const inicio = indicesPara(periodos, mesInicial).desde;
  const destino = indicesPara(periodos, mesDestino).desde;
  let factor = 1;
  for (let i = inicio + 1; i <= destino; i += 1) {
    const factorMes = tabla.get(periodos[i]);
    if (factorMes === undefined) {
      throw new RangeError(`factor de reajuste no disponible para ${periodos[i]}`);
    }
    factor *= factorMes;
  }
  return factor;
}

export class TablasIndicadoresEnMemoria implements PpeeIndicadores {
  constructor(
    private readonly ufPorFecha: Map<string, number> = new Map(),
    private readonly reajustePorMes: Map<string, number> = new Map(),
    private readonly imnrPorMes: Map<string, number> = new Map(),
    private readonly topePesosPorMes: Map<string, number> = new Map(),
    private readonly tasas: Map<string, number> = new Map(),
    private readonly comisionPorAfp: Map<string, Map<string, number>> = new Map(),
    private readonly regimenesDepuracion: Map<string, number> = new Map([
      ['AFP_STD', 1.1757],
      ['AFP_TRASPASO', 1.2053],
      ['IPS', 1.0],
      ['EXCLUIDO', 1.0],
    ]),
  ) {}

  ufUltimoDiaMes(periodo: string): number {
    const valor = this.ufPorFecha.get(periodo);
    if (valor === undefined) {
      throw new RangeError(`UF no disponible para el periodo: ${periodo}`);
    }
    return valor;
  }

  factorReajusteMes(periodo: string): number {
    const valor = this.reajustePorMes.get(periodo);
    if (valor === undefined) {
      throw new RangeError(`factor de reajuste no disponible para: ${periodo}`);
    }
    return valor;
  }

  imnr(periodo: string): number {
    const valor = this.imnrPorMes.get(periodo);
    if (valor !== undefined) return valor;
    const periodos = [...this.imnrPorMes.keys()].sort();
    if (periodos.length === 0) {
      throw new RangeError(`IMNR no disponible para el periodo: ${periodo}`);
    }
    const cercano = periodos.find((p) => p >= periodo) ?? periodos[periodos.length - 1];
    const valorCercano = this.imnrPorMes.get(cercano);
    if (valorCercano === undefined) {
      throw new RangeError(`IMNR no disponible para el periodo: ${periodo}`);
    }
    return valorCercano;
  }

  topeImponiblePesos(periodo: string, _regimen: string): number {
    const valor = this.topePesosPorMes.get(periodo);
    if (valor === undefined) {
      return Number.POSITIVE_INFINITY;
    }
    return valor;
  }

  factorDepuracion(regimen: string, _periodo: string): number {
    const factor = this.regimenesDepuracion.get(regimen);
    if (factor === undefined) {
      throw new RangeError(`regimen previsional no soportado: ${regimen}`);
    }
    return factor;
  }

  tasa(nombre: string, _periodo?: string): number {
    const valor = this.tasas.get(nombre);
    if (valor === undefined) {
      throw new RangeError(`tasa no disponible: ${nombre}`);
    }
    return valor;
  }

  comisionAfp(afp: string, periodo: string): number {
    const porPeriodo = this.comisionPorAfp.get(afp);
    if (porPeriodo !== undefined) {
      const exacta = porPeriodo.get(periodo);
      if (exacta !== undefined) return exacta;
      const general = porPeriodo.get('*');
      if (general !== undefined) return general;
    }
    const general = this.comisionPorAfp.get('*')?.get('*');
    if (general !== undefined) return general;
    const desdeTasas = this.tasas.get(`COMISION_${afp}`);
    if (desdeTasas !== undefined) return desdeTasas;
    throw new RangeError(`comision AFP no disponible para: ${afp}`);
  }

  static vacio(): TablasIndicadoresEnMemoria {
    return new TablasIndicadoresEnMemoria();
  }
}

export function redondearPesos(valor: number): number {
  return Math.round(valor);
}

export interface IndicadoresJson {
  reajustePorMes?: Record<string, number>;
  imnrPorMes?: Record<string, number>;
  topePesosPorMes?: Record<string, number>;
  ufPorMes?: Record<string, number>;
  tasas?: Record<string, number>;
  comisionPorAfp?: Record<string, Record<string, number>>;
  regimenesDepuracion?: Record<string, number>;
}

export function cargarIndicadoresDesdeJson(data: IndicadoresJson): TablasIndicadoresEnMemoria {
  return new TablasIndicadoresEnMemoria(
    new Map(Object.entries(data.ufPorMes ?? {})),
    new Map(Object.entries(data.reajustePorMes ?? {})),
    new Map(Object.entries(data.imnrPorMes ?? {})),
    new Map(Object.entries(data.topePesosPorMes ?? {})),
    new Map(Object.entries(data.tasas ?? {})),
    new Map(
      Object.entries(data.comisionPorAfp ?? {}).map(([afp, porPeriodo]) => [
        afp,
        new Map(Object.entries(porPeriodo ?? {})),
      ]),
    ),
    new Map(Object.entries(data.regimenesDepuracion ?? {})),
  );
}

/**
 * Proveedor de indicadores respaldado en PostgreSQL (current_uf, current_ipc,
 * current_imnr, current_tope_imponible, current_tasas). Carga las series a
 * memoria al construirse.
 */
export class PpeeIndicadoresPostgres implements PpeeIndicadores {
  private readonly ufPorFecha = new Map<string, number>();
  private readonly reajustePorMes = new Map<string, number>();
  private readonly imnrPorMes = new Map<string, number>();
  private readonly topePesosPorMes = new Map<string, number>();
  private readonly tasas = new Map<string, number>();
  private readonly comisionPorAfp = new Map<string, Map<string, number>>();
  private readonly regimenesDepuracion = new Map<string, number>();

  private constructor(private readonly tablas: TablasIndicadoresEnMemoria) {}

  static async cargar(pool: Pool): Promise<PpeeIndicadoresPostgres> {
    const [uf, ipc, imnr, tope, tasas] = await Promise.all([
      pool.query('SELECT fecha, valor FROM current_uf ORDER BY fecha'),
      pool.query('SELECT periodo, factor FROM current_ipc ORDER BY periodo'),
      pool.query('SELECT periodo, valor FROM current_imnr ORDER BY periodo'),
      pool.query('SELECT vigencia_desde, vigencia_hasta, regimen, tope_uf FROM current_tope_imponible ORDER BY vigencia_desde'),
      pool.query('SELECT nombre, valor FROM current_tasas'),
    ]);

    const ufPorFecha = new Map<string, number>();
    for (const row of uf.rows) {
      ufPorFecha.set(formatoPeriodo(row.fecha), Number(row.valor));
    }

    const reajustePorMes = new Map<string, number>();
    for (const row of ipc.rows) {
      reajustePorMes.set(row.periodo, Number(row.factor));
    }

    const imnrPorMes = new Map<string, number>();
    for (const row of imnr.rows) {
      imnrPorMes.set(row.periodo, Number(row.valor));
    }

    const topePesosPorMes = new Map<string, number>();
    for (const row of tope.rows) {
      const desde = formatoPeriodo(row.vigencia_desde);
      const hasta = row.vigencia_hasta === null ? undefined : formatoPeriodo(row.vigencia_hasta);
      topePesosPorMes.set(desde, Number(row.tope_uf));
      if (hasta !== undefined) {
        topePesosPorMes.set(hasta, Number(row.tope_uf));
      }
    }

    const tasasMap = new Map<string, number>();
    const comisionPorAfp = new Map<string, Map<string, number>>();
    for (const row of tasas.rows) {
      const nombre = String(row.nombre);
      const valor = Number(row.valor);
      const match = nombre.match(/^COMISION_(.+)$/);
      if (match !== null) {
        const porPeriodo = comisionPorAfp.get(match[1]) ?? new Map<string, number>();
        porPeriodo.set('*', valor);
        comisionPorAfp.set(match[1], porPeriodo);
      }
      tasasMap.set(nombre, valor);
    }

    const tablas = new TablasIndicadoresEnMemoria(
      ufPorFecha,
      reajustePorMes,
      imnrPorMes,
      topePesosPorMes,
      tasasMap,
      comisionPorAfp,
    );

    return new PpeeIndicadoresPostgres(tablas);
  }

  ufUltimoDiaMes(periodo: string): number {
    return this.tablas.ufUltimoDiaMes(periodo);
  }

  factorReajusteMes(periodo: string): number {
    return this.tablas.factorReajusteMes(periodo);
  }

  imnr(periodo: string): number {
    return this.tablas.imnr(periodo);
  }

  topeImponiblePesos(periodo: string, regimen: string): number {
    return this.tablas.topeImponiblePesos(periodo, regimen);
  }

  factorDepuracion(regimen: string, periodo: string): number {
    return this.tablas.factorDepuracion(regimen, periodo);
  }

  tasa(nombre: string, periodo?: string): number {
    return this.tablas.tasa(nombre, periodo);
  }

  comisionAfp(afp: string, periodo: string): number {
    return this.tablas.comisionAfp(afp, periodo);
  }
}

function formatoPeriodo(fecha: string | Date): string {
  const d = typeof fecha === 'string' ? new Date(`${fecha}T00:00:00`) : fecha;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export { MESES };
