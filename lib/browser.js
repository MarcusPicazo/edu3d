// Lanzamiento de Chromium headless con WebGL por software (SwiftShader vía ANGLE).
// Estos flags son los que hacen que WebGL funcione sin GPU en CI / headless.
import { chromium } from 'playwright';

export const WEBGL_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--enable-webgl',
  '--enable-webgl2-compute-context',
  '--ignore-gpu-blocklist',
  '--disable-gpu-sandbox',
  '--no-sandbox',
  '--mute-audio',
  '--disable-dev-shm-usage',
];

/**
 * Lanza un navegador Chromium listo para WebGL headless.
 * Reutiliza una sola instancia para muchas verificaciones (más rápido en /eval).
 * @param {{ headless?: boolean }} [opts]
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchBrowser({ headless = true } = {}) {
  return chromium.launch({ headless, args: WEBGL_ARGS });
}
