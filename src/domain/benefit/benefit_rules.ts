import { FACTORES_INDEMNIZACION } from './indemnity_factor_table.js';
import type {
  BenefitCalculationInput,
  Periodicidad,
  ResultadoBeneficio,
  TipoBeneficio,
} from './benefit_types.js';

export type FormulaDataType = 'numeric' | 'boolean' | 'text';

export type RuleType = 'FORMULA' | 'DECISION' | 'COMPOSITE' | 'MAPPING' | 'EFFECT';

export interface RuleAction {
  formula?: string;
  expr?: string;
  result?: {
    estado?: string;
    bloqueo?: boolean;
    errorCode?: string;
  };
  conceptos?: Array<{ rdnRef: string; sign: 1 | -1 }>;
  mappingName?: string;
  default?: unknown;
  event?: string;
  targetState?: string;
  audit?: boolean;
}

export interface FormulaVariable {
  variableName: string;
  dataType: FormulaDataType;
  source: string;
  enabled: boolean;
  description?: string;
}

export interface BenefitFormulaConditions {
  gradoMin?: number;
  gradoMaxExclusive?: number;
  granInvalidez?: boolean;
  tipoPrestacion?: string;
  edadMin?: number;
  edadMax?: number;
  afiliacionSalud?: string;
  tramoMin?: number;
  tramoMax?: number;
  estado?: string;
  hijos?: number;
  estadoCivil?: string;
  esIndependiente?: boolean;
  regimenPrevisional?: string;
  beneficiarioTipo?: string;
}

export interface NewBenefitFormulaRule {
  formulaName: string;
  priority: number;
  formula: string;
  enabled: boolean;
  beneficiaryType: string;
  periodicity: Periodicidad;
  benefitType: TipoBeneficio;
  conditions: BenefitFormulaConditions;
  ruleType?: RuleType;
  action?: RuleAction;
  description?: string;
}

export interface BenefitFormulaRule extends NewBenefitFormulaRule {
  id: string;
}

const RULE_TYPES = new Set<RuleType>(['FORMULA', 'DECISION', 'COMPOSITE', 'MAPPING', 'EFFECT']);

const BENEFIT_TYPES = new Set<TipoBeneficio>([
  'INDEMNIZACION',
  'PENSION_PARCIAL',
  'PENSION_TOTAL',
  'NINGUNO',
]);

const PERIODICITIES = new Set<Periodicidad>(['UNICO', 'MENSUAL', null]);
const DATA_TYPES = new Set<FormulaDataType>(['numeric', 'boolean', 'text']);
const RESERVED_WORDS = new Set(['case', 'when', 'then', 'else', 'end']);
const ALLOWED_FUNCTIONS = new Set(['round', 'min', 'max', 'sum', 'count']);

export const DEFAULT_FORMULA_VARIABLES: readonly FormulaVariable[] = [
  {
    variableName: 'sbm',
    dataType: 'numeric',
    source: 'calculation_input.sbm',
    enabled: true,
    description: 'Sueldo base mensual',
  },
  {
    variableName: 'grado',
    dataType: 'numeric',
    source: 'calculation_input.grado',
    enabled: true,
    description: 'Porcentaje de incapacidad',
  },
  {
    variableName: 'gran_invalidez',
    dataType: 'boolean',
    source: 'calculation_input.granInvalidez',
    enabled: true,
    description: 'Si aplica gran invalidez',
  },
  {
    variableName: 'factor',
    dataType: 'numeric',
    source: 'matched_formula.factor',
    enabled: true,
    description: 'Factor de la formula',
  },
];

