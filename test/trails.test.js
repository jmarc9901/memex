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
  exportTrail,
  linkInTrail,
  listTrails,
  showTrail,
  relate,
  toD3,
  removeTrail,
  suggestTrail,
} from "../src/trails.js";

function makeCorpus() {
  const root = mkdtempSync(join(tmpdir(), "memex-trails-"));
  writeFileSync(join(root, "proyecto.md"), "Conclusiones del proyecto X en 2024: simplificar y medir.\n");
  writeFileSync(join(root, "notas.md"), "Notas sobre el proyecto X y sus conclusiones de 2024.\n");
  writeFileSync(join(root, "receta.txt"), "Tarta de manzana con canela y azucar.\n");
  return root;
}

test("crea, lista, enlaza y exporta trails", async () => {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  const embedder = createEmbedder({ embed_provider: "hash", embed_dim: 256 });
  try {
    indexFolder(db, root, { embedder });

    const trailId = ensureTrail(db, "proyecto-x", "como llego a conclusiones");
    assert.ok(trailId > 0);

    const added = await addToTrail(db, { trail: "proyecto-x", ref: join(root, "proyecto.md"), embedder });
    assert.ok(added.ok);
    await addToTrail(db, { trail: "proyecto-x", ref: join(root, "notas.md"), note: "contexto", embedder });

    const linked = await linkInTrail(db, { trail: "proyecto-x", from: join(root, "proyecto.md"), to: join(root, "notas.md"), label: "relacionado", embedder });
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

test("exportTrail serializa a dot, mermaid, markdown y json", () => {
  const graph = {
    trail: { name: "proyecto-x", description: "camino" },
    nodes: [
      { file_id: 1, name: "a.md", path: "/a.md", ext: ".md", title: null, note: "inicio", position: 0 },
      { file_id: 2, name: "b.md", path: "/b.md", ext: ".md", title: "B", note: null, position: 1 },
    ],
    edges: [{ from: 1, to: 2, label: "relacionado" }],
  };

  const dot = exportTrail(graph, "dot");
  assert.match(dot, /^digraph "proyecto-x" \{/);
  assert.match(dot, /n1 -> n2 \[label="relacionado"\]/);
  assert.match(dot, /label="B/);

  const mermaid = exportTrail(graph, "mermaid");
  assert.match(mermaid, /^graph LR/);
  assert.match(mermaid, /n1 -->\|relacionado\| n2/);

  const md = exportTrail(graph, "md");
  assert.match(md, /^# Trail: proyecto-x/);
  assert.match(md, /_camino_/);
  assert.match(md, /1\. \*\*a\.md\*\*/);
  assert.match(md, /inicio/);
  assert.match(md, /a\.md → B/);

  const json = JSON.parse(exportTrail(graph, "json"));
  assert.equal(json.trail, "proyecto-x");
  assert.equal(json.description, "camino");
  assert.equal(json.links.length, 1);

  assert.throws(() => exportTrail(graph, "pdf"), /formato de trail invalido/);
});

test("suggestTrail propone documentos afines que aun no estan en el trail", async () => {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  const embedder = createEmbedder({ embed_provider: "hash", embed_dim: 256 });
  try {
    indexFolder(db, root, { embedder });
    await addToTrail(db, { trail: "t", ref: join(root, "proyecto.md"), embedder });

    const res = await suggestTrail(db, "t", { limit: 5, embedder });
    assert.equal(res.members, 1);
    assert.ok(res.suggestions.length >= 1);
    assert.ok(res.suggestions.every((s) => s.name !== "proyecto.md"), "no repite los miembros");
    assert.equal(res.suggestions[0].name, "notas.md");

    assert.equal(await suggestTrail(db, "inexistente", { embedder }), null);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("relate encuentra documentos afines por similitud", async () => {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  const embedder = createEmbedder({ embed_provider: "hash", embed_dim: 256 });
  try {
    indexFolder(db, root, { embedder });
    const results = await relate(db, join(root, "proyecto.md"), { limit: 5, embedder });
    assert.ok(results.length >= 1);
    assert.equal(results[0].name, "notas.md", "las notas del mismo tema deben ir primero");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
