// Memex Offline - orquestacion del indexado incremental.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { walkFiles, extractText, chunkText, DEFAULT_IGNORES } from "./extract.js";
import { deleteFile, getIndexedFile, insertFile, setMeta } from "./db.js";

function sha256(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Indexa (o reindexa) una carpeta de forma incremental.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} root
 * @param {{force?:boolean, ignore?:Set<string>, embedder?:((t:string)=>Float32Array)|null,
 *          onProgress?:(info:{done:number,total:number,path:string})=>void}} [opts]
 */
export function indexFolder(db, root, opts = {}) {
  const files = walkFiles(root, { ignore: opts.ignore ?? DEFAULT_IGNORES });
  const embedder = opts.embedder ?? null;
  if (embedder) {
    setMeta(db, "embed_provider", embedder.provider ?? "hash");
    setMeta(db, "embed_dim", embedder.dim ?? "");
  }
  const summary = {
    root,
    scanned: files.length,
    added: 0,
    updated: 0,
    unchanged: 0,
    unsupported: 0,
    failed: 0,
  };

  let done = 0;
  for (const path of files) {
    done += 1;
    opts.onProgress?.({ done, total: files.length, path });

    let st;
    try {
      st = statSync(path);
    } catch {
      summary.failed += 1;
      continue;
    }

    const existing = getIndexedFile(db, path);
    const mtime = Math.floor(st.mtimeMs);
    if (
      !opts.force &&
      existing &&
      existing.size === st.size &&
      existing.mtime === mtime
    ) {
      summary.unchanged += 1;
      continue;
    }

    const extracted = extractText(path);
    if (!extracted) {
      if (existing) deleteFile(db, path);
      summary.unsupported += 1;
      continue;
    }

    const pieces = chunkText(extracted.text);
    if (!pieces.length) {
      if (existing) deleteFile(db, path);
      summary.unsupported += 1;
      continue;
    }

    const chunks = embedder
      ? pieces.map((content) => ({ content, embedding: embedder(content) }))
      : pieces.map((content) => ({ content }));

    try {
      if (existing) deleteFile(db, path);
      insertFile(db, {
        path,
        name: basename(path),
        ext: extname(path).toLowerCase(),
        size: st.size,
        mtime,
        sha256: sha256(path),
        status: "indexed",
        source: extracted.extractor,
        chunks,
      });
      if (existing) summary.updated += 1;
      else summary.added += 1;
    } catch {
      summary.failed += 1;
    }
  }

  return summary;
}
