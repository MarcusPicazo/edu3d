// ============================================================================
// EL VERIFICADOR
// Abre un HTML generado en Chromium headless (WebGL por software), espera a que
// asiente, toma screenshot y comprueba tres cosas:
//   1. El canvas NO está en negro  -> varianza / luminancia de los píxeles
//   2. Cero errores en consola     -> console.error + pageerror + requests fallidos
//   3. Hay un render loop activo    -> se instrumenta requestAnimationFrame
// Además hace un "poke" de interacción (arrastrar + rueda + teclas) y mide si la
// escena reacciona, para alimentar el score de interactividad.
//
// Devuelve un objeto estructurado; `ok` es true solo si pasan las 3 comprobaciones.
// ============================================================================
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { launchBrowser } from './browser.js';

const SETTLE_MS = 2000;          // espera pedida en el enunciado
const LOOP_SAMPLE_MS = 600;      // ventana para confirmar que el loop sigue vivo
const POKE_SETTLE_MS = 400;      // espera tras interactuar antes de re-capturar

const INTERACTION_EVENTS = [
  'pointerdown', 'pointermove', 'pointerup',
  'mousedown', 'mousemove', 'mouseup',
  'wheel', 'keydown', 'keyup',
  'click', 'dblclick', 'touchstart', 'touchmove',
];

// Script que se inyecta ANTES de cualquier script de la página, en cada frame.
// Instrumenta rAF, draw calls de WebGL, getContext, addEventListener y errores.
function instrumentation() {
  const w = window;
  const V = {
    rafCount: 0,
    rafStamps: [],
    drawCalls: 0,
    contextRequests: [],
    listeners: {},
    errors: [],
  };
  w.__verify = V;

  const origRAF =
    typeof w.requestAnimationFrame === 'function'
      ? w.requestAnimationFrame.bind(w)
      : null;
  if (origRAF) {
    w.requestAnimationFrame = function (cb) {
      V.rafCount++;
      if (V.rafStamps.length < 8) V.rafStamps.push(Date.now());
      return origRAF(cb);
    };
  }

  const wrapDraw = (proto) => {
    if (!proto) return;
    for (const name of [
      'drawArrays', 'drawElements',
      'drawArraysInstanced', 'drawElementsInstanced',
    ]) {
      const orig = proto[name];
      if (typeof orig !== 'function') continue;
      proto[name] = function (...args) {
        V.drawCalls++;
        return orig.apply(this, args);
      };
    }
  };
  try { wrapDraw(w.WebGLRenderingContext && w.WebGLRenderingContext.prototype); } catch {}
  try { wrapDraw(w.WebGL2RenderingContext && w.WebGL2RenderingContext.prototype); } catch {}

  try {
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      try { V.contextRequests.push(String(type)); } catch {}
      return origGetContext.call(this, type, ...rest);
    };
  } catch {}

  try {
    const origAEL = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, ...rest) {
      try { V.listeners[type] = (V.listeners[type] || 0) + 1; } catch {}
      return origAEL.call(this, type, ...rest);
    };
  } catch {}

  w.addEventListener('error', (ev) => {
    V.errors.push(String((ev && (ev.message || ev.error)) || 'error'));
  });
  w.addEventListener('unhandledrejection', (ev) => {
    V.errors.push('unhandledrejection: ' + String(ev && ev.reason));
  });

  w.__verifySnapshot = function () {
    const canvases = Array.from(document.querySelectorAll('canvas')).map((c) => {
      const r = c.getBoundingClientRect();
      return {
        w: c.width, h: c.height,
        x: r.x, y: r.y, rw: r.width, rh: r.height,
        area: r.width * r.height,
      };
    });
    canvases.sort((a, b) => b.area - a.area);
    return {
      rafCount: V.rafCount,
      rafStamps: V.rafStamps.slice(),
      drawCalls: V.drawCalls,
      contextRequests: V.contextRequests.slice(),
      listeners: { ...V.listeners },
      errors: V.errors.slice(),
      canvases,
      title: document.title || '',
      bodyText: ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 6000),
    };
  };
}

// ---- análisis de píxeles sobre el PNG del screenshot ------------------------

