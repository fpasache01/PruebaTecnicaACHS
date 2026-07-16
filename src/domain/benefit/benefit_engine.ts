import {
  calculateBenefitFromFormulaRules,
  DEFAULT_BENEFIT_FORMULAS,
  DEFAULT_FORMULA_VARIABLES,
  type BenefitFormulaRule,
  type FormulaVariable,
} from './benefit_rules.js';
import type {
  BenefitCalculationInput,
  OpcionesCalculo,
  ResultadoBeneficio,
} from './benefit_types.js';

export function calcularBeneficio(
  sbm: number,
  grado: number,
  opciones: OpcionesCalculo = {},
): ResultadoBeneficio {
  return calcularBeneficioConReglas(
    {
      sbm,
      grado,
      granInvalidez: opciones.granInvalidez,
    },
    DEFAULT_BENEFIT_FORMULAS,
    DEFAULT_FORMULA_VARIABLES,
  );
}

export function calcularBeneficioConReglas(
  input: BenefitCalculationInput,
  rules: readonly BenefitFormulaRule[],
  variables: readonly FormulaVariable[] = DEFAULT_FORMULA_VARIABLES,
): ResultadoBeneficio {
  return calculateBenefitFromFormulaRules(input, rules, variables);
}
