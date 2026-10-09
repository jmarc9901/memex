// Memex Offline - busqueda hibrida: full-text (BM25) + semantica (coseno),
// fusionadas con Reciprocal Rank Fusion (RRF). Sin GPU y sin red.
import { search as lexicalSearch, chunksWithEmbeddings } from "./db.js";
import { buildMatch } from "./query.js";
import { cosine, fromBlob, tokenize } from "./embeddings.js";

const RRF_K = 60;

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
 * @param {{mode?:'lexical'|'semantic'|'hybrid', limit?:number, embedder?:((t:string)=>Float32Array)|null, weights?:{lexical?:number,semantic?:number}}} [opts]
 * @returns {SearchHit[]}
 */
export function hybridSearch(db, queryText, opts = {}) {
  const mode = opts.mode ?? "hybrid";
  const limit = Math.max(1, opts.limit ?? 20);
  const weights = { lexical: 1, semantic: 1, ...(opts.weights ?? {}) };
  const candidates = Math.max(limit * 5, 50);

  const lexical = mode === "semantic" ? [] : lexicalHits(db, queryText, candidates);
  const semantic =
    mode === "lexical" ? [] : semanticHits(db, queryText, candidates, opts.embedder);

  if (mode === "lexical") return lexical.slice(0, limit);
  if (mode === "semantic") return semantic.slice(0, limit);

  return fuse(lexical, semantic, weights).slice(0, limit);
}

function lexicalHits(db, queryText, candidates) {
  let match;
  try {
    match = buildMatch(queryText);
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

function semanticHits(db, queryText, candidates, embedder) {
  if (!embedder) return [];
  const queryVec = embedder(queryText);
  const rows = chunksWithEmbeddings(db);
  if (!rows.length) return [];

  const scored = [];
  for (const row of rows) {
    const vec = fromBlob(row.embedding);
    if (!vec) continue;
    const score = cosine(queryVec, vec);
    if (score > 0) scored.push({ row, score });
  }
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, candidates).map(({ row, score }, i) => ({
    file_id: row.file_id,
    path: row.path,
    name: row.name,
    ext: row.ext,
    chunk_index: row.chunk_index,
    snippet: makeSnippet(row.content, queryText),
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