export const DEFAULT_BENEFIT_FORMULAS: readonly BenefitFormulaRule[] = [
  {
    id: 'no-benefit',
    formulaName: 'Sin beneficio por incapacidad menor a 15%',
    priority: 100,
    formula: '0',
    enabled: true,
    beneficiaryType: 'WORKER',
    periodicity: null,
    benefitType: 'NINGUNO',
    conditions: {
      gradoMin: 0,
      gradoMaxExclusive: 15,
    },
  },
  ...FACTORES_INDEMNIZACION.map((factor, index): BenefitFormulaRule => ({
    id: `indemnity-factor-${String(factor.desde).replace('.', '-')}`,
    formulaName: `Factor de indemnización desde ${factor.desde}%`,
    priority: 110 + index,
    formula: `sbm * ${factor.factor}`,
    enabled: true,
    beneficiaryType: 'WORKER',
    periodicity: 'UNICO',
    benefitType: 'INDEMNIZACION',
    conditions: {
      gradoMin: factor.desde,
      gradoMaxExclusive: FACTORES_INDEMNIZACION[index + 1]?.desde ?? 40,
    },
  })),
  {
    id: 'partial-pension',
    formulaName: 'Pensión de invalidez parcial',
    priority: 200,
    formula: 'sbm * 0.35',
    enabled: true,
    beneficiaryType: 'WORKER',
    periodicity: 'MENSUAL',
    benefitType: 'PENSION_PARCIAL',
    conditions: {
      gradoMin: 40,
      gradoMaxExclusive: 70,
    },
  },
  {
    id: 'total-pension-gran-invalidez',
    formulaName: 'Pensión de invalidez total con gran invalidez',
    priority: 290,
    formula: 'sbm * 1',
    enabled: true,
    beneficiaryType: 'WORKER',
    periodicity: 'MENSUAL',
    benefitType: 'PENSION_TOTAL',
    conditions: {
      gradoMin: 70,
      granInvalidez: true,
    },
  },
  {
    id: 'total-pension',
    formulaName: 'Pensión de invalidez total',
    priority: 300,
    formula: 'sbm * 0.7',
    enabled: true,
    beneficiaryType: 'WORKER',
    periodicity: 'MENSUAL',
    benefitType: 'PENSION_TOTAL',
    conditions: {
      gradoMin: 70,
    },
  },
];

export function calculateBenefitFromFormulaRules(
  input: BenefitCalculationInput,
  rules: readonly BenefitFormulaRule[],
  variables: readonly FormulaVariable[] = DEFAULT_FORMULA_VARIABLES,
): ResultadoBeneficio {
  validateBenefitCalculationInput(input);

  const rule = sortFormulaRules(rules)
    .filter((candidate) => candidate.enabled)
    .find((candidate) => matchesFormulaRule(candidate, input));

  if (rule === undefined) {
    throw new RangeError('no matching benefit formula');
  }

  const variableContext = resolveFormulaContext(input, rule, variables);
  const monto = evaluateFormula(rule.formula, variableContext, variables);

  return {
    tipoBeneficio: rule.benefitType,
    monto,
    periodicidad: rule.periodicity,
  };
}

export interface BenefitRuleResult {
  tipoBeneficio: TipoBeneficio;
  monto: number;
  periodicidad: Periodicidad;
  estado?: string;
  errorCode?: string;
  reglaAplicada?: string;
}

export interface ContextoDecision {
  conditions: Record<string, unknown>;
  beneficiary?: Record<string, unknown>;
  input?: BenefitCalculationInput;
}

export function ejecutarBenefitRules(
  input: BenefitCalculationInput,
  rules: readonly BenefitFormulaRule[],
  variables: readonly FormulaVariable[] = DEFAULT_FORMULA_VARIABLES,
): BenefitRuleResult {
  validateBenefitCalculationInput(input);

  const rule = sortFormulaRules(rules)
    .filter((candidate) => candidate.enabled)
    .find((candidate) => matchesFormulaRule(candidate, input));

  if (rule === undefined) {
    throw new RangeError('no matching benefit formula');
  }

  const ruleType = rule.ruleType ?? 'FORMULA';

  if (ruleType === 'DECISION') {
    const decision = evaluarDecision(rule, input);
    return {
      tipoBeneficio: rule.benefitType,
      monto: 0,
      periodicidad: rule.periodicity,
      estado: decision.estado,
      errorCode: decision.errorCode,
      reglaAplicada: rule.id,
    };
  }

  if (ruleType === 'EFFECT') {
    return {
      tipoBeneficio: rule.benefitType,
      monto: 0,
      periodicidad: rule.periodicity,
      estado: rule.action?.targetState ?? 'EJECUTADO',
      reglaAplicada: rule.id,
    };
  }

  if (ruleType === 'MAPPING') {
    const contexto = resolveFormulaContext(input, rule, variables);
    const valor = rule.action?.default ?? contexto.mappingKey ?? 0;
    return {
      tipoBeneficio: rule.benefitType,
      monto: typeof valor === 'number' ? valor : 0,
      periodicidad: rule.periodicity,
      estado: 'MAPPED',
      reglaAplicada: rule.id,
    };
  }

  const variableContext = resolveFormulaContext(input, rule, variables);
  const monto = evaluateFormula(rule.formula, variableContext, variables);

  return {
    tipoBeneficio: rule.benefitType,
    monto,
    periodicidad: rule.periodicity,
    estado: 'CALCULADA',
    reglaAplicada: rule.id,
  };
}