function clampRect(rect, width, height) {
  if (!rect) return { x0: 0, y0: 0, x1: width, y1: height };
  let x0 = Math.max(0, Math.floor(rect.x ?? 0));
  let y0 = Math.max(0, Math.floor(rect.y ?? 0));
  let x1 = Math.min(width, Math.ceil((rect.x ?? 0) + (rect.rw ?? width)));
  let y1 = Math.min(height, Math.ceil((rect.y ?? 0) + (rect.rh ?? height)));
  if (x1 - x0 < 8 || y1 - y0 < 8) return { x0: 0, y0: 0, x1: width, y1: height };
  return { x0, y0, x1, y1 };
}

function analyzeRegion(png, rect) {
  const { width, height, data } = png;
  const { x0, y0, x1, y1 } = clampRect(rect, width, height);
  let n = 0, sum = 0, sumSq = 0, minL = 255, maxL = 0, bright = 0;
  const colors = new Set();
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      n++; sum += l; sumSq += l * l;
      if (l < minL) minL = l;
      if (l > maxL) maxL = l;
      if (l > 16) bright++;
      if (colors.size < 8192) {
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      }
    }
  }
  if (n === 0) {
    return { sampled: 0, meanLuma: 0, stdLuma: 0, minLuma: 0, maxLuma: 0, brightFrac: 0, distinctColors: 0 };
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  return {
    sampled: n,
    meanLuma: +mean.toFixed(2),
    stdLuma: +std.toFixed(2),
    minLuma: +minL.toFixed(2),
    maxLuma: +maxL.toFixed(2),
    brightFrac: +(bright / n).toFixed(4),
    distinctColors: colors.size,
  };
}

function regionDiffFraction(pngA, pngB, rect, threshold = 14) {
  const width = Math.min(pngA.width, pngB.width);
  const height = Math.min(pngA.height, pngB.height);
  const { x0, y0, x1, y1 } = clampRect(rect, width, height);
  let n = 0, changed = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * 4;
      const d =
        Math.abs(pngA.data[i] - pngB.data[i]) +
        Math.abs(pngA.data[i + 1] - pngB.data[i + 1]) +
        Math.abs(pngA.data[i + 2] - pngB.data[i + 2]);
      n++;
      if (d > threshold) changed++;
    }
  }
  return n ? changed / n : 0;
}

// ---- API principal --------------------------------------------------------

/**
 * @param {string} htmlPath  ruta al .html a verificar
 * @param {object} [opts]
 * @param {import('playwright').Browser} [opts.browser]  navegador a reutilizar
 * @param {string} [opts.screenshotPath]  dónde guardar el screenshot principal
 * @param {number} [opts.settleMs]  espera tras cargar (default 2000)
 * @param {boolean} [opts.probeInteractivity]  hacer el "poke" (default true)
 * @param {number} [opts.viewportWidth] / [opts.viewportHeight]
 */
