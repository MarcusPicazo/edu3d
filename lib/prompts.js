// Prompts para la generación de experiencias 3D.
// El objetivo: que el HTML generado pase el VERIFICADOR (render no negro, cero
// errores de consola, render loop activo) y tenga interactividad real + contenido
// ajustado al nivel.

const IMPORTMAP = `<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
  }
}
</script>`;

export function buildSystemPrompt() {
  return `Eres un generador de experiencias educativas 3D interactivas.

Devuelves UN ÚNICO archivo HTML autocontenido y nada más: sin explicaciones, sin
comentarios previos, SIN fences de markdown. La respuesta empieza exactamente con
"<!doctype html>".

REQUISITOS TÉCNICOS (obligatorios — se verifican automáticamente):
1. Three.js SOLO por CDN, con este importmap EXACTO y un <script type="module">:
${IMPORTMAP}
   No uses NINGÚN otro recurso externo: nada de otras librerías por CDN, ni
   texturas/modelos/imágenes/fuentes remotas. Todo lo visual se genera con código
   (geometrías, materiales, luces, CanvasTexture si hace falta).
2. El <canvas> ocupa todo el viewport. CSS mínimo:
   html,body{margin:0;height:100%;overflow:hidden} canvas{display:block}
3. Fondo NO negro: define scene.background = new THREE.Color(0x...) con un color
   claramente visible, y añade luces suficientes (Ambient + Directional como mínimo)
   para que la geometría se vea. La escena debe tener varias formas/colores.
4. Render loop CONTINUO con renderer.setAnimationLoop((t)=>{ ...; renderer.render(scene,camera); }).
   Nunca dejes de renderizar.
5. Interactividad REAL con mouse/teclado:
   - OrbitControls de "three/addons/controls/OrbitControls.js" (con enableDamping=true), y
   - al menos UNA interacción más que modifique la escena: Raycaster para
     seleccionar/resaltar objetos, o botones/sliders HTML que cambien parámetros
     visibles (velocidad, capas visibles, escala, paso de una animación...).
   Los controles de UI son HTML/CSS plano (no librerías de GUI).
6. Manejo de resize: actualiza camera.aspect, projectionMatrix y renderer.setSize.
7. CERO errores de consola. Usa la API vigente de three r160 (BufferGeometry,
   outputColorSpace, etc.). No uses APIs eliminadas (THREE.Geometry, .outputEncoding).
8. Texto explicativo SOBREPUESTO en HTML (un panel con position:fixed): título del
   tema y 2–5 frases o viñetas que expliquen el concepto. Incluye una línea de
   "cómo interactuar".

AJUSTE AL NIVEL (adapta vocabulario, profundidad y tipo de interacción):
- primaria: lenguaje muy simple, analogías cotidianas, frases cortas, sin fórmulas.
  Interacción directa y llamativa (arrastrar, botones grandes, colores vivos).
- secundaria: vocabulario técnico básico siempre definido, relaciones causa-efecto,
  fórmulas simples si aportan.
- preparatoria / bachillerato: terminología formal, variables y fórmulas,
  relaciones cuantitativas, ejes y escalas.
- universidad: rigor y notación formal (vectores, matrices, ecuaciones), casos
  límite y supuestos explícitos.

CALIDAD: la escena debe representar de verdad el concepto (no un placeholder), con
etiquetas o colores que conecten cada elemento 3D con la explicación.

Responde SOLO con el HTML.`;
}

export function buildInitialUserPrompt({ topic, level, learningGoal }) {
  return `Tema: ${topic}
Nivel: ${level}
Objetivo de aprendizaje: ${learningGoal || '(libre)'}

Crea la experiencia educativa 3D interactiva para este tema y nivel.`;
}

/**
 * Contenido del turno de usuario para un reintento de reparación.
 * Devuelve un array (imagen + texto) si hay screenshot, o un string si no.
 */
export function buildRepairUserContent({ topic, level, learningGoal, previousHtml, feedback, screenshotPngBuffer }) {
  const text = `El intento anterior FALLÓ la verificación visual automática.

Tema: ${topic} · Nivel: ${level} · Objetivo: ${learningGoal || '(libre)'}

PROBLEMAS DETECTADOS:
${feedback || '(sin detalle)'}

Te adjunto el screenshot del resultado actual (si aparece en negro o vacío, el
render está roto). Corrige TODOS los problemas manteniendo los requisitos técnicos
y el ajuste al nivel. Devuelve el HTML COMPLETO corregido, empezando con
"<!doctype html>", sin explicaciones.

HTML del intento anterior:
${previousHtml}`;

  if (screenshotPngBuffer && screenshotPngBuffer.length) {
    return [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: Buffer.from(screenshotPngBuffer).toString('base64'),
        },
      },
      { type: 'text', text },
    ];
  }
  return text;
}