function evaluarDecision(
  rule: BenefitFormulaRule,
  input: BenefitCalculationInput,
): { estado?: string; errorCode?: string } {
  const contexto: ContextoDecision = {
    conditions: rule.conditions as unknown as Record<string, unknown>,
    beneficiary: input.beneficiary ?? {},
    input,
  };
  const expr = rule.action?.expr ?? '';
  const resultado = evaluarExprBooleana(expr, contexto);
  if (resultado === true) {
    return {
      estado: rule.action?.result?.estado ?? 'CONFORME',
      errorCode: rule.action?.result?.errorCode,
    };
  }
  return {
    estado: 'NO_CUMPLE',
    errorCode: rule.action?.result?.errorCode,
  };
}

export function evaluarExprBooleana(expr: string, contexto: ContextoDecision): boolean {
  const trimmed = expr.trim();
  if (trimmed === '') return true;
  const context: Record<string, number | boolean | string> = {};
  for (const [clave, valor] of Object.entries(contexto.beneficiary ?? {})) {
    if (typeof valor === 'number' || typeof valor === 'boolean' || typeof valor === 'string') {
      context[clave] = valor;
    }
  }
  if (typeof contexto.input?.grado === 'number') context.grado = contexto.input.grado;
  if (contexto.input?.granInvalidez !== undefined) context.gran_invalidez = contexto.input.granInvalidez === true;

  const exprNormalizada = trimmed
    .replace(/\s*&&\s*/g, ' AND ')
    .replace(/\s*\|\|\s*/g, ' OR ')
    .replace(/\s*===\s*/g, ' = ')
    .replace(/\s*==\s*/g, ' = ')
    .replace(/\s*!=\s*/g, ' <> ')
    .replace(/\s*<=\s*/g, ' <= ')
    .replace(/\s*>=\s*/g, ' >= ');

  const partes = exprNormalizada.split(/\s+AND\s+|\s+OR\s+/i);
  const operadores = exprNormalizada.match(/\s+(AND|OR)\s+/gi) ?? [];

  const resultados = partes.map((parte) => evaluarComparacion(parte.trim(), context));
  let resultado = resultados[0] ?? false;
  for (let i = 0; i < operadores.length && i + 1 < resultados.length; i += 1) {
    const op = operadores[i].trim().toUpperCase();
    if (op === 'AND') resultado = resultado && resultados[i + 1];
    else resultado = resultado || resultados[i + 1];
  }
  return resultado;
}

function evaluarComparacion(expr: string, context: Record<string, number | boolean | string>): boolean {
  const m = expr.match(/^(.+?)\s*(<=|>=|<>|=|<|>)\s*(.+)$/);
  if (m === null) return Boolean(context[expr]);
  const izquierda = resolverValor(m[1].trim(), context);
  const derecha = resolverValor(m[3].trim(), context);
  const op = m[2];
  switch (op) {
    case '<': return (izquierda as number) < (derecha as number);
    case '>': return (izquierda as number) > (derecha as number);
    case '<=': return (izquierda as number) <= (derecha as number);
    case '>=': return (izquierda as number) >= (derecha as number);
    case '=': return izquierda === derecha;
    case '<>': return izquierda !== derecha;
    default: return false;
  }
}