export async function verifyExperience(htmlPath, opts = {}) {
  const {
    browser: sharedBrowser,
    screenshotPath,
    settleMs = SETTLE_MS,
    probeInteractivity = true,
    viewportWidth = 1280,
    viewportHeight = 800,
  } = opts;

  const t0 = Date.now();
  const browser = sharedBrowser || (await launchBrowser());
  const context = await browser.newContext({
    viewport: { width: viewportWidth, height: viewportHeight },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const resourceErrors = [];

  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') consoleErrors.push(text);
    else if (type === 'warning') consoleWarnings.push(text);
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err && (err.stack || err.message || err)));
  });
  page.on('requestfailed', (req) => {
    const f = req.failure();
    // ERR_ABORTED en navegaciones es ruido; nos interesan recursos que no cargaron
    if (f && !/ERR_ABORTED/i.test(f.errorText)) {
      resourceErrors.push(`${req.resourceType()} ${req.url()} — ${f.errorText}`);
    }
  });

  await page.addInitScript(instrumentation);

  const fileUrl = pathToFileURL(path.resolve(htmlPath)).href;
  let navError = null;
  let loadMs = 0;
  try {
    const tNav = Date.now();
    await page.goto(fileUrl, { waitUntil: 'load', timeout: 30000 });
    loadMs = Date.now() - tNav;
  } catch (e) {
    navError = String(e && (e.message || e));
  }

  await page.waitForTimeout(settleMs);

  let snap = null;
  try {
    snap = await page.evaluate(() => window.__verifySnapshot && window.__verifySnapshot());
  } catch (e) {
    pageErrors.push('snapshot failed: ' + String(e && e.message));
  }

  const canvasRect = snap && snap.canvases && snap.canvases[0] ? snap.canvases[0] : null;

  // Screenshot principal (estado asentado, antes de interactuar)
  let shotBuf = null;
  try {
    shotBuf = await page.screenshot({ type: 'png' });
    if (screenshotPath) {
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      await fs.writeFile(screenshotPath, shotBuf);
    }
  } catch (e) {
    pageErrors.push('screenshot failed: ' + String(e && e.message));
  }

  // ---- interacción: medir animación pasiva vs reacción al "poke" ----------
  let idleDelta = 0;
  let pokeDelta = 0;
  let pokeApplied = false;
  if (probeInteractivity && shotBuf) {
    try {
      await page.waitForTimeout(350);
      const idleBuf = await page.screenshot({ type: 'png' });
      idleDelta = regionDiffFraction(PNG.sync.read(shotBuf), PNG.sync.read(idleBuf), canvasRect);

      const cx = canvasRect ? canvasRect.x + canvasRect.rw / 2 : viewportWidth / 2;
      const cy = canvasRect ? canvasRect.y + canvasRect.rh / 2 : viewportHeight / 2;
      await page.mouse.move(cx - 120, cy);
      await page.mouse.down();
      for (let k = 1; k <= 6; k++) {
        await page.mouse.move(cx - 120 + k * 40, cy + Math.sin(k) * 20, { steps: 2 });
      }
      await page.mouse.up();
      await page.mouse.wheel(0, -240);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Space');
      pokeApplied = true;

      await page.waitForTimeout(POKE_SETTLE_MS);
      const afterBuf = await page.screenshot({ type: 'png' });
      pokeDelta = regionDiffFraction(PNG.sync.read(idleBuf), PNG.sync.read(afterBuf), canvasRect);
    } catch (e) {
      pageErrors.push('poke failed: ' + String(e && e.message));
    }
  }

  // ---- confirmar que el render loop sigue vivo ---------------------------
  const rafCountAtSettle = snap ? snap.rafCount : 0;
  await page.waitForTimeout(LOOP_SAMPLE_MS);
  let rafCountLater = rafCountAtSettle;
  let drawCallsLater = snap ? snap.drawCalls : 0;
  try {
    const s2 = await page.evaluate(() => window.__verifySnapshot && window.__verifySnapshot());
    if (s2) {
      rafCountLater = s2.rafCount;
      drawCallsLater = s2.drawCalls;
    }
  } catch {}

  const runtimeErrors = snap ? snap.errors : [];
  const totalTimeMs = Date.now() - t0;

  await context.close();
  if (!sharedBrowser) await browser.close();

  // ---- análisis de píxeles --------------------------------------------
  let pixels = { sampled: 0, meanLuma: 0, stdLuma: 0, minLuma: 0, maxLuma: 0, brightFrac: 0, distinctColors: 0 };
  if (shotBuf) {
    try {
      pixels = analyzeRegion(PNG.sync.read(shotBuf), canvasRect);
    } catch (e) {
      pageErrors.push('pixel analysis failed: ' + String(e && e.message));
    }
  }

  // ---- veredictos ----------------------------------------------------
  const notBlack = pixels.maxLuma > 12 && pixels.brightFrac > 0.005;
  const hasVariance = pixels.stdLuma >= 6 && pixels.distinctColors >= 4;
  const rendersPass = Boolean(canvasRect) && notBlack && hasVariance && !navError;

  const allErrors = [
    ...consoleErrors,
    ...pageErrors,
    ...resourceErrors,
    ...runtimeErrors,
  ];
  const noErrorsPass = allErrors.length === 0 && !navError;

  const rafDelta = rafCountLater - rafCountAtSettle;
  const drawDelta = drawCallsLater - (snap ? snap.drawCalls : 0);
  const renderLoopPass = rafDelta >= 3 || drawDelta >= 3;

  const listeners = (snap && snap.listeners) || {};
  const interactionListeners = INTERACTION_EVENTS.filter((e) => listeners[e] > 0);
  const reactedToPoke = pokeDelta > idleDelta + 0.02 && pokeDelta > idleDelta * 1.4;

  const ok = rendersPass && noErrorsPass && renderLoopPass;

  return {
    ok,
    htmlPath,
    screenshotPath: screenshotPath || null,
    navError,
    checks: {
      rendersNotBlack: {
        pass: rendersPass,
        notBlack,
        hasVariance,
        canvasCount: snap ? snap.canvases.length : 0,
        canvasRect,
        pixels,
      },
      noConsoleErrors: {
        pass: noErrorsPass,
        consoleErrors,
        pageErrors,
        resourceErrors,
        runtimeErrors,
        consoleWarnings,
      },
      renderLoopActive: {
        pass: renderLoopPass,
        rafHookInstalled: Boolean(snap && snap.rafStamps),
        rafCountAtSettle,
        rafCountLater,
        rafDelta,
        drawCallsLater,
        drawDelta,
        contextRequests: snap ? snap.contextRequests : [],
      },
    },
    interactivity: {
      interactionListeners,
      listenerCounts: listeners,
      idleDelta: +idleDelta.toFixed(4),
      pokeDelta: +pokeDelta.toFixed(4),
      pokeApplied,
      reactedToPoke,
    },
    content: {
      title: snap ? snap.title : '',
      bodyText: snap ? snap.bodyText : '',
    },
    timing: { loadMs, totalTimeMs },
  };
}

