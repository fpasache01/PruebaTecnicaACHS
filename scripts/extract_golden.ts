import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDirectory, '..');
const HTML_PATH = join(repoRoot, 'sdd', 'dominio', 'golden_dataset_pec267.html');
const OUT_PATH = join(repoRoot, 'data', 'golden_dataset.json');

interface RentasRow {
  periodo: string;
  imponible: number | string;
  dias: number;
  regimen: string;
}

interface Criterio {
  texto: string;
  valor?: number;
  tolerancia?: number;
}

interface GoldenCaso {
  id: string;
  seccion: string;
  fuente: string;
  dificultad: string;
  tipo: string;
  estado: string;
  escenario: string;
  entrada: Record<string, number | string>;
  rentas: RentasRow[];
  esperado: Record<string, number | string>;
  esperado_texto: string;
  criterios_pasa: Criterio[];
  criterios_falla: Criterio[];
  trazabilidad_negocio: {
    principal: string;
    secundarios: string[];
    tipo_relacion: string;
    confianza: string;
    criterio: string;
  };
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  ndash: '–',
  mdash: '—',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  uuml: 'ü',
  agrave: 'à',
  egrave: 'è',
  igrave: 'ì',
  ograve: 'ò',
  ugrave: 'ù',
  '39': "'",
  '#39': "'",
  '#8211': '–',
  '#8212': '—',
  '#8226': '•',
  '#8364': '€',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z0-9]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return ENTITIES[entity] ?? match;
  });
}

function innerText(html: string): string {
  const withoutTags = html.replace(/<[^>]*>/g, ' ');
  return decodeEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

function normKey(txt: string): string {
  return txt.trim().toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9áéíóúñü]+/gi, '_')
    .replace(/^_+|_+$/g, '');
}

function parseMonto(txt: string): number | string {
  const s = txt.replace(/\./g, '').replace(/\$/g, '').replace(/±.*/, '').trim();
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? txt.trim() : n;
}

function parseReip(txt: string): number | string {
  const m = txt.match(/([\d.]+)\s*%/);
  return m ? Number.parseFloat(m[1]) : txt.trim();
}

function stripTag(html: string): string {
  return html.replace(/^<[^>]*>/, '').replace(/<\/[^>]*>$/, '');
}

interface TagToken {
  type: 'open' | 'close' | 'selfclose' | 'text';
  tag?: string;
  raw?: string;
  text?: string;
}

function tokenizeRow(html: string): TagToken[] {
  const tokens: TagToken[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      const text = html.slice(i);
      if (text.trim() !== '') tokens.push({ type: 'text', text });
      break;
    }
    if (lt > i) {
      const text = html.slice(i, lt);
      if (text.trim() !== '') tokens.push({ type: 'text', text });
    }
    const gt = html.indexOf('>', lt);
    if (gt === -1) {
      tokens.push({ type: 'text', text: html.slice(lt) });
      break;
    }
    const rawTag = html.slice(lt, gt + 1);
    const tagContent = html.slice(lt + 1, gt);
    const isClosing = tagContent.startsWith('/');
    const isSelfClosing = tagContent.endsWith('/') || /^(br|hr|img|input|meta|link)(\s|$)/i.test(tagContent);
    const tagName = tagContent.replace(/^\/|\/$/g, '').split(/[\s>/]/)[0].toLowerCase();
    if (!isClosing && !isSelfClosing) {
      tokens.push({ type: 'open', tag: tagName, raw: rawTag });
    } else if (isClosing) {
      tokens.push({ type: 'close', tag: tagName, raw: rawTag });
    }
    i = gt + 1;
  }
  return tokens;
}

interface TopLevelCell {
  html: string;
  text: string;
}

function extractTopLevelCells(rowHtml: string): TopLevelCell[] {
  const tokens = tokenizeRow(rowHtml);
  const cells: TopLevelCell[] = [];
  let tableDepth = 0;
  let current: string[] | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === 'open' && token.tag === 'table') {
      tableDepth += 1;
      if (current !== null) current.push(`<${token.tag}>`);
      continue;
    }
    if (token.type === 'close' && token.tag === 'table') {
      tableDepth -= 1;
      if (current !== null) current.push(`</${token.tag}>`);
      continue;
    }
    if (token.type === 'open' && token.tag === 'td' && tableDepth === 0 && current === null) {
      current = [`<td>`];
      continue;
    }
    if (token.type === 'close' && token.tag === 'td' && tableDepth === 0 && current !== null) {
      const html = current.join('');
      cells.push({ html, text: innerText(html) });
      current = null;
      continue;
    }
    if (current !== null) {
      if (token.type === 'open') current.push(token.raw ?? `<${token.tag}>`);
      else if (token.type === 'close') current.push(token.raw ?? `</${token.tag}>`);
      else current.push(token.text ?? '');
    }
  }

  return cells;
}