function resolverValor(
  token: string,
  context: Record<string, number | boolean | string>,
): number | string | boolean {
  if (/^\d+(?:\.\d+)?$/.test(token)) return Number(token);
  const sinComillas = token.replace(/^['"]|['"]$/g, '');
  if (sinComillas !== token) return sinComillas;
  return context[token] ?? token;
}

export function detectarOverlap(rules: readonly BenefitFormulaRule[]): Array<{
  a: string;
  b: string;
  motivo: string;
}> {
  const habilitadas = rules.filter((rule) => rule.enabled);
  const solapamientos: Array<{ a: string; b: string; motivo: string }> = [];
  for (let i = 0; i < habilitadas.length; i += 1) {
    for (let j = i + 1; j < habilitadas.length; j += 1) {
      const a = habilitadas[i];
      const b = habilitadas[j];
      if (a.beneficiaryType !== b.beneficiaryType || a.benefitType !== b.benefitType) continue;
      const minA = a.conditions.gradoMin ?? 0;
      const maxA = a.conditions.gradoMaxExclusive ?? 100;
      const minB = b.conditions.gradoMin ?? 0;
      const maxB = b.conditions.gradoMaxExclusive ?? 100;
      const solapaGrado = minA < maxB && minB < maxA;
      const giA = a.conditions.granInvalidez;
      const giB = b.conditions.granInvalidez;
      const solapaGi = giA === undefined || giB === undefined || giA === giB;
      if (solapaGrado && solapaGi) {
        solapamientos.push({ a: a.id, b: b.id, motivo: 'condiciones de grado/granInvalidez se intersectan' });
      }
    }
  }
  return solapamientos;
}

export function sortFormulaRules(rules: readonly BenefitFormulaRule[]): BenefitFormulaRule[] {
  return [...rules].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return left.id.localeCompare(right.id);
  });
}

export function parseNewBenefitFormulaRule(
  value: unknown,
  variables: readonly FormulaVariable[] = DEFAULT_FORMULA_VARIABLES,
  options: { validateFormula?: boolean } = {},
): NewBenefitFormulaRule {
  if (value === null || typeof value !== 'object') {
    throw new RangeError('formula rule must be an object');
  }

  const candidate = value as Partial<NewBenefitFormulaRule>;

  if (typeof candidate.formulaName !== 'string' || candidate.formulaName.trim() === '') {
    throw new RangeError('formulaName must be a non-empty string');
  }

  if (!Number.isFinite(candidate.priority)) {
    throw new RangeError('priority must be a finite number');
  }

  if (candidate.ruleType !== undefined && !RULE_TYPES.has(candidate.ruleType)) {
    throw new RangeError('ruleType must be FORMULA, DECISION, COMPOSITE, MAPPING, or EFFECT');
  }

  const ruleType = candidate.ruleType ?? 'FORMULA';

  if (ruleType === 'FORMULA' && (typeof candidate.formula !== 'string' || candidate.formula.trim() === '')) {
    throw new RangeError('formula must be a non-empty string');
  }

  if (typeof candidate.formula !== 'string') {
    throw new RangeError('formula must be a string');
  }

  if (typeof candidate.enabled !== 'boolean') {
    throw new RangeError('enabled must be a boolean');
  }

  if (typeof candidate.beneficiaryType !== 'string' || candidate.beneficiaryType.trim() === '') {
    throw new RangeError('beneficiaryType must be a non-empty string');
  }

  if (!isTipoBeneficio(candidate.benefitType)) {
    throw new RangeError('benefitType must be a valid benefit type');
  }

  if (!PERIODICITIES.has(candidate.periodicity as Periodicidad)) {
    throw new RangeError('periodicity must be UNICO, MENSUAL, or null');
  }

  const conditions = parseConditions(candidate.conditions ?? {});
  if (options.validateFormula !== false && ruleType === 'FORMULA') {
    validateFormulaSyntax(candidate.formula, variables);
  }
  if (candidate.action !== undefined && !isRuleAction(candidate.action)) {
    throw new RangeError('action must be a valid rule action object');
  }

  if (candidate.description !== undefined && typeof candidate.description !== 'string') {
    throw new RangeError('description must be a string');
  }

  return {
    formulaName: candidate.formulaName,
    priority: candidate.priority as number,
    formula: candidate.formula,
    enabled: candidate.enabled,
    beneficiaryType: candidate.beneficiaryType,
    periodicity: candidate.periodicity as Periodicidad,
    benefitType: candidate.benefitType,
    conditions,
    ruleType,
    action: candidate.action,
    description: candidate.description,
  };
}

