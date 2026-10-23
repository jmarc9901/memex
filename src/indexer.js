// Memex Offline - orquestacion del indexado incremental.
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";
import { walkFiles, extractText, chunkText, DEFAULT_IGNORES } from "./extract.js";
import {
  chunksPendingEmbedding,
  clearEmbeddings,
  deleteFile,
  getFileByPath,
  getIndexedFile,
  insertFile,
  setChunkEmbedding,
  setMeta,
  withTransaction,
} from "./db.js";
import { resetStore } from "./vectorstore.js";

// Tamano del lote para proveedores que saben procesar varios textos a la vez
// (ONNX). Con el proveedor `hash` no se usa: ya es instantaneo.
const EMBED_BATCH_SIZE = 16;

/** Hash del contenido ya en memoria (evita releer el archivo del disco). */
function sha256Buffer(buf) {
  if (!buf || !buf.length) return null;
  try {
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

function newSummary(root, scanned) {
  return {
    root,
    scanned,
    added: 0,
    updated: 0,
    unchanged: 0,
    unsupported: 0,
    failed: 0,
    pruned: 0,
  };
}

/**
 * Indexa (o reindexa) un solo archivo. Actualiza el resumen y no lanza: los
 * errores por archivo se cuentan para que un PDF corrupto no aborte la carpeta.
 */
function indexOne(db, path, { force, embedder }, summary) {
  let st;
  try {
    st = statSync(path);
  } catch {
    // El archivo desaparecio entre el recorrido y el stat: si estaba en el
    // indice, se elimina (es justo el caso de "borrado mientras indexaba").
    if (deleteFile(db, path)) summary.pruned += 1;
    summary.failed += 1;
    return;
  }

  const existing = getIndexedFile(db, path);
  // mtime en milisegundos (sin truncar a segundos) para detectar cambios
  // rapidos aunque el tamano no varie.
  const mtime = st.mtimeMs;
  if (!force && existing && existing.size === st.size && existing.mtime === mtime) {
    summary.unchanged += 1;
    return;
  }

  const extracted = extractText(path);
  if (!extracted) {
    if (existing) deleteFile(db, path);
    summary.unsupported += 1;
    return;
  }

  const pieces = chunkText(extracted.text);
  if (!pieces.length) {
    if (existing) deleteFile(db, path);
    summary.unsupported += 1;
    return;
  }

  const chunks = embedder
    ? pieces.map((content) => ({ content, embedding: embedder(content) }))
    : pieces.map((content) => ({ content }));

  try {
    // Atomico: si el insert falla, el archivo anterior no se pierde.
    withTransaction(db, () => {
      if (existing) deleteFile(db, path);
      insertFile(db, {
        path,
        name: basename(path),
        ext: extname(path).toLowerCase(),
        size: st.size,
        mtime,
        sha256: sha256Buffer(extracted.buffer),
        status: "indexed",
        source: extracted.extractor,
        chunks,
      });
    });
    if (existing) summary.updated += 1;
    else summary.added += 1;
  } catch {
    summary.failed += 1;
  }
}

/**
 * Borra del indice los archivos que estaban bajo `root` y ya no existen en
 * disco. Solo toca rutas dentro de esa carpeta: indexar `~/A` nunca elimina lo
 * que pertenece a `~/B` en la misma base de datos.
 */
export function pruneMissing(db, root, seen) {
  const base = resolve(root);
  const prefix = base.endsWith(sep) ? base : base + sep;
  const rows = db.prepare("SELECT path FROM files").all();
  let pruned = 0;
  for (const row of rows) {
    if (seen.has(row.path)) continue;
    if (!row.path.startsWith(prefix)) continue;
    if (deleteFile(db, row.path)) pruned += 1;
  }
  return pruned;
}

/** Cierre comun de las dos variantes de indexado. */
function finishIndex(db, summary, root, files, opts) {
  if (opts.prune !== false) {
    summary.pruned += pruneMissing(db, root, new Set(files));
  }
  // Cualquier reindexado puede cambiar el contenido sin cambiar el numero de
  // chunks (el caso normal al editar una nota). La cache del indice vectorial
  // se invalida siempre para no devolver fragmentos/embeddings viejos.
  resetStore(db);
  return summary;
}

/**
 * Indexa (o reindexa) una carpeta de forma incremental.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} root
 * @param {{force?:boolean, prune?:boolean, ignore?:Set<string>,
 *          embedder?:((t:string)=>Float32Array)|null,
 *          onProgress?:(info:{done:number,total:number,path:string})=>void}} [opts]
 */
export function indexFolder(db, root, opts = {}) {
  const files = walkFiles(root, { ignore: opts.ignore ?? DEFAULT_IGNORES });
  const embedder = opts.embedder ?? null;
  if (embedder) {
    setMeta(db, "embed_provider", embedder.provider ?? "hash");
    setMeta(db, "embed_dim", embedder.dim ?? "");
  }
  const summary = newSummary(root, files.length);

  let done = 0;
  for (const path of files) {
    done += 1;
    opts.onProgress?.({ done, total: files.length, path });
    indexOne(db, path, opts, summary);
  }

  return finishIndex(db, summary, root, files, opts);
}

/**
 * Igual que `indexFolder` pero cede el event loop entre archivos. La usa el
 * servidor: indexar una carpeta grande de forma sincrona congelaba la GUI y la
 * API hasta terminar. La extraccion de cada archivo sigue siendo sincrona (una
 * sola lectura), pero el proceso atiende peticiones entre archivo y archivo.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} root
 * @param {Parameters<typeof indexFolder>[2]} [opts]
 * @returns {Promise<ReturnType<typeof indexFolder>>}
 */
export async function indexFolderAsync(db, root, opts = {}) {
  const files = walkFiles(root, { ignore: opts.ignore ?? DEFAULT_IGNORES });
  const embedder = opts.embedder ?? null;
  if (embedder) {
    setMeta(db, "embed_provider", embedder.provider ?? "hash");
    setMeta(db, "embed_dim", embedder.dim ?? "");
  }
  const summary = newSummary(root, files.length);

  let done = 0;
  for (const path of files) {
    done += 1;
    opts.onProgress?.({ done, total: files.length, path });
    indexOne(db, path, opts, summary);
    await new Promise((resolveYield) => setImmediate(resolveYield));
  }

  return finishIndex(db, summary, root, files, opts);
}

/**
 * Guarda un documento en memoria (por ejemplo una pagina web enviada por la
 * extension del navegador) directamente en el indice.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{url:string, title?:string, text:string, source?:string, embedder?:Function}} doc
 * @returns {{file_id:number, chunks:number, updated:boolean}}
 */
export function saveDocument(db, doc) {
  const { url, title = "", text, source = "web", embedder = null } = doc;
  const path = url || title;
  if (!path) throw new Error("saveDocument requiere url o title");

  const body = title ? `${title}\n\n${text}` : text;
  const pieces = chunkText(body);
  const chunks = embedder
    ? pieces.map((content) => ({ content, embedding: embedder(content) }))
    : pieces.map((content) => ({ content }));

  const existing = getFileByPath(db, path);

  const now = Date.now();
  withTransaction(db, () => {
    if (existing) deleteFile(db, path);
    insertFile(db, {
      path,
      name: title || path,
      ext: ".web",
      size: Buffer.byteLength(body, "utf8"),
      mtime: now,
      status: "indexed",
      source,
      url,
      title,
      chunks,
    });
  });

  resetStore(db);
  return { file_id: getFileByPath(db, path).id, chunks: chunks.length, updated: Boolean(existing) };
}

/**
 * Calcula los embeddings de los chunks pendientes (o de todos con `force`)
 * usando un embedder sync u async. Si el proveedor expone `batch`, se procesan
 * varios textos por llamada (ONNX): es la diferencia entre minutos y horas en
 * corpus grandes.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{embedder:Function, force?:boolean, all?:boolean,
 *          onProgress?:(info:{done:number,total:number})=>void}} opts
 * @returns {Promise<{pending:number, embedded:number, failed:number, provider:string, dim:number|undefined}>}
 */
export async function embedIndex(db, opts) {
  const embedder = opts.embedder;
  if (!embedder) throw new Error("embedIndex requiere un embedder");
  if (opts.force) clearEmbeddings(db);

  const pending = chunksPendingEmbedding(db, { all: Boolean(opts.force || opts.all) });
  let embedded = 0;
  let failed = 0;
  let done = 0;

  const embedOne = async (row) => {
    const vec = await embedder(row.content);
    setChunkEmbedding(db, row.chunk_id, vec);
    embedded += 1;
  };

  // Transaccion manual (no podemos usar withTransaction con un bucle async).
  db.exec("BEGIN");
  try {
    for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
      const slice = pending.slice(i, i + EMBED_BATCH_SIZE);
      if (typeof embedder.batch === "function") {
        try {
          const vectors = await embedder.batch(slice.map((row) => row.content));
          slice.forEach((row, k) => {
            const vec = vectors?.[k];
            if (vec && vec.length) {
              setChunkEmbedding(db, row.chunk_id, vec);
              embedded += 1;
            } else {
              failed += 1;
            }
          });
        } catch {
          // Un lote fallido no debe perder los fragmentos: se reintentan de uno
          // en uno para aislar el texto problematico.
          for (const row of slice) {
            try {
              await embedOne(row);
            } catch {
              failed += 1;
            }
          }
        }
      } else {
        for (const row of slice) {
          try {
            await embedOne(row);
          } catch {
            failed += 1;
          }
        }
      }
      done += slice.length;
      opts.onProgress?.({ done, total: pending.length });
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ya cerrada */
    }
    throw err;
  }

  resetStore(db);
  if (embedder.provider) setMeta(db, "embed_provider", embedder.provider);
  if (embedder.dim) setMeta(db, "embed_dim", embedder.dim);
  return { pending: pending.length, embedded, failed, provider: embedder.provider, dim: embedder.dim };
}
