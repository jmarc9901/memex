// Memex Offline - construccion de consultas FTS5 a partir de lenguaje natural.

const WORD_RE = /[\p{L}\p{N}_]+/gu;

/**
 * Convierte una consulta de usuario en una expresion MATCH valida para FTS5.
 * Soporta frases entre comillas y prefijos con `*`. Por defecto une terminos
 * con AND; con `opts.any` los une con OR.
 *
 * @param {string} input
 * @param {{any?:boolean}} [opts]
 * @returns {string}
 */
export function buildMatch(input, opts = {}) {
  const { any = false } = opts;
  const raw = (input ?? "").trim();
  if (!raw) throw new Error("consulta vacia");

  const terms = [];
  // 1) frases entre comillas -> termino literal
  const withoutPhrases = raw.replace(/"([^"]+)"/g, (_, phrase) => {
    const words = phrase.match(WORD_RE);
    if (words && words.length) terms.push('"' + words.join(" ") + '"');
    return " ";
  });

  // 2) palabras sueltas (con soporte de prefijo * al final)
  for (const token of withoutPhrases.split(/\s+/)) {
    if (!token) continue;
    const prefix = token.endsWith("*");
    const words = token.match(WORD_RE);
    if (!words || !words.length) continue;
    const word = words.join("");
    terms.push(prefix ? word + "*" : word);
  }

  if (!terms.length) throw new Error("consulta vacia");
  return terms.join(any ? " OR " : " AND ");
}
