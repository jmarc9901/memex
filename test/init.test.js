import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { downloadFile, setupModel, runInit } from "../src/init.js";
import { loadConfig } from "../src/config.js";
import { openDatabase, stats } from "../src/db.js";

const color = {
  bold: (t) => t,
  dim: (t) => t,
  green: (t) => t,
  cyan: (t) => t,
  yellow: (t) => t,
  red: (t) => t,
};

function collector() {
  let text = "";
  return {
    isTTY: false,
    write(chunk) {
      text += chunk;
    },
    get text() {
      return text;
    },
  };
}

/** fetch falso que devuelve bytes fijos. */
const fakeFetch = (payload) => async () => ({
  ok: true,
  arrayBuffer: async () => new TextEncoder().encode(payload).buffer,
});

test("downloadFile escribe el contenido descargado", async () => {
  const root = mkdtempSync(join(tmpdir(), "memex-dl-"));
  try {
    const dest = join(root, "sub", "file.bin");
    const bytes = await downloadFile("https://ejemplo/x", dest, { fetchImpl: fakeFetch("hola") });
    assert.equal(bytes, 4);
    assert.equal(readFileSync(dest, "utf8"), "hola");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setupModel descarga modelo y vocab en el directorio local", async () => {
  const root = mkdtempSync(join(tmpdir(), "memex-models-"));
  const prev = process.env.MEMEX_MODELS_DIR;
  process.env.MEMEX_MODELS_DIR = root;
  try {
    const info = await setupModel({ download: true, fetchImpl: fakeFetch("x") });
    assert.ok(info.model.startsWith(root));
    assert.ok(existsSync(info.model));
    assert.ok(existsSync(info.tokenizer));
  } finally {
    if (prev === undefined) delete process.env.MEMEX_MODELS_DIR;
    else process.env.MEMEX_MODELS_DIR = prev;
    rmSync(root, { recursive: true, force: true });
  }
});

test("setupModel usa un modelo local existente", async () => {
  const root = mkdtempSync(join(tmpdir(), "memex-local-"));
  try {
    const model = join(root, "m.onnx");
    writeFileSync(model, "fake");
    const info = await setupModel({ model });
    assert.equal(info.model, model);
    assert.equal(info.tokenizer, join(root, "vocab.txt"));
    await assert.rejects(() => setupModel({ model: join(root, "nope.onnx") }), /no existe/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runInit --no-model configura hash e indexa la carpeta", async () => {
  const root = mkdtempSync(join(tmpdir(), "memex-initt-"));
  const prev = process.env.MEMEX_CONFIG;
  process.env.MEMEX_CONFIG = join(root, "config.json");
  try {
    const corpus = join(root, "docs");
    mkdirSync(corpus);
    writeFileSync(join(corpus, "a.md"), "Texto sobre ansiedad y proyecto X.\n");

    const out = collector();
    const dbPath = join(root, "index.db");
    const result = await runInit({
      out,
      color,
      flags: { _: ["init", corpus], "no-model": true },
      dbPath,
    });

    assert.equal(result.provider, "hash");
    assert.match(out.text, /Listo/);
    assert.equal(loadConfig().embed_provider, "hash");

    const db = openDatabase(dbPath);
    try {
      assert.equal(stats(db).files, 1);
      assert.ok(stats(db).embedded >= 1);
    } finally {
      db.close();
    }
  } finally {
    if (prev === undefined) delete process.env.MEMEX_CONFIG;
    else process.env.MEMEX_CONFIG = prev;
    rmSync(root, { recursive: true, force: true });
  }
});
