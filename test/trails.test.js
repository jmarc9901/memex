import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../src/db.js";
import { indexFolder } from "../src/indexer.js";
import { createEmbedder } from "../src/embeddings.js";
import {
  ensureTrail,
  addToTrail,
  linkInTrail,
  listTrails,
  showTrail,
  relate,
  toD3,
  removeTrail,
} from "../src/trails.js";

function makeCorpus() {
  const root = mkdtempSync(join(tmpdir(), "memex-trails-"));
  writeFileSync(join(root, "proyecto.md"), "Conclusiones del proyecto X en 2024: simplificar y medir.\n");
  writeFileSync(join(root, "notas.md"), "Notas sobre el proyecto X y sus conclusiones de 2024.\n");
  writeFileSync(join(root, "receta.txt"), "Tarta de manzana con canela y azucar.\n");
  return root;
}

test("crea, lista, enlaza y exporta trails", () => {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  const embedder = createEmbedder({ embed_provider: "hash", embed_dim: 256 });
  try {
    indexFolder(db, root, { embedder });

    const trailId = ensureTrail(db, "proyecto-x", "como llego a conclusiones");
    assert.ok(trailId > 0);

    const added = addToTrail(db, { trail: "proyecto-x", ref: join(root, "proyecto.md"), embedder });
    assert.ok(added.ok);
    addToTrail(db, { trail: "proyecto-x", ref: join(root, "notas.md"), note: "contexto", embedder });

    const linked = linkInTrail(db, { trail: "proyecto-x", from: join(root, "proyecto.md"), to: join(root, "notas.md"), label: "relacionado", embedder });
    assert.ok(linked.ok);

    const graph = showTrail(db, "proyecto-x");
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.edges.length, 1);

    const d3 = toD3(graph);
    assert.equal(d3.nodes.length, 2);
    assert.equal(d3.links.length, 1);
    assert.equal(d3.trail, "proyecto-x");

    const listed = listTrails(db);
    assert.equal(listed[0].name, "proyecto-x");
    assert.equal(listed[0].nodes, 2);
    assert.equal(listed[0].edges, 1);

    removeTrail(db, "proyecto-x");
    assert.equal(listTrails(db).length, 0);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("relate encuentra documentos afines por similitud", () => {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  const embedder = createEmbedder({ embed_provider: "hash", embed_dim: 256 });
  try {
    indexFolder(db, root, { embedder });
    const results = relate(db, join(root, "proyecto.md"), { limit: 5, embedder });
    assert.ok(results.length >= 1);
    assert.equal(results[0].name, "notas.md", "las notas del mismo tema deben ir primero");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
