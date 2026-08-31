// Casos negativos: confirma que el VERIFICADOR reprueba lo que debe reprobar.
// No usa red ni API. Genera fixtures rotos en un tmp y corre verifyExperience().
//
//   node test/verify-negatives.js
//
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyExperience, summarizeVerification } from '../lib/verifier.js';
import { launchBrowser } from '../lib/browser.js';

const FIXTURES = {
  // canvas 2d relleno de NEGRO, sin render loop
  'black.html': `<!doctype html><meta charset=utf-8><title>negro</title>
<style>html,body{margin:0;height:100%;background:#000}canvas{display:block}</style>
<canvas id=c width=800 height=600></canvas>
<script>const g=document.getElementById('c').getContext('2d');g.fillStyle='#000';g.fillRect(0,0,800,600);</script>`,

  // render con color y loop, pero LANZA errores
  'errors.html': `<!doctype html><meta charset=utf-8><title>errores</title>
<style>html,body{margin:0;height:100%}canvas{display:block}</style>
<canvas id=c width=800 height=600></canvas>
<script>
const g=document.getElementById('c').getContext('2d');
let t=0;
function loop(){t++;const grd=g.createLinearGradient(0,0,800,600);grd.addColorStop(0,'#f80');grd.addColorStop(1,'#08f');g.fillStyle=grd;g.fillRect(0,0,800,600);g.fillStyle='#fff';g.fillRect((t*3)%800,100,60,60);requestAnimationFrame(loop);}
loop();
console.error('boom: algo falló');
throw new Error('kaboom no capturado');
</script>`,

  // loop activo y no-negro, pero un SOLO color plano (nada renderizado de verdad)
  'blank.html': `<!doctype html><meta charset=utf-8><title>plano</title>
<style>html,body{margin:0;height:100%}canvas{display:block}</style>
<canvas id=c width=800 height=600></canvas>
<script>
const g=document.getElementById('c').getContext('2d');
function loop(){g.fillStyle='#2a4d8f';g.fillRect(0,0,800,600);requestAnimationFrame(loop);}
loop();
</script>`,
};

// qué comprobaciones esperamos que FALLEN en cada fixture
const EXPECT_FAIL = {
  'black.html': ['rendersNotBlack', 'renderLoopActive'],
  'errors.html': ['noConsoleErrors'],
  'blank.html': ['rendersNotBlack'],
};

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-neg-'));
const browser = await launchBrowser();
let allGood = true;

try {
  for (const [name, html] of Object.entries(FIXTURES)) {
    const p = path.join(dir, name);
    await fs.writeFile(p, html);
    const res = await verifyExperience(p, { browser, screenshotPath: path.join(dir, name + '.png') });
    const failed = Object.entries(res.checks).filter(([, v]) => !v.pass).map(([k]) => k);
    const want = EXPECT_FAIL[name];
    const ok =
      res.ok === false &&
      want.every((w) => failed.includes(w));
    allGood = allGood && ok;

    console.log(`\n${ok ? '✅' : '❌'} ${name}`);
    console.log(`   ok=${res.ok}  fallan=[${failed.join(', ')}]  esperado⊇[${want.join(', ')}]`);
    for (const b of summarizeVerification(res).bullets) console.log('   ·', b.split('\n')[0]);
  }
} finally {
  await browser.close();
  await fs.rm(dir, { recursive: true, force: true });
}

console.log('\n' + '─'.repeat(50));
console.log(allGood ? '✅ El verificador discrimina correctamente.' : '❌ Algún caso negativo no se detectó.');
process.exit(allGood ? 0 : 1);
