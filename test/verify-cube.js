// Prueba de humo del VERIFICADOR: corre verifyExperience() sobre un cubo giratorio
// de Three.js y reporta si WebGL headless (SwiftShader) funciona en esta máquina.
//
//   npm run verify:cube
//
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyExperience } from '../lib/verifier.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(here, 'cube.html');
const screenshotPath = path.join(here, '..', 'out', 'cube-verify.png');

console.log('Verificando:', htmlPath);
const res = await verifyExperience(htmlPath, { screenshotPath });

const c = res.checks;
const line = (label, pass, extra) =>
  `  ${pass ? '✅' : '❌'} ${label}${extra ? `  — ${extra}` : ''}`;

console.log('\n──────────────── COMPROBACIONES ────────────────');
console.log(line(
  '1. Canvas NO en negro',
  c.rendersNotBlack.pass,
  `stdLuma=${c.rendersNotBlack.pixels.stdLuma} maxLuma=${c.rendersNotBlack.pixels.maxLuma} ` +
  `brightFrac=${c.rendersNotBlack.pixels.brightFrac} colores=${c.rendersNotBlack.pixels.distinctColors}`,
));
console.log(line(
  '2. Cero errores en consola',
  c.noConsoleErrors.pass,
  `console=${c.noConsoleErrors.consoleErrors.length} page=${c.noConsoleErrors.pageErrors.length} ` +
  `recursos=${c.noConsoleErrors.resourceErrors.length} runtime=${c.noConsoleErrors.runtimeErrors.length}`,
));
console.log(line(
  '3. Render loop activo',
  c.renderLoopActive.pass,
  `rafDelta=${c.renderLoopActive.rafDelta} drawDelta=${c.renderLoopActive.drawDelta} ` +
  `contextos=${JSON.stringify(c.renderLoopActive.contextRequests)}`,
));
console.log('\n  Interactividad (informativo):',
  `listeners=[${res.interactivity.interactionListeners.join(', ')}]`,
  `idleDelta=${res.interactivity.idleDelta} pokeDelta=${res.interactivity.pokeDelta}`,
  `reaccionó=${res.interactivity.reactedToPoke}`);

if (!c.noConsoleErrors.pass) {
  console.log('\n  Errores capturados:');
  for (const e of [
    ...c.noConsoleErrors.consoleErrors,
    ...c.noConsoleErrors.pageErrors,
    ...c.noConsoleErrors.resourceErrors,
    ...c.noConsoleErrors.runtimeErrors,
  ]) console.log('   -', e);
}
if (res.navError) console.log('\n  navError:', res.navError);

console.log('\n──────────────── RESULTADO ────────────────');
console.log(res.ok
  ? '✅ WebGL headless FUNCIONA — el verificador está operativo.'
  : '❌ Falló alguna comprobación (ver arriba).');
console.log('Screenshot:', screenshotPath);
console.log('\nJSON completo:');
console.log(JSON.stringify(res, null, 2));

process.exit(res.ok ? 0 : 1);
