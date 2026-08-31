// /eval — corre baseline y solución sobre los MISMOS casos, puntúa 0-100 cada uno
// con el mismo rubro y escribe results.json + results.md (misma tabla).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser } from '../lib/browser.js';
import { verifyExperience } from '../lib/verifier.js';
import { scoreCase } from '../lib/score.js';
import { genConfig } from '../lib/generate.js';
import { runBaseline, BASELINE_DIR } from '../baseline/index.js';
import { runSolution } from '../solution/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

async function b64(p) {
  try {
    return (await fs.readFile(p)).toString('base64');
  } catch {
    return null;
  }
}

function slimVerify(v) {
  return {
    ok: v.ok,
    navError: v.navError,
    canvasCount: v.checks.rendersNotBlack.canvasCount,
    pixels: v.checks.rendersNotBlack.pixels,
    errors: {
      console: v.checks.noConsoleErrors.consoleErrors,
      page: v.checks.noConsoleErrors.pageErrors,
      resource: v.checks.noConsoleErrors.resourceErrors,
      runtime: v.checks.noConsoleErrors.runtimeErrors,
    },
    renderLoop: {
      pass: v.checks.renderLoopActive.pass,
      rafDelta: v.checks.renderLoopActive.rafDelta,
      drawDelta: v.checks.renderLoopActive.drawDelta,
    },
    interactivity: {
      listeners: v.interactivity.interactionListeners,
      idleDelta: v.interactivity.idleDelta,
      pokeDelta: v.interactivity.pokeDelta,
      reactedToPoke: v.interactivity.reactedToPoke,
    },
    timing: v.timing,
  };
}

async function evalCase(c, browser, cfg) {
  const id = String(c.id).padStart(2, '0');

  // ---------- BASELINE: 1 generación, luego verificar + puntuar ----------
  const base = await runBaseline(c, cfg);
  const baseShot = path.join(BASELINE_DIR, `case-${id}.png`);
  const baseVerify = await verifyExperience(base.htmlPath, { browser, screenshotPath: baseShot });
  const baseScore = await scoreCase({
    topic: c.topic,
    level: c.level,
    verify: baseVerify,
    html: base.html,
    model: cfg.model,
    screenshotB64: await b64(baseShot),
  });

  // ---------- SOLUTION: generar + verificar + reintentar ----------
  const sol = await runSolution(c, { browser, ...cfg });
  const solScore = await scoreCase({
    topic: c.topic,
    level: c.level,
    verify: sol.verify,
    html: sol.html,
    model: cfg.model,
    screenshotB64: await b64(sol.screenshotPath),
  });

  return {
    id: c.id,
    topic: c.topic,
    level: c.level,
    learningGoal: c.learningGoal,
    baseline: {
      score: baseScore.total,
      breakdown: baseScore.breakdown,
      attempts: 1,
      genMs: base.genMs,
      truncated: base.truncated,
      htmlPath: rel(base.htmlPath),
      screenshot: rel(baseShot),
      verify: slimVerify(baseVerify),
    },
    solution: {
      score: solScore.total,
      breakdown: solScore.breakdown,
      attempts: sol.attempts,
      passed: sol.passed,
      totalMs: sol.totalMs,
      htmlPath: rel(sol.htmlPath),
      screenshot: rel(sol.screenshotPath),
      attemptLog: sol.attemptLog.map((a) => ({ n: a.n, ok: a.ok, problems: a.problems })),
      verify: slimVerify(sol.verify),
    },
  };
}

function summarize(rows) {
  const avg = (xs) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : 0);
  const n = rows.length || 1;
  return {
    n: rows.length,
    baseline: {
      avgScore: avg(rows.map((r) => r.baseline.score)),
      verifyPassRate: +(rows.filter((r) => r.baseline.verify.ok).length / n).toFixed(2),
    },
    solution: {
      avgScore: avg(rows.map((r) => r.solution.score)),
      verifyPassRate: +(rows.filter((r) => r.solution.verify.ok).length / n).toFixed(2),
      avgAttempts: avg(rows.map((r) => r.solution.attempts)),
    },
    avgScoreDelta: +(avg(rows.map((r) => r.solution.score)) - avg(rows.map((r) => r.baseline.score))).toFixed(1),
  };
}

