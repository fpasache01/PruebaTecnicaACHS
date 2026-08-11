import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDirectory, '..');
const REGLAS_DIR = join(repoRoot, 'sdd', 'dominio', 'reglas');
const OUT_PATH = join(repoRoot, 'data', 'rdn_seed.json');

type RuleType = 'FORMULA' | 'DECISION' | 'COMPOSITE' | 'MAPPING' | 'EFFECT';

interface RdnSeed {
  id: string;
  ruleType: RuleType;
  formulaName: string;
  description: string;
  formula: string;
  enabled: boolean;
  beneficiaryType: string;
  periodicity: string | null;
  benefitType: string;
  conditions: Record<string, unknown>;
  action: Record<string, unknown>;
}

const FORMULAS_CONOCIDAS: Record<string, { formula: string; action?: Record<string, unknown> }> = {
  'CALC-OTG-005': { formula: 'sbp * factor' },
  'CALC-OTG-002': { formula: 'sbp', action: { concepto: 'Sueldo base para pension' } },
  'CALC-OTG-003': { formula: 'pension_base + incremento_art41', action: { conceptos: [{ rdnRef: 'CALC-OTG-002', sign: 1 }] } },
  'CALC-OTG-004': { formula: 'pension * 24' },
  'CALC_PIM_001': { formula: 'sbp * 0.7' },
  'CALC_PIM_002': { formula: 'sbp * 0.35' },
  'CALC_PIM_003': { formula: 'sbp * 0.05 * max(0, hijos - 2)' },
  'CALC_PIM_004': { formula: 'monto_base * 0.30' },
  'CALC_PIM_005': { formula: 'monto_base + incremento_art41 + suplemento_gi' },
  'CALC_PLI_001': { formula: 'round(imponible * 0.07)' },
  'CALC_PLI_003': { formula: 'round(imponible * 0.10)' },
  'CALC_PLI_004': { formula: 'max(0, minimo + estandar - pension)' },
  'CALC_PLI_006': { formula: 'round(imponible * tasa_fondo)' },
  'CALC_PLI_009': { formula: 'round(imponible * comision_afp)' },
  'CALC_PLI_010': { formula: 'round(monto)' },
  'CALC_PLI_011': { formula: 'pension - cotizaciones - descuentos' },
  'CALC_PLI_012': { formula: 'round(monto, 0)' },
  'CALC_PLI_013': { formula: 'min(monto, tope)' },
  'CALC-ASIGFAM-001': { formula: 'tramo_asignacion_familiar' },
  'CALC-MANT-001': { formula: 'pension * (1 + ipc)' },
  'CALC-MANT-002': { formula: 'max(pension, pension_base)' },
  'CALC-MANT-003': { formula: 'sum(pensiones)' },
  'DESC-LEG-002': { formula: 'round(imponible * tasa_afp)' },
  'APLICA-RETENCION-001': { formula: 'min(retencion, liquido * 0.5)', action: { concepto: 'Retencion judicial tope 50%' } },
};

const ACCIONES_DECISION: Record<string, { expr: string; result: Record<string, unknown> }> = {
  'CUMP-OTG-001': { expr: 'grado >= 15', result: { estado: 'CONFORME' } },
  'CUMP-OTG-002': { expr: 'estado = ACTIVA', result: { estado: 'CONFORME' } },
  'CUMP-OTG-003': { expr: 'dias <= plazo', result: { estado: 'CONFORME' } },
  'CUMP-OTG-005': { expr: 'fecha <= fecha_limite', result: { estado: 'CONFORME' } },
  'VALID-ACUERDO-001': { expr: 'acuerdo_valido = true', result: { estado: 'CONFORME' } },
  'VALID-ACUERDO-002': { expr: 'acuerdo_vigente = true', result: { estado: 'CONFORME' } },
  'VALID-ACUERDO-003': { expr: 'retencion <= 50', result: { estado: 'CONFORME', errorCode: 'EXCESO_PAGO' } },
  'VALID-EMP-001': { expr: 'empleador_afiliado = true', result: { estado: 'CONFORME' } },
  'VALID-LEGAL-001': { expr: 'marco_vigente = true', result: { estado: 'CONFORME' } },
  'VALID-MANT-001': { expr: 'vigencia_ok = true', result: { estado: 'CONFORME' } },
  'VALID-MANT-002': { expr: 'revision_ok = true', result: { estado: 'CONFORME' } },
  'VALID-OTG-001': { expr: 'requisitos = true', result: { estado: 'CONFORME' } },
  'VALID-OTG-002': { expr: 'no_duplicado = true', result: { estado: 'CONFORME', errorCode: 'RECHAZADO_DUPLICADO' } },
  'VALID-PAGO-001': { expr: 'beneficiario_valido = true', result: { estado: 'CONFORME' } },
  'VALID-PAGO-002': { expr: 'pago_autorizado = true', result: { estado: 'CONFORME' } },
  'VALID-SOBREV-001': { expr: 'beneficiarios > 0', result: { estado: 'CONFORME', errorCode: 'SOBREVIVENCIA_SIN_BENEFICIARIOS' } },
  'CICLO-CESE-001': { expr: 'edad < 65', result: { estado: 'VIGENTE' } },
  'CICLO-CESE-002': { expr: 'vinculo_vigente = true', result: { estado: 'VIGENTE' } },
};

