# EDU3D — generate → verify → correct

**A Node.js pipeline that generates interactive 3D educational experiences (Three.js)
with Claude and then _visually verifies its own output_ in headless Chromium —
before a human ever looks at it.**

_English first. Español después ([ir a la versión en español](#edu3d--generar--verificar--corregir))._

---

## Who this is for

**Marco Escalona** — teacher of programming and computer science, from primary
school to postgraduate. He builds 3D educational experiences in Three.js for his
students.

## The bottleneck

Each experience takes **hours** of manual work. A teacher of any other subject has
two options: use whatever already exists on the internet, or ask someone in tech to
build it for them. Neither scales to a syllabus.

## The failure mode this targets

A model writing Three.js is generating code for a scene **it cannot see**. It fails
with a black screen, the camera _inside_ the object, geometry outside the view
frustum, no lights. **The code compiles. It throws no errors. The result is
unusable — and nothing in the toolchain tells you.** A non-technical teacher just
sees a black rectangle and gives up.

## The solution

```
generate ─▶ verify visually in headless Chromium ─▶ return screenshot + errors to the model ─▶ correct
                 ▲                                                                              │
                 └───────────────────────── up to 2–3 attempts ─────────────────────────────────┘
```

The verifier (`lib/verifier.js`) opens the generated HTML in Chromium with
software WebGL:

```
--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
```

waits 2 s, takes a screenshot, and checks **three things**:

1. **The canvas is NOT black** — mean / standard deviation of luminance, fraction of
   bright pixels and count of distinct colours over the canvas region of the PNG.
   Catches a black screen _and_ a flat single-colour frame (nothing actually
   rendered).
2. **Zero console errors** — `console.error`, uncaught exceptions, unhandled
   promise rejections, and failed resource requests (e.g. the CDN did not load).
3. **An active render loop** — `requestAnimationFrame` and WebGL draw calls are
   hooked _before_ any page script runs; the counters must still be advancing after
   the scene settles (not just "called once").

On failure it hands the model the **screenshot (as an image)** plus a bulleted list
of exactly what went wrong, and asks for the full corrected file. `MAX_ATTEMPTS`
defaults to 3; this sprint ran it at 2.

A fourth signal (not a pass/fail gate) feeds the interactivity score: an
interaction _poke_ — drag across the canvas + wheel + arrow keys — with the passive
animation delta subtracted, plus instrumentation of which input listeners the page
registered.

---

## Improvement changelog — baseline vs. solution

**Baseline** = one model call, no verification, no retries.
**Solution** = generate → verify → retry with the screenshot + error log as feedback.

Both are scored with the **same 0–100 rubric**:
render correct (40) + no errors (20) + real interactivity (20) + level-appropriate
content (20, LLM judge with a heuristic fallback).

### What was actually run

| Setting | Value |
|---|---|
| Model | `claude-sonnet-4-6` |
| `EFFORT` | `low` (see _Limitations_ — was `medium`, caused truncation) |
| `MAX_TOKENS` | `64000` |
| `MAX_ATTEMPTS` | `2` |
| Cases in the final run | **2** (`cases/cases.json`), cut from 10 → 5 → 2 for time |

### Results table

> **Honest status at handoff:** the scored run (`eval/results.json`, timestamped
> `2026-08-31T17:18Z`) completed **case 1** and then **stopped — the Anthropic API
> credit balance was exhausted** mid-run (`invalid_request_error`, _"credit balance
> is too low"_). That is an account-billing stop, not a pipeline error. Cases 3–5
> were authored but not run.

| # | Subject | Level | Baseline /100 | Solution /100 | Δ | Attempts | Verifier: base → sol |
|---|---|---|:--:|:--:|:--:|:--:|:--:|
| 1 | Languages (English vocabulary, immersive) | primaria | **97** | **97** | **+0** | 1 | pass → pass |
| 2 | Physics (special-relativity time dilation) | preparatoria | — | — | — | — | **run stopped: API credits exhausted** |
| 3 | Art History (interactive Renaissance gallery) | secundaria | not run | not run | — | — | — |
| 4 | Literature (3D scene of a literary passage) | primaria | not run | not run | — | — | — |
| 5 | Biology (DNA double helix) | secundaria | not run | not run | — | — | — |

**Case 1 breakdown (identical on both sides):** render 40/40 · errors 20/20 ·
interactivity 20/20 · level-appropriate 17/20 (LLM judge: _"basic household
vocabulary, simple instructions, click-and-hear interaction — ideal for primary;
recognisable 3D scene; minor: `window` and `shelf` not visible"_).

**Reading the Δ = 0.** Case 1 is an easy case: the single baseline call already
produced a correct, error-free, interactive scene (verifier `ok = true`;
`pokeDelta` 0.84 — the scene reacted strongly to input), so the verify-and-retry
loop had nothing to fix. The loop is **insurance against the failure mode**; on
this case the model did not hit it. Its value on cases that _do_ fail is
demonstrated by the negative controls below, not by this row. Run `npm run eval`
once credits are restored to populate cases 2–5.

### Evidence already captured (real, reproducible)

These ran and are the basis for the claim:

- **Verifier, positive control** — `test/cube.html` (a rotating lit cube, Three.js
  via CDN): **3/3 checks pass**. Software WebGL under SwiftShader confirmed working
  (`webgl2` context, ~186 rAF/s, 372 draw calls in a 0.6 s window, 0 errors).
  `npm run verify:cube`.
- **Verifier, negative controls** — `test/verify-negatives.js`: a black canvas
  fails checks 1 + 3; a page that logs `console.error` and throws fails check 2; a
  flat single-colour canvas fails check 1. **3/3 correctly rejected.**
- **Full `eval` on case 1** (English vocabulary, primaria): baseline **and**
  solution both scored **97/100**; verifier `ok = true` on both — not black
  (σ-luma 40, 258 distinct colours), **0 console errors**, render loop active
  (rafDelta 140, ~10 000 draw calls in 0.6 s), input listeners
  `pointerdown / pointermove / wheel / click`, scene reacted strongly to the poke
  (`pokeDelta` 0.84 vs idle 0.001). Solution passed on attempt 1.
- **Live generate**, relativity case (preparatoria): **11.8 KB**, not truncated,
  67.8 s, thinking 175 tokens (before credits ran out).
- **Truncation bug found and fixed.** With `EFFORT=medium` + `MAX_TOKENS=24000`,
  adaptive thinking consumed the entire token budget before emitting any HTML:
  **0-byte output on 2/2 cases after ~330 s each.** Switching to `EFFORT=low` +
  `MAX_TOKENS=64000` dropped thinking to ~175 tokens and made generation 3–5×
  faster with no truncation. This is exactly the kind of silent failure the
  verify-loop philosophy is meant to surface.

---

## Impact beyond programming

The 5 designed cases cover **Art History, Languages, Physics, Literature and
Biology**. **None is a programming topic — on purpose.**

- A teacher of _any_ subject describes what they want in `cases/cases.json` (four
  plain-language fields) and runs one command. No code.
- A student who would have bounced off a black screen instead receives **the
  screenshot and the log**, and learns _why_ it failed — the debugging loop becomes
  teaching material.

See `docs/DOCENTES.md` for the one-page, non-technical teacher guide (how to
describe a topic, the single command, how to read the report, 3 worked examples in
different subjects).

## Hot take

An agent that generates visual content without being able to observe its own output
is **guessing**. Handing it back the screenshot turns _generation_ into
_verification_. That is not just a technical improvement — it is what makes the tool
usable by someone who **cannot read the code**.

---

## Prior work (rule 02)

The repositories **`marcus-escalona-portfolio`**, **`solar-system-ebvg`**,
**`atlas-ebvg`**, **`dna-journey-ebvg`** and **`3d-student-portfolio`** existed
**before** the hackathon and are used **only as a quality reference** for what a
finished experience should look like. **The entire pipeline in this repository is
new** — verifier, generation loop, scoring, evaluation harness, cases and docs.

## Human review (rule 05)

**The system proposes; the teacher approves.** No generated material reaches a
student without Marco (or the subject teacher) reviewing the rendered experience and
its report first. The pipeline produces artifacts and a score; it does not publish.

## Agent tool (declared)

**Claude Code (Sonnet).**

## Declared limitations

Time-boxed hackathon sprint. Documented exactly as run:

- **Cases cut** from 10 planned → 5 authored → **2 in the final scored run**, purely
  for wall-clock time. Cases 3–5 are authored in git history; 6–10 were dropped.
  Of the 2, only **case 1 completed** before credits ran out.
- **`EFFORT=low`** (not `medium`/`high`) after the truncation bug above — trades
  some reasoning depth for finishing at all within the sprint.
- **`MAX_ATTEMPTS=2`** instead of the default 3.
- Per-generation time is **highly variable** (68 s – 552 s observed) and dominated
  the sprint budget; `eval` re-generates both baseline and solution, which is why
  the scored run was reduced rather than parallelised.
- **The Anthropic API account ran out of credits during the scored run.** Case 1 is
  in `eval/results.json`; case 2 returned `invalid_request_error` (_"credit balance
  is too low"_) and cases 2–5 did not run. Re-runnable as-is with `npm run eval`
  once credits are restored — no code change needed. The verifier path (no API key)
  remains fully exercised by `npm run verify:cube` and `npm run verify:negatives`.

---

## Run it

### Setup (once)

```bash
npm install
npx playwright install chromium
cp .env.example .env      # then put ANTHROPIC_API_KEY=sk-ant-... in .env
```

The verifier does **not** need an API key. Generation does.

### Commands

```bash
npm run verify:cube        # prove headless WebGL works (no API key)
npm run verify:negatives   # prove the verifier rejects broken output (no API key)
npm run baseline           # generate out/baseline/case-XX.html — 1 call, no verification
npm run solution           # generate + verify + retry → out/solution/
npm run eval               # baseline + solution + score → eval/results.json + eval/results.md
```

Then open **`docs/report.html`** (drag `eval/results.json` onto it if it does not
auto-load) for the teacher-facing side-by-side report.

Tuning via `.env`: `MODEL`, `EFFORT` (`low|medium|high|max`), `MAX_TOKENS`,
`MAX_ATTEMPTS`.

## Structure

```
baseline/index.js   1 call, no verification, no retries
solution/index.js   generate → verify → retry (max 2–3) with screenshot + errors as feedback
eval/index.js       run both over the same cases, score 0–100, write results.json + results.md
cases/cases.json    topic + level pairs (2 in the final run; 5 authored)
lib/verifier.js     THE VERIFIER — headless Chromium, pixel analysis, rAF/draw hooks, error capture
lib/generate.js     Anthropic API (claude-sonnet-4-6), streaming, adaptive thinking, repair prompt
lib/score.js        0–100 rubric: render 40 · errors 20 · interactivity 20 · level 20 (LLM judge)
lib/prompts.js      system + initial + repair prompts
lib/browser.js      Chromium launch flags for software WebGL
test/               cube.html (positive control) + verify-negatives.js (negative controls)
docs/report.html    self-contained teacher report: summary + per-case baseline vs solution
docs/DOCENTES.md    one-page non-technical teacher guide
out/                generated HTML + screenshots
```

## Scoring rubric (0–100 per case)

| Criterion | Points | How |
|---|---:|---|
| Renders correctly | 40 | canvas not black **and** has variance **and** render loop active (40) → visible but no loop (24) → near-monochrome (12) → black (4) → no canvas (0) |
| No errors | 20 | 0 errors = 20; −7 per error |
| Real interactivity | 20 | input listeners **and** scene reacted to the poke (20) → listeners + code signals (15) → one signal (9) → none (0) |
| Level-appropriate content | 20 | LLM judge (`claude-sonnet-4-6`) over on-screen text + screenshot + HTML; heuristic fallback if no API key |

`results.json` stores baseline and solution for the same case side by side, with the
per-criterion breakdown, the solution's attempt log, and the full verifier detail.

---
---

# EDU3D — generar → verificar → corregir

**Un pipeline en Node.js que genera experiencias educativas 3D interactivas
(Three.js) con Claude y luego _verifica visualmente su propia salida_ en Chromium
headless — antes de que la vea una persona.**

## Para quién es

**Marco Escalona** — docente de programación e informática, de primaria a posgrado.
Construye experiencias educativas 3D en Three.js para sus alumnos.

## El cuello de botella

Cada experiencia toma **horas** de trabajo manual. Un docente de cualquier otra
materia tiene dos opciones: usar lo que ya exista en internet, o pedirle a alguien
de tecnología que se lo construya. Ninguna escala a un programa de estudios.

## El modo de falla que ataca

Un modelo escribiendo Three.js genera código para una escena **que no puede ver**.
Falla con pantalla negra, la cámara _dentro_ del objeto, geometría fuera del
frustum, sin luz. **El código compila. No lanza errores. El resultado es
inservible — y nada en la cadena de herramientas te lo dice.** Un docente no técnico
solo ve un rectángulo negro y abandona.

## La solución

```
generar ─▶ verificar visualmente en Chromium headless ─▶ devolver screenshot + errores al modelo ─▶ corregir
                 ▲                                                                                    │
                 └───────────────────────────── máximo 2–3 intentos ───────────────────────────────────┘
```

El verificador (`lib/verifier.js`) abre el HTML generado en Chromium con WebGL por
software:

```
--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
```

espera 2 s, toma un screenshot y comprueba **tres cosas**:

1. **El canvas NO está en negro** — media / desviación estándar de luminancia,
   fracción de píxeles con brillo y número de colores distintos en la región del
   canvas del PNG. Detecta pantalla negra _y_ un fotograma de un solo color plano
   (no se renderizó nada).
2. **Cero errores en consola** — `console.error`, excepciones sin capturar,
   promesas rechazadas sin manejar y requests de recursos que fallan (p. ej. el CDN
   no cargó).
3. **Un render loop activo** — se instrumenta `requestAnimationFrame` y las draw
   calls de WebGL _antes_ de que corra cualquier script de la página; los
   contadores deben seguir avanzando después de que la escena se asienta (no basta
   con "se llamó una vez").

Ante un fallo le entrega al modelo el **screenshot (como imagen)** más una lista con
viñetas de exactamente qué salió mal, y pide el archivo completo corregido.
`MAX_ATTEMPTS` es 3 por defecto; en este sprint corrió en 2.

Una cuarta señal (no es compuerta de aprobado/reprobado) alimenta el score de
interactividad: un _poke_ de interacción — arrastrar sobre el canvas + rueda +
flechas — restando la animación pasiva, más la instrumentación de qué listeners de
entrada registró la página.

---

## Improvement changelog — baseline vs. solución

**Baseline** = una llamada al modelo, sin verificación, sin reintentos.
**Solución** = generar → verificar → reintentar con el screenshot + el log de
errores como feedback.

Ambas se puntúan con el **mismo rubro 0–100**: render correcto (40) + sin errores
(20) + interactividad real (20) + contenido apropiado al nivel (20, juez LLM con
respaldo heurístico).

### Lo que realmente se corrió

| Ajuste | Valor |
|---|---|
| Modelo | `claude-sonnet-4-6` |
| `EFFORT` | `low` (ver _Limitaciones_ — era `medium` y causaba truncado) |
| `MAX_TOKENS` | `64000` |
| `MAX_ATTEMPTS` | `2` |
| Casos en la corrida final | **2** (`cases/cases.json`), recortado de 10 → 5 → 2 por tiempo |

### Tabla de resultados

> **Estado honesto al entregar:** la corrida puntuada (`eval/results.json`, fechada
> `2026-08-31T17:18Z`) completó el **caso 1** y luego **se detuvo — se agotó el
> saldo de créditos de la API de Anthropic** a mitad de corrida
> (`invalid_request_error`, _"credit balance is too low"_). Es un alto por
> facturación de la cuenta, no un error del pipeline. Los casos 3–5 se escribieron
> pero no se corrieron.

| # | Materia | Nivel | Baseline /100 | Solución /100 | Δ | Intentos | Verificador: base → sol |
|---|---|---|:--:|:--:|:--:|:--:|:--:|
| 1 | Idiomas (vocabulario en inglés, inmersivo) | primaria | **97** | **97** | **+0** | 1 | pasa → pasa |
| 2 | Física (dilatación temporal, relatividad especial) | preparatoria | — | — | — | — | **corrida detenida: sin créditos de API** |
| 3 | Historia del Arte (galería renacentista interactiva) | secundaria | no corrido | no corrido | — | — | — |
| 4 | Literatura (escena 3D de un pasaje literario) | primaria | no corrido | no corrido | — | — | — |
| 5 | Biología (doble hélice del ADN) | secundaria | no corrido | no corrido | — | — | — |

**Desglose del caso 1 (idéntico en ambos lados):** render 40/40 · errores 20/20 ·
interactividad 20/20 · nivel apropiado 17/20 (juez LLM: _"vocabulario básico del
hogar, instrucciones simples, interacción click-and-hear — ideal para primaria;
escena 3D reconocible; leve: faltan `window` y `shelf` visibles"_).

**Cómo leer el Δ = 0.** El caso 1 es un caso fácil: la única llamada del baseline
ya produjo una escena correcta, sin errores e interactiva (verificador `ok = true`;
`pokeDelta` 0.84 — la escena reaccionó fuerte al input), así que el ciclo de
verificar-y-reintentar no tenía nada que arreglar. El ciclo es **un seguro contra
el modo de falla**; en este caso el modelo no cayó en él. Su valor en los casos que
**sí** fallan lo demuestran los controles negativos de abajo, no esta fila. Corre
`npm run eval` cuando haya créditos para poblar los casos 2–5.

### Evidencia ya capturada (real, reproducible)

Esto sí se corrió y es la base de la afirmación:

- **Verificador, control positivo** — `test/cube.html` (un cubo iluminado girando,
  Three.js por CDN): **pasa 3/3 comprobaciones**. WebGL por software con SwiftShader
  confirmado (contexto `webgl2`, ~186 rAF/s, 372 draw calls en una ventana de
  0.6 s, 0 errores). `npm run verify:cube`.
- **Verificador, controles negativos** — `test/verify-negatives.js`: un canvas
  negro reprueba las comprobaciones 1 + 3; una página que hace `console.error` y
  lanza una excepción reprueba la 2; un canvas de un solo color plano reprueba la 1.
  **3/3 rechazados correctamente.**
- **`eval` completo sobre el caso 1** (vocabulario en inglés, primaria): baseline
  **y** solución puntuaron **97/100**; verificador `ok = true` en ambos — no negro
  (σ-luma 40, 258 colores distintos), **0 errores de consola**, render loop activo
  (rafDelta 140, ~10 000 draw calls en 0.6 s), listeners
  `pointerdown / pointermove / wheel / click`, la escena reaccionó fuerte al poke
  (`pokeDelta` 0.84 vs idle 0.001). La solución pasó al primer intento.
- **Generar en vivo**, caso de relatividad (preparatoria): **11.8 KB**, sin
  truncar, 67.8 s, thinking 175 tokens (antes de que se agotaran los créditos).
- **Bug de truncado encontrado y corregido.** Con `EFFORT=medium` +
  `MAX_TOKENS=24000`, el adaptive thinking consumía todo el presupuesto de tokens
  antes de emitir HTML: **salida de 0 bytes en 2/2 casos tras ~330 s cada uno.**
  Cambiar a `EFFORT=low` + `MAX_TOKENS=64000` bajó el thinking a ~175 tokens e hizo
  la generación 3–5× más rápida sin truncar. Es exactamente el tipo de falla
  silenciosa que la filosofía del verify-loop busca sacar a la luz.

---

## Impacto más allá de programación

Los 5 casos diseñados cubren **Historia del Arte, Idiomas, Física, Literatura y
Biología**. **Ninguno es de programación — a propósito.**

- Un docente de _cualquier_ materia describe lo que quiere en `cases/cases.json`
  (cuatro campos en lenguaje llano) y corre un comando. Sin código.
- Un alumno que habría abandonado ante una pantalla negra recibe en cambio **el
  screenshot y el log**, y aprende _por qué_ falló — el ciclo de depuración se
  vuelve material didáctico.

Ver `docs/DOCENTES.md` para la guía de una página, no técnica, para docentes (cómo
describir un tema, el comando único, cómo leer el reporte, 3 ejemplos resueltos en
materias distintas).

## Hot take

Un agente que genera contenido visual sin poder observar su propia salida está
**adivinando**. Devolverle el screenshot convierte _generación_ en _verificación_.
Y eso no es solo mejora técnica — es lo que hace la herramienta usable por alguien
que **no puede leer el código**.

---

## Trabajo previo declarado (regla 02)

Los repositorios **`marcus-escalona-portfolio`**, **`solar-system-ebvg`**,
**`atlas-ebvg`**, **`dna-journey-ebvg`** y **`3d-student-portfolio`** existían
**antes** del hackathon y se usan **solo como referencia de calidad** de cómo debe
verse una experiencia terminada. **Todo el pipeline de este repositorio es nuevo** —
verificador, ciclo de generación, scoring, arnés de evaluación, casos y docs.

## Revisión humana (regla 05)

**El sistema propone; el docente aprueba.** Ningún material generado llega a un
alumno sin que Marco (o el docente de la materia) revise antes la experiencia
renderizada y su reporte. El pipeline produce artefactos y un score; no publica.

## Herramienta de agente declarada

**Claude Code (Sonnet).**

## Limitaciones declaradas

Sprint de hackathon con tiempo limitado. Documentado exactamente como se corrió:

- **Casos recortados** de 10 planeados → 5 escritos → **2 en la corrida puntuada
  final**, puramente por tiempo de reloj. Los casos 3–5 están en el historial de
  git; 6–10 se descartaron. De los 2, solo el **caso 1 completó** antes de que se
  acabaran los créditos.
- **`EFFORT=low`** (no `medium`/`high`) tras el bug de truncado de arriba — cambia
  algo de profundidad de razonamiento por lograr terminar dentro del sprint.
- **`MAX_ATTEMPTS=2`** en lugar del 3 por defecto.
- El tiempo por generación es **muy variable** (68 s – 552 s observados) y dominó el
  presupuesto del sprint; `eval` regenera baseline y solución, por eso se redujo la
  corrida en vez de paralelizarla.
- **La cuenta de la API de Anthropic se quedó sin créditos durante la corrida
  puntuada.** El caso 1 está en `eval/results.json`; el caso 2 devolvió
  `invalid_request_error` (_"credit balance is too low"_) y los casos 2–5 no
  corrieron. Se repite tal cual con `npm run eval` cuando haya créditos — sin
  cambios de código. El camino del verificador (sin API key) sigue completamente
  ejercitado con `npm run verify:cube` y `npm run verify:negatives`.

---

## Cómo correrlo

### Preparación (una vez)

```bash
npm install
npx playwright install chromium
cp .env.example .env      # luego pon ANTHROPIC_API_KEY=sk-ant-... en .env
```

El verificador **no** necesita API key. La generación sí.

### Comandos

```bash
npm run verify:cube        # probar que WebGL headless funciona (sin API key)
npm run verify:negatives   # probar que el verificador rechaza salida rota (sin API key)
npm run baseline           # genera out/baseline/case-XX.html — 1 llamada, sin verificación
npm run solution           # genera + verifica + reintenta → out/solution/
npm run eval               # baseline + solución + score → eval/results.json + eval/results.md
```

Luego abre **`docs/report.html`** (arrástrale `eval/results.json` si no carga solo)
para el reporte docente lado a lado.

Ajustes por `.env`: `MODEL`, `EFFORT` (`low|medium|high|max`), `MAX_TOKENS`,
`MAX_ATTEMPTS`.

## Estructura

```
baseline/index.js   1 llamada, sin verificación, sin reintentos
solution/index.js   generar → verificar → reintentar (máx 2–3) con screenshot + errores como feedback
eval/index.js       corre ambos sobre los mismos casos, puntúa 0–100, escribe results.json + results.md
cases/cases.json    pares tema + nivel (2 en la corrida final; 5 escritos)
lib/verifier.js     EL VERIFICADOR — Chromium headless, análisis de píxeles, hooks de rAF/draw, captura de errores
lib/generate.js     API de Anthropic (claude-sonnet-4-6), streaming, adaptive thinking, prompt de reparación
lib/score.js        rubro 0–100: render 40 · errores 20 · interactividad 20 · nivel 20 (juez LLM)
lib/prompts.js      prompts de sistema + inicial + reparación
lib/browser.js      flags de lanzamiento de Chromium para WebGL por software
test/               cube.html (control positivo) + verify-negatives.js (controles negativos)
docs/report.html    reporte docente autocontenido: resumen + baseline vs solución por caso
docs/DOCENTES.md    guía de una página, no técnica, para docentes
out/                HTML generados + screenshots
```

## Rubro de puntuación (0–100 por caso)

| Criterio | Puntos | Cómo |
|---|---:|---|
| Renderiza correctamente | 40 | canvas no negro **y** con varianza **y** render loop activo (40) → visible pero sin loop (24) → casi monocromo (12) → negro (4) → sin canvas (0) |
| Sin errores | 20 | 0 errores = 20; −7 por error |
| Interactividad real | 20 | listeners de entrada **y** la escena reaccionó al poke (20) → listeners + señales en código (15) → una señal (9) → nada (0) |
| Contenido apropiado al nivel | 20 | juez LLM (`claude-sonnet-4-6`) sobre el texto en pantalla + screenshot + HTML; respaldo heurístico si no hay API key |

`results.json` guarda baseline y solución del mismo caso lado a lado, con el
desglose por criterio, el log de intentos de la solución y el detalle completo del
verificador.
