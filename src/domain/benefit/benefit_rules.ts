import { FACTORES_INDEMNIZACION } from './indemnity_factor_table.js';
import type {
  BenefitCalculationInput,
  Periodicidad,
  ResultadoBeneficio,
  TipoBeneficio,
} from './benefit_types.js';

export type FormulaDataType = 'numeric' | 'boolean' | 'text';

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
}

export interface BenefitFormulaRule extends NewBenefitFormulaRule {
  id: string;
}

const BENEFIT_TYPES = new Set<TipoBeneficio>([
  'INDEMNIZACION',
  'PENSION_PARCIAL',
  'PENSION_TOTAL',
  'NINGUNO',
]);

const PERIODICITIES = new Set<Periodicidad>(['UNICO', 'MENSUAL', null]);
const DATA_TYPES = new Set<FormulaDataType>(['numeric', 'boolean', 'text']);
const RESERVED_WORDS = new Set(['case', 'when', 'then', 'else', 'end']);

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
    description: 'Incapacity percentage',
  },
  {
    variableName: 'gran_invalidez',
    dataType: 'boolean',
    source: 'calculation_input.granInvalidez',
    enabled: true,
    description: 'Whether gran invalidez applies',
  },
  {
    variableName: 'factor',
    dataType: 'numeric',
    source: 'matched_formula.factor',
    enabled: true,
    description: 'Formula-specific factor',
  },
];

export const DEFAULT_BENEFIT_FORMULAS: readonly BenefitFormulaRule[] = [
  {
    id: 'no-benefit',
    formulaName: 'No benefit below 15%',
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
    formulaName: `Indemnity factor from ${factor.desde}%`,
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
    formulaName: 'Partial disability pension',
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
    formulaName: 'Total disability pension with gran invalidez',
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
    formulaName: 'Total disability pension',
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

  if (typeof candidate.formula !== 'string' || candidate.formula.trim() === '') {
    throw new RangeError('formula must be a non-empty string');
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
  if (options.validateFormula !== false) {
    validateFormulaSyntax(candidate.formula, variables);
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
  };
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

  if (/[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(normalizedFormula)) {
    throw new RangeError('formula function calls are not allowed');
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

  return {
    gradoMin: conditions.gradoMin,
    gradoMaxExclusive: conditions.gradoMaxExclusive,
    granInvalidez: conditions.granInvalidez,
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

  return true;
}

function resolveFormulaContext(
  input: BenefitCalculationInput,
  rule: BenefitFormulaRule,
  variables: readonly FormulaVariable[],
): Record<string, number | boolean | string> {
  const context: Record<string, number | boolean | string> = {};

  for (const variable of variables.filter((candidate) => candidate.enabled)) {
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

  if (variable.source.startsWith('beneficiary.')) {
    const key = variable.source.slice('beneficiary.'.length);
    const value = input.beneficiary?.[key];

    if (value === undefined) {
      throw new RangeError(`missing beneficiary variable: ${variable.variableName}`);
    }

    return value as number | boolean | string;
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

    if (/[()+\-*/]/.test(char)) {
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
    || source.startsWith('beneficiary.');
}

function isTipoBeneficio(value: unknown): value is TipoBeneficio {
  return typeof value === 'string' && BENEFIT_TYPES.has(value as TipoBeneficio);
}
