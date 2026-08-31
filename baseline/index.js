// /baseline — genera con una sola llamada al modelo. SIN verificación, SIN reintentos.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateExperience, genConfig } from '../lib/generate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
export const BASELINE_DIR = path.join(ROOT, 'out', 'baseline');

/**
 * Genera UNA experiencia para un caso, sin verificarla.
 * @param {{id:number,topic:string,level:string,learningGoal?:string}} c
 * @param {object} [cfg]  { model, effort, maxTokens }
 */
export async function runBaseline(c, cfg = {}) {
  await fs.mkdir(BASELINE_DIR, { recursive: true });
  const id = String(c.id).padStart(2, '0');
  const t0 = Date.now();

  const gen = await generateExperience({
    topic: c.topic,
    level: c.level,
    learningGoal: c.learningGoal,
    ...cfg,
  });

  const htmlPath = path.join(BASELINE_DIR, `case-${id}.html`);
  await fs.writeFile(htmlPath, gen.html || '<!doctype html><title>vacío</title>');

  return {
    id: c.id,
    topic: c.topic,
    level: c.level,
    htmlPath,
    html: gen.html,
    attempts: 1,
    genMs: Date.now() - t0,
    usage: gen.usage,
    stopReason: gen.stopReason,
    truncated: gen.truncated,
  };
}

async function main() {
  const cases = JSON.parse(await fs.readFile(path.join(ROOT, 'cases', 'cases.json'), 'utf8'));
  const cfg = genConfig();
  console.log(`baseline · ${cases.length} casos · modelo ${cfg.model} · effort ${cfg.effort}\n`);

  for (const c of cases) {
    const tag = `[${String(c.id).padStart(2, '0')}] ${c.topic} (${c.level})`;
    process.stdout.write(`  ${tag} … `);
    try {
      const r = await runBaseline(c, cfg);
      console.log(
        `ok · ${r.html.length} bytes · ${(r.genMs / 1000).toFixed(1)}s` +
        (r.truncated ? ' · ⚠ truncado (sube MAX_TOKENS)' : ''),
      );
    } catch (e) {
      console.log('ERROR:', String((e && e.message) || e));
    }
  }
  console.log(`\nHTMLs en ${path.relative(process.cwd(), BASELINE_DIR)}/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(String((e && e.stack) || e));
    process.exit(1);
  });
}
