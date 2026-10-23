import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, insertFile, withTransaction } from "../src/db.js";
import { getStore, semanticSearch, resetStore } from "../src/vectorstore.js";
import { hashEmbed } from "../src/embeddings.js";

const DIM = 64;

/** Crea una base con `n` chunks (un archivo), cada uno con su embedding hash. */
function makeDb(n) {
  const root = mkdtempSync(join(tmpdir(), "memex-vec-"));
  const db = openDatabase(join(root, ".memex", "index.db"));
  const chunks = [];
  for (let i = 0; i < n; i++) {
    const content = `documento numero ${i} sobre tema ${i * 7} y contenido variado ${i % 13}`;
    chunks.push({ content, embedding: hashEmbed(content, { dim: DIM }) });
  }
  // Una sola transaccion: sin ella, cada chunk se confirma por separado y
  // insertar 2000 fragmentos pasaba de ~0,2 s a mas de 90 s (fsync por fila).
  withTransaction(db, () =>
    insertFile(db, {
      path: join(root, "corpus.txt"),
      name: "corpus.txt",
      ext: ".txt",
      size: 1,
      mtime: 1,
      chunks,
    })
  );
  return { root, db };
}

test("getStore construye la matriz y cachea", () => {
  const { root, db } = makeDb(10);
  try {
    const store = getStore(db);
    assert.equal(store.count, 10);
    assert.equal(store.dim, DIM);
    assert.equal(store.matrix.length, 10 * DIM);
    assert.equal(getStore(db), store, "la segunda llamada reutiliza la cache");
    resetStore(db);
    assert.notEqual(getStore(db), store, "resetStore fuerza reconstruccion");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("getStore devuelve null sin embeddings", () => {
  const root = mkdtempSync(join(tmpdir(), "memex-vec-empty-"));
  const db = openDatabase(join(root, ".memex", "index.db"));
  try {
    assert.equal(getStore(db), null);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("el escaneo exacto encuentra el documento identico", () => {
  const { root, db } = makeDb(50);
  try {
    const store = getStore(db);
    const query = hashEmbed(store.contents[30], { dim: DIM });
    const hits = semanticSearch(db, query, { k: 5, minScore: 0 });
    assert.equal(hits[0].index, 30);
    assert.ok(hits[0].score > 0.99, "un vector identico da coseno ~1");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("semanticSearch descarta consultas con otra dimension y avisa", async () => {
  const { root, db } = makeDb(5);
  const warnings = [];
  const onWarning = (w) => warnings.push(w);
  process.on("warning", onWarning);
  try {
    // 32 dimensiones contra un indice de 64: no son comparables.
    const hits = semanticSearch(db, new Float32Array(32), { k: 3, minScore: 0 });
    assert.deepEqual(hits, [], "no debe devolver resultados con dimensiones mezcladas");
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(
      warnings.some((w) => w.code === "MEMEX_EMBED_DIM_MISMATCH"),
      "deberia avisar del desajuste de dimensiones"
    );
  } finally {
    process.removeListener("warning", onWarning);
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("el prefiltro binario no pierde el vecino mas cercano en corpus grande", () => {
  const { root, db } = makeDb(2000);
  try {
    const store = getStore(db);
    const target = 1234;
    const query = hashEmbed(store.contents[target], { dim: DIM });

    const exact = semanticSearch(db, query, { k: 5, minScore: 0 });
    const approx = semanticSearch(db, query, { k: 5, minScore: 0, approx: true });

    assert.equal(exact[0].index, target);
    assert.equal(approx[0].index, target, "el prefiltro binario conserva el top-1");
    // El shortlist (>=512) no debe degradar el top-1 ni su puntuacion.
    assert.ok(Math.abs(exact[0].score - approx[0].score) < 1e-6);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("la cache se invalida cuando OTRA conexion modifica el indice", () => {
  const { root, db } = makeDb(5);
  const db2 = openDatabase(join(root, ".memex", "index.db"));
  try {
    const before = getStore(db);
    assert.match(before.contents[0], /documento numero 0/);

    // Simula `memex index` en otra terminal: mismo numero de chunks, contenido
    // distinto. Sin `data_version` la cache de `memex serve` seguia siendo vieja.
    db2
      .prepare("UPDATE chunks SET content = ? WHERE id = ?")
      .run("contenido reemplazado por otra conexion", before.ids[0]);

    const after = getStore(db);
    assert.notEqual(after, before, "debe reconstruir la cache");
    assert.match(after.contents[0], /reemplazado/);
  } finally {
    db2.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