function toMarkdown(rows, summary, meta) {
  const L = [];
  L.push('# Resultados de evaluación');
  L.push('');
  L.push(`- Modelo: \`${meta.model}\` · effort \`${meta.effort}\` · ${meta.timestamp}`);
  L.push(`- **Baseline**: ${summary.baseline.avgScore}/100 · verificador ${Math.round(summary.baseline.verifyPassRate * 100)}%`);
  L.push(`- **Solución**: ${summary.solution.avgScore}/100 · verificador ${Math.round(summary.solution.verifyPassRate * 100)}% · ${summary.solution.avgAttempts} intentos prom.`);
  L.push(`- **Δ score**: ${summary.avgScoreDelta >= 0 ? '+' : ''}${summary.avgScoreDelta}`);
  L.push('');
  L.push('| # | Tema | Nivel | Baseline | Solución | Δ | Intentos |');
  L.push('|---|------|-------|:--------:|:--------:|:--:|:--------:|');
  for (const r of rows) {
    const d = r.solution.score - r.baseline.score;
    L.push(`| ${r.id} | ${r.topic} | ${r.level} | ${r.baseline.score} | ${r.solution.score} | ${d >= 0 ? '+' : ''}${d} | ${r.solution.attempts} |`);
  }
  L.push('');
  L.push('## Desglose por criterio');
  L.push('');
  L.push('| # | | Render /40 | Errores /20 | Interact. /20 | Nivel /20 | Total |');
  L.push('|---|---|:--:|:--:|:--:|:--:|:--:|');
  for (const r of rows) {
    for (const [k, s] of [['baseline', r.baseline], ['solución', r.solution]]) {
      const b = s.breakdown;
      L.push(`| ${r.id} | ${k} | ${b.renders.points} | ${b.errors.points} | ${b.interactivity.points} | ${b.levelContent.points} | ${s.score} |`);
    }
  }
  return L.join('\n') + '\n';
}

async function main() {
  const cfg = genConfig();
  const cases = JSON.parse(await fs.readFile(path.join(ROOT, 'cases', 'cases.json'), 'utf8'));
  const meta = {
    model: cfg.model,
    effort: cfg.effort,
    maxTokens: cfg.maxTokens,
    timestamp: new Date().toISOString(),
    cases: cases.length,
  };
  console.log(`eval · ${cases.length} casos · baseline + solución · modelo ${cfg.model}\n`);

  const browser = await launchBrowser();
  const rows = [];
  try {
    for (const c of cases) {
      const t0 = Date.now();
      process.stdout.write(`  [${String(c.id).padStart(2, '0')}] ${c.topic} … `);
      try {
        const row = await evalCase(c, browser, cfg);
        rows.push(row);
        console.log(
          `base ${row.baseline.score} → sol ${row.solution.score} ` +
          `(${row.solution.attempts} int · ${((Date.now() - t0) / 1000).toFixed(0)}s)`,
        );
      } catch (e) {
        console.log('ERROR:', String((e && e.message) || e));
        rows.push({ id: c.id, topic: c.topic, level: c.level, error: String((e && e.message) || e) });
      }
    }
  } finally {
    await browser.close();
  }

  const scored = rows.filter((r) => !r.error);
  const summary = summarize(scored);
  const output = { meta, summary, cases: rows };

  await fs.writeFile(path.join(here, 'results.json'), JSON.stringify(output, null, 2));
  await fs.writeFile(path.join(here, 'results.md'), toMarkdown(scored, summary, meta));

  console.log('\n' + '─'.repeat(64));
  console.log(`Baseline:  ${summary.baseline.avgScore}/100   verificador ${Math.round(summary.baseline.verifyPassRate * 100)}%`);
  console.log(`Solución:  ${summary.solution.avgScore}/100   verificador ${Math.round(summary.solution.verifyPassRate * 100)}%   (${summary.solution.avgAttempts} intentos prom.)`);
  console.log(`Δ score:   ${summary.avgScoreDelta >= 0 ? '+' : ''}${summary.avgScoreDelta}`);
  console.log('─'.repeat(64));
  console.log(`\nEscrito: ${rel(path.join(here, 'results.json'))} · ${rel(path.join(here, 'results.md'))}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(String((e && e.stack) || e));
    process.exit(1);
  });
}
