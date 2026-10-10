import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs, formatExport, run } from "../src/cli.js";

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

test("run() rechaza comandos y modos invalidos", async () => {
  await assert.rejects(() => run(["volando"], { stdout: collector() }), /comando desconocido/);
  await assert.rejects(
    () => run(["search", "x", "--mode", "ilegal"], { stdout: collector() }),
    /modo invalido/
  );
});
