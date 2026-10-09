// Memex Offline - capa de almacenamiento.
// SQLite + FTS5 (sin dependencias externas, via node:sqlite).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fromBlob } from "./embeddings.js";

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

/** Crea el esquema si no existe y aplica migraciones aditivas. */
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
      source     TEXT,
      url        TEXT,
      title      TEXT,
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

    CREATE TABLE IF NOT EXISTS trails (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trail_nodes (
      id        INTEGER PRIMARY KEY,
      trail_id  INTEGER NOT NULL REFERENCES trails(id) ON DELETE CASCADE,
      file_id   INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      note      TEXT,
      position  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS trail_edges (
      id        INTEGER PRIMARY KEY,
      trail_id  INTEGER NOT NULL REFERENCES trails(id) ON DELETE CASCADE,
      from_file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      to_file   INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      label     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_trail ON trail_nodes(trail_id);
    CREATE INDEX IF NOT EXISTS idx_edges_trail ON trail_edges(trail_id);
  `);

  // Migraciones aditivas para indices creados en versiones anteriores.
  ensureColumn(db, "chunks", "embedding", "BLOB");
  ensureColumn(db, "chunks", "embed_dim", "INTEGER");
  ensureColumn(db, "files", "source", "TEXT");
  ensureColumn(db, "files", "url", "TEXT");
  ensureColumn(db, "files", "title", "TEXT");
}

function ensureColumn(db, table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

/** Lee/crea metadatos del indice. */
export function getMeta(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row?.value ?? null;
}

export function setMeta(db, key, value) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}

/** Lee el mtime+size previos de un archivo ya indexado (o undefined). */
export function getIndexedFile(db, path) {
  return db
    .prepare("SELECT id, size, mtime, sha256 FROM files WHERE path = ?")
    .get(path);
}

/** Busca un archivo por ruta (o por id). */
export function getFileByPath(db, path) {
  return db.prepare("SELECT * FROM files WHERE path = ?").get(path) ?? null;
}

export function getFileById(db, id) {
  return db.prepare("SELECT * FROM files WHERE id = ?").get(id) ?? null;
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
 * Inserta un archivo con sus chunks en el indice.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{path:string,name:string,ext:string,size:number,mtime:number,sha256?:string,
 *          status?:string,source?:string,url?:string,title?:string,
 *          chunks:Array<{content:string,embedding?:Float32Array,embedDim?:number}>}} file
 * @returns {number} id del archivo
 */
export function insertFile(db, file) {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO files (path, name, ext, size, mtime, sha256, chunks, status, source, url, title, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      file.source ?? null,
      file.url ?? null,
      file.title ?? null,
      now
    );
  const fileId = Number(info.lastInsertRowid);

  const insertChunk = db.prepare(
    "INSERT INTO chunks (file_id, chunk_index, content, embedding, embed_dim) VALUES (?, ?, ?, ?, ?)"
  );
  const insertFts = db.prepare("INSERT INTO chunks_fts (rowid, content) VALUES (?, ?)");
  file.chunks.forEach((chunk, index) => {
    const embedding = chunk.embedding ?? null;
    const res = insertChunk.run(
      fileId,
      index,
      chunk.content,
      embedding,
      embedding ? embedding.length : null
    );
    insertFts.run(Number(res.lastInsertRowid), chunk.content);
  });

  return fileId;
}

/**
 * Busqueda full-text con ranking BM25 y fragmentos resaltados.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} matchQuery  consulta ya construida para FTS5 MATCH
 * @param {{limit?:number}} [opts]
 */
export function search(db, matchQuery, opts = {}) {
  const limit = Math.max(1, opts.limit ?? 20);
  return db
    .prepare(
      `SELECT
         fi.id          AS file_id,
         fi.path        AS path,
         fi.name        AS name,
         fi.ext         AS ext,
         c.chunk_index  AS chunk_index,
         c.id           AS chunk_id,
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

/**
 * Candidatos semanticos: todos los chunks con embedding.
 * Pensado para corpus personales (decenas de miles de fragmentos).
 */
export function chunksWithEmbeddings(db) {
  return db
    .prepare(
      `SELECT
         c.id           AS chunk_id,
         c.content      AS content,
         c.embedding    AS embedding,
         c.chunk_index  AS chunk_index,
         fi.id          AS file_id,
         fi.path        AS path,
         fi.name        AS name,
         fi.ext         AS ext
       FROM chunks c
       JOIN files fi ON fi.id = c.file_id
       WHERE c.embedding IS NOT NULL`
    )
    .all();
}

/** Numero de chunks con embedding (para decidir si hay indice semantico). */
export function embeddedChunkCount(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE embedding IS NOT NULL").get().n;
}

/** Estadisticas basicas del indice. */
export function stats(db) {
  const files = db.prepare("SELECT COUNT(*) AS n FROM files").get().n;
  const chunks = db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n;
  const skipped = db
    .prepare("SELECT COUNT(*) AS n FROM files WHERE status != 'indexed'")
    .get().n;
  const embedded = embeddedChunkCount(db);
  const byExt = db
    .prepare(
      `SELECT ext, COUNT(*) AS n FROM files
       GROUP BY ext ORDER BY n DESC, ext ASC LIMIT 15`
    )
    .all();
  return { files, chunks, skipped, embedded, byExt };
}

/** Limpia todo el indice (documentos, chunks y trails). */
export function clear(db) {
  db.exec(
    "DELETE FROM chunks_fts; DELETE FROM chunks; DELETE FROM trail_edges; DELETE FROM trail_nodes; DELETE FROM trails; DELETE FROM files;"
  );
}

// ---------------------------------------------------------------------------
// Trails (caminos asociativos entre documentos, como imagino Vannevar Bush)
// ---------------------------------------------------------------------------

export function createTrail(db, name, description = "") {
  const now = Date.now();
  const info = db
    .prepare(
      "INSERT INTO trails (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)"
    )
    .run(name, description, now, now);
  return Number(info.lastInsertRowid);
}

export function getTrailByName(db, name) {
  return db.prepare("SELECT * FROM trails WHERE name = ?").get(name) ?? null;
}

export function listTrails(db) {
  return db
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM trail_nodes n WHERE n.trail_id = t.id) AS nodes,
              (SELECT COUNT(*) FROM trail_edges e WHERE e.trail_id = t.id) AS edges
       FROM trails t ORDER BY t.updated_at DESC`
    )
    .all();
}

export function deleteTrail(db, name) {
  const trail = getTrailByName(db, name);
  if (!trail) return 0;
  db.prepare("DELETE FROM trails WHERE id = ?").run(trail.id);
  return trail.id;
}

export function touchTrail(db, trailId) {
  db.prepare("UPDATE trails SET updated_at = ? WHERE id = ?").run(Date.now(), trailId);
}

export function addTrailNode(db, trailId, fileId, note = null) {
  const existing = db
    .prepare("SELECT id FROM trail_nodes WHERE trail_id = ? AND file_id = ?")
    .get(trailId, fileId);
  if (existing) {
    if (note !== null) {
      db.prepare("UPDATE trail_nodes SET note = ? WHERE id = ?").run(note, existing.id);
    }
    return existing.id;
  }
  const pos = db
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM trail_nodes WHERE trail_id = ?")
    .get(trailId).p;
  const info = db
    .prepare("INSERT INTO trail_nodes (trail_id, file_id, note, position) VALUES (?, ?, ?, ?)")
    .run(trailId, fileId, note, pos);
  touchTrail(db, trailId);
  return Number(info.lastInsertRowid);
}

export function addTrailEdge(db, trailId, fromFile, toFile, label = null) {
  const info = db
    .prepare(
      "INSERT INTO trail_edges (trail_id, from_file, to_file, label) VALUES (?, ?, ?, ?)"
    )
    .run(trailId, fromFile, toFile, label);
  touchTrail(db, trailId);
  return Number(info.lastInsertRowid);
}

/** Grafo completo de un trail (nodos + aristas) listo para serializar. */
export function getTrailGraph(db, name) {
  const trail = getTrailByName(db, name);
  if (!trail) return null;
  const nodes = db
    .prepare(
      `SELECT n.id, n.note, n.position, f.id AS file_id, f.name, f.path, f.ext, f.title
       FROM trail_nodes n JOIN files f ON f.id = n.file_id
       WHERE n.trail_id = ? ORDER BY n.position ASC`
    )
    .all(trail.id);
  const edges = db
    .prepare(
      `SELECT e.id, e.label, e.from_file AS from, e.to_file AS to
       FROM trail_edges e WHERE e.trail_id = ?`
    )
    .all(trail.id);
  return { trail, nodes, edges };
}

/** Chunks (id + contenido) de un conjunto de archivos, para RAG. */
export function chunksForFiles(db, fileIds) {
  if (!fileIds.length) return [];
  const placeholders = fileIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT c.id, c.content, c.chunk_index, f.id AS file_id, f.name, f.path
       FROM chunks c JOIN files f ON f.id = c.file_id
       WHERE c.file_id IN (${placeholders})
       ORDER BY c.file_id, c.chunk_index`
    )
    .all(...fileIds);
}

export { fromBlob };
