import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMBED_MODELS,
  DEFAULT_EMBED_MODEL,
  normalizeLanguage,
  supportsLanguage,
  modelsForLanguage,
  selectModel,
} from "../src/modelcatalog.js";

test("el catalogo tiene un modelo pequeno por defecto y uno multilingue", () => {
  assert.equal(DEFAULT_EMBED_MODEL.id, "all-MiniLM-L6-v2");
  assert.ok(DEFAULT_EMBED_MODEL.sizeMb < 50);
  const multi = EMBED_MODELS.find((model) => model.id === "bert-base-multilingual-cased");
  assert.ok(multi);
  assert.equal(multi.dim, 768);
  assert.ok(multi.sizeMb > DEFAULT_EMBED_MODEL.sizeMb);
  for (const model of EMBED_MODELS) {
    assert.ok(model.urls.model.startsWith("https://"));
    assert.ok(model.urls.tokenizer.endsWith("vocab.txt"));
    assert.ok(Number.isInteger(model.minRamGb));
  }
});

test("normalizeLanguage reconoce espanol, ingles y multilingue", () => {
  assert.equal(normalizeLanguage("es"), "es");
  assert.equal(normalizeLanguage("es-ES"), "es");
  assert.equal(normalizeLanguage("Spanish"), "es");
  assert.equal(normalizeLanguage("en-GB"), "en");
  assert.equal(normalizeLanguage("multi"), "multi");
  assert.equal(normalizeLanguage(undefined), "en");
  assert.equal(normalizeLanguage("fr"), "fr");
});

test("supportsLanguage y modelsForLanguage filtran por idioma", () => {
  const mini = EMBED_MODELS.find((model) => model.id === "all-MiniLM-L6-v2");
  const multi = EMBED_MODELS.find((model) => model.id === "bert-base-multilingual-cased");
  assert.equal(supportsLanguage(mini, "en"), true);
  assert.equal(supportsLanguage(mini, "es"), false);
  assert.equal(supportsLanguage(multi, "es"), true);
  assert.equal(supportsLanguage(multi, "en"), true);
  assert.deepEqual(modelsForLanguage("es").map((model) => model.id), [multi.id]);
  assert.deepEqual(modelsForLanguage("en").map((model) => model.id), [mini.id, multi.id]);
});

test("selectModel prioriza velocidad y respeta el idioma", () => {
  const speed = selectModel({ memoryGb: 32, cores: 16 }, { language: "en", quality: "speed" });
  assert.equal(speed.id, "all-MiniLM-L6-v2");

  const spanish = selectModel({ memoryGb: 16, cores: 8 }, { language: "es", quality: "auto" });
  assert.equal(spanish.id, "bert-base-multilingual-cased");
});

test("selectModel con best elige el modelo de mayor calidad que quepa", () => {
  const best = selectModel({ memoryGb: 16, cores: 8 }, { language: "en", quality: "best" });
  assert.equal(best.id, "bert-base-multilingual-cased");

  const lowRam = selectModel({ memoryGb: 4, cores: 2 }, { language: "en", quality: "best" });
  assert.equal(lowRam.id, "all-MiniLM-L6-v2", "con 4 GB no debe recomendar el modelo de 180 MB");
});

test("selectModel rechaza una calidad desconocida", () => {
  assert.throws(
    () => selectModel({ memoryGb: 16 }, { language: "en", quality: "ultra" }),
    /quality invalida/
  );
});
