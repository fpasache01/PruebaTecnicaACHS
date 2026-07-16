import { describe, expect, it } from 'vitest';
import {
  calculateBenefitFromFormulaRules,
  DEFAULT_BENEFIT_FORMULAS,
  DEFAULT_FORMULA_VARIABLES,
  parseFormulaVariable,
  parseNewBenefitFormulaRule,
} from '../../../../src/domain/benefit/benefit_rules.js';

describe('benefit formula rules', () => {
  it('calculates using a registered beneficiary variable', () => {
    const variables = [
      ...DEFAULT_FORMULA_VARIABLES,
      parseFormulaVariable({
        variableName: 'cargas',
        dataType: 'numeric',
        source: 'beneficiary.cargas',
        enabled: true,
      }),
    ];
    const rules = [
      {
        id: 'partial-with-cargas',
        ...parseNewBenefitFormulaRule({
          formulaName: 'Partial with cargas',
          priority: 1,
          formula: 'sbm * 0.35 + cargas * 10000',
          enabled: true,
          beneficiaryType: 'WORKER',
          periodicity: 'MENSUAL',
          benefitType: 'PENSION_PARCIAL',
          conditions: {
            gradoMin: 40,
            gradoMaxExclusive: 70,
          },
        }, variables),
      },
      ...DEFAULT_BENEFIT_FORMULAS,
    ];

    expect(calculateBenefitFromFormulaRules({
      sbm: 1_000_000,
      grado: 45,
      beneficiary: {
        cargas: 2,
      },
    }, rules, variables)).toEqual({
      tipoBeneficio: 'PENSION_PARCIAL',
      monto: 370_000,
      periodicidad: 'MENSUAL',
    });
  });

  it('rejects formulas with unknown variables', () => {
    expect(() => parseNewBenefitFormulaRule({
      formulaName: 'Unknown variable',
      priority: 1,
      formula: 'sbm * unknown_variable',
      enabled: true,
      beneficiaryType: 'WORKER',
      periodicity: 'MENSUAL',
      benefitType: 'PENSION_PARCIAL',
      conditions: {
        gradoMin: 40,
      },
    })).toThrow('formula references unknown variable: unknown_variable');
  });

  it('rejects dangerous formula strings', () => {
    expect(() => parseNewBenefitFormulaRule({
      formulaName: 'Dangerous formula',
      priority: 1,
      formula: 'sbm; drop table benefit_formulas',
      enabled: true,
      beneficiaryType: 'WORKER',
      periodicity: 'MENSUAL',
      benefitType: 'PENSION_PARCIAL',
      conditions: {
        gradoMin: 40,
      },
    })).toThrow('formula contains forbidden SQL syntax');
  });

  it('rejects unsupported variable sources', () => {
    expect(() => parseFormulaVariable({
      variableName: 'unsafe',
      dataType: 'numeric',
      source: 'database.other_table.value',
      enabled: true,
    })).toThrow('unsupported formula variable source: database.other_table.value');
  });
});
