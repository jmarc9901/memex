import { test } from "node:test";
import assert from "node:assert/strict";

import { toolStatus, configStatus, capabilitySummary, pingRag } from "../src/doctor.js";

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
  assert.equal(cfg.rag_base_url, "https://api.groq.com/openai/v1");
  assert.equal(typeof cfg.ocr_lang, "string");
});

test("configStatus resuelve la URL de proveedores locales", () => {
  const cfg = configStatus({ rag: { enabled: true, provider: "ollama" } });
  assert.equal(cfg.rag_base_url, "http://127.0.0.1:11434/v1");
});

test("configStatus tolera configuracion vacia", () => {
  const cfg = configStatus();
  assert.equal(cfg.embed_provider, "hash");
  assert.equal(cfg.rag_enabled, false);
  assert.equal(cfg.rag_model, null);
  assert.equal(cfg.rag_base_url, null);
});

test("pingRag sondea el endpoint configurado y los presets locales", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("11434")) {
      return { ok: true, json: async () => ({ data: [{ id: "llama3.2" }] }) };
    }
    throw new Error("connection refused");
  };
  const results = await pingRag({ rag: { provider: "ollama" } }, { fetchImpl });

  const ollama = results.find((r) => r.provider === "ollama");
  assert.equal(ollama.reachable, true);
  assert.deepEqual(ollama.models, ["llama3.2"]);

  const llamacpp = results.find((r) => r.provider === "llamacpp");
  assert.equal(llamacpp.reachable, false);
  assert.deepEqual(llamacpp.models, []);
  // no duplica el preset ya usado como endpoint configurado
  assert.equal(results.filter((r) => r.url.includes("11434")).length, 1);
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
