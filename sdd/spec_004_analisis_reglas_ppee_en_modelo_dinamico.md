# Spec 004: Analisis de las Reglas PPEE aplicadas al Modelo Dinamico

> **Actualizacion (post-revision):** este analisis concluye que solo un subconjunto de las
> RDN cabe en el modelo de formulas lineales del spec_003. Las decisiones de diseno que
> cierran el alcance, el plan de implementacion y los requisitos consolidados (incluido el
> manual de calculo v1.9 y el golden dataset de 267 casos) estan en
> [`spec_005_requisitos_motor_ppee_golden_267.md`](./spec_005_requisitos_motor_ppee_golden_267.md).

## Contexto

Este documento analiza si las reglas de negocio (RDN) del dominio PPEE documentadas en
`docs/docs/dominio/reglas/` (repo `analisis`) pueden representarse en el modelo dinamico
introducido por `spec_003_dynamic_rules.md`: las tablas `formula_variables` y `benefit_formulas`.

### Modelo de referencia

#### `formula_variables` (registro dinamico de variables)

Ejemplo de dataset:

| variable_name | data_type | source | enabled | description |
| :--- | :--- | :--- | :---: | :--- |
| `sbm` | numeric | `calculation_input.sbm` | 1 | Sueldo base mensual |
| `grado` | numeric | `calculation_input.grado` | 1 | Incapacity percentage |
| `gran_invalidez` | boolean | `calculation_input.granInvalidez` | 1 | Whether gran invalidez applies |
| `factor` | numeric | `matched_formula.factor` | 1 | Formula-specific factor |
| `cargas` | numeric | `beneficiary.cargas` | 1 | numero de cargas |

#### `benefit_formulas` (reglas de formula)

Ejemplo de dataset:

| id | formula_name | priority | formula | enabled | beneficiary_type | periodicity | benefit_type | conditions | created_at | updated_at |
| :--- | :--- | :---: | :--- | :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| `54d7d8f8-...` | pension invalidez total | 300 | `sbm * 0.7` | 1 | WORKER | MENSUAL | PENSION_TOTAL | `{"gradoMin":70}` | 2026-07-17 | 2026-07-17 |
| `1a657320-...` | pension dummy con cargas y nuevo valor formula | 150 | `sbm * 0.35 + cargas * 10000` | 1 | WORKER | MENSUAL | PENSION_PARCIAL | `{"gradoMin":40,"gradoMaxExclusive":70}` | 2026-07-17 | 2026-07-17 |

### Semantica del motor

El motor (`calculateBenefitFromFormulaRules`, `src/domain/benefit/benefit_rules.ts:154-177`):

1. ordena las reglas habilitadas por `priority` ascendente (desempate por `id`);
2. aplica la **primera** regla cuyas `conditions` coinciden con la entrada (primer match);
3. evalúa la `formula` en un contexto controlado y devuelve `{ tipoBeneficio, monto, periodicidad }`.

El grammar de formula permite unicamente: literales numericos, variables registradas,
parentesis y `+ - * /`. No hay funciones (`round/min/max/sum`), ni condicionales, ni referencias a colecciones.

## Veredicto corto

**Solo un subconjunto de las reglas cabe en el modelo.** El modelo expresa bien las reglas
**lineales/aritmeticas puras** con seleccion por rango (la tabla de indemnizacion calza 1:1).
Pero la mayoria de las ~55 RDN reales **no caben**: son reglas de decision/validacion, ramifican
internamente, componen varias formulas, usan funciones o generan efectos (eventos, estados).

El modelo hoy responde a "elijo UNA formula y calculo un escalar"; el dominio PPEE necesita
"una pipeline de reglas compuestas, condicionales y con funciones".

## Reglas que calzan 1:1 en el modelo

| Regla real | Formula en el modelo | Condiciones |
| :--- | :--- | :--- |
| `CALC-OTG-005` (Indemnizacion Global) | `sbm * factor` (tabla por rango) | `gradoMin/gradoMaxExclusive` — exactamente el seed |
| `CALC-OTG-003` caso simple (parcial 35%, total 70%) | `sbm * 0.35`, `sbm * 0.7` | `[40,70)`, `>= 70` |
| `CALC-PIM-004` (Suplemento Gran Invalidez) | `sbm * 0.30` | `granInvalidez: true` |
| `CALC-MANT-001` (Reajuste IPC) | `pension * (1 + ipc)` | con `ipc` como variable dinamica |
| `CALC-PLI-002` / `DESC-LEG-002` (descuentos % AFP/salud) | `imponible * tasa_afp` | con `tasa` como variable dinamica |
| `CALC-OTG-004` (Bono por Matrimonio) | `pension * 24` | condicion simple |

El patron de variables dinamicas encaja muy bien con el `Servicio de Indicadores`
(PGU, pensión mínima, UF, tope imponible): cada indicador seria una `formula_variable`
con `source: indicators.<NOMBRE>`.

## Reglas que NO calzan (y por que)

### 1. Reglas de decision / validacion / estado

El modelo no tiene canal de salida booleano ni de transicion de estado:

- Todas las `VALID-*` (elegibilidad, duplicidad, plazos, consistencia).
- Todas las `CUMP-*` (prescripcion, topes de plazo).
- Todas las `CICLO-*` (ceses por edad, nuevo vinculo, fallecimiento).
- `VERF-GOB-001` (verificacion humana).

### 2. Ramificacion interna de una regla

