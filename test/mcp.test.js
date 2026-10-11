import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../src/db.js";
import { indexFolder } from "../src/indexer.js";
import { createEmbedder } from "../src/embeddings.js";
import { loadConfig } from "../src/config.js";
import { handleMessage, TOOLS } from "../src/mcp.js";

function makeCorpus() {
  const root = mkdtempSync(join(tmpdir(), "memex-mcp-"));
  writeFileSync(join(root, "notas.md"), "Hoy hable de la ansiedad y del proyecto X en 2024.\n");
  return root;
}

function makeCtx(root) {
  const db = openDatabase(join(root, ".memex", "index.db"));
  indexFolder(db, root, { embedder: createEmbedder({}) });
  return { db, embedder: createEmbedder({}), config: loadConfig() };
}

test("MCP initialize declara protocolo y servidor", async () => {
  const root = makeCorpus();
  const ctx = makeCtx(root);
  try {
    const res = await handleMessage(ctx, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    assert.equal(res.result.protocolVersion, "2024-11-05");
    assert.equal(res.result.serverInfo.name, "memex-offline");
    assert.ok(res.result.capabilities.tools);
  } finally {
    ctx.db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP tools/list expone las herramientas y las notificaciones no responden", async () => {
  const root = makeCorpus();
  const ctx = makeCtx(root);
  try {
    const res = await handleMessage(ctx, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.equal(res.result.tools.length, TOOLS.length);
    assert.ok(res.result.tools.some((t) => t.name === "memex_search"));

    const notif = await handleMessage(ctx, { jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(notif, null);
  } finally {
    ctx.db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP tools/call busca en el indice y responde errores de herramienta", async () => {
  const root = makeCorpus();
  const ctx = makeCtx(root);
  try {
    const search = await handleMessage(ctx, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "memex_search", arguments: { query: "ansiedad" } },
    });
    const data = JSON.parse(search.result.content[0].text);
    assert.ok(data.count >= 1);
    assert.equal(data.results[0].name, "notas.md");

    const stats = await handleMessage(ctx, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "memex_stats", arguments: {} },
    });
    assert.equal(JSON.parse(stats.result.content[0].text).files, 1);

    const bad = await handleMessage(ctx, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "no_existe", arguments: {} },
    });
    assert.equal(bad.result.isError, true);
  } finally {
    ctx.db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP responde error de metodo desconocido", async () => {
  const root = makeCorpus();
  const ctx = makeCtx(root);
  try {
    const res = await handleMessage(ctx, { jsonrpc: "2.0", id: 9, method: "resources/list" });
    assert.equal(res.error.code, -32601);
  } finally {
    ctx.db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcp responde por stdio de extremo a extremo", async () => {
  const root = makeCorpus();
  const dbPath = join(root, ".memex", "index.db");
  const db = openDatabase(dbPath);
  indexFolder(db, root, { embedder: createEmbedder({}) });
  db.close();

  const child = spawn(process.execPath, ["bin/memex.js", "mcp", "--db", dbPath], {
    env: { ...process.env, MEMEX_CONFIG: join(root, "no-config.json") },
    stdio: ["pipe", "pipe", "ignore"],
  });

  const responses = [];
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (line.trim()) responses.push(JSON.parse(line));
    }
  });

  const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "memex_search", arguments: { query: "ansiedad" } },
  });

  try {
    const deadline = Date.now() + 15000;
    while (responses.length < 3 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(responses.length, 3, "recibidas 3 respuestas");
    assert.equal(responses[0].result.serverInfo.name, "memex-offline");
    assert.ok(responses[1].result.tools.length >= 5);
    assert.ok(JSON.parse(responses[2].result.content[0].text).count >= 1);
  } finally {
    child.stdin.end();
    await once(child, "close");
    rmSync(root, { recursive: true, force: true });
  }
});
