export type TipoBeneficio =
  | 'INDEMNIZACION'
  | 'PENSION_PARCIAL'
  | 'PENSION_TOTAL'
  | 'NINGUNO';

export type Periodicidad = 'UNICO' | 'MENSUAL' | null;

export interface BenefitCalculationInput {
  sbm: number;
  grado: number;
  granInvalidez?: boolean;
  beneficiaryType?: string;
  beneficiary?: Record<string, unknown>;
}

export interface OpcionesCalculo {
  granInvalidez?: boolean;
}

export interface ResultadoBeneficio {
  tipoBeneficio: TipoBeneficio;
  monto: number;
  periodicidad: Periodicidad;
}