/**
 * Traduce un resultado de verifyExperience a viñetas accionables para el modelo
 * (se usa como feedback en los reintentos de /solution).
 * @returns {{ bullets: string[], data: object }}
 */
export function summarizeVerification(v) {
  const bullets = [];
  const r = v.checks.rendersNotBlack;
  const e = v.checks.noConsoleErrors;
  const l = v.checks.renderLoopActive;

  if (v.navError) bullets.push(`La página no cargó: ${v.navError}`);

  if (!r.pass) {
    if (!r.canvasRect) {
      bullets.push('No se encontró ningún <canvas>. Crea el WebGLRenderer y añade renderer.domElement al DOM.');
    } else if (!r.notBlack) {
      bullets.push(
        `El canvas se ve NEGRO/vacío (maxLuma=${r.pixels.maxLuma}, brightFrac=${r.pixels.brightFrac}). ` +
        'Define scene.background con color, añade AmbientLight + DirectionalLight, comprueba que la cámara ' +
        'apunta a la geometría y que se llama renderer.render(scene, camera) cada frame.',
      );
    } else if (!r.hasVariance) {
      bullets.push(
        `El canvas es casi de un solo color (stdLuma=${r.pixels.stdLuma}, colores=${r.pixels.distinctColors}). ` +
        'No hay geometría claramente visible: revisa posición/escala de las mallas y la distancia de la cámara.',
      );
    }
  }

  if (!e.pass) {
    const all = [
      ...e.consoleErrors.map((x) => `console: ${x}`),
      ...e.pageErrors.map((x) => `pageerror: ${x}`),
      ...e.resourceErrors.map((x) => `recurso: ${x}`),
      ...e.runtimeErrors.map((x) => `runtime: ${x}`),
    ];
    bullets.push(`Errores en la página (${all.length}):\n  - ${all.slice(0, 8).join('\n  - ')}`);
  }

  if (!l.pass) {
    bullets.push(
      `No se detecta un render loop activo (rafDelta=${l.rafDelta}, drawDelta=${l.drawDelta}). ` +
      'Usa renderer.setAnimationLoop((t) => { ...; renderer.render(scene, camera); }) y no lo detengas.',
    );
  }

  if (
    v.interactivity.pokeApplied &&
    !v.interactivity.reactedToPoke &&
    v.interactivity.interactionListeners.length === 0
  ) {
    bullets.push(
      'La escena no reacciona al mouse/teclado y no hay listeners de interacción. ' +
      'Agrega OrbitControls (enableDamping=true) y al menos otra interacción que cambie la escena.',
    );
  }

  return {
    bullets,
    data: {
      renders: r.pass,
      noErrors: e.pass,
      renderLoop: l.pass,
      stdLuma: r.pixels.stdLuma,
      maxLuma: r.pixels.maxLuma,
      brightFrac: r.pixels.brightFrac,
      distinctColors: r.pixels.distinctColors,
      consoleErrors: e.consoleErrors,
      pageErrors: e.pageErrors,
      resourceErrors: e.resourceErrors,
      runtimeErrors: e.runtimeErrors,
      rafDelta: l.rafDelta,
      drawDelta: l.drawDelta,
    },
  };
}