function isRuleAction(value: unknown): value is RuleAction {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const action = value as RuleAction;
  if (action.formula !== undefined && typeof action.formula !== 'string') return false;
  if (action.expr !== undefined && typeof action.expr !== 'string') return false;
  if (action.mappingName !== undefined && typeof action.mappingName !== 'string') return false;
  if (action.event !== undefined && typeof action.event !== 'string') return false;
  return true;
}

export function parseBenefitFormulaRule(
  value: unknown,
  variables: readonly FormulaVariable[] = DEFAULT_FORMULA_VARIABLES,
  options: { validateFormula?: boolean } = {},
): BenefitFormulaRule {
  if (value === null || typeof value !== 'object') {
    throw new RangeError('formula rule must be an object');
  }

  const candidate = value as Partial<BenefitFormulaRule>;

  if (typeof candidate.id !== 'string' || candidate.id.trim() === '') {
    throw new RangeError('id must be a non-empty string');
  }

  return {
    id: candidate.id,
    ...parseNewBenefitFormulaRule(candidate, variables, options),
  };
}

export function parseFormulaVariable(value: unknown): FormulaVariable {
  if (value === null || typeof value !== 'object') {
    throw new RangeError('formula variable must be an object');
  }

  const candidate = value as Partial<FormulaVariable>;

  if (typeof candidate.variableName !== 'string' || candidate.variableName.trim() === '') {
    throw new RangeError('variableName must be a non-empty string');
  }

  if (!isIdentifier(candidate.variableName)) {
    throw new RangeError('variableName must be a valid formula identifier');
  }

  if (!DATA_TYPES.has(candidate.dataType as FormulaDataType)) {
    throw new RangeError('dataType must be numeric, boolean, or text');
  }

  if (typeof candidate.source !== 'string' || candidate.source.trim() === '') {
    throw new RangeError('source must be a non-empty string');
  }

  if (!isSupportedVariableSource(candidate.source)) {
    throw new RangeError(`unsupported formula variable source: ${candidate.source}`);
  }

  if (typeof candidate.enabled !== 'boolean') {
    throw new RangeError('enabled must be a boolean');
  }

  if (candidate.description !== undefined && typeof candidate.description !== 'string') {
    throw new RangeError('description must be a string');
  }

  return {
    variableName: candidate.variableName,
    dataType: candidate.dataType as FormulaDataType,
    source: candidate.source,
    enabled: candidate.enabled,
    description: candidate.description,
  };
}

