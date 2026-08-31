// Generación vía API de Anthropic (Claude Sonnet 4.6 por defecto).
// - Sin feedback  -> generación inicial (baseline / primer intento).
// - Con feedback + previousHtml + screenshot -> intento de reparación.
import Anthropic from '@anthropic-ai/sdk';
import {
  buildSystemPrompt,
  buildInitialUserPrompt,
  buildRepairUserContent,
} from './prompts.js';
import { extractHtml } from './html.js';

const MODEL = process.env.MODEL || 'claude-sonnet-4-6';
const EFFORT = process.env.EFFORT || 'medium'; // low | medium | high | max
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 24000);

export function genConfig() {
  return { model: MODEL, effort: EFFORT, maxTokens: MAX_TOKENS };
}

let _client = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error(
      'Falta ANTHROPIC_API_KEY. Ponla en el entorno o crea un archivo .env ' +
      '(ver .env.example). En PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."',
    );
  }
  if (!_client) _client = new Anthropic();
  return _client;
}

async function finalMessageFor(params, onDelta) {
  const stream = client().messages.stream(params);
  if (onDelta) stream.on('text', onDelta);
  return stream.finalMessage();
}

/**
 * @param {object} a
 * @param {string} a.topic
 * @param {string} a.level
 * @param {string} [a.learningGoal]
 * @param {string|null} [a.previousHtml]
 * @param {string|null} [a.feedback]
 * @param {Buffer|Uint8Array|null} [a.screenshotPngBuffer]
 * @param {string} [a.model]
 * @param {string} [a.effort]
 * @param {number} [a.maxTokens]
 * @param {(t:string)=>void} [a.onDelta]
 */
export async function generateExperience({
  topic,
  level,
  learningGoal,
  previousHtml = null,
  feedback = null,
  screenshotPngBuffer = null,
  model = MODEL,
  effort = EFFORT,
  maxTokens = MAX_TOKENS,
  onDelta = null,
}) {
  const system = buildSystemPrompt();
  const isRepair = Boolean(feedback && previousHtml);
  const messages = [
    {
      role: 'user',
      content: isRepair
        ? buildRepairUserContent({ topic, level, learningGoal, previousHtml, feedback, screenshotPngBuffer })
        : buildInitialUserPrompt({ topic, level, learningGoal }),
    },
  ];

  const fullParams = {
    model,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort },
    system,
    messages,
  };

  const t0 = Date.now();
  let final;
  try {
    final = await finalMessageFor(fullParams, onDelta);
  } catch (err) {
    const msg = String((err && err.message) || err);
    // Fallback por si el SDK/endpoint rechaza thinking/effort en esta cuenta.
    if (err instanceof Anthropic.BadRequestError && /(output_config|effort|thinking)/i.test(msg)) {
      const { output_config, thinking, ...rest } = fullParams;
      final = await finalMessageFor(rest, onDelta);
    } else {
      throw err;
    }
  }
  const elapsedMs = Date.now() - t0;

  const rawText = final.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return {
    html: extractHtml(rawText),
    rawText,
    stopReason: final.stop_reason,
    truncated: final.stop_reason === 'max_tokens',
    usage: final.usage,
    model: final.model || model,
    elapsedMs,
    isRepair,
  };
}
