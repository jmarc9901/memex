import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../src/db.js";
import { indexFolder } from "../src/indexer.js";
import { createEmbedder } from "../src/embeddings.js";
import { startServer, isLoopbackHost, resolveStaticPath } from "../src/server.js";

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

test("GET /api/health responde sin tocar el indice", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.name, "memex");
  });
});

test("la API responde 400 ante parametros y JSON invalidos, no 500", async () => {
  await withServer(async (base) => {
    const badLimit = await fetch(`${base}/api/search?q=ansiedad&limit=abc`);
    assert.equal(badLimit.status, 400);
    assert.match((await badLimit.json()).error, /limit invalido/);

    const badMode = await fetch(`${base}/api/search?q=ansiedad&mode=nope`);
    assert.equal(badMode.status, 400);

    const badJson = await fetch(`${base}/api/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{no es json",
    });
    assert.equal(badJson.status, 400);
    assert.match((await badJson.json()).error, /JSON invalido/);

    const badSave = await fetch(`${base}/api/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: 42, text: [] }),
    });
    assert.equal(badSave.status, 400);
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

    const lib = await fetch(`${base}/lib.js`);
    assert.equal(lib.status, 200, "los helpers de la GUI se sirven como modulo");

    const nope = await fetch(`${base}/api/desconocido`);
    assert.equal(nope.status, 404);
  });
});

test("POST /api/embed responde con el resumen de texto y de vectores", async () => {
  await withServer(async (base, root) => {
    const res = await fetch(`${base}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: root }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.provider, "hash");
    assert.equal(data.text.unchanged, 1);
    assert.equal(data.embedded, 0, "el corpus de prueba ya venia vectorizado");
  });
});

test("GET /api/trails/:name?format=dot y /api/config", async () => {
  await withServer(async (base, root) => {
    await fetch(`${base}/api/trails/formato`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: join(root, "notas.md") }),
    });

    const dot = await fetch(`${base}/api/trails/formato?format=dot`);
    assert.equal(dot.status, 200);
    assert.match(dot.headers.get("content-type"), /graphviz/);
    assert.match(await dot.text(), /^digraph/);

    const bad = await fetch(`${base}/api/trails/formato?format=pdf`);
    assert.equal(bad.status, 400);

    const cfg = await fetch(`${base}/api/config`);
    assert.equal(cfg.status, 200);
    const config = await cfg.json();
    assert.equal(config.embed_provider, "hash");
    assert.equal(typeof config.rag_enabled, "boolean");
  });
});

test("GET /api/tools informa herramientas y configuracion", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/tools`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.tools) && data.tools.length >= 5);
    assert.equal(typeof data.capabilities.pdf, "boolean");
    assert.equal(data.config.embed_provider, "hash");
  });
});

test("la API rechaza origenes remotos y permite extensiones y localhost", async () => {
  await withServer(async (base) => {
    // Una web cualquiera no puede leer el indice.
    const evil = await fetch(`${base}/api/search?q=ansiedad`, {
      headers: { origin: "https://evil.example" },
    });
    assert.equal(evil.status, 403);
    assert.equal(evil.headers.get("access-control-allow-origin"), null);

    // La extension del navegador si esta autorizada y recibe CORS reflejado.
    const extOrigin = "chrome-extension://abcdefghijklmnop";
    const ext = await fetch(`${base}/api/search?q=ansiedad`, {
      headers: { origin: extOrigin },
    });
    assert.equal(ext.status, 200);
    assert.equal(ext.headers.get("access-control-allow-origin"), extOrigin);
    assert.equal(ext.headers.get("vary"), "Origin");

    // El preflight tambien se corta para origenes no permitidos.
    const preflight = await fetch(`${base}/api/search`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });
    assert.equal(preflight.status, 403);
  });
});