export function validateFormulaSyntax(
  formula: string,
  variables: readonly FormulaVariable[],
): void {
  const normalizedFormula = formula.trim();

  if (normalizedFormula === '') {
    throw new RangeError('formula must be a non-empty string');
  }

  if (/;|--|\/\*/.test(normalizedFormula)) {
    throw new RangeError('formula contains forbidden SQL syntax');
  }

  if (/\b(select|insert|update|delete|drop|alter|create|from|join|where)\b/i.test(normalizedFormula)) {
    throw new RangeError('formula contains forbidden SQL keyword');
  }

  const functionMatches = normalizedFormula.match(/[A-Za-z_][A-Za-z0-9_]*\s*\(/g) ?? [];
  for (const match of functionMatches) {
    const nombre = match.replace(/[^A-Za-z0-9_]/g, '');
    if (!ALLOWED_FUNCTIONS.has(nombre.toLowerCase())) {
      throw new RangeError(`formula function calls are not allowed: ${nombre}`);
    }
  }

  const enabledVariables = new Set(
    variables
      .filter((variable) => variable.enabled)
      .map((variable) => variable.variableName),
  );

  for (const identifier of extractIdentifiers(normalizedFormula)) {
    if (RESERVED_WORDS.has(identifier.toLowerCase())) {
      continue;
    }

    if (ALLOWED_FUNCTIONS.has(identifier.toLowerCase())) {
      continue;
    }

    if (!enabledVariables.has(identifier)) {
      throw new RangeError(`formula references unknown variable: ${identifier}`);
    }
  }

  const tokens = tokenizeFormula(normalizedFormula);
  const sampleContext = Object.fromEntries(
    variables
      .filter((variable) => variable.enabled)
      .map((variable) => [
        variable.variableName,
        variable.dataType === 'boolean' ? true : 1,
      ]),
  );

  new FormulaParser(tokens, sampleContext).parse();
}

function parseConditions(value: unknown): BenefitFormulaConditions {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RangeError('conditions must be an object');
  }

  const conditions = value as Partial<BenefitFormulaConditions>;

  if (conditions.gradoMin !== undefined && !Number.isFinite(conditions.gradoMin)) {
    throw new RangeError('conditions.gradoMin must be a finite number');
  }

  if (
    conditions.gradoMaxExclusive !== undefined
    && !Number.isFinite(conditions.gradoMaxExclusive)
  ) {
    throw new RangeError('conditions.gradoMaxExclusive must be a finite number');
  }

  if (
    conditions.gradoMin !== undefined
    && (conditions.gradoMin < 0 || conditions.gradoMin > 100)
  ) {
    throw new RangeError('conditions.gradoMin must be between 0 and 100');
  }

  if (
    conditions.gradoMaxExclusive !== undefined
    && (conditions.gradoMaxExclusive <= (conditions.gradoMin ?? 0) || conditions.gradoMaxExclusive > 100)
  ) {
    throw new RangeError('conditions.gradoMaxExclusive must be greater than gradoMin and less than or equal to 100');
  }

  if (conditions.granInvalidez !== undefined && typeof conditions.granInvalidez !== 'boolean') {
    throw new RangeError('conditions.granInvalidez must be a boolean');
  }

  for (const [clave, valor] of Object.entries({
    edadMin: conditions.edadMin,
    edadMax: conditions.edadMax,
    tramoMin: conditions.tramoMin,
    tramoMax: conditions.tramoMax,
    hijos: conditions.hijos,
  })) {
    if (valor !== undefined && !Number.isFinite(valor)) {
      throw new RangeError(`conditions.${clave} must be a finite number`);
    }
  }

  return {
    gradoMin: conditions.gradoMin,
    gradoMaxExclusive: conditions.gradoMaxExclusive,
    granInvalidez: conditions.granInvalidez,
    tipoPrestacion: conditions.tipoPrestacion,
    edadMin: conditions.edadMin,
    edadMax: conditions.edadMax,
    afiliacionSalud: conditions.afiliacionSalud,
    tramoMin: conditions.tramoMin,
    tramoMax: conditions.tramoMax,
    estado: conditions.estado,
    hijos: conditions.hijos,
    estadoCivil: conditions.estadoCivil,
    esIndependiente: conditions.esIndependiente,
    regimenPrevisional: conditions.regimenPrevisional,
    beneficiarioTipo: conditions.beneficiarioTipo,
  };
}

function validateBenefitCalculationInput(input: BenefitCalculationInput): void {
  if (!Number.isFinite(input.sbm)) {
    throw new RangeError('sbm must be a finite number');
  }

  if (input.sbm < 0) {
    throw new RangeError('sbm must be greater than or equal to 0');
  }

  if (!Number.isFinite(input.grado)) {
    throw new RangeError('grado must be a finite number');
  }

  if (input.grado < 0 || input.grado > 100) {
    throw new RangeError('grado must be between 0 and 100');
  }
}

