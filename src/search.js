// Memex Offline - busqueda hibrida: full-text (BM25) + semantica (coseno),
// fusionadas con Reciprocal Rank Fusion (RRF). Sin GPU y sin red.
import { search as lexicalSearch } from "./db.js";
import { buildMatch } from "./query.js";
import { tokenize } from "./embeddings.js";
import { getStore, semanticSearch } from "./vectorstore.js";

const RRF_K = 60;
// Similitud coseno minima para aceptar un candidato semantico. Los embeddings
// por feature hashing dan valores bajos (~0.02-0.06) a textos sin relacion,
// mientras que las coincidencias reales superan ~0.20; el umbral elimina ruido
// sin descartar coincidencias reales.
const SEMANTIC_MIN_SCORE = 0.1;
// ONNX produce cosenos mucho mas altos que el feature hashing, incluso entre
// textos sin relacion (~0.2-0.4 con MiniLM). El umbral bajo del `hash` dejaria
// pasar ruido, asi que el proveedor neuronal usa un corte mas alto.
const SEMANTIC_MIN_SCORE_ONNX = 0.3;

/**
 * @typedef {Object} SearchHit
 * @property {number} file_id
 * @property {string} path
 * @property {string} name
 * @property {string} ext
 * @property {number} chunk_index
 * @property {string} snippet
 * @property {number} score
 * @property {number|null} lexical_rank
 * @property {number|null} semantic_rank
 * @property {number|null} lexical_score
 * @property {number|null} semantic_score
 */

/**
 * Busca en el indice combinando recuperacion lexica y semantica.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} queryText
 * @param {{mode?:'lexical'|'semantic'|'hybrid', limit?:number, any?:boolean, minScore?:number, embedder?:((t:string)=>Float32Array)|null, queryVec?:Float32Array|null, weights?:{lexical?:number,semantic?:number}}} [opts]
 * @returns {SearchHit[]}
 */
export function hybridSearch(db, queryText, opts = {}) {
  const mode = opts.mode ?? "hybrid";
  const limit = Math.max(1, opts.limit ?? 20);
  const any = opts.any ?? false;
  const minScore = opts.minScore ?? semanticMinScore(opts.embedder);
  const weights = { lexical: 1, semantic: 1, ...(opts.weights ?? {}) };
  const candidates = Math.max(limit * 5, 50);

  // Vector de consulta: si el embedder es sincrono (hash) lo calculamos aqui;
  // si es asincrono (onnx), el llamante ya debe pasar `queryVec` resuelto.
  const queryVec = opts.queryVec ?? syncQueryVec(opts.embedder, queryText);

  const lexical = mode === "semantic" ? [] : lexicalHits(db, queryText, candidates, any);
  const semantic =
    mode === "lexical" ? [] : semanticHits(db, queryText, candidates, queryVec, minScore);

  if (mode === "lexical") return lexical.slice(0, limit);
  if (mode === "semantic") return semantic.slice(0, limit);

  return fuse(lexical, semantic, weights).slice(0, limit);
}

/**
 * Umbral de similitud coseno que corresponde al proveedor configurado.
 * @param {Function|null|undefined} embedder
 * @returns {number}
 */
export function semanticMinScore(embedder) {
  return embedder?.provider === "onnx" ? SEMANTIC_MIN_SCORE_ONNX : SEMANTIC_MIN_SCORE;
}

/** Calcula el vector de consulta solo si el embedder es sincrono. */
export function syncQueryVec(embedder, queryText) {
  if (!embedder) return null;
  const maybe = embedder(queryText);
  return maybe && typeof maybe.then !== "function" ? maybe : null;
}

/**
 * Resuelve el vector de consulta con un embedder sync o async.
 * @param {Function|null} embedder
 * @param {string} queryText
 * @returns {Promise<Float32Array|null>}
 */
export async function resolveQueryVec(embedder, queryText) {
  if (!embedder) return null;
  return await embedder(queryText);
}

function lexicalHits(db, queryText, candidates, any = false) {
  let match;
  try {
    match = buildMatch(queryText, { any });
  } catch {
    return [];
  }
  return lexicalSearch(db, match, { limit: candidates }).map((row, i) => ({
    file_id: row.file_id,
    path: row.path,
    name: row.name,
    ext: row.ext,
    chunk_index: row.chunk_index,
    snippet: row.snippet,
    lexical_rank: i,
    lexical_score: row.score,
    semantic_rank: null,
    semantic_score: null,
  }));
}

function semanticHits(db, queryText, candidates, queryVec, minScore = SEMANTIC_MIN_SCORE) {
  if (!queryVec) return [];
  const hits = semanticSearch(db, queryVec, { k: candidates, minScore });
  if (!hits.length) return [];
  const store = getStore(db);
  if (!store) return [];

  return hits.map(({ index, score }, i) => ({
    file_id: store.fileIds[index],
    path: store.paths[index],
    name: store.names[index],
    ext: store.exts[index],
    chunk_index: store.chunkIndexes[index],
    snippet: makeSnippet(store.contents[index], queryText),
    semantic_rank: i,
    semantic_score: score,
    lexical_rank: null,
    lexical_score: null,
  }));
}

/** Fusiona dos listas rankeadas con RRF. */
export function fuse(listA, listB, weights = {}) {
  const wa = weights.lexical ?? 1;
  const wb = weights.semantic ?? 1;
  const merged = new Map();

  const add = (list, key, weight) => {
    list.forEach((hit, rank) => {
      const id = hit.file_id + ":" + hit.chunk_index;
      const entry =
        merged.get(id) ??
        {
          file_id: hit.file_id,
          path: hit.path,
          name: hit.name,
          ext: hit.ext,
          chunk_index: hit.chunk_index,
          snippet: hit.snippet,
          score: 0,
          lexical_rank: null,
          semantic_rank: null,
          lexical_score: null,
          semantic_score: null,
        };
      entry.score += weight * (1 / (RRF_K + rank + 1));
      entry[key + "_rank"] = rank;
      entry[key + "_score"] = hit[key + "_score"];
      // Preferimos el fragmento lexico (tiene resaltado exacto) si existe.
      if (!entry.snippet || (key === "lexical" && hit.snippet)) entry.snippet = hit.snippet;
      merged.set(id, entry);
    });
  };

  add(listA, "lexical", wa);
  add(listB, "semantic", wb);

  return [...merged.values()].sort((a, b) => b.score - a.score);
}

/**
 * Construye un extracto para resultados semanticos, resaltando los terminos
 * de la consulta que aparezcan literalmente.
 */
export function makeSnippet(content, queryText, { maxLen = 240 } = {}) {
  const terms = tokenize(queryText, { minLength: 3 });
  const text = content.replace(/\s+/g, " ").trim();

  let at = -1;
  for (const term of terms) {
    const idx = text.toLowerCase().indexOf(term);
    if (idx !== -1 && (at === -1 || idx < at)) at = idx;
  }

  let window;
  if (at === -1) {
    window = text.slice(0, maxLen);
    return text.length > maxLen ? window + " …" : window;
  }
  const start = Math.max(0, at - 60);
  window = text.slice(start, start + maxLen);
  const prefix = start > 0 ? "… " : "";

  let highlighted = window;
  for (const term of terms) {
    highlighted = highlighted.replace(new RegExp(escapeRegExp(term), "gi"), (m) => `[[${m}]]`);
  }
  return prefix + highlighted + (start + maxLen < text.length ? " …" : "");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
