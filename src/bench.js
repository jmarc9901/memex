// Memex Offline - benchmarks reproducibles sobre un indice desechable.
//
// Indexa una carpeta en una base de datos temporal (nunca toca el indice real),
// mide el tiempo de indexado y la latencia de busqueda, y limpia al terminar.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, stats } from "./db.js";
import { indexFolder } from "./indexer.js";
import { hybridSearch } from "./search.js";
import { tokenize } from "./embeddings.js";

const ms = (startNs, endNs) => Number(endNs - startNs) / 1e6;
const round = (n, d = 2) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);

/**
 * Ejecuta un benchmark de indexado + busqueda.
 * @param {string} root carpeta a indexar
 * @param {{embedder?:Function|null, queries?:string[]|null, limit?:number, mode?:string}} [opts]
 */
export function benchmark(root, opts = {}) {
  const { embedder = null, queries = null, limit = 10, mode = "hybrid" } = opts;
  const dir = mkdtempSync(join(tmpdir(), "memex-bench-"));
  const db = openDatabase(join(dir, "bench.db"));
  try {
    const t0 = process.hrtime.bigint();
    const summary = indexFolder(db, root, { embedder, force: true });
    const t1 = process.hrtime.bigint();
    const indexMs = ms(t0, t1);

    const s = stats(db);
    const usedQueries = queries && queries.length ? queries : deriveQueries(db);
    const results = usedQueries.map((q) => {
      const a = process.hrtime.bigint();
      const hits = hybridSearch(db, q, { mode, limit, embedder });
      const b = process.hrtime.bigint();
      return { query: q, ms: round(ms(a, b)), hits: hits.length };
    });

    return {
      root,
      mode,
      scanned: summary.scanned,
      indexed: summary.added + summary.updated,
      chunks: s.chunks,
      embedded: s.embedded,
      index_ms: round(indexMs),
      files_per_s: indexMs > 0 ? round(summary.scanned / (indexMs / 1000)) : null,
      search_ms: summarize(results.map((r) => r.ms)),
      queries: results,
      rss_mb: round(process.memoryUsage().rss / 1048576),
    };
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Elige los terminos mas frecuentes del corpus como consultas de prueba. */
function deriveQueries(db, n = 5) {
  const rows = db.prepare("SELECT content FROM chunks LIMIT 200").all();
  const freq = new Map();
  for (const row of rows) {
    for (const token of tokenize(row.content, { minLength: 4 })) {
      freq.set(token, (freq.get(token) ?? 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([token]) => token);
}

function summarize(values) {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return { count: 0, min: null, median: null, max: null };
  const mid = Math.floor(clean.length / 2);
  const median = clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
  return { count: clean.length, min: round(clean[0]), median: round(median), max: round(clean[clean.length - 1]) };
}
