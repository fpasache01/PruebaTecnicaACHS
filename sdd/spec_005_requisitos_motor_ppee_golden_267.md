# Spec 005: Requisitos del Motor PPEE + Golden Dataset (267 casos)

| Metadato | Valor |
| --- | --- |
| **Código** | NT-PPEE-SPEC-005 |
| **Versión** | 1.0 |
| **Fecha** | 2026-08-11 |
| **Estado** | Aprobado como requisitos consolidados para implementación |
| **Fuente de fórmulas** | [`manual_calculo_pensiones_ley_16744_v1.9.md`](./dominio/manual_calculo_pensiones_ley_16744_v1.9.md) (NT-PPEE-MANUAL-001, v1.9) |
| **Fuente de casos** | [`golden_dataset_pec267.html`](./dominio/golden_dataset_pec267.html) — 267 casos (Ley 16.744, freeze 2026-06-15, marco `MN-TEST-16744-BASE`) |
| **Antecesores** | spec_001 (benefit engine), spec_002 (API), spec_003 (dynamic rules), spec_004 (análisis RDN→modelo dinámico) |

---

## 1. Resumen

Este spec consolida los **requisitos actualizados** del motor de cálculo de pensiones e
indemnizaciones PPEE después de la revisión completa de:

1. el **Manual de cálculo v1.9** (fórmulas canónicas de los momentos M1/M2/M3/M3R);
2. el **golden dataset ejecutable de 267 casos** (14 secciones A–N) que el motor debe
   reproducir (tolerancia ±$1);
3. el análisis **spec_004** sobre qué reglas caben en el modelo dinámico de `spec_003` y
   cuáles requieren extensiones;
4. las **~55 RDN** del catálogo `dominio/reglas/` que deben poder ejecutarse.

El objetivo es que el motor sea capaz de **ejecutar todas las RDN del catálogo** y de
**reproducir los 267 casos golden**, sobre el modelo de reglas **declarativo** introducido
en `spec_003` y extendido aquí.

---

## 2. Contexto y fuentes

| Fuente | Rol |
| --- | --- |
| `spec_001_benefit_engine.md` | Contrato original `calcularBeneficio(sbm, grado, opciones)` |
| `spec_002_api_implementation.md` | API Express + OpenAPI alrededor del motor |
| `spec_003_dynamic_rules.md` | Modelo dinámico `benefit_formulas` + `formula_variables` |
| `spec_004_analisis_reglas_ppee_en_modelo_dinamico.md` | Análisis de representabilidad de las RDN |
| `dominio/manual_calculo_pensiones_ley_16744_v1.9.md` | **Manual canónico de fórmulas** (M1/M2/M3/M3R) |
| `dominio/golden_dataset_pec267.html` | **Dataset ejecutable** de 267 casos con esperados y trazabilidad |
| `dominio/golden_dataset.md`, `dominio/18_Golden_Dataset_*.md` | Catálogo narrativo histórico (90 casos), ya no ejecutable |
| `dominio/reglas/*.md` | Catálogo de ~55 RDN del dominio PPEE |

---

## 3. Alcance

El motor debe:

1. **Ejecutar todas las RDN** del catálogo `dominio/reglas/` (cálculo, validación,
   cumplimiento, ciclo de vida, mapeos, efectos) de forma **declarativa** (sin recompilar
   para cambiar una regla), sobre el modelo dinámico de `spec_003` extendido.
2. **Reproducir los 267 casos golden** (`golden_dataset_pec267.html`) con tolerancia ±$1
   en montos, tipo de prestación correcto y códigos de error esperados.
3. Implementar el pipeline canónico **M1 → M2 → (término) → M3R → M3** del manual v1.9.

Quedan **fuera del alcance de esta iteración** (se documentan como pendientes en §9):
la focalización/elegibilidad real de PGU (solo cotas de prueba), la determinación de
parámetros oficiales fuera del `MarcoNormativo` de prueba, y los ítems `VAL-DESC-*`
(topos de descuentos aún "por validar").

---

## 4. Decisiones de revisión (espec_004 → este spec)

