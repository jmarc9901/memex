import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../src/db.js";
import { indexFolder } from "../src/indexer.js";
import { createEmbedder } from "../src/embeddings.js";
import { startServer } from "../src/server.js";

/** Arranca el servidor en un puerto libre con un corpus de prueba. */
async function withServer(fn) {
  const root = mkdtempSync(join(tmpdir(), "memex-server-"));
  writeFileSync(join(root, "notas.md"), "Hoy hable de la ansiedad y del proyecto X en 2024.");

  const prevConfig = process.env.MEMEX_CONFIG;
  process.env.MEMEX_CONFIG = join(root, "no-config.json"); // evita config del usuario
  const dbPath = join(root, ".memex", "index.db");
  const db = openDatabase(dbPath);
  indexFolder(db, root, { embedder: createEmbedder({}) });
  db.close();

  const handle = startServer({ dbPath, port: 0 });
  const port = await new Promise((resolve) => {
    if (handle.server.listening) return resolve(handle.server.address().port);
    handle.server.once("listening", () => resolve(handle.server.address().port));
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base, root);
  } finally {
    await handle.close();
    if (prevConfig === undefined) delete process.env.MEMEX_CONFIG;
    else process.env.MEMEX_CONFIG = prevConfig;
    rmSync(root, { recursive: true, force: true });
  }
}

test("GET /api/stats devuelve el resumen del indice", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/stats`);
    assert.equal(res.status, 200);
    const s = await res.json();
    assert.equal(s.files, 1);
    assert.ok(s.chunks >= 1);
  });
});

test("GET /api/search valida y responde con resultados", async () => {
  await withServer(async (base) => {
    const bad = await fetch(`${base}/api/search?q=`);
    assert.equal(bad.status, 400);

    const res = await fetch(`${base}/api/search?q=ansiedad&mode=lexical`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.count ?? data.results.length, data.results.length);
    assert.equal(data.results[0].name, "notas.md");
    assert.match(data.results[0].snippet, /\[\[ansiedad\]\]/);
  });
});

test("POST /api/save guarda una pagina y la hace buscable", async () => {
  await withServer(async (base) => {
    const saved = await fetch(`${base}/api/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://ejemplo.test/articulo",
        title: "Articulo de prueba",
        text: "El contenido habla de serenidad y calma mental.",
      }),
    });
    assert.equal(saved.status, 200);
    const info = await saved.json();
    assert.ok(info.chunks >= 1);

    const res = await fetch(`${base}/api/search?q=serenidad`);
    const data = await res.json();
    assert.ok(data.results.some((r) => r.name === "Articulo de prueba"));
  });
});

test("POST /api/ask funciona en modo offline y cita fuentes", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "ansiedad" }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.answer, null);
    assert.equal(data.offline, true);
    assert.ok(data.context.length >= 1);
  });
});

test("trails: lista, crea nodos y devuelve el grafo", async () => {
  await withServer(async (base, root) => {
    const empty = await fetch(`${base}/api/trails`);
    assert.deepEqual((await empty.json()).trails, []);

    const added = await fetch(`${base}/api/trails/proyecto`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: join(root, "notas.md"), note: "origen" }),
    });
    assert.equal(added.status, 200);
    assert.equal((await added.json()).ok, true);

    const graph = await fetch(`${base}/api/trails/proyecto`);
    assert.equal(graph.status, 200);
    const d3 = await graph.json();
    assert.equal(d3.trail, "proyecto");
    assert.equal(d3.nodes.length, 1);

    const missing = await fetch(`${base}/api/trails/inexistente`);
    assert.equal(missing.status, 404);
  });
});

test("sirve la GUI estatica y rechaza rutas desconocidas", async () => {
  await withServer(async (base) => {
    const html = await fetch(`${base}/`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /Memex Offline/);

    const css = await fetch(`${base}/styles.css`);
    assert.equal(css.status, 200);

    const nope = await fetch(`${base}/api/desconocido`);
    assert.equal(nope.status, 404);
  });
});
