import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs, formatExport, run } from "../src/cli.js";
import { loadConfig } from "../src/config.js";

/** Colector que imita un stream de salida. */
function collector() {
  let buffer = "";
  return {
    isTTY: false,
    write(chunk) {
      buffer += chunk;
    },
    get text() {
      return buffer;
    },
  };
}

test("parseArgs separa comandos, valores y flags booleanas", () => {
  const flags = parseArgs([
    "search", "ansiedad", "proyecto", "--mode", "semantic", "-n", "5", "--any", "--json",
  ]);
  assert.deepEqual(flags._, ["search", "ansiedad", "proyecto"]);
  assert.equal(flags.mode, "semantic");
  assert.equal(flags.limit, 5);
  assert.equal(flags.any, true);
  assert.equal(flags.json, true);
});

test("parseArgs reconoce flags con valor de serve y export", () => {
  const flags = parseArgs(["serve", "--port", "8080", "--host", "0.0.0.0"]);
  assert.equal(flags.port, 8080);
  assert.equal(flags.host, "0.0.0.0");

  const exp = parseArgs(["export", "x", "--format", "csv", "-o", "s.csv"]);
  assert.equal(exp.format, "csv");
  assert.equal(exp.out, "s.csv");
});

test("parseArgs exige valor para flags que lo requieren", () => {
  assert.throws(() => parseArgs(["search", "x", "--mode"]), /falta el valor/);
});

test("parseArgs registra las flags desconocidas sin romper las propias", () => {
  const flags = parseArgs(["init", "--no-model", "--limt", "5"]);
  assert.equal(flags["no-model"], true, "--no-model sigue siendo una flag valida");
  assert.deepEqual(flags._unknown, ["--limt"]);

  const clean = parseArgs(["search", "x", "--json", "--any"]);
  assert.equal(clean._unknown, undefined, "sin erratas no hay avisos");
});

