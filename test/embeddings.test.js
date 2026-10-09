import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, hashEmbed, cosine, toBlob, fromBlob, createEmbedder } from "../src/embeddings.js";

test("tokenize normaliza y quita acentos", () => {
  assert.deepEqual(tokenize("Cómo me SENTÍA hoy"), ["como", "me", "sentia", "hoy"]);
});

test("hashEmbed es determinista y esta normalizado", () => {
  const a = hashEmbed("busqueda semantica local", { dim: 128 });
  const b = hashEmbed("busqueda semantica local", { dim: 128 });
  assert.equal(a.length, 128);
  assert.deepEqual(Array.from(a), Array.from(b));
  let norm = 0;
  for (const v of a) norm += v * v;
  assert.ok(Math.abs(Math.sqrt(norm) - 1) < 1e-5, "vector debe estar normalizado");
});

test("cosine distingue textos relacionados de no relacionados", () => {
  const q = hashEmbed("proyecto conclusiones 2024");
  const related = hashEmbed("las conclusiones del proyecto de 2024");
  const unrelated = hashEmbed("receta de tarta de manzana con canela");
  assert.ok(cosine(q, related) > cosine(q, unrelated));
});

test("round-trip BLOB", () => {
  const vec = hashEmbed("hola mundo", { dim: 64 });
  const back = fromBlob(toBlob(vec));
  assert.deepEqual(Array.from(back), Array.from(vec));
});

test("createEmbedder respeta el proveedor hash y la dimension", () => {
  const embed = createEmbedder({ embed_provider: "hash", embed_dim: 64 });
  assert.equal(embed.dim, 64);
  assert.equal(embed("texto").length, 64);
  assert.equal(embed.provider, "hash");
});