function extractRows(html: string): string[] {
  const rows: string[] = [];
  let index = 0;
  while (index < html.length) {
    const rowStart = html.indexOf('<tr class="dr', index);
    if (rowStart === -1) break;
    let depth = 0;
    let i = rowStart;
    let end = -1;
    while (i < html.length) {
      const open = html.indexOf('<tr', i);
      const close = html.indexOf('</tr>', i);
      if (open === -1 && close === -1) break;
      if (open !== -1 && (close === -1 || open < close)) {
        depth += 1;
        i = open + 3;
      } else {
        depth -= 1;
        i = close + 5;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    rows.push(html.slice(rowStart, end));
    index = end;
  }
  return rows;
}

function extractAttrs(openTag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of openTag.matchAll(/([a-zA-Z0-9_-]+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function extraerEntrada(cellText: string): Record<string, number | string> {
  const entrada: Record<string, number | string> = {};
  const expIndex = cellText.indexOf('Parámetros de entrada');
  if (expIndex === -1) return entrada;
  return entrada;
}

function parseEntradaTable(cellHtml: string): Record<string, number | string> {
  const entrada: Record<string, number | string> = {};
  const firstTable = extractFirstTable(cellHtml);
  if (firstTable === null) return entrada;
  for (const rowHtml of extractTableRows(firstTable)) {
    const cells = extractRowCells(rowHtml);
    if (cells.length < 2) continue;
    const k = normKey(innerText(cells[0]));
    const raw = innerText(cells[1]);
    if (!k) continue;
    if (/imponible|monto|sbp|pbc|pagado|imnr|indem|pension/.test(k)) {
      entrada[k] = parseMonto(raw);
    } else if (/reip|incapacidad/.test(k)) {
      entrada[k] = parseReip(raw);
    } else {
      entrada[k] = raw;
    }
  }
  return entrada;
}

function parseRentasTable(cellHtml: string): RentasRow[] {
  const tables = extractAllTables(cellHtml);
  if (tables.length < 2) return [];
  const rentas: RentasRow[] = [];
  for (const rowHtml of extractTableRows(tables[1]).slice(1)) {
    const cells = extractRowCells(rowHtml);
    if (cells.length < 3) continue;
    const dias = Number.parseInt(innerText(cells[2]), 10);
    rentas.push({
      periodo: innerText(cells[0]),
      imponible: parseMonto(innerText(cells[1])),
      dias: Number.isNaN(dias) ? 30 : dias,
      regimen: cells[3] ? innerText(cells[3]) : 'AFP_STD',
    });
  }
  return rentas;
}

function extractFirstTable(html: string): string | null {
  const tables = extractAllTables(html);
  return tables.length > 0 ? tables[0] : null;
}

function extractAllTables(html: string): string[] {
  const tables: string[] = [];
  const tokens = tokenizeRow(html);
  const stack: number[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type === 'open' && token.tag === 'table') {
      stack.push(i);
    } else if (token.type === 'close' && token.tag === 'table' && stack.length > 0) {
      const start = stack.pop() as number;
      tables.push(serializeTokens(tokens.slice(start, i + 1)));
    }
    i += 1;
  }
  return tables;
}

function serializeTokens(tokens: TagToken[]): string {
  let out = '';
  for (const token of tokens) {
    if (token.type === 'open') out += token.raw ?? `<${token.tag}>`;
    else if (token.type === 'close') out += token.raw ?? `</${token.tag}>`;
    else out += token.text ?? '';
  }
  return out;
}

function extractTableRows(tableHtml: string): string[] {
  const rows: string[] = [];
  const tokens = tokenizeRow(tableHtml);
  let trDepth = 0;
  let current: string[] | null = null;
  for (const token of tokens) {
    if (token.type === 'open' && token.tag === 'tr') {
      if (trDepth === 0) current = [];
      trDepth += 1;
      if (current !== null) current.push('<tr>');
    } else if (token.type === 'close' && token.tag === 'tr') {
      trDepth -= 1;
      if (current !== null) current.push('</tr>');
      if (trDepth === 0 && current !== null) {
        rows.push(current.join(''));
        current = null;
      }
    } else if (current !== null) {
      if (token.type === 'open') current.push(token.raw ?? `<${token.tag}>`);
      else if (token.type === 'close') current.push(token.raw ?? `</${token.tag}>`);
      else current.push(token.text ?? '');
    }
  }
  return rows;
}

function extractRowCells(trHtml: string): string[] {
  const cells: string[] = [];
  const tokens = tokenizeRow(trHtml);
  let current: string[] | null = null;
  for (const token of tokens) {
    if (token.type === 'open' && token.tag === 'td') {
      current = [];
    } else if (token.type === 'close' && token.tag === 'td' && current !== null) {
      cells.push(current.join(''));
      current = null;
    } else if (current !== null) {
      if (token.type === 'open') current.push(token.raw ?? `<${token.tag}>`);
      else if (token.type === 'close') current.push(token.raw ?? `</${token.tag}>`);
      else current.push(token.text ?? '');
    }
  }
  return cells;
}

function extraerEsperado(cellHtml: string, cellText: string): Record<string, number | string> {
  const esperado: Record<string, number | string> = {};
  const txt = cellText;

  const sbp = txt.match(/SBP[^=]+=\s*\$?([\d.]+)/i);
  if (sbp) esperado.sbp = parseMonto(sbp[1]);

  const factor = txt.match(/factor[^=]+=\s*([\d.]+)/i);
  if (factor) esperado.factor_sueldos = Number.parseFloat(factor[1]);

  const montoIndem = txt.match(/monto\s*(?:único|indem[a-z]*)[^=]*=\s*\$?([\d.]+)/i);
  if (montoIndem) esperado.monto_indem = parseMonto(montoIndem[1]);

  const montoIndemnizacion = txt.match(/montoIndemnizacion\s*\$?([\d.]+)/i);
  if (montoIndemnizacion) esperado.monto_indem = parseMonto(montoIndemnizacion[1]);

  const tipo = txt.match(/tipo[Pp]resta[a-z]*=([A-Z_]+)/);
  if (tipo) esperado.tipo_prestacion = tipo[1];

  const tipoSpace = txt.match(/tipoPrestacion\s+([A-Z_]+)/);
  if (tipoSpace) esperado.tipo_prestacion = tipoSpace[1];

  const pensionMensual = txt.match(/monto\s+mensual\s*=\s*\$?([\d.]+)/i);
  if (pensionMensual) esperado.pension_mensual = parseMonto(pensionMensual[1]);

  const liquido = txt.match(/líquido\s+final\s*=\s*\$?([\d.]+)/i);
  if (liquido) esperado.liquido_final = parseMonto(liquido[1]);

  const pisoImnr = txt.match(/piso\s+IMNR\s*=\s*\$?([\d.]+)/i);
  if (pisoImnr) esperado.piso_imnr = parseMonto(pisoImnr[1]);

  const neto = txt.match(/neto\s*=\s*\$?([\d.]+)/i);
  if (neto) esperado.neto_primer_pago = parseMonto(neto[1]);

  const sbpReip = txt.match(/SBP en periodo REIP[^=]*=\s*\$?([\d.]+)/i);
  if (sbpReip) esperado.sbp_reip = parseMonto(sbpReip[1]);

  const codigo = txt.match(/código\s+([A-Z0-9_-]+)/i)
    ?? txt.match(/(?:motivo|denegado)[^=]*=\s*([A-Z0-9_-]+)/i)
    ?? txt.match(/\b(EXD-[A-Z0-9-]+|REIP_[A-Z0-9_]+|ERROR_[A-Z0-9_]+|RECHAZADO_[A-Z0-9_]+|DEUDA_[A-Z0-9_]+)\b/i);
  if (codigo) esperado.error_code = codigo[1].toUpperCase();

  const denegado = txt.match(/tipoPrestacion\s+(DENEGADO)/i);
  if (denegado) esperado.tipo_prestacion = 'NINGUNO';

  return esperado;
}

function extraerCriterios(cellHtml: string): { pasa: Criterio[]; falla: Criterio[] } {
  const pasa: Criterio[] = [];
  const falla: Criterio[] = [];
  let inPasa = false;

  const tagRegex = /<(span|li)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(cellHtml)) !== null) {
    const tag = match[1];
    const body = match[2];
    if (tag === 'span') {
      const openTagMatch = match[0].match(/^<span[^>]*class="([^"]*)"/);
      inPasa = openTagMatch ? openTagMatch[1].includes('pasa') : false;
    } else if (tag === 'li') {
      const txt = innerText(body).trim();
      if (!txt) continue;
      const m = txt.match(/\$?([\d.]+)\s*\(±\s*\$?(\d+)\)/);
      if (m && inPasa) {
        pasa.push({ texto: txt, valor: parseMonto(m[1]) as number, tolerancia: Number.parseInt(m[2], 10) });
      } else if (inPasa) {
        pasa.push({ texto: txt });
      } else {
        falla.push({ texto: txt });
      }
    }
  }

  return { pasa, falla };
}

function escenarioDeCell(cellHtml: string): string {
  const match = cellHtml.match(/<strong>([\s\S]*?)<\/strong>/);
  return match ? innerText(match[1]) : '';
}

function validateCasos(casos: GoldenCaso[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const caso of casos) {
    if (caso.id === '') errors.push(`caso sin id (seccion ${caso.seccion})`);
    if (ids.has(caso.id)) errors.push(`id duplicado: ${caso.id}`);
    ids.add(caso.id);
    if (!/^GDS-[A-Z0-9-]+$/.test(caso.id)) errors.push(`id con formato inesperado: ${caso.id}`);
    for (const key of Object.keys(caso.entrada)) {
      const value = caso.entrada[key];
      const esPorcentaje = /reip|incapacidad|grado|tramo/.test(key);
      if (typeof value === 'number' && !Number.isInteger(value) && !esPorcentaje) {
        errors.push(`${caso.id}: entrada.${key} no es entero: ${value}`);
      }
    }
    for (const [field, value] of Object.entries(caso.esperado)) {
      if (typeof value === 'number' && !Number.isInteger(value) && field !== 'factor_sueldos') {
        errors.push(`${caso.id}: esperado.${field} no es entero: ${value}`);
      }
    }
    if (caso.esperado_texto.trim() === '') {
      errors.push(`${caso.id}: esperado vacío`);
    }
  }
  return errors;
}

function main(): void {
  const html = readFileSync(HTML_PATH, 'utf8');
  const rowHtmls = extractRows(html);
  const casos: GoldenCaso[] = [];

  for (const rowHtml of rowHtmls) {
    const openTagMatch = rowHtml.match(/^<tr[^>]*>/);
    const openTag = openTagMatch ? openTagMatch[0] : '';
    const attrs = extractAttrs(openTag);
    const cells = extractTopLevelCells(rowHtml);
    if (cells.length < 5) {
      throw new Error(`fila sin celdas suficientes: ${attrs.id ?? 'unknown'} (${cells.length})`);
    }
    const cell1 = cells[1];
    const cell3 = cells[3];
    const cell4 = cells[4];

    const criterios = extraerCriterios(cell4.html);

    const caso: GoldenCaso = {
      id: (attrs.id ?? '').replace(/^row-/, ''),
      seccion: attrs['data-sec'] ?? '',
      fuente: attrs['data-src'] ?? '',
      dificultad: attrs['data-dif'] ?? '',
      tipo: attrs['data-tipo'] ?? '',
      estado: attrs['data-state'] ?? 'revision',
      escenario: escenarioDeCell(cell1.html),
      entrada: parseEntradaTable(cell1.html),
      rentas: parseRentasTable(cell1.html),
      esperado: extraerEsperado(cell3.html, cell3.text),
      esperado_texto: cell3.text,
      criterios_pasa: criterios.pasa,
      criterios_falla: criterios.falla,
      trazabilidad_negocio: {
        principal: attrs['data-business-primary'] ?? '',
        secundarios: (attrs['data-business-secondary'] ?? '').split(';').filter(Boolean),
        tipo_relacion: attrs['data-business-relation'] ?? '',
        confianza: attrs['data-business-confidence'] ?? '',
        criterio: attrs['data-business-reason'] ?? '',
      },
    };
    casos.push(caso);
  }

  const errors = validateCasos(casos);
  if (errors.length > 0) {
    console.error(`Validación golden falló (${errors.length} errores):`);
    for (const error of errors.slice(0, 50)) console.error(`  - ${error}`);
    process.exit(1);
  }

  const secciones = casos.reduce<Record<string, number>>((acc, caso) => {
    acc[caso.seccion] = (acc[caso.seccion] ?? 0) + 1;
    return acc;
  }, {});

  const output = {
    meta: {
      documento: 'Golden DataSet - PEC',
      version: '2.0',
      total: casos.length,
      secciones,
      marcoNormativo: 'MN-TEST-16744-BASE',
      freezeTime: '2026-06-15',
    },
    casos,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Golden dataset extraído: ${casos.length} casos -> ${OUT_PATH}`);
  console.log(`Secciones: ${JSON.stringify(secciones)}`);
}

main();