test("run() avisa por stderr (nunca por stdout) de las opciones desconocidas", async () => {
  const root = mkdtempSync(join(tmpdir(), "memex-flags-"));
  try {
    const stdout = collector();
    const stderr = collector();
    await run(["stats", "--db", join(root, "index.db"), "--json", "--limt"], {
      stdout,
      stderr,
    });
    assert.match(stderr.text, /no reconocidas/);
    assert.match(stderr.text, /--limt/);
    // stdout queda limpio: sigue siendo JSON parseable por otro proceso.
    assert.equal(JSON.parse(stdout.text).files, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("formatExport serializa a jsonl, csv y markdown", () => {
  const rows = [
    { name: "a.md", path: "/a.md", ext: ".md", chunk_index: 0, score: -1.5, snippet: "hola [[ansiedad]]" },
    { name: "b.md", path: "/b.md", ext: ".md", chunk_index: 1, score: -0.5, snippet: "texto, con coma" },
  ];
  const jsonl = formatExport(rows, { query: "ansiedad", format: "jsonl" });
  assert.equal(jsonl.split("\n").length, 2);
  assert.equal(JSON.parse(jsonl.split("\n")[0]).query, "ansiedad");

  const csv = formatExport(rows, { query: "ansiedad", format: "csv" });
  assert.match(csv.split("\n")[0], /^rank,name,path/);
  assert.match(csv, /"texto, con coma"/);
  assert.doesNotMatch(csv, /\[\[/);

  const md = formatExport(rows, { query: "ansiedad", mode: "lexical", format: "md" });
  assert.match(md, /^# Memex export/);
  assert.match(md, /## 1\. a\.md/);
  assert.match(md, /hola ansiedad/);
});

function makeCorpus() {
  const root = mkdtempSync(join(tmpdir(), "memex-cli-"));
  writeFileSync(join(root, "diario.md"), "Hoy hable de la ansiedad y del proyecto X.\n");
  writeFileSync(join(root, "receta.txt"), "Receta de tarta de manzana con canela y azucar.\n");
  return root;
}

test("run() indexa, busca con AND/OR y reporta stats", async () => {
  const root = makeCorpus();
  try {
    const dbPath = join(root, ".memex", "index.db");

    const indexOut = collector();
    await run(["index", root, "--db", dbPath, "--no-embed", "--json"], { stdout: indexOut });
    const summary = JSON.parse(indexOut.text);
    assert.equal(summary.added, 2);

    const andOut = collector();
    await run(["search", "ansiedad receta", "--db", dbPath, "--json"], { stdout: andOut });
    assert.equal(JSON.parse(andOut.text).count, 0);

    const orOut = collector();
    await run(["search", "ansiedad receta", "--any", "--db", dbPath, "--json"], { stdout: orOut });
    assert.equal(JSON.parse(orOut.text).count, 2);

    const statsOut = collector();
    await run(["stats", "--db", dbPath, "--json"], { stdout: statsOut });
    assert.equal(JSON.parse(statsOut.text).files, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("run() export escribe a stdout ya un archivo", async () => {
  const root = makeCorpus();
  try {
    const dbPath = join(root, ".memex", "index.db");
    await run(["index", root, "--db", dbPath, "--no-embed"], { stdout: collector() });

    const stdout = collector();
    await run(["export", "ansiedad", "--db", dbPath, "--format", "csv"], { stdout });
    assert.match(stdout.text, /^rank,/);

    const outFile = join(root, "export.jsonl");
    const fileOut = collector();
    await run(["export", "ansiedad", "--db", dbPath, "--format", "jsonl", "-o", outFile], { stdout: fileOut });
    const lines = readFileSync(outFile, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).name, "diario.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("run() config set escribe y loadConfig lo refleja", async () => {
  const root = mkdtempSync(join(tmpdir(), "memex-config-"));
  const prev = process.env.MEMEX_CONFIG;
  process.env.MEMEX_CONFIG = join(root, "config.json");
  try {
    const setOut = collector();
    await run(["config", "set", "rag.provider", "ollama"], { stdout: setOut });
    assert.match(setOut.text, /rag\.provider/);
    assert.equal(loadConfig().rag.provider, "ollama");

    const numOut = collector();
    await run(["config", "set", "server.port", "8080"], { stdout: numOut });
    assert.equal(loadConfig().server.port, 8080);

    const show = collector();
    await run(["config", "show", "--json"], { stdout: show });
    const data = JSON.parse(show.text);
    assert.equal(data.config.rag.provider, "ollama");
    assert.equal(data.config.server.port, 8080);
    assert.ok(typeof data.path === "string");
  } finally {
    if (prev === undefined) delete process.env.MEMEX_CONFIG;
    else process.env.MEMEX_CONFIG = prev;
    rmSync(root, { recursive: true, force: true });
  }
});

test("run() rechaza comandos y modos invalidos", async () => {
  await assert.rejects(() => run(["volando"], { stdout: collector() }), /comando desconocido/);
  await assert.rejects(
    () => run(["search", "x", "--mode", "ilegal"], { stdout: collector() }),
    /modo invalido/
  );
});

test("run() acota -n al maximo de resultados de la API", async () => {
  const root = makeCorpus();
  try {
    const dbPath = join(root, ".memex", "index.db");
    await run(["index", root, "--db", dbPath, "--no-embed"], { stdout: collector() });

    const out = collector();
    await run(["search", "ansiedad", "-n", "1000000", "--db", dbPath, "--json"], {
      stdout: out,
    });
    const data = JSON.parse(out.text);
    assert.ok(data.count <= 100, `count=${data.count} deberia estar acotado`);
    assert.ok(data.results.length <= 100);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Aisla la config del usuario para que estos tests sean deterministas. */
function isolateConfig(root) {
  const prev = process.env.MEMEX_CONFIG;
  process.env.MEMEX_CONFIG = join(root, "config.json");
  return () => {
    if (prev === undefined) delete process.env.MEMEX_CONFIG;
    else process.env.MEMEX_CONFIG = prev;
  };
}

test("run() crea, enlaza, muestra, sugiere y elimina un trail", async () => {
  const root = makeCorpus();
  const restore = isolateConfig(root);
  try {
    const dbPath = join(root, ".memex", "index.db");
    await run(["index", root, "--db", dbPath, "--no-embed"], { stdout: collector() });
    const note = join(root, "diario.md");
    const recipe = join(root, "receta.txt");

    await run(["trail", "create", "demo", "--desc", "camino", "--db", dbPath], {
      stdout: collector(),
    });
    await run(["trail", "add", "demo", note, "--note", "inicio", "--db", dbPath], {
      stdout: collector(),
    });
    const link = collector();
    await run(
      ["trail", "link", "demo", note, recipe, "--label", "relacionado", "--db", dbPath],
      { stdout: link }
    );
    assert.match(link.text, /Enlace creado/);

    const show = collector();
    await run(["trail", "show", "demo", "--json", "--db", dbPath], { stdout: show });
    const graph = JSON.parse(show.text);
    assert.equal(graph.trail, "demo");
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.links.length, 1);

    const dot = collector();
    await run(["trail", "show", "demo", "--format", "dot", "--db", dbPath], { stdout: dot });
    assert.match(dot.text, /^digraph/);

    const list = collector();
    await run(["trails", "--json", "--db", dbPath], { stdout: list });
    assert.equal(JSON.parse(list.text)[0].name, "demo");

    const suggest = collector();
    await run(["trail", "suggest", "demo", "--json", "--db", dbPath], { stdout: suggest });
    assert.ok(Array.isArray(JSON.parse(suggest.text).suggestions));

    const rm = collector();
    await run(["trail", "rm", "demo", "--db", dbPath], { stdout: rm });
    assert.match(rm.text, /eliminado/);
  } finally {
    restore();
    rmSync(root, { recursive: true, force: true });
  }
});

test("run() relaciona documentos y calcula embeddings pendientes", async () => {
  const root = makeCorpus();
  const restore = isolateConfig(root);
  try {
    const dbPath = join(root, ".memex", "index.db");
    const embed = collector();
    await run(["embed", root, "--db", dbPath, "--json"], { stdout: embed });
    const embedded = JSON.parse(embed.text);
    assert.equal(embedded.provider, "hash");
    assert.ok(embedded.embedded >= 2, "debe vectorizar los fragmentos pendientes");

    const relate = collector();
    await run(["relate", join(root, "diario.md"), "--db", dbPath, "--json"], {
      stdout: relate,
    });
    const results = JSON.parse(relate.text).results;
    assert.ok(Array.isArray(results) && results.length >= 1);

    const doctor = collector();
    await run(["doctor", "--json"], { stdout: doctor });
    const status = JSON.parse(doctor.text);
    assert.ok(Array.isArray(status.tools) && status.tools.length >= 5);
    assert.equal(typeof status.capabilities.pdf, "boolean");

    const clear = collector();
    await run(["clear", "--db", dbPath], { stdout: clear });
    assert.match(clear.text, /vaciado/);

    const stats = collector();
    await run(["stats", "--db", dbPath, "--json"], { stdout: stats });
    assert.equal(JSON.parse(stats.text).files, 0);
  } finally {
    restore();
    rmSync(root, { recursive: true, force: true });
  }
});

test("run() valida argumentos de trail, relate, config e init", async () => {
  const root = makeCorpus();
  const restore = isolateConfig(root);
  try {
    const out = { stdout: collector() };
    await assert.rejects(() => run(["trail", "volar"], out), /subcomando desconocido/);
    await assert.rejects(() => run(["trail", "add", "x"], out), /al menos una ruta/);
    await assert.rejects(() => run(["trail", "link", "x", "solo-una"], out), /uso: memex trail link/);
    await assert.rejects(() => run(["relate"], out), /uso: memex relate/);
    await assert.rejects(() => run(["config", "set", "rag.provider"], out), /uso: memex config set/);
    await assert.rejects(
      () => run(["init", root, "--dim", "0", "--no-model"], out),
      /--dim invalido/
    );
  } finally {
    restore();
    rmSync(root, { recursive: true, force: true });
  }
});

test("run() informa de la poda al reindexar", async () => {
  const root = makeCorpus();
  try {
    const dbPath = join(root, ".memex", "index.db");
    await run(["index", root, "--db", dbPath, "--no-embed"], { stdout: collector() });

    rmSync(join(root, "receta.txt"));
    const out = collector();
    await run(["index", root, "--db", dbPath, "--no-embed", "--json"], { stdout: out });
    assert.equal(JSON.parse(out.text).pruned, 1);

    const statsOut = collector();
    await run(["stats", "--db", dbPath, "--json"], { stdout: statsOut });
    assert.equal(JSON.parse(statsOut.text).files, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
