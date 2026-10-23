import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, stats, chunksPendingEmbedding } from "../src/db.js";
import { embedIndex, indexFolder } from "../src/indexer.js";
import { hybridSearch, resolveQueryVec } from "../src/search.js";
import { hashEmbed } from "../src/embeddings.js";

/** Embedder asincrono de prueba: envuelve el hash en una Promesa. */
function asyncEmbedder(dim = 32) {
  const fn = async (text) => hashEmbed(text, { dim });
  fn.provider = "onnx";
  fn.dim = dim;
  return fn;
}

function makeCorpus() {
  const root = mkdtempSync(join(tmpdir(), "memex-embed-"));
  writeFileSync(join(root, "diario.md"), "Hoy hable de la ansiedad y del proyecto X en 2024.\n");
  writeFileSync(join(root, "receta.txt"), "Tarta de manzana con canela y azucar.\n");
  return root;
}

test("embedIndex calcula vectores con un embedder asincrono", async () => {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  try {
    indexFolder(db, root, { embedder: null });
    assert.equal(stats(db).embedded, 0, "sin embedder no hay vectores");
    assert.equal(chunksPendingEmbedding(db).length, 2);

    const res = await embedIndex(db, { embedder: asyncEmbedder() });
    assert.equal(res.embedded, 2);
    assert.equal(res.failed, 0);
    assert.equal(stats(db).embedded, 2);
    assert.equal(chunksPendingEmbedding(db).length, 0, "ya no queda nada pendiente");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveQueryVec + hybridSearch funciona con un embedder asincrono", async () => {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  const embedder = asyncEmbedder();
  try {
    indexFolder(db, root, { embedder: null });
    await embedIndex(db, { embedder });

    const queryVec = await resolveQueryVec(embedder, "ansiedad");
    assert.ok(queryVec && queryVec.length === 32);

    const hits = hybridSearch(db, "ansiedad", { mode: "hybrid", embedder, queryVec });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].name, "diario.md");
    assert.notEqual(hits[0].semantic_rank, null);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("embedIndex con force recomputa todos los vectores", async () => {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  try {
    indexFolder(db, root, { embedder: null });
    await embedIndex(db, { embedder: asyncEmbedder() });
    const again = await embedIndex(db, { embedder: asyncEmbedder(64), force: true });
    assert.equal(again.embedded, 2);
    assert.equal(again.dim, 64);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

/** Embedder asincrono que tambien sabe procesar lotes. */
function batchEmbedder(dim = 32) {
  const calls = [];
  const fn = async (text) => hashEmbed(text, { dim });
  fn.provider = "onnx";
  fn.dim = dim;
  fn.batch = async (texts) => {
    calls.push(texts.length);
    return texts.map((text) => hashEmbed(text, { dim }));
  };
  fn.calls = calls;
  return fn;
}

test("embedIndex usa el lote del proveedor en vez de ir texto a texto", async () => {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  const embedder = batchEmbedder();
  try {
    indexFolder(db, root, { embedder: null });
    const res = await embedIndex(db, { embedder });
    assert.equal(res.embedded, 2);
    assert.deepEqual(embedder.calls, [2], "los dos fragmentos van en una llamada");
    assert.equal(stats(db).embedded, 2);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("si el lote falla, embedIndex reintenta de uno en uno", async () => {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  const embedder = batchEmbedder();
  embedder.batch = async () => {
    throw new Error("lote roto");
  };
  try {
    indexFolder(db, root, { embedder: null });
    const res = await embedIndex(db, { embedder });
    assert.equal(res.embedded, 2, "ningun fragmento se pierde por un lote fallido");
    assert.equal(res.failed, 0);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
