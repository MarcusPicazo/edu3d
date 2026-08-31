// /solution — genera + verifica visualmente + reintenta con el screenshot y los
// errores como feedback. Máximo 3 intentos (configurable con MAX_ATTEMPTS).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateExperience, genConfig } from '../lib/generate.js';
import { verifyExperience, summarizeVerification } from '../lib/verifier.js';
import { launchBrowser } from '../lib/browser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
export const SOLUTION_DIR = path.join(ROOT, 'out', 'solution');

const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || 3);

/**
 * Genera y repara hasta pasar el verificador o agotar los intentos.
 * @param {{id:number,topic:string,level:string,learningGoal?:string}} c
 * @param {object} [opts]  { browser, maxAttempts, model, effort, maxTokens }
 */
export async function runSolution(c, opts = {}) {
  const { browser, maxAttempts = MAX_ATTEMPTS, ...cfg } = opts;
  await fs.mkdir(SOLUTION_DIR, { recursive: true });
  const id = String(c.id).padStart(2, '0');
  const ownBrowser = !browser;
  const b = browser || (await launchBrowser());

  const attemptLog = [];
  let prevHtml = null;
  let feedback = null;
  let prevShotBuf = null;
  let html = null;
  let verify = null;
  let lastShotPath = null;
  const t0 = Date.now();

  try {
    for (let n = 1; n <= maxAttempts; n++) {
      const gen = await generateExperience({
        topic: c.topic,
        level: c.level,
        learningGoal: c.learningGoal,
        previousHtml: prevHtml,
        feedback,
        screenshotPngBuffer: prevShotBuf,
        ...cfg,
      });
      html = gen.html || '<!doctype html><title>vacío</title>';

      const attemptHtmlPath = path.join(SOLUTION_DIR, `case-${id}.attempt-${n}.html`);
      const attemptShotPath = path.join(SOLUTION_DIR, `case-${id}.attempt-${n}.png`);
      await fs.writeFile(attemptHtmlPath, html);

      verify = await verifyExperience(attemptHtmlPath, { browser: b, screenshotPath: attemptShotPath });
      lastShotPath = attemptShotPath;
      const sum = summarizeVerification(verify);

      attemptLog.push({
        n,
        ok: verify.ok,
        htmlPath: attemptHtmlPath,
        shotPath: attemptShotPath,
        problems: sum.bullets,
        data: sum.data,
        genMs: gen.elapsedMs,
        usage: gen.usage,
        truncated: gen.truncated,
      });

      if (verify.ok) break;

      const extra = gen.truncated
        ? ['La salida anterior se cortó por longitud. Sé más conciso: menos comentarios, código más compacto.']
        : [];
      feedback = [...sum.bullets, ...extra].join('\n\n');
      prevHtml = html;
      prevShotBuf = await fs.readFile(attemptShotPath);
    }

    const finalHtmlPath = path.join(SOLUTION_DIR, `case-${id}.html`);
    const finalShotPath = path.join(SOLUTION_DIR, `case-${id}.png`);
    await fs.writeFile(finalHtmlPath, html);
    if (lastShotPath) await fs.copyFile(lastShotPath, finalShotPath);

    return {
      id: c.id,
      topic: c.topic,
      level: c.level,
      htmlPath: finalHtmlPath,
      screenshotPath: finalShotPath,
      html,
      verify,
      passed: Boolean(verify && verify.ok),
      attempts: attemptLog.length,
      attemptLog,
      totalMs: Date.now() - t0,
    };
  } finally {
    if (ownBrowser) await b.close();
  }
}

async function main() {
  const cases = JSON.parse(await fs.readFile(path.join(ROOT, 'cases', 'cases.json'), 'utf8'));
  const cfg = genConfig();
  console.log(
    `solution · ${cases.length} casos · modelo ${cfg.model} · effort ${cfg.effort} · máx ${MAX_ATTEMPTS} intentos\n`,
  );

  const b = await launchBrowser();
  let passed = 0;
  try {
    for (const c of cases) {
      const tag = `[${String(c.id).padStart(2, '0')}] ${c.topic} (${c.level})`;
      process.stdout.write(`  ${tag} … `);
      try {
        const r = await runSolution(c, { browser: b, ...cfg });
        if (r.passed) passed++;
        console.log(
          `${r.passed ? '✅' : '❌'} tras ${r.attempts} intento(s) · ${(r.totalMs / 1000).toFixed(1)}s`,
        );
        if (!r.passed) {
          for (const p of (r.attemptLog.at(-1)?.problems || [])) {
            console.log('       -', p.split('\n')[0]);
          }
        }
      } catch (e) {
        console.log('ERROR:', String((e && e.message) || e));
      }
    }
  } finally {
    await b.close();
  }
  console.log(`\n${passed}/${cases.length} pasaron el verificador.`);
  console.log(`HTMLs y screenshots en ${path.relative(process.cwd(), SOLUTION_DIR)}/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(String((e && e.stack) || e));
    process.exit(1);
  });
}
