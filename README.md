# edu3d-verify-pipeline

Pipeline en Node.js que **genera experiencias educativas 3D en Three.js** con la API
de Anthropic y **las verifica visualmente** en Chromium headless con WebGL por
software (SwiftShader). Compara una línea base sin verificación contra una solución
que verifica y reintenta.

## Estructura

```
baseline/   genera con UNA sola llamada al modelo. Sin verificación, sin reintentos.
solution/   genera + verifica visualmente + reintenta (máx 3) con screenshot + errores como feedback.
eval/       corre baseline y solución sobre los mismos casos, puntúa 0-100 y escribe results.json + results.md.
cases/      cases.json — 10 pares tema + nivel.
lib/        verifier.js (el verificador), generate.js, prompts.js, score.js, browser.js, html.js
test/       cube.html + verify-cube.js — prueba de humo del verificador con un cubo giratorio.
out/        HTMLs generados y screenshots (baseline/ y solution/).
```

## El verificador (`lib/verifier.js`)

`verifyExperience(htmlPath, opts)` abre el HTML en Chromium headless con:

```
--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
```

espera 2 s, toma screenshot y comprueba **tres cosas**:

1. **El canvas NO está en negro** — analiza la región del canvas en el PNG: media
   y desviación estándar de luminancia, fracción de píxeles con brillo y número de
   colores distintos. Falla si es negro (`maxLuma` bajo) o casi monocromo
   (`stdLuma` y colores bajos → nada renderizado).
2. **Cero errores en consola** — `console.error`, `pageerror`, promesas sin
   capturar y requests de recursos que fallan (p. ej. el CDN).
3. **Render loop activo** — inyecta un hook a `requestAnimationFrame` y a las draw
   calls de WebGL *antes* de que corra la página; confirma que el contador sigue
   subiendo después de asentarse.

Además hace un *poke* de interacción (arrastrar sobre el canvas + rueda + teclas) y
mide si la escena reacciona más que por la animación pasiva; registra también qué
listeners de input se registraron. Eso alimenta el score de interactividad.

Devuelve un objeto con `ok` (las 3 comprobaciones) y todos los números.
`summarizeVerification(result)` lo traduce a viñetas accionables que `/solution`
manda de vuelta al modelo junto con el screenshot.

### Probar el verificador (no necesita API key)

```bash
npm install
npx playwright install chromium
npm run verify:cube
```

Debe terminar con `✅ WebGL headless FUNCIONA`. El screenshot queda en
`out/cube-verify.png`.

## Generación

`lib/generate.js` llama a la API de Anthropic (modelo `claude-sonnet-4-6` por
defecto) y pide **un HTML autocontenido** con Three.js por CDN (importmap a
`unpkg`), render loop, OrbitControls + otra interacción, fondo no negro, manejo de
resize y un panel de texto con contenido acorde al nivel.

- **baseline**: una sola llamada.
- **solution**: hasta 3 llamadas; cada reintento recibe el screenshot del fallo y
  la lista de problemas del verificador.

### Configurar la API key

```bash
cp .env.example .env
# edita .env y pon ANTHROPIC_API_KEY=sk-ant-...
```

o en PowerShell, para la sesión:

```bash
$env:ANTHROPIC_API_KEY="sk-ant-..."
```

## Correr

```bash
npm run baseline      # genera out/baseline/case-XX.html
npm run solution      # genera out/solution/case-XX.html (+ intentos + screenshots)
npm run eval          # baseline + solución + score → eval/results.json y eval/results.md
```

Variables opcionales (ver `.env.example`): `MODEL`, `EFFORT`, `MAX_TOKENS`,
`MAX_ATTEMPTS`.

## Rubro de evaluación (0-100 por caso)

| Criterio | Puntos | Cómo se mide |
|---|---:|---|
| Render correcto | 40 | canvas no negro **y** con varianza **y** render loop activo (40); render sin loop (24); casi monocromo (12); negro (4); sin canvas (0) |
| Sin errores | 20 | 0 errores = 20; `−7` por cada error |
| Interactividad real | 20 | listeners de input **y** la escena reaccionó al poke (20); listeners + señales en código (15); solo una señal (9); nada (0) |
| Contenido apropiado al nivel | 20 | juez LLM (`claude-sonnet-4-6`) sobre el texto en pantalla + screenshot + HTML; heurística de respaldo si no hay API key |

`results.json` guarda baseline y solución del mismo caso lado a lado, con el
desglose por criterio, el log de intentos de la solución y el detalle del
verificador. `results.md` es la misma tabla en formato legible.

## Requisitos

- Node ≥ 20.6 (usa `--env-file-if-exists`)
- Chromium de Playwright (`npx playwright install chromium`)
- `ANTHROPIC_API_KEY` para todo lo que llama al modelo (el verificador no la necesita)