El grammar no tiene `if/else` ni `case`, y `conditions` solo entiende
`gradoMin` / `gradoMaxExclusive` / `granInvalidez` (+ `beneficiary_type`):

- `CALC-PLI-001` (FONASA 7% vs ISAPRE cotizacion del plan): habria que partirla en 2+ formulas,
  pero no existe condicion `afiliacionSalud`.
- `CALC-PIM-001` (Bonificacion de Viudez si edad>=50 **O** hijos **O** invalidez **O** dependencia):
  la elegibilidad es un OR de criterios inexpresable.
- `CALC-PLI-003` / `CALC-ASIGFAM-001` (Asignacion Familiar por **tramo de ingreso**).

### 3. Composicion / multi-formula

El motor aplica una sola regla (primer match). La liquidacion real es la **suma de muchas**
conceptos (imponible + asignacion familiar + PGU - salud - AFP - retencion).

### 4. Funciones

- `round` — `CALC-PLI-012` (Redondeo Ley 20.956).
- `min` / `max` — `CALC-PLI-013` (Tope Art. 50), `CALC-MANT-002` (no detrimento),
  `VALID-ACUERDO-003` (tope retencion 50%).
- `sum` / `count` — `CALC-OTG-002` (prorrata sobrevivencia), `CALC-MANT-003` (acrecimiento),
  `CALC-REP-*` (agregaciones para reporteria).

Ninguna existe en el grammar actual.

### 5. Encadenamiento

`CALC-OTG-003` consume el output de `CALC-OTG-001` / `CALC-OTG-002`. El modelo solo resuelve
`calculation_input.*`, `beneficiary.*` y `factor` (extraido con regex de la propia formula,
`benefit_rules.ts:658-661`). No existe "variable = output de otra regla".

### 6. Efectos secundarios

Ninguna regla emite eventos, actualiza estados, escribe auditoria ni notifica
(parte de `COMM-*`, auditoria por RDN, transiciones de `PrestacionEconomica`).

## Mapa de familias

| Familia | Cant. aprox. | Calza en el modelo |
| :--- | :---: | :--- |
| `CALC-OTG` (sueldo base, sobrevivencia, monto final) | ~7 | Parcial (solo casos lineales sin branching) |
| `CALC-PIM` (imponible / bonificaciones) | 5 | Parcial (formula ok, elegibilidad no) |
| `CALC-PLI` (liquido / descuentos) | 15 | Parcial (redondeo / topes / funciones no) |
| `CALC-ASIGFAM`, `CALC-MANT` | ~4 | Parcial (tramos, `max`, reajuste si) |
| `CALC-REP`, `CALC-FIN`, `CALC-DEUDA` | ~9 | No (agregaciones / colecciones) |
| `VALID-*`, `CUMP-*`, `CICLO-*`, `COMM-*`, `VERF-*` | ~50 | No (decision / estado / plazo) |
| `MAP-*` | 3 | No (mapeos, no formulas) |
| `APLICA-RETENCION-001`, `DESC-LEG-002` | 2 | Parcial (la parte lineal si) |

## Riesgo de overlap (regla que se pisa con otra)

El diseno "primer match por prioridad" genera solapamiento estructural. En la configuracion seed:

- `pension invalidez total` (`conditions: {"gradoMin":70}`) no declara `granInvalidez`, por lo que
  tambien matchea casos con `granInvalidez: true`. Si coexiste con una regla de Gran Invalidez
  (por ejemplo `sbm * 1.0` con `granInvalidez: true`), ambas calzan y **gana la de menor priority**
  en silencio.
- Una regla catch-all (`gradoMin:0`, `gradoMaxExclusive:100`) con priority baja pisaria a todas las demas.
- Empate de priority: el desempate por `id` es determinista pero arbitrario y no emite advertencia.

Ninguna capa detecta ni previene el solapamiento hoy: `conditions` es JSONB libre en la BD y
`POST /api/benefits/rules` no valida interseccion de condiciones contra reglas habilitadas existentes.

## Extensiones necesarias para cubrir el resto

1. **Enriquecer `conditions`**: JSONB con schema validado (edad, tipo prestacion, afiliacion salud,
   tramo, estado) para poder partir reglas ramificadas en multiples filas.
2. **Modelo de composicion**: permitir que varias formulas calcen y se **sumen**
   (haberes - descuentos), en lugar de "primera que matchea".
3. **Agregar funciones** `round` / `min` / `max` al grammar, manteniendo la validacion anti-SQL.
4. **Canal de decision**: un tipo de regla que retorne booleano/estado (para `VALID` / `CUMP` /
   `CICLO`) o delegar esas reglas a codigo de dominio.
5. **Encadenamiento**: soportar `source` que apunte al output de otra regla
   (ej. `rule.CALC-OTG-001.monto`).
6. **Efectos / eventos**: outbox y eventos de dominio al ejecutar reglas que mutan estado.

## Recomendacion

El modelo es solido como **capa de formulas aritmeticas parametricas** (tabla de indemnizacion,
porcentajes legales, indicadores). Para las reglas PPEE reales conviene que el motor sea un
**RuleExecutorService que orquesta**:

- condiciones para elegir la regla;
- composicion para sumar conceptos;
- `FrameworkResolverService` para versionar por `MarcoNormativo` y `VigenciaLegal`.

Las RDN complejas deben permanecer como codigo de dominio (como ya define el dominio en
`docs/docs/dominio/reglas/`), usando las tablas dinamicas solo para lo que es genuinamente formula.
