export type TipoPrestacionPpee =
  | 'PENSION_PARCIAL'
  | 'PENSION_TOTAL'
  | 'PENSION_GRAN_INVALIDEZ'
  | 'PENSION_TRANSITORIA'
  | 'PENSION_SOBREVIVENCIA'
  | 'INDEMNIZACION_GLOBAL'
  | 'NINGUNO';

export type ClasificacionPrimerPago = 'GIRO' | 'CONSUMIDO' | 'DEUDA';

export type RegimenPrevisional = 'AFP_STD' | 'AFP_TRASPASO' | 'IPS';

export interface RentaMensual {
  periodo: string;
  imponible: number;
  dias: number;
  regimen: RegimenPrevisional | string;
  diasSubsidio?: number;
}

export type TipoBeneficiarioSobrevivencia =
  | 'CONYUGE'
  | 'CONVIVIENTE'
  | 'HIJO'
  | 'MADRE'
  | 'PADRE'
  | 'ASCENDIENTE';

export interface BeneficiarioSobrevivencia {
  id: string;
  tipo: TipoBeneficiarioSobrevivencia;
  nombre?: string;
  porcentajeNominal?: number;
  porcentajeEfectivo?: number;
  fechaNacimiento?: string;
  activo?: boolean;
}

export interface PagadoPrevioPeriodo {
  periodo: string;
  monto: number;
  concepto?: string;
}

export interface DescuentosLiquidacion {
  retencionesJudiciales?: number[];
  deudaInterna?: number;
  deudaSuseso?: number;
  oficio?: number;
  ccaf?: number;
  iusc?: boolean;
  descripcion?: string;
}

export interface EntradaPrestacion {
  tipoPrestacion?: string;
  reip?: number;
  granInvalidez?: boolean;

  fechaInicioIncapacidad?: string;
  fechaInicioPension?: string;
  fechaFallecimiento?: string;
  fechaPresentacionTramite?: string;
  fechaResolucionPago?: string;
  fechaCalculo?: string;
  fechaTerminoBeneficio?: string;
  fechaNacimiento?: string;
  periodoReip?: string;
  periodoLiquidacion?: string;
  causalTermino?: string;

  pensionYaConstituida?: boolean;
  causanteYaEraPensionado?: boolean;

  sbpForzado?: number;
  sbpCalculado?: number;
  pbcForzado?: number;
  pensionBaseForzada?: number;
  factorIndemnizacionPagado?: number;
  montoIndemnizacionPagada?: number;

  rentas?: RentaMensual[];
  beneficiarios?: BeneficiarioSobrevivencia[];
  pagadoPrevio?: PagadoPrevioPeriodo[];
  pagadoPrevioPorPeriodo?: Record<string, number>;

  afp?: string;
  planSalud?: 'FONASA' | 'ISAPRE';
  planIsapreUf?: number;
  hijos?: number;
  hijosActivosArt41?: number;
  regimenPrevisional?: RegimenPrevisional | string;
  esIndependiente?: boolean;

  nombre?: string;
  rut?: string;

  aplicarReajustePension?: boolean;
  seriePagos?: {
    modo?: string;
    fechaPeriodoCalculo?: string;
    fechaHasta?: string;
    aplicarReajustePension?: boolean;
  };
  descuentos?: DescuentosLiquidacion;
  haberesNoImponibles?: Record<string, number>;
  errorEsperado?: string;
  edad?: number;
  cotizaciones?: {
    fondo?: number;
    salud?: number;
    comision?: number;
    comisionAfp?: number;
  };
}

export interface CuadroFila {
  periodo: string;
  devengado: number;
  pagadoPrevio: number;
  saldo: number;
}

export interface ResultadoPrestacion {
  tipoPrestacion: TipoPrestacionPpee;
  estado: string;
  errorCode?: string;
  periodicidad?: 'UNICO' | 'MENSUAL';
  monto?: number;
  montoMensual?: number;
  pensionImponible?: number;
  pensionBase?: number;
  auxilioGi?: number;
  sbp?: number;
  factorSueldos?: number;
  montoIndemnizacion?: number;
  liquido?: number;
  haberImponible?: number;
  netoPrimerPago?: number;
  clasificacionPrimerPago?: ClasificacionPrimerPago;
  fechaPrimerPago?: string;
  cuadro?: CuadroFila[];
  beneficiarios?: Array<{ id: string; monto: number; porcentaje: number }>;
  conformidades?: string[];
  evidencia?: Record<string, unknown>;
}