function matchesFormulaRule(rule: BenefitFormulaRule, input: BenefitCalculationInput): boolean {
  const beneficiaryType = input.beneficiaryType ?? 'WORKER';

  if (rule.beneficiaryType !== beneficiaryType) {
    return false;
  }

  if (rule.conditions.gradoMin !== undefined && input.grado < rule.conditions.gradoMin) {
    return false;
  }

  if (
    rule.conditions.gradoMaxExclusive !== undefined
    && input.grado >= rule.conditions.gradoMaxExclusive
  ) {
    return false;
  }

  if (
    rule.conditions.granInvalidez !== undefined
    && rule.conditions.granInvalidez !== (input.granInvalidez === true)
  ) {
    return false;
  }

  const benef = input.beneficiary ?? {};
  if (
    rule.conditions.tipoPrestacion !== undefined
    && benef.tipoPrestacion !== rule.conditions.tipoPrestacion
  ) {
    return false;
  }

  if (
    rule.conditions.estado !== undefined
    && benef.estado !== rule.conditions.estado
  ) {
    return false;
  }

  if (
    rule.conditions.afiliacionSalud !== undefined
    && benef.afiliacionSalud !== rule.conditions.afiliacionSalud
  ) {
    return false;
  }

  if (
    rule.conditions.regimenPrevisional !== undefined
    && benef.regimenPrevisional !== rule.conditions.regimenPrevisional
  ) {
    return false;
  }

  if (rule.conditions.edadMin !== undefined && typeof benef.edad === 'number' && benef.edad < rule.conditions.edadMin) {
    return false;
  }

  if (rule.conditions.edadMax !== undefined && typeof benef.edad === 'number' && benef.edad > rule.conditions.edadMax) {
    return false;
  }

  if (rule.conditions.hijos !== undefined && benef.hijos !== rule.conditions.hijos) {
    return false;
  }

  if (rule.conditions.esIndependiente !== undefined && benef.esIndependiente !== rule.conditions.esIndependiente) {
    return false;
  }

  return true;
}

function resolveFormulaContext(
  input: BenefitCalculationInput,
  rule: BenefitFormulaRule,
  variables: readonly FormulaVariable[],
): Record<string, number | boolean | string> {
  const context: Record<string, number | boolean | string> = {};
  const usados = new Set(extractIdentifiers(rule.formula));

  for (const variable of variables.filter((candidate) => candidate.enabled)) {
    if (!usados.has(variable.variableName)) continue;
    context[variable.variableName] = resolveVariable(variable, input, rule);
  }

  return context;
}

function resolveVariable(
  variable: FormulaVariable,
  input: BenefitCalculationInput,
  rule: BenefitFormulaRule,
): number | boolean | string {
  if (variable.source === 'calculation_input.sbm') {
    return input.sbm;
  }

  if (variable.source === 'calculation_input.grado') {
    return input.grado;
  }

  if (variable.source === 'calculation_input.granInvalidez') {
    return input.granInvalidez === true;
  }

  if (variable.source === 'matched_formula.factor') {
    return extractMultiplierFactor(rule.formula);
  }

  if (variable.source.startsWith('beneficiary.') || variable.source.startsWith('ficha.')) {
    const prefijo = variable.source.startsWith('beneficiary.') ? 'beneficiary.' : 'ficha.';
    const key = variable.source.slice(prefijo.length);
    const value = input.beneficiary?.[key];

    if (value === undefined) {
      throw new RangeError(`missing beneficiary variable: ${variable.variableName}`);
    }

    return value as number | boolean | string;
  }

  if (variable.source === 'prestacion.sbp' || variable.source === 'prestacion.monto') {
    return input.sbm;
  }

  if (variable.source.startsWith('indicators.') || variable.source.startsWith('parametros.') || variable.source.startsWith('rule.')) {
    throw new RangeError(
      `variable source ${variable.source} requires the PPEE pipeline / rule engine context`,
    );
  }

  throw new RangeError(`unsupported formula variable source: ${variable.source}`);
}

function evaluateFormula(
  formula: string,
  context: Record<string, number | boolean | string>,
  variables: readonly FormulaVariable[],
): number {
  validateFormulaSyntax(formula, variables);

  const parser = new FormulaParser(tokenizeFormula(formula), context);
  const result = parser.parse();

  if (!Number.isFinite(result)) {
    throw new RangeError('formula result must be a finite number');
  }

  return result;
}

function tokenizeFormula(formula: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < formula.length) {
    const char = formula[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[()+\-*/,]/.test(char)) {
      tokens.push(char);
      index += 1;
      continue;
    }

    const numberMatch = formula.slice(index).match(/^\d+(?:\.\d+)?/);
    if (numberMatch !== null) {
      tokens.push(numberMatch[0]);
      index += numberMatch[0].length;
      continue;
    }

    const identifierMatch = formula.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifierMatch !== null) {
      tokens.push(identifierMatch[0]);
      index += identifierMatch[0].length;
      continue;
    }

    throw new RangeError(`formula contains unsupported token: ${char}`);
  }

  return tokens;
}