| # | Decisión | Consecuencia |
| --- | --- | --- |
| D1 | El modelo de fórmulas lineales de `spec_003` **no alcanza** para la mayoría de las RDN. Se extiende con **tipos de regla** (ver §7). | `benefit_formulas` gana `rule_type` y `action`; `conditions` se enriquece. |
| D2 | **Gran Invalidez (GI):** la pensión imponible es el **70% del SBP**; el **suplemento 30% (auxilio de terceros) es NO imponible** (se suma al líquido). Criterio del caso QA `FR-020`. | Los casos NEGOCIO `CM-03` que tratan el 100% como imponible quedan como **desviación documentada** (reporte de conformidad). |
| D3 | **Factor de indemnización:** se mantiene la **tabla discreta por rangos** (15%→1.5 … 37.5%→15.0) del motor actual. | Los casos QA `FR-002/003/007/010/011` y `SBP-*` que asumen la fórmula continua `1.5 + (REIP−15)×0.6` en valores intermedios quedan como **desviación documentada**. |
| D4 | **Golden canónico:** se extrae el JSON desde el HTML (lógica `exportarJsonCICD()`) a `data/golden_dataset.json` como fuente de verdad de pruebas. | El harness corre data-driven sobre ese JSON; no se edita a mano. |
| D5 | **Errores tipados:** el motor devuelve códigos de error del dataset (ej. `REIP_BAJO_UMBRAL`, `ERROR_RUT_INVALIDO`, `DEUDA_TRABAJADOR`) vía canal de decisión. | Se implementa un canal `DECISION`/validación (ver §7). |
| D6 | **Normalización de entrada** obligatoria (RUT, fechas, montos `$700.000`, UTF-8). | Capa de entrada normaliza antes de validar/calcular. |

---

## 5. Requisitos de negocio (manual v1.9)

### 5.1. Momento 1 (M1) — Sueldo Base Promedio (SBP)

Entradas: rentas imponibles certificadas de los **6 meses anteriores** al hecho causal.

Por cada mes histórico `i`:

1. **Amplificación** (solo si `diasTrabajados < 30` y `diasSubsidio = 0`):
   `R_aj = R / diasTrabajados × 30`.
2. **Tope imponible del mes**: `topePesos_i = round(topeUF_i × UF(último día del mes i))`;
   `baseCota_i = min(R_aj, topePesos_i)`.
3. **Depuración D.L. 3.501**: `R_dep = baseCota_i / f_i`, con `f_i` por régimen del mes
   (AFP_STD 1.1757, AFP_TRASPASO 1.2053, IPS 1.0).
4. **Actualización** (cadena §2.3):
   - **Paso ①**: llevar cada renta al **ancla primaria** — invalidez: inicio de
     incapacidad (REIP); indemnización: **periodo de cálculo**; sobrevivencia (causante no
     pensionado): fallecimiento. Factor = producto de `Reajuste_rentas_SBM`.
   - **Paso ② (pensión)**: llevar SBP al **periodo REIP** para el primer pago.
   - **Paso ③ (pensión)**: reajustar cada mes del cuadro hasta el **periodo de cálculo**.
5. **Promedio**: `SBP_calc = round( (Σ R_reaj) / n )`.
6. **Piso IMNR**: `SBP = max(SBP_calc, IMNR(periodo de ancla))`.

Meses con subsidio (SIL) se **excluyen** del promedio; si no hay `n` meses válidos →
`EXD-SBM-001`.

### 5.2. Momento 2 (M2) — Determinación del beneficio

**Invalidez parcial** (40% ≤ grado < 70%):
`nucleo = round(SBP × 0.35)`;
`incrArt41 = round(SBP × 0.05 × max(0, hijosCausantes − 2))`;
`bruto = nucleo + incrArt41`; `tope50 = round(SBP × 0.50)`;
`monto = min(bruto, tope50)`.

**Invalidez total** (grado ≥ 70%, sin GI):
`nucleo = round(SBP × 0.70)`; mismo Art. 41; `tope100 = round(SBP × 1.00)`;
`monto = min(bruto, tope100)`.

**Gran invalidez (GI)** (D2):
`nucleo = round(SBP × 0.70)` (imponible);
`auxilio = round(SBP × 0.30)` (**no imponible**);
`incrArt41 = round(SBP × 0.05 × max(0, hijos − 2))`;
`tope140 = round(SBP × 1.40)`;
`pensionImponible = min(nucleo + incrArt41, tope140)`; `auxilio` se suma al líquido.

**Pensión transitoria (104 semanas)**: `round(SBP × 0.70)`.

**Límite máximo inicial** (Ley 15.386 art. 25): aplicar sobre la pensión en la ancla de
constitución; **no reaplicar** si `pension_ya_constituida = 1`.

**Pensión mínima** (si hay derecho): `max(calculada, mínima aplicable)`.

