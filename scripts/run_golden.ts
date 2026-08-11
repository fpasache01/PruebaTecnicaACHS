import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarIndicadoresDesdeJson } from '../src/domain/ppee/ppee_indicators.js';
import { evaluarCaso } from '../tests/helpers/golden_runner.js';
import { cargarGoldenDataset } from '../tests/helpers/golden.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDirectory, '..');

const indicadores = cargarIndicadoresDesdeJson(
  JSON.parse(readFileSync(join(repoRoot, 'data', 'indicators.json'), 'utf8')),
);
const golden = cargarGoldenDataset();

const evaluaciones = golden.casos.map((caso) => evaluarCaso(caso, indicadores));
const porSeccion = evaluaciones.reduce<Record<string, { total: number; pasa: number }>>((acc, e) => {
  acc[e.seccion] = acc[e.seccion] ?? { total: 0, pasa: 0 };
  acc[e.seccion].total += 1;
  if (e.pasa) acc[e.seccion].pasa += 1;
  return acc;
}, {});

const noConformes = evaluaciones.filter((e) => !e.pasa);
const pasan = evaluaciones.filter((e) => e.pasa);

console.log(`=== GOLDEN ${golden.casos.length} casos | PASA: ${pasan.length} | NO CONFORME: ${noConformes.length} ===`);
console.log('Por seccion (pasa/total):');
for (const [sec, v] of Object.entries(porSeccion).sort()) {
  console.log(`  ${sec}: ${v.pasa}/${v.total}`);
}

const detalle = noConformes.map((e) => ({
  id: e.id,
  seccion: e.seccion,
  tipo: e.tipoPrestacion,
  error: e.errorCode,
  motivos: e.motivo.slice(0, 4),
}));

const SECCIONES_PENDIENTES = ['AGR', 'NRM', 'SOBE', 'PENE'];

const reporte = {
  meta: {
    documento: 'Golden DataSet - PEC',
    total: golden.casos.length,
    conformes: pasan.length,
    noConformes: noConformes.length,
    porSeccion,
    marcoNormativo: 'MN-TEST-16744-BASE',
    freezeTime: '2026-06-15',
    fecha: new Date().toISOString(),
  },
  desviacionesConocidas: {
    D2_GI_100_vs_7030: {
      descripcion: 'Gran Invalidez: casos NEGOCIO CM-03 tratan el 100% como imponible vs decision D2 (70% imponible + 30% auxilio no imponible)',
      casos: evaluaciones.filter((e) => /CM-03/i.test(e.id) && !e.pasa).map((e) => e.id),
    },
    D3_factor_continuo: {
      descripcion: 'Factor indemnizacion: casos QA FR-002/003/007/010/011 y SBP-* usan formula continua vs decision D3 (tabla discreta)',
      casos: evaluaciones.filter((e) => /^(FR-00[237]|FR-010|FR-011|SBP-)/.test(e.id) && !e.pasa).map((e) => e.id),
    },
  },
  seccionesPendientes: SECCIONES_PENDIENTES.map((sec) => ({
    seccion: sec,
    descripcion: `Seccion QA/adversarial con semantica especifica aun no cubierta por el pipeline (${porSeccion[sec]?.pasa ?? 0}/${porSeccion[sec]?.total ?? 0} conformes)`,
  })),
  casosNoConformes: detalle,
};

writeFileSync(join(repoRoot, 'data', 'conformity_report.json'), `${JSON.stringify(reporte, null, 2)}\n`);
console.log(`Reporte -> data/conformity_report.json`);
