// Memex Offline - indice vectorial en memoria para busqueda semantica escalable.
//
// El problema: puntuar todos los chunks con coseno en cada consulta es O(n) y
// se resiente con corpus grandes. Aqui resolvemos eso **sin dependencias**:
//   1. Cache: cargamos todos los vectores una vez en una matriz Float32Array
//      contigua (mucho mas rapido que decodificar BLOBs en cada consulta).
//   2. Prefiltro binario: cada vector se reduce a su "firma" de signos
//      (1 bit por dimension). La distancia de Hamming (popcount) es ~32x mas
//      barata que el coseno, asi que se usa para preseleccionar un shortlist
//      y luego se re-puntua el shortlist con el coseno exacto.
// El resultado es casi exacto (recall alto) y ordenes de magnitud mas rapido
// en corpus grandes. Para corpus pequenos se usa el escaneo exacto directo.
import { chunksWithEmbeddings, embeddedChunkCount } from "./db.js";
import { fromBlob, cosine } from "./embeddings.js";

const EXACT_LIMIT = 4096; // por debajo de esto, escaneo exacto (sin prefiltro)
const SHORTLIST_FACTOR = 40; // tamano del shortlist = k * factor
const MIN_SHORTLIST = 512;

/** Cache por base de datos: se reconstruye si cambia el numero de vectores. */
const caches = new WeakMap();

/**
 * Construye (o reutiliza) el indice en memoria de una base de datos.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {null|{count:number, dim:number, matrix:Float32Array, bits:Uint32Array,
 *                 words:number, ids:number[], fileIds:number[], paths:string[],
 *                 names:string[], exts:string[], chunkIndexes:number[], contents:string[]}}
 */
export function getStore(db) {
  const count = embeddedChunkCount(db);
  const cached = caches.get(db);
  if (cached && cached.count === count) return cached.store;

  const rows = chunksWithEmbeddings(db);
  if (!rows.length) {
    caches.set(db, { count, store: null });
    return null;
  }

  const dim = Buffer.from(rows[0].embedding).byteLength / 4;
  const words = Math.ceil(dim / 32);
  const n = rows.length;
  const store = {
    count: n,
    dim,
    words,
    matrix: new Float32Array(n * dim),
    bits: new Uint32Array(n * words),
    ids: new Array(n),
    fileIds: new Array(n),
    paths: new Array(n),
    names: new Array(n),
    exts: new Array(n),
    chunkIndexes: new Array(n),
    contents: new Array(n),
  };

  let row = 0;
  for (const r of rows) {
    const vec = fromBlob(r.embedding);
    if (!vec || vec.length !== dim) continue; // dimensiones mezcladas: se omiten
    const base = row * dim;
    for (let j = 0; j < dim; j++) {
      const v = vec[j];
      store.matrix[base + j] = v;
      if (v >= 0) store.bits[row * words + (j >>> 5)] |= 1 << (j & 31);
    }
    store.ids[row] = r.chunk_id;
    store.fileIds[row] = r.file_id;
    store.paths[row] = r.path;
    store.names[row] = r.name;
    store.exts[row] = r.ext;
    store.chunkIndexes[row] = r.chunk_index;
    store.contents[row] = r.content;
    row += 1;
  }
  store.count = row;

  caches.set(db, { count, store });
  return store;
}

/** Invalida la cache (p. ej. tras reindexar en el mismo proceso). */
export function resetStore(db) {
  caches.delete(db);
}

/** Cuenta los bits a 1 (popcount de 32 bits). */
function popcount(x) {
  x -= (x >> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >> 24;
}

/** Firma binaria de un vector de consulta (misma convencion que el store). */
function queryBits(vec, dim, words) {
  const bits = new Uint32Array(words);
  for (let j = 0; j < dim; j++) {
    if (vec[j] >= 0) bits[j >>> 5] |= 1 << (j & 31);
  }
  return bits;
}

/**
 * Recupera los candidatos semanticos mas similares a un vector de consulta.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Float32Array} queryVec
 * @param {{k?:number, minScore?:number, approx?:boolean}} [opts]
 * @returns {Array<{index:number, score:number}>} indices ordenados de mayor a menor similitud
 */
export function semanticSearch(db, queryVec, opts = {}) {
  const k = Math.max(1, opts.k ?? 50);
  const minScore = opts.minScore ?? 0;
  const store = getStore(db);
  if (!store || !queryVec) return [];

  const dim = Math.min(queryVec.length, store.dim);
  const scored = [];

  if (store.count <= EXACT_LIMIT && !opts.approx) {
    for (let i = 0; i < store.count; i++) {
      const score = cosineStr(queryVec, store.matrix, i * store.dim, dim);
      if (score >= minScore) scored.push({ index: i, score });
    }
  } else {
    // Prefiltro binario: shortlist por Hamming, luego coseno exacto.
    const qbits = queryBits(queryVec, dim, store.words);
    const shortlist = Math.max(k * SHORTLIST_FACTOR, MIN_SHORTLIST);
    const dists = new Array(store.count);
    for (let i = 0; i < store.count; i++) {
      let d = 0;
      const base = i * store.words;
      for (let w = 0; w < store.words; w++) d += popcount(qbits[w] ^ store.bits[base + w]);
      dists[i] = d;
    }
    const order = dists
      .map((d, i) => i)
      .sort((a, b) => dists[a] - dists[b])
      .slice(0, Math.min(shortlist, store.count));
    for (const i of order) {
      const score = cosineStr(queryVec, store.matrix, i * store.dim, dim);
      if (score >= minScore) scored.push({ index: i, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/** Coseno de queryVec contra la fila `offset` de la matriz (sin alocar). */
function cosineStr(queryVec, matrix, offset, dim) {
  let dot = 0;
  for (let j = 0; j < dim; j++) dot += queryVec[j] * matrix[offset + j];
  return dot;
}

export const VECTORSTORE = { EXACT_LIMIT, SHORTLIST_FACTOR, MIN_SHORTLIST };
export { cosine };