**Sobrevivencia**:
- PBC: si causante no pensionado → `PBC = round(SBP × 0.70)` (excluye 30% de GI); si ya
  pensionado → PBC vigente.
- Distribución: cada beneficiario con `%` nominal (cónyuge 50/60%, hijo 20%, madre 30%,
  ascendiente 20%); **tope orfandad** 50 (con cónyuge) o 100 (sin); **Art. 50**: si la
  suma de `%` efectivos > 100, se prorratea.
- Devengo: dentro de 2 años del fallecimiento → desde fallecimiento; fuera → desde
  presentación (Ley 19.260).

**Indemnización global**: `INDEM = round(SBP × factorSueldos(grado))` con **tabla discreta**
(D3): 15→1.5, 17.5→3, 20→4.5, 22.5→6, 25→7.5, 27.5→9, 30→10.5, 32.5→12, 35→13.5, 37.5→15.
Aplica solo a `15% ≤ grado < 40%`. Si hubo pagos previos, se paga la **diferencia**.

### 5.3. Momento 2 complemento — incrementos y bonos

| Componente | Regla |
| --- | --- |
| Bono 19.403 | `% legal (edad, hijos) × MIN_t`; efectivo = `max(0, MIN + estándar − P)` acotado. |
| Bono 19.539 | Complementa hasta `META` = PMVI (sin hijos) o `0.85×PMVI` (con hijos); α = 1 desde dic-1998. |
| Incremento 19.578 | Origen `8.000 × %beneficio` × `FACTOR_IPC(origen → t)`. |
| 19.953 Δ reliquidación | Viudez sin hijos: 50% → 55% (2004-09) → 60% (2005-09); `Δ = P_rel − P_antes`. |
| Bono 19.953 (75+) | `META_75+ − (P + 19.403 + 19.539)`; desde el mes siguiente a cumplir 75. |
| Incremento 20.102 | Umbrales fijos de may-2006 (100.000/110.000) — **no** revaluar; `INCR_origen × FACTOR_IPC(200607 → t)`. |

Regla anti-error: **Familia A** (19.578/20.102) usa origen histórico × IPC; **Familia B**
(19.403/19.539/19.953, AF, aguinaldo) recalcula con tablas del período `t`.

### 5.4. Momento 3 (M3) — Liquidación mensual

**Base imponible** = pensión (incl. GI 70% imponible y Art. 41) + incrementos + bonos
19.403/19.539/19.953 (imponibles). **NO imponibles**: AF, aguinaldo, bono invierno, `HAB_PGU`.

Cotizaciones:
- `DES_SALUD`: FONASA 7%; **ISAPRE** = `min(max(planUF×UF_último_día_mes, 7% base), base)`,
  con `planUF ∈ (0, 10]`.
- `DES_FONDO` = 10% de la base (régimen AFP, no exento).
- `DES_COMISION` = comisión AFP vigente.

Descuentos (inventario B.2) con **prioridad** y **topes**:
1. Retención judicial — tope **50%** acumulado (Art. 57 CT / Ley 14.908).
2. Deuda interna / SUSESO / oficio / PGU exceso — tope **20%** (Compendio CASO 3 y
   operativo; ítems `VAL-DESC-*` por validar).
3. CCAF / FONASA préstamo / otros — por validar.

Líquido: `max(0, base − cotizaciones − descuentos) + Σ haberes no imponibles`.
**No aplica IUSC/impuesto a la renta** sobre pensión/indemnización Ley 16.744 (INR —
LIR art. 17 N°2; SII Oficio 2.971/1998).

### 5.5. Momento 3R (M3R) — Cuadro de primer pago y recálculo

- **Antes** de armar el cuadro se determina `fechaTerminoBeneficio` (§6.8 del manual):
  edad legal (65H/60M), vitalicia, plazos sobrevivencia, nuevas nupcias (cese + pago único
  de 2 años de pensión), fallecimiento.
- `fechaFinCuadro = min(fechaCalculo, fechaTerminoBeneficio)`.
- Filas desde la **fecha de devengo** hasta `fechaFinCuadro`; prorrata del primer mes
  `dias/30`; `P_m` se reajusta mes a mes si corresponde.
- `PagadoPrevio_m` (SIL, pensión transitoria, anticipo) se resta en el mismo período.
- `NetoPrimerPago = Σ (Devengado_m − PagadoPrevio_m) ± aguinaldos del tramo`:
  `> 0` → primer giro; `≤ 0` → consumido / deuda.
