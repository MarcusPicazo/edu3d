// Scoring 0-100 por caso:
//   render correcto ............ 40   (objetivo: verificador)
//   sin errores ................ 20   (objetivo: verificador)
//   interactividad real ........ 20   (listeners + reacción al "poke" + señales en código)
//   contenido apropiado al nivel 20   (juez LLM; heurística de respaldo)
import Anthropic from '@anthropic-ai/sdk';

export function scoreRenders(v) {
  if (v.navError) return { points: 0, why: 'la página no cargó' };
  const r = v.checks.rendersNotBlack;
  const l = v.checks.renderLoopActive;
  if (r.pass && l.pass) return { points: 40, why: 'render con contenido visible y loop activo' };
  if (r.pass && !l.pass) return { points: 24, why: 'render visible pero sin loop activo' };
  if (r.canvasRect && r.notBlack && !r.hasVariance) return { points: 12, why: 'canvas casi monocromo (poca geometría visible)' };
  if (r.canvasRect && !r.notBlack) return { points: 4, why: 'canvas en negro' };
  return { points: 0, why: 'sin canvas' };
}

export function scoreErrors(v) {
  if (v.navError) return { points: 0, why: 'navegación falló' };
  const e = v.checks.noConsoleErrors;
  const n =
    e.consoleErrors.length +
    e.pageErrors.length +
    e.resourceErrors.length +
    e.runtimeErrors.length;
  if (n === 0) return { points: 20, why: 'sin errores' };
  return { points: Math.max(0, 20 - 7 * n), why: `${n} error(es) en la página` };
}

export function scoreInteractivity(v, html) {
  const wired = v.interactivity.interactionListeners.length > 0;
  const reacted = v.interactivity.reactedToPoke;
  const staticSignal =
    /OrbitControls|Raycaster|addEventListener\(\s*['"`](?:pointer|mouse|wheel|key|click|touch|dblclick)/i.test(html || '');
  if (wired && reacted) return { points: 20, why: 'listeners de input y la escena reaccionó al arrastre/teclas' };
  if (wired && staticSignal) return { points: 15, why: 'listeners + interacción en el código, sin reacción visible marcada' };
  if (wired || staticSignal) return { points: 9, why: 'señales parciales de interacción' };
  return { points: 0, why: 'sin interacción detectable' };
}

function fallbackLevelScore(bodyText) {
  const len = (bodyText || '').length;
  let p = 6;
  if (len > 80) p += 4;
  if (len > 240) p += 3;
  if (len > 500) p += 2;
  if (/\b(porque|por qué|cómo|imagina|ejemplo|es decir|significa)\b/i.test(bodyText || '')) p += 3;
  return { points: Math.min(20, p), why: 'heurística (sin juez LLM)', rationale: '' };
}

export async function scoreLevelContent({ topic, level, verify, html, model, screenshotB64 }) {
  const bodyText = (verify.content && verify.content.bodyText) || '';
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return fallbackLevelScore(bodyText);
  }
  try {
    const sys =
      'Eres evaluador de material educativo. Califica de 0 a 20 qué tan apropiado es ' +
      'el CONTENIDO de esta experiencia 3D (texto en pantalla, vocabulario, profundidad ' +
      'conceptual, tipo de interacción) para el NIVEL objetivo. 20 = ajuste excelente al ' +
      'nivel; 10 = aceptable con desajustes; 0 = nivel equivocado o contenido irrelevante. ' +
      'Considera también si la escena representa de verdad el tema. ' +
      'Responde SOLO JSON: {"score": <entero 0-20>, "rationale": "<=180 chars"}.';
    const userText =
      `Tema: ${topic}\nNivel objetivo: ${level}\n\n` +
      `Texto en pantalla:\n"""${bodyText || '(ninguno)'}"""\n\n` +
      `Extracto del HTML:\n"""${(html || '').slice(0, 1800)}"""`;
    const content = screenshotB64
      ? [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotB64 } },
          { type: 'text', text: userText },
        ]
      : userText;

    const client = new Anthropic();
    const msg = await client.messages.create({
      model: model || process.env.MODEL || 'claude-sonnet-4-6',
      max_tokens: 400,
      system: sys,
      messages: [{ role: 'user', content }],
    });
    const txt = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const m = txt.match(/\{[\s\S]*?\}/);
    if (!m) return { ...fallbackLevelScore(bodyText), why: 'heurística (juez sin JSON)' };
    const parsed = JSON.parse(m[0]);
    const score = Math.max(0, Math.min(20, Math.round(Number(parsed.score))));
    return { points: Number.isFinite(score) ? score : 10, why: 'juez LLM', rationale: String(parsed.rationale || '') };
  } catch (e) {
    return { ...fallbackLevelScore(bodyText), why: 'heurística (juez LLM falló: ' + String(e && e.message).slice(0, 60) + ')' };
  }
}

/**
 * @returns {{ total:number, breakdown:object, verifyOk:boolean }}
 */
export async function scoreCase({ topic, level, verify, html, model, screenshotB64 }) {
  const renders = scoreRenders(verify);
  const errors = scoreErrors(verify);
  const interactivity = scoreInteractivity(verify, html);
  const levelContent = await scoreLevelContent({ topic, level, verify, html, model, screenshotB64 });
  const total = renders.points + errors.points + interactivity.points + levelContent.points;
  return {
    total,
    breakdown: {
      renders: { max: 40, ...renders },
      errors: { max: 20, ...errors },
      interactivity: { max: 20, ...interactivity },
      levelContent: { max: 20, ...levelContent },
    },
    verifyOk: verify.ok,
  };
}