class FormulaParser {
  private index = 0;

  constructor(
    private readonly tokens: readonly string[],
    private readonly context: Record<string, number | boolean | string>,
  ) {}

  parse(): number {
    const result = this.parseExpression();

    if (this.index !== this.tokens.length) {
      throw new RangeError('formula contains trailing tokens');
    }

    return result;
  }

  private parseExpression(): number {
    let result = this.parseTerm();

    while (this.peek() === '+' || this.peek() === '-') {
      const operator = this.consume();
      const right = this.parseTerm();
      result = operator === '+' ? result + right : result - right;
    }

    return result;
  }

  private parseTerm(): number {
    let result = this.parseFactor();

    while (this.peek() === '*' || this.peek() === '/') {
      const operator = this.consume();
      const right = this.parseFactor();
      result = operator === '*' ? result * right : result / right;
    }

    return result;
  }

  private parseFactor(): number {
    const token = this.consume();

    if (token === '-') {
      return -this.parseFactor();
    }

    if (token === '(') {
      const value = this.parseExpression();

      if (this.consume() !== ')') {
        throw new RangeError('formula contains unmatched parenthesis');
      }

      return value;
    }

    if (/^\d+(?:\.\d+)?$/.test(token)) {
      return Number(token);
    }

    if (isIdentifier(token)) {
      if (ALLOWED_FUNCTIONS.has(token.toLowerCase()) && this.peek() === '(') {
        return this.parseFunction(token.toLowerCase());
      }

      if (!(token in this.context)) {
        throw new RangeError(`formula variable is not resolved: ${token}`);
      }

      const value = this.context[token];

      if (typeof value === 'number') {
        return value;
      }

      if (typeof value === 'boolean') {
        return value ? 1 : 0;
      }

      throw new RangeError(`formula variable must be numeric: ${token}`);
    }

    throw new RangeError(`formula contains invalid token: ${token}`);
  }

  private parseFunction(nombre: string): number {
    this.consume(); // '('
    const args: number[] = [];

    if (this.peek() !== ')') {
      args.push(this.parseExpression());
      while (this.peek() === ',') {
        this.consume();
        args.push(this.parseExpression());
      }
    }

    if (this.consume() !== ')') {
      throw new RangeError(`formula function ${nombre} has unmatched parenthesis`);
    }

    switch (nombre) {
      case 'round':
        if (args.length < 1) throw new RangeError('round requires 1 argument');
        return Math.round(args[0]);
      case 'min':
        return Math.min(...args);
      case 'max':
        return Math.max(...args);
      case 'sum':
        return args.reduce((a, b) => a + b, 0);
      case 'count':
        return args.length;
      default:
        throw new RangeError(`unsupported formula function: ${nombre}`);
    }
  }

  private peek(): string | undefined {
    return this.tokens[this.index];
  }

  private consume(): string {
    const token = this.tokens[this.index];

    if (token === undefined) {
      throw new RangeError('formula ended unexpectedly');
    }

    this.index += 1;
    return token;
  }
}

function extractIdentifiers(formula: string): string[] {
  return formula.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
}

function extractMultiplierFactor(formula: string): number {
  const match = formula.match(/^sbm\s*\*\s*(\d+(?:\.\d+)?)$/);
  return match === null ? 0 : Number(match[1]);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function isSupportedVariableSource(source: string): boolean {
  return source === 'calculation_input.sbm'
    || source === 'calculation_input.grado'
    || source === 'calculation_input.granInvalidez'
    || source === 'matched_formula.factor'
    || source.startsWith('beneficiary.')
    || source.startsWith('ficha.')
    || source.startsWith('prestacion.')
    || source.startsWith('indicators.')
    || source.startsWith('parametros.')
    || source.startsWith('rule.');
}

function isTipoBeneficio(value: unknown): value is TipoBeneficio {
  return typeof value === 'string' && BENEFIT_TYPES.has(value as TipoBeneficio);
}
