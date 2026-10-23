import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../src/db.js";
import { indexFolder } from "../src/indexer.js";
import { hybridSearch, fuse, makeSnippet, semanticMinScore } from "../src/search.js";
import { createEmbedder } from "../src/embeddings.js";

function makeCorpus() {
  const root = mkdtempSync(join(tmpdir(), "memex-search-"));
  writeFileSync(
    join(root, "diario.md"),
    "Hoy hable sobre la ansiedad y como me sentia en ese momento.\n\nEl proyecto X saco conclusiones en 2024: simplificar.\n"
  );
  writeFileSync(
    join(root, "receta.txt"),
    "Tarta de manzana\n\nIngredientes: manzana, harina, canela y azucar.\n"
  );
  return root;
}

test("fuse ordena por RRF y conserva el origen de cada hit", () => {
  const lex = [{ file_id: 1, chunk_index: 0, name: "a", path: "a", ext: ".md", snippet: "s", lexical_score: -1 }];
  const sem = [
    { file_id: 1, chunk_index: 0, name: "a", path: "a", ext: ".md", snippet: "s2", semantic_score: 0.9 },
    { file_id: 2, chunk_index: 0, name: "b", path: "b", ext: ".md", snippet: "s3", semantic_score: 0.5 },
  ];
  const fused = fuse(lex, sem);
  assert.equal(fused.length, 2);
  assert.equal(fused[0].file_id, 1, "el hit presente en ambas listas va primero");
  assert.equal(fused[0].lexical_rank, 0);
  assert.equal(fused[0].semantic_rank, 0);
});

test("makeSnippet resalta los terminos de la consulta", () => {
  const snip = makeSnippet("texto largo sobre ansiedad y calma", "ansiedad");
  assert.match(snip, /\[\[ansiedad\]\]/);
});

test("modos lexical, semantic e hybrid devuelven resultados coherentes", () => {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  const embedder = createEmbedder({ embed_provider: "hash", embed_dim: 256 });
  try {
    indexFolder(db, root, { embedder });

    const lexical = hybridSearch(db, "conclusiones", { mode: "lexical" });
    assert.equal(lexical.length, 1);
    assert.equal(lexical[0].name, "diario.md");

    const semantic = hybridSearch(db, "ansiedad", { mode: "semantic", embedder });
    assert.ok(semantic.length >= 1);
    assert.equal(semantic[0].name, "diario.md");
    assert.equal(semantic[0].lexical_rank, null);

    const hybrid = hybridSearch(db, "ansiedad", { mode: "hybrid", embedder });
    assert.ok(hybrid[0].name === "diario.md");
    assert.notEqual(hybrid[0].lexical_rank, null);
    assert.notEqual(hybrid[0].semantic_rank, null);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("reindexar invalida la cache del indice vectorial", () => {
  const root = mkdtempSync(join(tmpdir(), "memex-stale-"));
  const db = openDatabase(join(root, ".memex", "index.db"));
  const embedder = createEmbedder({ embed_provider: "hash", embed_dim: 256 });
  const file = join(root, "nota.md");
  try {
    writeFileSync(file, "ansiedad terapia bienestar emocional\n");
    indexFolder(db, root, { embedder });
    let hits = hybridSearch(db, "ansiedad", { mode: "semantic", embedder });
    assert.equal(hits[0].name, "nota.md");

    // Mismo numero de chunks (texto corto), contenido distinto: la cache
    // antigua se reutilizaba y devolvia el fragmento viejo.
    writeFileSync(file, "receta tarta manzana canela hornear\n");
    indexFolder(db, root, { embedder, force: true });

    hits = hybridSearch(db, "manzana", { mode: "semantic", embedder });
    assert.equal(hits.length, 1);
    assert.match(hits[0].snippet, /manzana/);

    hits = hybridSearch(db, "ansiedad", { mode: "semantic", embedder });
    assert.equal(hits.length, 0, "el contenido anterior ya no debe existir");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("el umbral semantico descarta coincidencias sin relacion", () => {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  const embedder = createEmbedder({ embed_provider: "hash", embed_dim: 256 });
  try {
    indexFolder(db, root, { embedder });
    const semantic = hybridSearch(db, "ansiedad", { mode: "semantic", embedder });
    assert.ok(semantic.length >= 1);
    assert.ok(
      semantic.every((r) => r.name === "diario.md"),
      "la receta no deberia aparecer como coincidencia semantica"
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("el umbral semantico depende del proveedor de embeddings", () => {
  assert.equal(semanticMinScore(null), 0.1);
  assert.equal(semanticMinScore({ provider: "hash" }), 0.1);
  assert.equal(
    semanticMinScore({ provider: "onnx" }),
    0.3,
    "ONNX necesita un corte mas alto que el feature hashing"
  );
  assert.ok(semanticMinScore({ provider: "onnx" }) > semanticMinScore({ provider: "hash" }));
});