- **Recálculo**: `periodoReferencia = periodo actual`; el cuadro llega hasta el mes actual
  (capado por `fechaTerminoBeneficio`); cada mes se valoriza con reglas/tablas de ese mes.

---

## 6. Golden Dataset (267 casos)

### 6.1. Secciones

| Sección | Casos | Fuente | Tema |
| --- | ---: | --- | --- |
| A IND | 20 | NEGOCIO | Indemnización global (casos madre/variantes) |
| B PEN | 52 | NEGOCIO | Pensiones / liquidación / stress |
| C SOB | 23 | NEGOCIO | Sobrevivencia |
| D ERR | 2 | NEGOCIO | Denegación y EXD |
| E FR | 20 | QA | Fronteras exactas REIP |
| F SBP | 25 | QA | SBP en condiciones límite |
| G NEG | 20 | QA | Negativos verificables |
| H REC | 15 | QA | Recálculos y retroactividad |
| I SOBE | 15 | QA | Sobrevivencia edge |
| J TEC | 15 | QA | Técnico adversarial |
| K PENE | 20 | QA | Pensión mensual edge |
| L REGI | 16 | QA | Regímenes DL 3.501 |
| M AGR | 14 | QA | Agravamiento/mejoría REIP |
| N NRM | 10 | QA | Normalización de entrada |

### 6.2. Estructura del caso

Cada caso expone: `id` (GDS-*), sección, fuente, dificultad, tipo, estado, escenario,
**parámetros de entrada**, **rentas mes a mes**, **resultado esperado** (con valores
exactos y tolerancia ±$1), **criterios PASA/FALLA** y **trazabilidad** QA→NEGOCIO
(`data-business-primary/secondary/relation/confidence/reason`).

### 6.3. JSON canónico

- Ubicación: `data/golden_dataset.json`.
- Generación: script que reproduce `exportarJsonCICD()` del HTML (parsea las filas
  `tr.dr`, tablas de entrada/rentas, bloque de esperado por regex, criterios y
  trazabilidad).
- Validación de schema: IDs únicos, montos enteros, expectativas sin `null`, referencias
  RDN existentes, clasificación correcta.

### 6.4. Comportamiento esperado por tipo de caso

| Tipo de caso | Verificación |
| --- | --- |
| Cálculo (`IND`, `PEN`, `SOB`, `FR`, `SBP`, `REGI`, `PENE`) | Montos con tolerancia ±$1 y tipo de prestación. |
| Denegación / negativo (`ERR`, `NEG`) | Código de error exacto (ej. `REIP_BAJO_UMBRAL`, `DEUDA_TRABAJADOR`). |
| Recálculo / agravamiento (`REC`, `AGR`) | Runner multi-acto: secuencia de REIP, `PagadoPrevio`, retroactivo/deuda. |
| Sobrevivencia edge (`SOBE`) | PBC/prorrata/topes de orfandad/Art. 50, plazos de vigencia. |
| Técnico adversarial (`TEC`) | Errores tipados sin stack trace ni datos internos. |
| Normalización (`NRM`) | Acepta formatos normalizables; idéntico resultado al caso base. |

---

## 7. Requisitos del motor de reglas (extensión declarativa)

### 7.1. Tipos de regla

| `rule_type` | Para | `action` |
| --- | --- | --- |
| `FORMULA` | CALC* lineales | `{ formula }` (grammar + `round/min/max/sum/count`) |
| `DECISION` | VALID*, CUMP*, CICLO*, elegibilidad, errores | `{ expr (booleana), result (estado/bloqueo/error_code) }` |
| `COMPOSITE` | Suma/resta de conceptos (haberes − descuentos, sobrevivencia) | `{ conceptos: [{ rdnRef, sign }] }` |
| `MAPPING` | MAP-REP*, mapeos de reportería | `{ mappingName, default }` |
| `EFFECT` | COMM-*, transiciones, eventos, auditoría | `{ event, targetState, audit }` |

### 7.2. Condiciones enriquecidas (schema JSONB validado)

Además de `gradoMin/gradoMaxExclusive/granInvalidez`:
`tipoPrestacion`, `edadMin/Max`, `afiliacionSalud`, `tramoMin/Max`, `estado`, `hijos`,
`estadoCivil`, `esIndependiente`, `regimenPrevisional`, `beneficiarioTipo`, etc.

### 7.3. Variables

