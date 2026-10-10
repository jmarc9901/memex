import { test } from "node:test";
import assert from "node:assert/strict";

import { toolStatus, configStatus, capabilitySummary } from "../src/doctor.js";

test("toolStatus lista las herramientas opcionales con su estado", () => {
  const tools = toolStatus();
  assert.ok(Array.isArray(tools) && tools.length >= 5);
  for (const tool of tools) {
    assert.equal(typeof tool.name, "string");
    assert.equal(typeof tool.purpose, "string");
    assert.equal(typeof tool.available, "boolean");
  }
  const names = tools.map((t) => t.name);
  for (const expected of ["pdftotext", "mutool", "tesseract", "whisper"]) {
    assert.ok(names.includes(expected), `falta ${expected}`);
  }
});

test("configStatus resume embeddings, RAG y variables de entorno", () => {
  const cfg = configStatus({
    embed_provider: "hash",
    embed_dim: 128,
    rag: { enabled: true, provider: "groq", model: "m1" },
  });
  assert.equal(cfg.embed_provider, "hash");
  assert.equal(cfg.embed_dim, 128);
  assert.equal(cfg.rag_enabled, true);
  assert.equal(cfg.rag_provider, "groq");
  assert.equal(cfg.rag_model, "m1");
  assert.equal(typeof cfg.ocr_lang, "string");
});

test("configStatus tolera configuracion vacia", () => {
  const cfg = configStatus();
  assert.equal(cfg.embed_provider, "hash");
  assert.equal(cfg.rag_enabled, false);
  assert.equal(cfg.rag_model, null);
});

test("capabilitySummary deriva las capacidades del estado de las herramientas", () => {
  const caps = capabilitySummary([
    { name: "pdftotext", available: true },
    { name: "mutool", available: false },
    { name: "tesseract", available: false },
    { name: "whisper-cli", available: true },
  ]);
  assert.deepEqual(caps, { pdf: true, ocr: false, transcription: true });
});