test("isLoopbackHost acepta loopback y rechaza el resto", () => {
  for (const host of ["127.0.0.1", "localhost", "::1", "[::1]", "127.0.0.53"]) {
    assert.equal(isLoopbackHost(host), true, `${host} deberia ser loopback`);
  }
  for (const host of ["0.0.0.0", "192.168.1.10", "::", "example.com", "", undefined]) {
    assert.equal(isLoopbackHost(host), false, `${host} no deberia ser loopback`);
  }
});

test("serve rechaza escuchar fuera de loopback sin --allow-remote", () => {
  const root = mkdtempSync(join(tmpdir(), "memex-host-"));
  try {
    const dbPath = join(root, "index.db");
    for (const host of ["0.0.0.0", "192.168.1.10"]) {
      assert.throws(() => startServer({ dbPath, port: 0, host }), /no local/, `${host} deberia rechazarse`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("serve arranca fuera de loopback solo con allowRemote explicito", async () => {
  const root = mkdtempSync(join(tmpdir(), "memex-remote-"));
  const handle = startServer({
    dbPath: join(root, "index.db"),
    port: 0,
    host: "0.0.0.0",
    allowRemote: true,
  });
  try {
    if (!handle.server.listening) {
      await new Promise((resolve) => handle.server.once("listening", resolve));
    }
    assert.ok(handle.server.listening);
  } finally {
    await handle.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveStaticPath confina las rutas a web/", () => {
  assert.match(resolveStaticPath("/"), /web[/\\]index\.html$/);
  assert.match(resolveStaticPath("/app.js"), /web[/\\]app\.js$/);
  for (const path of ["/../src/db.js", "/../package.json", "/../", "/..\\..\\package.json"]) {
    assert.equal(resolveStaticPath(path), null, `${path} deberia quedar fuera de web/`);
  }
});

test("la GUI lleva cabeceras de seguridad y no sirve nada fuera de web/", async () => {
  await withServer(async (base) => {
    const html = await fetch(`${base}/`);
    assert.equal(html.status, 200);
    assert.equal(html.headers.get("x-content-type-options"), "nosniff");
    assert.equal(html.headers.get("x-frame-options"), "DENY");
    assert.match(html.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(html.headers.get("content-security-policy"), /frame-ancestors 'none'/);

    // Ni rutas codificadas ni directorios hermanos (web-algo) se sirven.
    for (const path of ["/..%2fpackage.json", "/%2e%2e/package.json", "/web-backup/x.js"]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 404, `${path} no deberia servirse`);
    }
  });
});

test("isAllowedOrigin acepta localhost y extensiones, y rechaza el resto", async () => {
  const { isAllowedOrigin } = await import("../src/server.js");
  assert.equal(isAllowedOrigin("http://127.0.0.1:4747"), true);
  assert.equal(isAllowedOrigin("http://localhost:4747"), true);
  assert.equal(isAllowedOrigin("chrome-extension://abc"), true);
  assert.equal(isAllowedOrigin("moz-extension://abc"), true);
  assert.equal(isAllowedOrigin("https://evil.example"), false);
  assert.equal(isAllowedOrigin("http://localhost.evil.example"), false);
  assert.equal(isAllowedOrigin(undefined), false);
});

test("POST /api/index valida la carpeta y reindexa de forma asincrona", async () => {
  await withServer(async (base, root) => {
    const missing = await fetch(`${base}/api/index`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: join(root, "no-existe") }),
    });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /no existe la carpeta/);

    const notDir = await fetch(`${base}/api/index`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: join(root, "notas.md") }),
    });
    assert.equal(notDir.status, 400);
    assert.match((await notDir.json()).error, /no es una carpeta/);

    const ok = await fetch(`${base}/api/index`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: root }),
    });
    assert.equal(ok.status, 200);
    const summary = await ok.json();
    assert.equal(summary.scanned, 1);
    assert.equal(summary.unchanged, 1);
    assert.equal(summary.pruned, 0);
  });
});

test("POST /api/embed valida la carpeta antes de vectorizar", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/ruta/que/no/existe/jamas" }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /no existe la carpeta/);
  });
});
