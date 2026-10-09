// Memex Offline - capa de almacenamiento.
// SQLite + FTS5 (sin dependencias externas, via node:sqlite).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const FTS_TOKENIZER = "unicode61 remove_diacritics 2";

/**
 * Abre (creando si hace falta) la base de datos del indice.
 * @param {string} dbPath
 * @returns {DatabaseSync}
 */
export function openDatabase(dbPath) {
  const absolute = resolve(dbPath);
  mkdirSync(dirname(absolute), { recursive: true });
  const db = new DatabaseSync(absolute);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

/** Crea el esquema si no existe. */
export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id         INTEGER PRIMARY KEY,
      path       TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      ext        TEXT NOT NULL,
      size       INTEGER NOT NULL,
      mtime      INTEGER NOT NULL,
      sha256     TEXT,
      chunks     INTEGER NOT NULL DEFAULT 0,
      status     TEXT NOT NULL DEFAULT 'indexed',
      indexed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id          INTEGER PRIMARY KEY,
      file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content,
      tokenize = '${FTS_TOKENIZER}'
    );

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

/** Lee el mtime+size previos de un archivo ya indexado (o undefined). */
export function getIndexedFile(db, path) {
  return db
    .prepare("SELECT id, size, mtime, sha256 FROM files WHERE path = ?")
    .get(path);
}

/**
 * Borra un archivo y sus chunks/FTS del indice.
 * @returns {number} id borrado o 0.
 */
export function deleteFile(db, path) {
  const row = db.prepare("SELECT id FROM files WHERE path = ?").get(path);
  if (!row) return 0;
  const ids = db
    .prepare("SELECT id FROM chunks WHERE file_id = ?")
    .all(row.id)
    .map((c) => c.id);
  const delFts = db.prepare("DELETE FROM chunks_fts WHERE rowid = ?");
  const delChunk = db.prepare("DELETE FROM chunks WHERE id = ?");
  for (const id of ids) {
    delFts.run(id);
    delChunk.run(id);
  }
  db.prepare("DELETE FROM files WHERE id = ?").run(row.id);
  return row.id;
}

/**
 * Inserta un archivo con sus chunks (texto completo) en el indice.
 * @param {DatabaseSync} db
 * @param {{path:string,name:string,ext:string,size:number,mtime:number,sha256?:string,status?:string,chunks:string[]}} file
 * @returns {number} id del archivo
 */
export function insertFile(db, file) {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO files (path, name, ext, size, mtime, sha256, chunks, status, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      file.path,
      file.name,
      file.ext,
      file.size,
      file.mtime,
      file.sha256 ?? null,
      file.chunks.length,
      file.status ?? "indexed",
      now
    );
  const fileId = Number(info.lastInsertRowid);

  const insertChunk = db.prepare(
    "INSERT INTO chunks (file_id, chunk_index, content) VALUES (?, ?, ?)"
  );
  const insertFts = db.prepare("INSERT INTO chunks_fts (rowid, content) VALUES (?, ?)");
  file.chunks.forEach((content, index) => {
    const res = insertChunk.run(fileId, index, content);
    insertFts.run(Number(res.lastInsertRowid), content);
  });

  return fileId;
}

/**
 * Busqueda full-text con ranking BM25 y fragmentos resaltados.
 * @param {DatabaseSync} db
 * @param {string} matchQuery  consulta ya construida para FTS5 MATCH
 * @param {{limit?:number}} [opts]
 */
export function search(db, matchQuery, opts = {}) {
  const limit = Math.max(1, opts.limit ?? 20);
  return db
    .prepare(
      `SELECT
         fi.path        AS path,
         fi.name        AS name,
         fi.ext         AS ext,
         c.chunk_index  AS chunk_index,
         bm25(chunks_fts) AS score,
         snippet(chunks_fts, 0, '[[', ']]', ' … ', 14) AS snippet
       FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.rowid
       JOIN files  fi ON fi.id = c.file_id
       WHERE chunks_fts MATCH ?
       ORDER BY score ASC
       LIMIT ?`
    )
    .all(matchQuery, limit);
}

/** Estadisticas basicas del indice. */
export function stats(db) {
  const files = db.prepare("SELECT COUNT(*) AS n FROM files").get().n;
  const chunks = db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n;
  const skipped = db
    .prepare("SELECT COUNT(*) AS n FROM files WHERE status != 'indexed'")
    .get().n;
  const byExt = db
    .prepare(
      `SELECT ext, COUNT(*) AS n FROM files
       GROUP BY ext ORDER BY n DESC, ext ASC LIMIT 15`
    )
    .all();
  return { files, chunks, skipped, byExt };
}

/** Limpia todo el indice. */
export function clear(db) {
  db.exec("DELETE FROM chunks_fts; DELETE FROM chunks; DELETE FROM files;");
}