function ruleTypeDe(id: string): RuleType {
  if (/^CALC-PLI|^CALC_PLI/.test(id)) return 'FORMULA';
  if (/^CALC-REP|^CALC-FIN|^FIN|^MAP/.test(id)) return 'MAPPING';
  if (/^COMM/.test(id)) return 'EFFECT';
  if (/^VALID|^CUMP|^CICLO|^APLICA/.test(id)) return 'DECISION';
  return 'FORMULA';
}

function main(): void {
  const archivos = readdirSync(REGLAS_DIR)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => !['README.md', 'AGENTS.md', 'plantilla.md'].includes(f))
    .sort();

  const seeds: RdnSeed[] = [];

  for (const archivo of archivos) {
    const id = archivo.replace(/\.md$/, '');
    const contenido = readFileSync(join(REGLAS_DIR, archivo), 'utf8');
    const ruleType = ruleTypeDe(id);

    let formula = '';
    let action: Record<string, unknown> = {};

    if (ruleType === 'FORMULA' && FORMULAS_CONOCIDAS[id]) {
      formula = FORMULAS_CONOCIDAS[id].formula;
      action = FORMULAS_CONOCIDAS[id].action ?? {};
    } else if (ruleType === 'DECISION' && ACCIONES_DECISION[id]) {
      action = ACCIONES_DECISION[id] as unknown as Record<string, unknown>;
    } else if (ruleType === 'EFFECT') {
      action = {
        event: `${id}_EJECUTADO`,
        targetState: 'REGISTRADO',
        audit: true,
      };
    } else if (ruleType === 'MAPPING') {
      action = { mappingName: `MAP_${id}`, default: 0 };
    } else {
      formula = '0';
    }

    if (formula === '' && ruleType === 'FORMULA') {
      const formulaDoc = extraerFormulaDeDocumento(contenido);
      formula = formulaDoc ?? '0';
    }

    const descripcion = extraerTituloEspanol(contenido, id);

    seeds.push({
      id,
      ruleType,
      formulaName: id,
      description: descripcion,
      formula,
      enabled: true,
      beneficiaryType: 'WORKER',
      periodicity: null,
      benefitType: 'NINGUNO',
      conditions: {},
      action,
    });
  }

  const output = { total: seeds.length, rdn: seeds };
  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Seed RDN: ${seeds.length} reglas -> ${OUT_PATH}`);
  const porTipo = seeds.reduce<Record<string, number>>((acc, s) => {
    acc[s.ruleType] = (acc[s.ruleType] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Por tipo: ${JSON.stringify(porTipo)}`);
}

function extraerTituloEspanol(contenido: string, id: string): string {
  const primera = contenido.split('\n')[0] ?? '';
  const titulo = primera
    .replace(/^#+\s*/, '')
    .replace(/^(?:RDN\s*:\s*)?[A-Z0-9-]+(\s*[-:—]\s*)?/i, '')
    .trim();
  if (titulo !== '' && titulo !== id) return titulo;
  return extraerProposito(contenido);
}

function extraerProposito(contenido: string): string {
  const m = contenido.match(/## Propósito\n\n([^\n]+)/);
  if (m) return m[1].trim().slice(0, 90);
  const m2 = contenido.match(/- \*\*Propósito\*\*: ([^\n]+)/);
  if (m2) return m2[1].trim().slice(0, 90);
  return '';
}

function extraerFormulaDeDocumento(contenido: string): string | null {
  const m = contenido.match(/formula\s*[:=]\s*([^\n]+)/i);
  return m ? m[1].trim() : null;
}

main();
