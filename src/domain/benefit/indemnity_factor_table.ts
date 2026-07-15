export interface FactorIndemnizacion {
  desde: number;
  factor: number;
}

export const FACTORES_INDEMNIZACION: readonly FactorIndemnizacion[] = [
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
] as const;

export function obtenerFactorIndemnizacion(grado: number): number {
  const factor = [...FACTORES_INDEMNIZACION]
    .reverse()
    .find((item) => grado >= item.desde);

  if (factor === undefined) {
    throw new RangeError('grado does not qualify for indemnity');
  }

  return factor.factor;
}
