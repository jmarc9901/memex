import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../src/db.js";
import { indexFolder } from "../src/indexer.js";
import { createEmbedder } from "../src/embeddings.js";
import { ask, buildPrompt, retrieveContext, resolveBaseUrl } from "../src/rag.js";

function makeDb() {
  const root = mkdtempSync(join(tmpdir(), "memex-rag-"));
  writeFileSync(
    join(root, "diario.md"),
    "Conclusiones del proyecto X en 2024: simplificar y medir. La ansiedad bajo al ordenar."
  );
  const db = openDatabase(join(root, ".memex", "index.db"));
  indexFolder(db, root, { embedder: createEmbedder({}) });
  return { root, db };
}

test("resolveBaseUrl usa el proveedor o el base_url explicito", () => {
  assert.equal(resolveBaseUrl({ provider: "groq" }), "https://api.groq.com/openai/v1");
  assert.equal(resolveBaseUrl({ provider: "openrouter" }), "https://openrouter.ai/api/v1");
  assert.equal(resolveBaseUrl({ base_url: "http://localhost:8080/v1/" }), "http://localhost:8080/v1");
  assert.equal(resolveBaseUrl({ provider: "desconocido" }), null);
});

test("resolveBaseUrl incluye presets locales sin clave", () => {
  assert.equal(resolveBaseUrl({ provider: "ollama" }), "http://127.0.0.1:11434/v1");
  assert.equal(resolveBaseUrl({ provider: "llamacpp" }), "http://127.0.0.1:8080/v1");
  assert.equal(resolveBaseUrl({ provider: "lmstudio" }), "http://127.0.0.1:1234/v1");
});

test("buildPrompt numera el contexto y pide citas", () => {
  const prompt = buildPrompt("¿conclusiones?", [
    { n: 1, name: "a.md", text: "texto uno" },
    { n: 2, name: "b.md", text: "texto dos" },
  ]);
  assert.match(prompt.user, /Pregunta: ¿conclusiones\?/);
  assert.match(prompt.user, /\[1\] \(a\.md\)/);
  assert.match(prompt.user, /\[2\] \(b\.md\)/);
  assert.match(prompt.system, /\[n\]/);
});

test("retrieveContext devuelve fragmentos numerados sin marcadores", () => {
  const { root, db } = makeDb();
  try {
    const context = retrieveContext(db, "conclusiones proyecto", { limit: 3 });
    assert.ok(context.length >= 1);
    assert.equal(context[0].n, 1);
    assert.doesNotMatch(context[0].text, /\[\[/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ask sin proveedor configurado devuelve las fuentes en modo offline", async () => {
  const { root, db } = makeDb();
  try {
    const result = await ask(db, "conclusiones del proyecto", {
      config: { rag: { enabled: false, provider: "openai-compatible", base_url: "", api_key: "", model: "" } },
      embedder: createEmbedder({}),
      limit: 2,
    });
    assert.equal(result.answer, null);
    assert.equal(result.offline, true);
    assert.ok(result.context.length >= 1);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ask con endpoint local genera respuesta y cita el modelo", async () => {
  const { root, db } = makeDb();
  try {
    let sent;
    const fetchImpl = async (url, options) => {
      sent = { url, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({ model: "modelo-local", choices: [{ message: { content: "  respuesta  " } }] }),
      };
    };
    const result = await ask(db, "conclusiones", {
      config: { rag: { base_url: "http://localhost:8080/v1", api_key: "", model: "m1" } },
      embedder: createEmbedder({}),
      fetchImpl,
    });
    assert.equal(result.answer, "respuesta");
    assert.equal(result.model, "modelo-local");
    assert.equal(result.offline, false);
    assert.equal(sent.url, "http://localhost:8080/v1/chat/completions");
    assert.equal(sent.body.model, "m1");
    assert.equal(sent.body.messages[0].role, "system");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ask reporta errores de HTTP y de red sin lanzar", async () => {
  const { root, db } = makeDb();
  try {
    const httpErr = await ask(db, "x", {
      config: { rag: { base_url: "http://localhost:8080/v1", api_key: "" } },
      embedder: createEmbedder({}),
      fetchImpl: async () => ({ ok: false, status: 429 }),
    });
    assert.equal(httpErr.answer, null);
    assert.equal(httpErr.error, "HTTP 429");

    const netErr = await ask(db, "x", {
      config: { rag: { base_url: "http://localhost:8080/v1", api_key: "" } },
      embedder: createEmbedder({}),
      fetchImpl: async () => {
        throw new Error("sin conexion");
      },
    });
    assert.equal(netErr.error, "sin conexion");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
