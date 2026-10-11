import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  basicClean,
  loadVocab,
  wordpiece,
  tokenizeBert,
  meanPool,
  normalize,
} from "../src/onnx.js";
import { createEmbedder } from "../src/embeddings.js";

function smallVocab() {
  return new Map([
    ["[PAD]", 0],
    ["[UNK]", 100],
    ["[CLS]", 101],
    ["[SEP]", 102],
    ["hola", 200],
    ["mundo", 201],
    ["un", 202],
    ["##known", 203],
  ]);
}

test("basicClean pasa a minusculas, quita acentos y separa puntuacion", () => {
  assert.equal(basicClean("Canción, ¡Hola!"), "cancion , ¡ hola !");
});

test("loadVocab indexa las lineas del vocab.txt", () => {
  const root = mkdtempSync(join(tmpdir(), "memex-vocab-"));
  try {
    const path = join(root, "vocab.txt");
    writeFileSync(path, "[PAD]\n[UNK]\n[CLS]\n[SEP]\nhola\n");
    const vocab = loadVocab(path);
    assert.equal(vocab.get("[CLS]"), 2);
    assert.equal(vocab.get("hola"), 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wordpiece resuelve palabras enteras, subpalabras y desconocidas", () => {
  const vocab = smallVocab();
  assert.deepEqual(wordpiece("hola", vocab), ["hola"]);
  assert.deepEqual(wordpiece("unknown", vocab), ["un", "##known"]);
  assert.equal(wordpiece("zzzz", vocab), null);
});

test("tokenizeBert añade CLS/SEP y rellena con PAD", () => {
  const vocab = smallVocab();
  const { ids, mask, typeIds } = tokenizeBert("hola mundo", vocab, { maxLen: 8 });
  assert.deepEqual(ids, [101, 200, 201, 102, 0, 0, 0, 0]);
  assert.deepEqual(mask, [1, 1, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(typeIds, [0, 0, 0, 0, 0, 0, 0, 0]);
});

test("tokenizeBert usa [UNK] para palabras no descomponibles", () => {
  const vocab = smallVocab();
  const { ids } = tokenizeBert("zzzz", vocab, { maxLen: 4 });
  assert.equal(ids[1], 100);
});

test("meanPool promedia solo los tokens con attention mask", () => {
  const data = new Float32Array([1, 1, 3, 3]);
  const out = meanPool(data, [1, 2, 2], [1, 0]);
  assert.deepEqual(Array.from(out), [1, 1]);
});

test("normalize deja el vector con norma 1", () => {
  const out = normalize(new Float32Array([3, 4]));
  assert.ok(Math.abs(out[0] - 0.6) < 1e-6);
  assert.ok(Math.abs(out[1] - 0.8) < 1e-6);
});

test("createEmbedder cae a hash si falta el modelo ONNX", () => {
  const embed = createEmbedder({ embed_provider: "onnx", embed_dim: 32 });
  assert.equal(embed.provider, "hash");
  assert.equal(embed("texto").length, 32);
});
