// Memex Offline - trails asociativos: caminos entre documentos (Fase 7).
import { resolve } from "node:path";
import {
  getFileByPath,
  getFileById,
  chunksWithEmbeddings,
  createTrail,
  getTrailByName,
  listTrails as dbListTrails,
  deleteTrail,
  addTrailNode,
  addTrailEdge,
  getTrailGraph,
} from "./db.js";
import { cosine, fromBlob, createEmbedder } from "./embeddings.js";
import { hybridSearch } from "./search.js";

/**
 * Resuelve una referencia (ruta exacta o consulta) a un file_id del indice.
 * @returns {number|null}
 */
export function resolveFileId(db, ref, { embedder } = {}) {
  if (!ref) return null;
  const asPath = getFileByPath(db, resolve(ref));
  if (asPath) return asPath.id;
  // Tambien acepta la ruta relativa ya indexada tal cual.
  const exact = db.prepare("SELECT id FROM files WHERE path = ?").get(ref);
  if (exact) return exact.id;

  const hits = hybridSearch(db, ref, { mode: "hybrid", limit: 1, embedder });
  return hits.length ? hits[0].file_id : null;
}

/** Crea (o reutiliza) un trail y devuelve su id. */
export function ensureTrail(db, name, description = "") {
  const existing = getTrailByName(db, name);
  if (existing) return existing.id;
  return createTrail(db, name, description);
}

export function listTrails(db) {
  return dbListTrails(db);
}

export function removeTrail(db, name) {
  return deleteTrail(db, name);
}

export function showTrail(db, name) {
  return getTrailGraph(db, name);
}

/** Añade un documento (por ruta o consulta) a un trail. */
export function addToTrail(db, { trail, ref, note, embedder }) {
  const trailId = ensureTrail(db, trail);
  const fileId = resolveFileId(db, ref, { embedder });
  if (!fileId) return { ok: false, reason: "no encontrado" };
  addTrailNode(db, trailId, fileId, note ?? null);
  return { ok: true, fileId, file: getFileById(db, fileId) };
}

/** Crea una arista entre dos documentos de un trail. */
export function linkInTrail(db, { trail, from, to, label, embedder }) {
  const trailId = ensureTrail(db, trail);
  const fromId = resolveFileId(db, from, { embedder });
  const toId = resolveFileId(db, to, { embedder });
  if (!fromId || !toId) return { ok: false, reason: "nodo no encontrado" };
  addTrailNode(db, trailId, fromId);
  addTrailNode(db, trailId, toId);
  addTrailEdge(db, trailId, fromId, toId, label ?? null);
  return { ok: true, fromId, toId };
}

/** Centroide de embeddings por archivo. */
function fileCentroids(db) {
  const rows = chunksWithEmbeddings(db);
  const acc = new Map();
  for (const row of rows) {
    const vec = fromBlob(row.embedding);
    if (!vec) continue;
    let entry = acc.get(row.file_id);
    if (!entry) {
      entry = { file_id: row.file_id, path: row.path, name: row.name, ext: row.ext, sum: new Float32Array(vec.length), n: 0 };
      acc.set(row.file_id, entry);
    }
    for (let i = 0; i < vec.length; i++) entry.sum[i] += vec[i];
    entry.n += 1;
  }
  for (const entry of acc.values()) {
    for (let i = 0; i < entry.sum.length; i++) entry.sum[i] /= entry.n;
  }
  return acc;
}

/**
 * Documentos mas parecidos a uno dado (por vector medio). Sugiere trails.
 * @returns {Array<{file_id,path,name,ext,score}>}
 */
export function relate(db, ref, { limit = 10, embedder } = {}) {
  const targetId = resolveFileId(db, ref, { embedder: embedder ?? createEmbedder({}) });
  if (!targetId) return [];
  const centroids = fileCentroids(db);
  const target = centroids.get(targetId);
  if (!target) return [];

  const results = [];
  for (const [fileId, entry] of centroids) {
    if (fileId === targetId) continue;
    results.push({
      file_id: fileId,
      path: entry.path,
      name: entry.name,
      ext: entry.ext,
      score: cosine(target.sum, entry.sum),
    });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Convierte un grafo de trail en JSON listo para visualizacion tipo D3. */
export function toD3(graph) {
  if (!graph) return { nodes: [], links: [] };
  return {
    trail: graph.trail.name,
    nodes: graph.nodes.map((n) => ({
      id: n.file_id,
      label: n.title || n.name,
      path: n.path,
      ext: n.ext,
      note: n.note,
    })),
    links: graph.edges.map((e) => ({ source: e.from, target: e.to, label: e.label })),
  };
}
