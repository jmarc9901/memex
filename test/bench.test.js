import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { benchmark } from "../src/bench.js";
import { createEmbedder } from "../src/embeddings.js";

function makeCorpus() {
  const root = mkdtempSync(join(tmpdir(), "memex-bench-"));
  writeFileSync(join(root, "a.md"), "Conclusiones del proyecto sobre ansiedad y bienestar emocional.\n");
  writeFileSync(join(root, "b.txt"), "Receta de tarta de manzana con canela y azucar.\n");
  return root;
}

test("benchmark indexa en un indice desechable y mide busquedas", async () => {
  const root = makeCorpus();
  try {
    const r = await benchmark(root, { embedder: createEmbedder({}), limit: 5 });
    assert.equal(r.scanned, 2);
    assert.equal(r.indexed, 2);
    assert.ok(r.chunks >= 1);
    assert.ok(r.index_ms >= 0);
    assert.ok(r.search_ms.count >= 1);
    assert.ok(r.search_ms.median >= 0);
    assert.ok(Array.isArray(r.queries));
    assert.ok(r.rss_mb > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("benchmark acepta consultas explicitas y sin embeddings", async () => {
  const root = makeCorpus();
  try {
    const r = await benchmark(root, { queries: ["ansiedad"], limit: 3 });
    assert.equal(r.embedded, 0);
    assert.equal(r.queries.length, 1);
    assert.equal(r.queries[0].query, "ansiedad");
    assert.ok(r.queries[0].hits >= 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
