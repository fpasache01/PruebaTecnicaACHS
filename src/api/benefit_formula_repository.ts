import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  parseBenefitFormulaRule,
  parseFormulaVariable,
  sortFormulaRules,
  type BenefitFormulaConditions,
  type BenefitFormulaRule,
  type FormulaVariable,
  type NewBenefitFormulaRule,
} from '../domain/benefit/benefit_rules.js';
import type { Periodicidad, TipoBeneficio } from '../domain/benefit/benefit_types.js';

export interface BenefitFormulaRepository {
  listRules(): Promise<BenefitFormulaRule[]>;
  addRule(rule: NewBenefitFormulaRule): Promise<BenefitFormulaRule>;
  deleteRule(id: string): Promise<boolean>;
}

export interface FormulaVariableRepository {
  listVariables(): Promise<FormulaVariable[]>;
  upsertVariable(variable: FormulaVariable): Promise<FormulaVariable>;
}

export class PostgresBenefitFormulaRepository implements BenefitFormulaRepository, FormulaVariableRepository {
  private readonly pool: Pool;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    this.pool = new Pool({
      connectionString: databaseUrl,
    });
  }

  async listRules(): Promise<BenefitFormulaRule[]> {
    const result = await this.pool.query<BenefitFormulaRow>(`
      SELECT
        id::text,
        formula_name,
        priority,
        formula,
        enabled,
        beneficiary_type,
        periodicity,
        benefit_type,
        conditions
      FROM benefit_formulas
      ORDER BY priority ASC, id ASC
    `);

    return sortFormulaRules(result.rows.map(rowToFormulaRule));
  }

  async addRule(rule: NewBenefitFormulaRule): Promise<BenefitFormulaRule> {
    const parsedRule = rule;
    const result = await this.pool.query<BenefitFormulaRow>(
      `
        INSERT INTO benefit_formulas (
          formula_name,
          priority,
          formula,
          enabled,
          beneficiary_type,
          periodicity,
          benefit_type,
          conditions
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        RETURNING
          id::text,
          formula_name,
          priority,
          formula,
          enabled,
          beneficiary_type,
          periodicity,
          benefit_type,
          conditions
      `,
      [
        parsedRule.formulaName,
        parsedRule.priority,
        parsedRule.formula,
        parsedRule.enabled,
        parsedRule.beneficiaryType,
        parsedRule.periodicity,
        parsedRule.benefitType,
        JSON.stringify(parsedRule.conditions),
      ],
    );

    return rowToFormulaRule(result.rows[0]);
  }

  async deleteRule(id: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM benefit_formulas WHERE id = $1',
      [id],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async listVariables(): Promise<FormulaVariable[]> {
    const result = await this.pool.query<FormulaVariableRow>(`
      SELECT
        variable_name,
        data_type,
        source,
        enabled,
        description
      FROM formula_variables
      ORDER BY variable_name ASC
    `);

    return result.rows.map(rowToFormulaVariable);
  }

  async upsertVariable(variable: FormulaVariable): Promise<FormulaVariable> {
    const parsedVariable = parseFormulaVariable(variable);
    const result = await this.pool.query<FormulaVariableRow>(
      `
        INSERT INTO formula_variables (
          variable_name,
          data_type,
          source,
          enabled,
          description
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (variable_name) DO UPDATE SET
          data_type = EXCLUDED.data_type,
          source = EXCLUDED.source,
          enabled = EXCLUDED.enabled,
          description = EXCLUDED.description,
          updated_at = now()
        RETURNING
          variable_name,
          data_type,
          source,
          enabled,
          description
      `,
      [
        parsedVariable.variableName,
        parsedVariable.dataType,
        parsedVariable.source,
        parsedVariable.enabled,
        parsedVariable.description ?? null,
      ],
    );

    return rowToFormulaVariable(result.rows[0]);
  }
}

export class InMemoryBenefitFormulaRepository implements BenefitFormulaRepository, FormulaVariableRepository {
  constructor(
    private rules: BenefitFormulaRule[],
    private variables: FormulaVariable[],
  ) {}

  async listRules(): Promise<BenefitFormulaRule[]> {
    return sortFormulaRules(this.rules);
  }

  async addRule(rule: NewBenefitFormulaRule): Promise<BenefitFormulaRule> {
    const parsedRule = rule;
    const savedRule = parseBenefitFormulaRule({
      id: randomUUID(),
      ...parsedRule,
    }, this.variables);

    this.rules = sortFormulaRules([...this.rules, savedRule]);

    return savedRule;
  }

  async deleteRule(id: string): Promise<boolean> {
    const nextRules = this.rules.filter((rule) => rule.id !== id);
    const deleted = nextRules.length !== this.rules.length;

    this.rules = nextRules;
    return deleted;
  }

  async listVariables(): Promise<FormulaVariable[]> {
    return [...this.variables].sort((left, right) => left.variableName.localeCompare(right.variableName));
  }

  async upsertVariable(variable: FormulaVariable): Promise<FormulaVariable> {
    const parsedVariable = parseFormulaVariable(variable);
    const nextVariables = this.variables.filter(
      (candidate) => candidate.variableName !== parsedVariable.variableName,
    );

    this.variables = [...nextVariables, parsedVariable];

    return parsedVariable;
  }
}

interface BenefitFormulaRow {
  id: string;
  formula_name: string;
  priority: number;
  formula: string;
  enabled: boolean;
  beneficiary_type: string;
  periodicity: Periodicidad;
  benefit_type: TipoBeneficio;
  conditions: BenefitFormulaConditions;
}

interface FormulaVariableRow {
  variable_name: string;
  data_type: FormulaVariable['dataType'];
  source: string;
  enabled: boolean;
  description: string | null;
}

function rowToFormulaRule(row: BenefitFormulaRow): BenefitFormulaRule {
  return parseBenefitFormulaRule({
    id: row.id,
    formulaName: row.formula_name,
    priority: Number(row.priority),
    formula: row.formula,
    enabled: row.enabled,
    beneficiaryType: row.beneficiary_type,
    periodicity: row.periodicity,
    benefitType: row.benefit_type,
    conditions: row.conditions,
  }, undefined, { validateFormula: false });
}

function rowToFormulaVariable(row: FormulaVariableRow): FormulaVariable {
  return parseFormulaVariable({
    variableName: row.variable_name,
    dataType: row.data_type,
    source: row.source,
    enabled: row.enabled,
    description: row.description ?? undefined,
  });
}
