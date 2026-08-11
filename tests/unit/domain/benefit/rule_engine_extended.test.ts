import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BENEFIT_FORMULAS,
  detectarOverlap,
  ejecutarBenefitRules,
  evaluarExprBooleana,
  parseNewBenefitFormulaRule,
  validateFormulaSyntax,
  type BenefitFormulaRule,
  type FormulaVariable,
} from '../../../../src/domain/benefit/benefit_rules.js';

const variables: FormulaVariable[] = [
  { variableName: 'sbm', dataType: 'numeric', source: 'calculation_input.sbm', enabled: true },
  { variableName: 'monto', dataType: 'numeric', source: 'beneficiary.monto', enabled: true },
  { variableName: 'tope', dataType: 'numeric', source: 'beneficiary.tope', enabled: true },
];

describe('rule engine extendido (spec_004/spec_005)', () => {
  it('acepta funciones round/min/max en el grammar', () => {
    expect(() => validateFormulaSyntax('min(round(sbm * 0.35), tope)', variables)).not.toThrow();
  });

  it('rechaza funciones no permitidas', () => {
    expect(() => validateFormulaSyntax('sqrt(sbm)', variables)).toThrow(/function calls are not allowed/);
  });

  it('evalua round/min/max en una regla FORMULA', () => {
    const reglas: BenefitFormulaRule[] = [
      {
        id: 'r1',
        ...parseNewBenefitFormulaRule({
          formulaName: 'Con tope',
          priority: 1,
          formula: 'min(round(sbm * 0.35), tope)',
          enabled: true,
          beneficiaryType: 'WORKER',
          periodicity: 'MENSUAL',
          benefitType: 'PENSION_PARCIAL',
          conditions: { gradoMin: 40 },
        }, variables),
      },
      ...DEFAULT_BENEFIT_FORMULAS,
    ];

    const r = ejecutarBenefitRules({
      sbm: 1_000_000,
      grado: 45,
      beneficiary: { monto: 0, tope: 200000 },
    }, reglas, variables);
    expect(r.monto).toBe(200000);
  });

  it('ejecuta una regla DECISION devolviendo errorCode', () => {
    const reglas: BenefitFormulaRule[] = [
      {
        id: 'reip-bajo',
        ...parseNewBenefitFormulaRule({
          formulaName: 'REIP bajo umbral',
          priority: 10,
          formula: '0',
          enabled: true,
          beneficiaryType: 'WORKER',
          periodicity: null,
          benefitType: 'NINGUNO',
          conditions: { gradoMin: 0 },
          ruleType: 'DECISION',
          action: {
            expr: 'grado < 15',
            result: { estado: 'DENEGADA', errorCode: 'REIP_BAJO_UMBRAL' },
          },
        }, variables),
      },
      ...DEFAULT_BENEFIT_FORMULAS,
    ];

    const r = ejecutarBenefitRules({ sbm: 1_000_000, grado: 10 }, reglas, variables);
    expect(r.errorCode).toBe('REIP_BAJO_UMBRAL');
    expect(r.estado).toBe('DENEGADA');
  });

  it('ejecuta una regla EFFECT', () => {
    const reglas: BenefitFormulaRule[] = [
      {
        id: 'audit',
        ...parseNewBenefitFormulaRule({
          formulaName: 'Auditoria',
          priority: 1,
          formula: '0',
          enabled: true,
          beneficiaryType: 'WORKER',
          periodicity: null,
          benefitType: 'NINGUNO',
          conditions: {},
          ruleType: 'EFFECT',
          action: { event: 'AUDITADO', targetState: 'REGISTRADO', audit: true },
        }, variables),
      },
      ...DEFAULT_BENEFIT_FORMULAS,
    ];
    const r = ejecutarBenefitRules({ sbm: 1_000_000, grado: 5 }, reglas, variables);
    expect(r.estado).toBe('REGISTRADO');
  });

  it('evalua expresiones booleanas del canal de decision', () => {
    expect(evaluarExprBooleana('grado >= 15', { input: { sbm: 0, grado: 20 }, conditions: {}, beneficiary: {} })).toBe(true);
    expect(evaluarExprBooleana('grado >= 15 AND hijos >= 2', {
      input: { sbm: 0, grado: 20 },
      conditions: {},
      beneficiary: { hijos: 1 },
    })).toBe(false);
    expect(evaluarExprBooleana('estado = ACTIVA', {
      conditions: {},
      beneficiary: { estado: 'ACTIVA' },
    })).toBe(true);
  });

  it('detecta overlap entre reglas habilitadas', () => {
    const overlaps = detectarOverlap(DEFAULT_BENEFIT_FORMULAS);
    const granInvalidez = DEFAULT_BENEFIT_FORMULAS.filter((r) => r.id.includes('gran-invalidez'))[0];
    const total = DEFAULT_BENEFIT_FORMULAS.filter((r) => r.id === 'total-pension')[0];
    expect(overlaps.some((o) => (o.a === granInvalidez.id && o.b === total.id)
      || (o.a === total.id && o.b === granInvalidez.id))).toBe(true);
  });

  it('acepta conditions enriquecidas (tipoPrestacion, afiliacionSalud)', () => {
    expect(() => parseNewBenefitFormulaRule({
      formulaName: 'FONASA',
      priority: 1,
      formula: 'sbm * 0.7',
      enabled: true,
      beneficiaryType: 'WORKER',
      periodicity: 'MENSUAL',
      benefitType: 'PENSION_TOTAL',
      conditions: { gradoMin: 70, afiliacionSalud: 'FONASA', tipoPrestacion: 'PENSION_TOTAL' },
    }, variables)).not.toThrow();
  });
});
