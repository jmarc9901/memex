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
import { hybridSearch, resolveQueryVec } from "./search.js";

/**
 * Resuelve una referencia (ruta exacta o consulta) a un file_id del indice.
 * @returns {number|null}
 */
export async function resolveFileId(db, ref, { embedder } = {}) {
  if (!ref) return null;
  const asPath = getFileByPath(db, resolve(ref));
  if (asPath) return asPath.id;
  // Tambien acepta la ruta relativa ya indexada tal cual.
  const exact = db.prepare("SELECT id FROM files WHERE path = ?").get(ref);
  if (exact) return exact.id;

  const queryVec = await resolveQueryVec(embedder, ref);
  const hits = hybridSearch(db, ref, { mode: "hybrid", limit: 1, embedder, queryVec });
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
export async function addToTrail(db, { trail, ref, note, embedder }) {
  const trailId = ensureTrail(db, trail);
  const fileId = await resolveFileId(db, ref, { embedder });
  if (!fileId) return { ok: false, reason: "no encontrado" };
  addTrailNode(db, trailId, fileId, note ?? null);
  return { ok: true, fileId, file: getFileById(db, fileId) };
}

/** Crea una arista entre dos documentos de un trail. */
export async function linkInTrail(db, { trail, from, to, label, embedder }) {
  const trailId = ensureTrail(db, trail);
  const fromId = await resolveFileId(db, from, { embedder });
  const toId = await resolveFileId(db, to, { embedder });
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
export async function relate(db, ref, { limit = 10, embedder } = {}) {
  const targetId = await resolveFileId(db, ref, { embedder: embedder ?? createEmbedder({}) });
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

/**
 * Sugiere documentos afines que aun no estan en un trail (para ampliarlo).
 * @returns {Promise<null|{trail:string, members:number, suggestions:Array}>}
 */
export async function suggestTrail(db, name, { limit = 10, embedder } = {}) {
  const graph = getTrailGraph(db, name);
  if (!graph) return null;
  const memberIds = new Set(graph.nodes.map((n) => n.file_id));
  const suggestions = new Map();

  for (const node of graph.nodes) {
    const related = await relate(db, node.path, { limit: limit * 3, embedder });
    for (const r of related) {
      if (memberIds.has(r.file_id)) continue;
      const prev = suggestions.get(r.file_id);
      if (!prev || r.score > prev.score) suggestions.set(r.file_id, r);
    }
  }

  return {
    trail: name,
    members: graph.nodes.length,
    suggestions: [...suggestions.values()].sort((a, b) => b.score - a.score).slice(0, limit),
  };
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

export const TRAIL_FORMATS = ["json", "dot", "mermaid", "md"];

/**
 * Serializa un trail a distintos formatos.
 * @param {ReturnType<typeof getTrailGraph>} graph
 * @param {'json'|'dot'|'mermaid'|'md'} [format]
 * @returns {string}
 */
export function exportTrail(graph, format = "json") {
  const g = toD3(graph);
  g.description = graph?.trail?.description ?? "";
  switch (format) {
    case "json":
      return JSON.stringify(g, null, 2);
    case "dot":
      return toDot(g);
    case "mermaid":
      return toMermaid(g);
    case "md":
    case "markdown":
      return toMarkdown(g);
    default:
      throw new Error(`formato de trail invalido: ${format} (usa ${TRAIL_FORMATS.join(", ")})`);
  }
}

const escDot = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const escMermaid = (s) => String(s ?? "").replace(/"/g, "#quot;").replace(/\n/g, " ");

function toDot(g) {
  const lines = [
    `digraph "${escDot(g.trail)}" {`,
    "  rankdir=LR;",
    '  node [shape=box, style=rounded, fontname="Helvetica"];',
    '  edge [fontname="Helvetica"];',
  ];
  for (const n of g.nodes) {
    lines.push(`  n${n.id} [label="${escDot(n.label)}\\n${escDot(n.path)}"];`);
  }
  for (const l of g.links) {
    const label = l.label ? ` [label="${escDot(l.label)}"]` : "";
    lines.push(`  n${l.source} -> n${l.target}${label};`);
  }
  lines.push("}");
  return lines.join("\n");
}

function toMermaid(g) {
  const lines = ["graph LR"];
  for (const n of g.nodes) lines.push(`  n${n.id}["${escMermaid(n.label)}"]`);
  for (const l of g.links) {
    const label = l.label ? `|${escMermaid(l.label)}|` : "";
    lines.push(`  n${l.source} -->${label} n${l.target}`);
  }
  return lines.join("\n");
}

function toMarkdown(g) {
  const byId = new Map(g.nodes.map((n) => [n.id, n.label]));
  const lines = [`# Trail: ${g.trail}`, ""];
  if (g.description) lines.push(`_${g.description}_`, "");
  lines.push("## Documentos", "");
  if (!g.nodes.length) lines.push("(vacio)");
  g.nodes.forEach((n, i) => {
    lines.push(`${i + 1}. **${n.label}** - \`${n.path}\`${n.note ? ` — ${n.note}` : ""}`);
  });
  lines.push("", "## Enlaces", "");
  if (!g.links.length) lines.push("(sin enlaces)");
  for (const l of g.links) {
    const from = byId.get(l.source) ?? `#${l.source}`;
    const to = byId.get(l.target) ?? `#${l.target}`;
    lines.push(`- ${from} → ${to}${l.label ? ` _(${l.label})_` : ""}`);
  }
  return lines.join("\n") + "\n";
}