Fuentes nuevas: `indicators.<NOMBRE>` (PGU, mínima, UF, IPC, tope, IMNR),
`parametros.<NOMBRE>` (tasas AFP/salud, límite máximo), `rule.<RDN>.monto`
(encadenamiento), `prestacion.*`, `ficha.*`.

### 7.4. Códigos de error (decisión)

Conjunto mínimo derivado del dataset: `REIP_BAJO_UMBRAL`, `ERROR_RUT_INVALIDO`,
`ERROR_FECHA_INVALIDA`, `ERROR_SBP_INSUFICIENTE`, `ERROR_MONTO_INVALIDO`,
`ERROR_REIP_INVALIDO`, `ERROR_CAMPO_FALTANTE`, `ERROR_TIPO_INVALIDO`,
`ERROR_TEMPORALIDAD`, `ERROR_MARCO_NORMATIVO`, `ERROR_PRERREQUISITO`,
`RECHAZADO`, `RECHAZADO_COBERTURA`, `RECHAZADO_DUPLICADO`, `RECHAZADO_PRESCRIPCION`,
`PENDIENTE_ACUMULACION`, `DEUDA_TRABAJADOR`, `EXCESO_PAGO`, `CONSUMIDO`,
`SOBREVIVENCIA_SIN_BENEFICIARIOS`, `EXD-PAG-030`, `EXD-SBM-*`, `MONTO_MINIMO`,
`IMNR_PISO_APLICADO`, `ACEPTADO`, `ACEPTADO_NORMALIZADO`, `SIN_CAMBIO`.

### 7.5. RDN del catálogo

Todas las RDN de `dominio/reglas/` se plasman como filas seed (id = RDN) con su
`rule_type`, `conditions` y `action` derivados del documento. `COMM/MAP/FIN` se modelan
como `EFFECT`/`MAPPING` (se ejecutan y registran; no envían I/O real).

---

## 8. Plan de implementación (fases)

| Fase | Entregable |
| --- | --- |
| **F0** | Extracción de `data/golden_dataset.json` desde el HTML + validación de schema. |
| **F1** | Migración `002_rule_engine.sql` (rule_type, action, conditions enriquecidas, variables, overlap). |
| **F2** | Pipeline M1/M2/M3/M3R en dominio (SBP, % legales, Art. 41, GI 70/30, tope 50/100/140, límite, mínimas, sobrevivencia, indemnización, liquidación, cuadro primer pago, término). |
| **F3** | Canal de decisión + errores tipados + normalización de entrada. |
| **F4** | Seed declarativo de las ~55 RDN. |
| **F5** | Harness `golden_dataset.test.ts` data-driven (267 casos, ±$1) + runner multi-acto + `conformity_report.json`. |
| **F6** | API/OpenAPI + verificación (`db:migrate`, `test`, `typecheck`). |

---

## 9. Pendientes y riesgos

- **Reconciliaciones conocidas (no bloquean, se documentan en `conformity_report.json`):**
  - GI: casos NEGOCIO `CM-03` (100% imponible) vs decisión D2 (70/30).
  - Factor indemnización: casos QA con fórmula continua (FR-002/003/007/010/011, SBP-*)
    vs decisión D3 (tabla discreta).
- **Topes de descuentos** `VAL-DESC-01…07` (CCAF, FONASA préstamo, PGU exceso, techo
  global, default 20% de oficio): se parametrizan con valores de prueba y se cierran con
  negocio.
- **PGU**: solo cotas de prueba (edad 65, umbrales $789.139/$1.252.602, máximo $231.732);
  la elegibilidad real la decide el IPS.
- **Normalización de `benefit_formulas`**: la migración debe ser idempotente y no romper
  los tests existentes de spec_001/003.
- **Volumetría de seeds**: ~55 RDN + 267 casos requiere fixture versionado y runner
  determinista (sin `Date.now()` ni datos no controlados; freeze `2026-06-15`).

---

## 10. Criterios de aceptación

1. `npm run db:migrate` aplica sin error (PostgreSQL y/o SQLite en tests).
2. `npm test` pasa: unit de M1/M2/M3/M3R, canal de decisión, y `golden_dataset.test.ts`
   con los casos conformes.
3. `npm run typecheck` sin errores.
4. El motor devuelve códigos de error del §7.4 para los casos NEG/TEC/ERR.
5. `data/golden_dataset.json` es generado por script y validado (sin edición manual).
6. Los casos con desviación conocida (D2/D3) no bloquean el pipeline; quedan listados en
   `conformity_report.json`.
