// Memex Offline - servidor local (API + GUI web). Solo escucha en localhost.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { openDatabase, stats } from "./db.js";
import { hybridSearch, resolveQueryVec } from "./search.js";
import { createEmbedder, isAsyncEmbedder } from "./embeddings.js";
import { loadConfig } from "./config.js";
import { embedIndex, indexFolderAsync, saveDocument } from "./indexer.js";
import { addToTrail, exportTrail, linkInTrail, listTrails, showTrail, relate, toD3 } from "./trails.js";
import { ask } from "./rag.js";
import { toolStatus, configStatus, capabilitySummary } from "./doctor.js";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const VERSION = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")
).version;

const TRAIL_TYPES = {
  dot: "text/vnd.graphviz; charset=utf-8",
  mermaid: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

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
  const embedder = createEmbedder(config); // puede ser asincrono (onnx)
  // El indexado y el guardado son sincronos: si el proveedor es neuronal, se
  // indexa solo texto y los vectores se calculan aparte (POST /api/embed).
  const indexEmbedder = isAsyncEmbedder(embedder) ? null : embedder;
  const host = opts.host ?? config.server.host ?? "127.0.0.1";
  const port = opts.port ?? config.server.port ?? 4747;
  // La API no tiene autenticacion: si se escucha fuera de loopback, cualquiera
  // en la red podria buscar, indexar o guardar documentos en el indice. Se
  // exige un opt-in explicito (--allow-remote) en vez de fallar en silencio.
  if (!isLoopbackHost(host) && !opts.allowRemote) {
    throw new Error(
      `host no local (${host}): el indice quedaria expuesto sin autenticacion. ` +
        `Usa --allow-remote si confias en la red, o deja 127.0.0.1.`
    );
  }
  const db = openDatabase(opts.dbPath);

  const server = createServer(async (req, res) => {
    try {
      await route(req, res, { db, embedder, indexEmbedder, config });
    } catch (err) {
      // Los errores de validacion (400/413) no son fallos internos: no hay que
      // disfrazarlos de 500 ni filtrar una traza en la respuesta.
      const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      sendJson(res, status, { error: err.message });
    }
  });

  server.listen(port, host, () => opts.onListen?.({ host, port }));
  return {
    server,
    db,
    close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })),
  };
}

/**
 * ¿El host es de loopback? Es la unica interfaz en la que la API se expone sin
 * autenticacion, asi que es el valor por defecto y el unico aceptado salvo
 * opt-in explicito.
 * @param {string|undefined} host
 */
export function isLoopbackHost(host) {
  if (typeof host !== "string" || !host) return false;
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" || h === "::1" || h === "0:0:0:0:0:0:0:1" || /^127\.\d{1,3}(\.\d{1,3}){2}$/.test(h)
  );
}

/**
 * Origen CORS permitido: solo localhost (la GUI) y extensiones de navegador.
 * Rechaza cualquier web remota, evitando fugas del indice via fetch cruzado.
 * @param {string|undefined} origin
 */
export function isAllowedOrigin(origin) {
  if (typeof origin !== "string" || !origin) return false;
  if (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://")) {
    return true;
  }
  try {
    const { hostname } = new URL(origin);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

async function route(req, res, ctx) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  res.setHeader("X-Content-Type-Options", "nosniff");

  if (path.startsWith("/api/")) {
    // La API se sirve desde localhost y solo debe ser consumida por la propia
    // GUI (mismo origen) o por la extension del navegador. Nunca reflejamos
    // el CORS de una web cualquiera: si el Origin no esta permitido, se corta
    // aqui para que el indice personal no sea legible desde internet.
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "origen no permitido" }));
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    return handleApi(req, res, url, ctx);
  }

  return serveStatic(res, path);
}

/** Cabeceras de seguridad de la GUI (respuestas HTML/CSS/JS). */
function setGuiHeaders(res) {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  // La GUI no carga nada externo: solo /styles.css, /app.js y el favicon data:.
  // 'unsafe-inline' en style-src es necesario por los atributos style="..."
  // del HTML; no hay ningun script inline (todo va por app.js).
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ")
  );
}

