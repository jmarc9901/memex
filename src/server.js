// Memex Offline - servidor local (API + GUI web). Solo escucha en localhost.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";
import { openDatabase, stats } from "./db.js";
import { hybridSearch } from "./search.js";
import { createEmbedder } from "./embeddings.js";
import { loadConfig } from "./config.js";
import { indexFolder, saveDocument } from "./indexer.js";
import { addToTrail, linkInTrail, listTrails, showTrail, relate, toD3 } from "./trails.js";
import { ask } from "./rag.js";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "web");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/**
 * Arranca el servidor local.
 * @param {{dbPath:string, host?:string, port?:number, onListen?:Function}} opts
 */
export function startServer(opts) {
  const config = loadConfig();
  const embedder = createEmbedder(config);
  const host = opts.host ?? config.server.host ?? "127.0.0.1";
  const port = opts.port ?? config.server.port ?? 4747;
  const db = openDatabase(opts.dbPath);

  const server = createServer(async (req, res) => {
    try {
      await route(req, res, { db, embedder, config });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });

  server.listen(port, host, () => opts.onListen?.({ host, port }));
  return {
    server,
    db,
    close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })),
  };
}

async function route(req, res, ctx) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (path.startsWith("/api/")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    return handleApi(req, res, url, ctx);
  }

  return serveStatic(res, path);
}

async function handleApi(req, res, url, { db, embedder, config }) {
  const path = url.pathname;
  const q = url.searchParams;

  if (req.method === "GET" && path === "/api/stats") {
    return sendJson(res, 200, stats(db));
  }

  if (req.method === "GET" && path === "/api/search") {
    const query = q.get("q") ?? "";
    if (!query.trim()) return sendJson(res, 400, { error: "falta el parametro q" });
    const mode = q.get("mode") ?? "hybrid";
    const limit = Number(q.get("limit") ?? 20);
    const any = q.get("any") === "1" || q.get("any") === "true";
    const started = Date.now();
    const results = hybridSearch(db, query, { mode, limit, any, embedder });
    return sendJson(res, 200, { query, mode, took_ms: Date.now() - started, results });
  }

  if (req.method === "GET" && path === "/api/relate") {
    const ref = q.get("ref") ?? "";
    if (!ref.trim()) return sendJson(res, 400, { error: "falta el parametro ref" });
    return sendJson(res, 200, { ref, results: relate(db, ref, { limit: Number(q.get("limit") ?? 10), embedder }) });
  }

  if (req.method === "GET" && path === "/api/trails") {
    return sendJson(res, 200, { trails: listTrails(db) });
  }

  if (req.method === "GET" && path.startsWith("/api/trails/")) {
    const name = decodeURIComponent(path.slice("/api/trails/".length));
    const graph = showTrail(db, name);
    if (!graph) return sendJson(res, 404, { error: "trail no encontrado" });
    return sendJson(res, 200, toD3(graph));
  }

  if (req.method === "POST" && path.startsWith("/api/trails/")) {
    const name = decodeURIComponent(path.slice("/api/trails/".length));
    const body = await readJson(req);
    if (body.from && body.to) {
      return sendJson(res, 200, linkInTrail(db, { trail: name, from: body.from, to: body.to, label: body.label, embedder }));
    }
    return sendJson(res, 200, addToTrail(db, { trail: name, ref: body.ref, note: body.note, embedder }));
  }

  if (req.method === "POST" && path === "/api/save") {
    const body = await readJson(req);
    if (!body.text && !body.title) return sendJson(res, 400, { error: "faltan title/text" });
    const saved = saveDocument(db, { ...body, embedder });
    return sendJson(res, 200, saved);
  }

  if (req.method === "POST" && path === "/api/ask") {
    const body = await readJson(req);
    if (!body.question) return sendJson(res, 400, { error: "falta question" });
    const result = await ask(db, body.question, { config, embedder, limit: body.limit ?? 6 });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && path === "/api/index") {
    const body = await readJson(req);
    if (!body.path) return sendJson(res, 400, { error: "falta path" });
    const summary = indexFolder(db, body.path, { embedder });
    return sendJson(res, 200, summary);
  }

  if (req.method === "GET" && path === "/api/config") {
    return sendJson(res, 200, {
      embed_provider: config.embed_provider,
      embed_dim: config.embed_dim,
      rag_enabled: config.rag.enabled,
      rag_provider: config.rag.provider,
      rag_model: config.rag.model || null,
    });
  }

  return sendJson(res, 404, { error: "endpoint no encontrado" });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 8 * 1024 * 1024) reject(new Error("payload demasiado grande"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("JSON invalido"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(res, path) {
  const rel = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  const file = normalize(join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR) || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("No encontrado");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}
