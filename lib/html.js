// Extrae el HTML de la respuesta del modelo, tolerando fences de markdown
// o texto antes del <!doctype>.
export function extractHtml(text) {
  if (!text) return '';
  let t = String(text).trim();

  // ```html ... ```  o  ``` ... ```
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence && /<(?:!doctype|html|body|script|canvas)/i.test(fence[1])) {
    t = fence[1].trim();
  }

  const doc = t.search(/<!doctype html>/i);
  if (doc > 0) {
    t = t.slice(doc);
  } else {
    const html = t.search(/<html[\s>]/i);
    if (html > 0) t = t.slice(html);
  }

  // recorta cualquier cosa después del </html> de cierre
  const end = t.search(/<\/html\s*>/i);
  if (end !== -1) t = t.slice(0, end + t.slice(end).indexOf('>') + 1);

  return t.trim();
}

export function looksLikeHtml(t) {
  return /<(?:!doctype html|html[\s>])/i.test(String(t || '')) && /<script/i.test(String(t || ''));
}
