import { test } from "node:test";
import assert from "node:assert/strict";

// La extension solo toca `chrome.*` dentro de sus funciones: se puede importar
// el modulo en Node y sustituir la API por un doble.
const lib = await import("../extension/lib.js");

function installChrome({ page = { title: "Titulo", url: "https://ejemplo.test/a", text: "hola" } } = {}) {
  const store = {};
  globalThis.chrome = {
    storage: {
      sync: {
        get: async (key) => ({ [key]: store[key] }),
        set: async (values) => Object.assign(store, values),
      },
    },
    scripting: {
      executeScript: async () => [{ result: page }],
    },
  };
  return store;
}

test("serverUrl usa el valor por defecto y normaliza la barra final", async () => {
  installChrome();
  assert.equal(await lib.serverUrl(), "http://127.0.0.1:4747");

  await lib.setServerUrl("http://127.0.0.1:5000/");
  assert.equal(await lib.serverUrl(), "http://127.0.0.1:5000");
});

test("capturePage devuelve titulo, url y texto de la pestana", async () => {
  installChrome({
    page: { title: "Nota", url: "https://ejemplo.test/nota", text: "cuerpo de la nota" },
  });
  const doc = await lib.capturePage(7);
  assert.deepEqual(doc, {
    title: "Nota",
    url: "https://ejemplo.test/nota",
    text: "cuerpo de la nota",
  });
});

test("saveToMemex envia el documento al servidor configurado", async () => {
  installChrome();
  const calls = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ chunks: 3 }) };
  };
  try {
    const result = await lib.saveToMemex({ url: "https://ejemplo.test", title: "T", text: "x" });
    assert.equal(result.chunks, 3);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:4747/api/save");
    assert.equal(calls[0].options.method, "POST");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.source, "extension", "el origen queda marcado para poder filtrarlo");
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("saveToMemex propaga el error HTTP del servidor", async () => {
  installChrome();
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 413, json: async () => ({}) });
  try {
    await assert.rejects(
      () => lib.saveToMemex({ url: "https://ejemplo.test", title: "T", text: "x" }),
      /HTTP 413/
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});