async function handleApi(req, res, url, { db, embedder, indexEmbedder, config }) {
  const path = url.pathname;
  const q = url.searchParams;

  if (req.method === "GET" && path === "/api/health") {
    return sendJson(res, 200, { ok: true, name: "memex", version: VERSION });
  }

  if (req.method === "GET" && path === "/api/stats") {
    return sendJson(res, 200, stats(db));
  }

  if (req.method === "GET" && path === "/api/search") {
    const query = q.get("q") ?? "";
    if (!query.trim()) return sendJson(res, 400, { error: "falta el parametro q" });
    const mode = q.get("mode") ?? "hybrid";
    if (!SEARCH_MODES.has(mode)) {
      return sendJson(res, 400, { error: `modo invalido: ${mode} (usa hybrid, lexical o semantic)` });
    }
    const limit = parseLimit(q.get("limit"), 20);
    const any = q.get("any") === "1" || q.get("any") === "true";
    const started = Date.now();
    const queryVec = await resolveQueryVec(embedder, query);
    const results = hybridSearch(db, query, { mode, limit, any, embedder, queryVec });
    return sendJson(res, 200, { query, mode, took_ms: Date.now() - started, results });
  }

  if (req.method === "GET" && path === "/api/relate") {
    const ref = q.get("ref") ?? "";
    if (!ref.trim()) return sendJson(res, 400, { error: "falta el parametro ref" });
    const results = await relate(db, ref, { limit: parseLimit(q.get("limit"), 10), embedder });
    return sendJson(res, 200, { ref, results });
  }

  if (req.method === "GET" && path === "/api/trails") {
    return sendJson(res, 200, { trails: listTrails(db) });
  }

  if (req.method === "GET" && path.startsWith("/api/trails/")) {
    const name = decodeURIComponent(path.slice("/api/trails/".length));
    const graph = showTrail(db, name);
    if (!graph) return sendJson(res, 404, { error: "trail no encontrado" });
    const format = q.get("format");
    if (format && format !== "json") {
      let text;
      try {
        text = exportTrail(graph, format);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
      res.writeHead(200, { "content-type": TRAIL_TYPES[format] ?? "text/plain; charset=utf-8" });
      res.end(text);
      return;
    }
    return sendJson(res, 200, toD3(graph));
  }

  if (req.method === "POST" && path.startsWith("/api/trails/")) {
    const name = decodeURIComponent(path.slice("/api/trails/".length));
    const body = await readJson(req);
    if (body.from && body.to) {
      const result = await linkInTrail(db, { trail: name, from: body.from, to: body.to, label: body.label, embedder });
      return sendJson(res, 200, result);
    }
    const result = await addToTrail(db, { trail: name, ref: body.ref, note: body.note, embedder });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && path === "/api/save") {
    const body = await readJson(req);
    if (typeof body.title !== "string" || typeof body.text !== "string" || (!body.title && !body.text)) {
      return sendJson(res, 400, { error: "faltan title/text (deben ser cadenas)" });
    }
    const saved = saveDocument(db, { ...body, embedder: indexEmbedder });
    // Con ONNX el guardado es sincrono (solo texto): calculamos aqui los
    // vectores pendientes para que la pagina sea visible en busqueda semantica
    // sin tener que reiniciar ni ejecutar `memex embed` a mano.
    const vectors = isAsyncEmbedder(embedder) ? await embedIndex(db, { embedder }) : null;
    return sendJson(res, 200, { ...saved, embedded: vectors ? vectors.embedded : null });
  }

  if (req.method === "POST" && path === "/api/ask") {
    const body = await readJson(req);
    if (typeof body.question !== "string" || !body.question.trim()) {
      return sendJson(res, 400, { error: "falta question" });
    }
    const limit = body.limit === undefined ? 6 : parseLimit(body.limit, 6);
    const result = await ask(db, body.question, { config, embedder, limit });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && path === "/api/index") {
    const body = await readJson(req);
    if (typeof body.path !== "string" || !body.path.trim()) {
      return sendJson(res, 400, { error: "falta path" });
    }
    const root = assertDirectory(body.path);
    const summary = await indexFolderAsync(db, root, { embedder: indexEmbedder });
    const vectors = isAsyncEmbedder(embedder) ? await embedIndex(db, { embedder }) : null;
    return sendJson(res, 200, { ...summary, embedded: vectors ? vectors.embedded : null });
  }

  if (req.method === "POST" && path === "/api/embed") {
    const body = await readJson(req);
    if (typeof body.path !== "string" || !body.path.trim()) {
      return sendJson(res, 400, { error: "falta path" });
    }
    const root = assertDirectory(body.path);
    const index = await indexFolderAsync(db, root, { embedder: indexEmbedder, force: Boolean(body.force) });
    const result = await embedIndex(db, { embedder, force: Boolean(body.force) });
    return sendJson(res, 200, { ...result, text: index });
  }

  if (req.method === "GET" && path === "/api/tools") {
    const tools = toolStatus();
    return sendJson(res, 200, { tools, capabilities: capabilitySummary(tools), config: configStatus(config) });
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

const SEARCH_MODES = new Set(["hybrid", "lexical", "semantic"]);
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_LIMIT = 100;

/** Error con codigo HTTP para que el catch de `route` no lo convierta en 500. */
class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Valida un limite numerico. Un `limit=abc` antes llegaba a SQLite como NaN y
 * provocaba un 500 "datatype mismatch"; ahora es un 400 claro.
 */
function parseLimit(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new HttpError(400, `limit invalido: ${raw} (debe ser un entero >= 1)`);
  }
  return Math.min(value, MAX_LIMIT);
}

function sendJson(res, status, data) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    // Respuestas del indice: nunca cachear en proxies ni en el navegador.
    "cache-control": "no-store",
  });
  res.end(body);
}

/**
 * Valida que una ruta de indexado exista y sea una carpeta.
 * @param {unknown} value
 * @returns {string} ruta absoluta
 * @throws {HttpError} 400 si no existe o no es una carpeta
 */
function assertDirectory(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "falta path");
  }
  const path = resolve(value);
  let info;
  try {
    info = statSync(path);
  } catch {
    throw new HttpError(400, `no existe la carpeta: ${path}`);
  }
  if (!info.isDirectory()) throw new HttpError(400, `no es una carpeta: ${path}`);
  return path;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      data += chunk;
      if (Buffer.byteLength(data, "utf8") > MAX_BODY_BYTES) {
        tooLarge = true;
        data = "";
      }
    });
    req.on("end", () => {
      if (tooLarge) return reject(new HttpError(413, "payload demasiado grande"));
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new HttpError(400, "JSON invalido"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Resuelve una ruta de la GUI dentro de `web/`, confinada a ese directorio.
 * Se compara con `path.relative` (no con un prefijo de cadena) para que un
 * directorio hermano tipo `web-backup` no pueda colarse.
 * @returns {string|null} ruta absoluta dentro de web/ o null si se sale.
 */
export function resolveStaticPath(path) {
  const rel = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  const file = normalize(join(WEB_DIR, rel));
  const inside = relative(WEB_DIR, file);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) return null;
  return file;
}

function serveStatic(res, path) {
  const file = resolveStaticPath(path);
  if (!file || !existsSync(file)) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("No encontrado");
    return;
  }
  setGuiHeaders(res);
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}
