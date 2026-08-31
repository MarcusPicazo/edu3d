# Guía para docentes

Esta herramienta **crea experiencias educativas 3D interactivas** (páginas web que
se abren en el navegador) a partir de una descripción escrita por ti. Además las
**revisa sola**: comprueba que se vean bien, que no tengan fallas y que se pueda
interactuar, y si algo sale mal, lo vuelve a intentar hasta 3 veces.

No necesitas saber programar. Solo escribir bien lo que quieres y correr un comando.

---

## Preparación (una sola vez)

Pídele a alguien con conocimientos técnicos que deje esto listo:

1. Instalar **Node.js** (versión 20 o mayor).
2. En la carpeta del proyecto, abrir una terminal y ejecutar `npm install`.
3. Ejecutar `npx playwright install chromium` (el navegador que hace las revisiones).
4. Crear un archivo llamado `.env` en la carpeta del proyecto con esta línea
   (la clave la da el administrador de la cuenta de Anthropic):

   ```
   ANTHROPIC_API_KEY=sk-ant-...tu-clave...
   ```

Con eso queda listo para siempre.

---

## Paso 1 — Describe tu tema

Abre el archivo **`cases/cases.json`** con cualquier editor de texto. Adentro hay
una lista de casos. Cada caso tiene **4 datos**:

| Dato | Qué poner |
|---|---|
| `id` | Un número distinto para cada caso (1, 2, 3, …). |
| `topic` | El tema, en una frase. Si quieres, agrega la materia entre paréntesis al final: `... (Geografía)`. |
| `level` | El nivel escolar: `primaria`, `secundaria`, `preparatoria` o `universidad`. |
| `learningGoal` | Qué debe **aprender o lograr** el estudiante con la experiencia. Sé concreto. |

Reemplaza los casos de ejemplo por los tuyos. Reglas al editar:

- Todo va entre comillas dobles `"..."`.
- Cada caso va entre llaves `{ }` y se separa del siguiente con una **coma**.
- El **último** caso **no** lleva coma después.
- Puedes dejar solo 1 caso si quieres probar rápido.

Plantilla para copiar y pegar (cambia el texto, deja los nombres de los campos):

```json
[
  {
    "id": 1,
    "topic": "Escribe aquí tu tema en una frase (Materia)",
    "level": "secundaria",
    "learningGoal": "Escribe qué debe entender, identificar o poder hacer el estudiante."
  }
]
```

---

## Paso 2 — Lanza el pipeline (un solo comando)

En la terminal, dentro de la carpeta del proyecto:

```
npm run eval
```

Eso hace **todo**: genera una versión rápida sin revisar (*baseline*), genera la
versión buena con revisiones y reintentos (*solución*), las califica a ambas y
guarda los resultados. Puede tardar varios minutos por caso (está "pensando" y
revisando cada intento). Al terminar verás un resumen y se crean:

- `out/baseline/` y `out/solution/` — las experiencias en formato de página web
  (archivos `.html`) y sus capturas de pantalla.
- `eval/results.json` — todos los resultados.

> ¿Solo quieres las experiencias buenas, sin la comparación? Usa `npm run solution`.

---

## Paso 3 — Lee el reporte

Abre **`docs/report.html`** en el navegador. Si al abrirlo con doble clic te pide
el archivo de resultados, arrástrale el archivo `eval/results.json`.

Qué vas a ver:

- **Resumen arriba**: promedio de la versión rápida vs. la versión revisada, cuánto
  mejoró, y qué porcentaje pasó la revisión.
- **Una tarjeta por caso**: la materia, el nivel, el objetivo, y las **dos capturas
  lado a lado** (rápida vs. revisada) con sus calificaciones.

Cada calificación es sobre **100 puntos**, repartidos así:

| Parte | Puntos | Qué mide |
|---|---:|---|
| Se ve bien | 40 | Que la escena 3D se dibuje de verdad (no pantalla negra ni vacía) y siga animándose. |
| Sin errores | 20 | Que la página no tenga fallas técnicas. |
| Interactividad | 20 | Que se pueda girar, hacer clic, mover cosas… y que la escena responda. |
| Nivel adecuado | 20 | Que el texto y la profundidad correspondan al nivel escolar que pediste. |

También verás **cuántos reintentos** hizo falta en la versión revisada: `1` significa
que salió bien a la primera; `3` significa que costó y quizá aún tiene detalles.

Para archivar o compartir: botón **"Imprimir / Guardar PDF"** dentro del reporte.

---

## 3 ejemplos de descripción bien escrita

**Geografía · secundaria**
```json
{
  "id": 1,
  "topic": "Las capas de la Tierra: corteza, manto, núcleo externo e interno (Geografía)",
  "level": "secundaria",
  "learningGoal": "Identificar las cuatro capas en un corte del planeta, comparar su grosor y estado (sólido o líquido) y relacionar el núcleo con el campo magnético."
}
```
*Por qué funciona:* nombra las partes exactas que deben aparecer, pide una acción
concreta (comparar grosor y estado) y acota el alcance.

**Música · primaria**
```json
{
  "id": 2,
  "topic": "La familia de instrumentos de una orquesta y cómo se agrupan en el escenario (Música)",
  "level": "primaria",
  "learningGoal": "Reconocer cuerdas, viento-madera, viento-metal y percusión haciendo clic en cada grupo para escuchar su nombre y ver dónde se sienta en la orquesta."
}
```
*Por qué funciona:* lenguaje simple, dice qué se toca (hacer clic en grupos) y qué
debe quedar claro (los 4 grupos y su ubicación).

**Química · preparatoria**
```json
{
  "id": 3,
  "topic": "Geometría molecular del metano, el agua y el amoniaco según VSEPR (Química)",
  "level": "preparatoria",
  "learningGoal": "Predecir la forma de cada molécula a partir de pares enlazantes y libres, y comparar los ángulos de enlace (109.5°, 104.5°, 107°) rotando los modelos en 3D."
}
```
*Por qué funciona:* usa términos formales propios del nivel, da datos verificables
(los ángulos) y pide una interacción clara (rotar los modelos).

---

## Consejos rápidos

- **Sé específico con lo visible.** "El sistema solar" es vago; "los 8 planetas en
  orden, con los rocosos pequeños y los gaseosos grandes" es accionable.
- **Di qué se hace, no solo qué se ve.** Menciona la interacción: hacer clic,
  arrastrar, mover un control, comparar dos objetos.
- **Ajusta el `learningGoal` al nivel.** En primaria, una idea concreta y visual;
  en preparatoria/universidad, relaciones, fórmulas o casos.
- **Un tema por caso.** Si mezclas tres conceptos, la escena se diluye.
- **Si un caso queda con calificación baja**, reescribe el `topic` con más detalle
  y vuelve a correr `npm run eval`.
