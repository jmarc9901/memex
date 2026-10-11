// Memex Offline - servidor MCP local (Model Context Protocol sobre stdio).
//
// Expone el indice personal como herramientas que cualquier cliente MCP
// (Claude Desktop, Cursor, Continue, etc.) puede invocar. TODO ocurre en tu
// maquina: el transporte es stdin/stdout del propio proceso, sin red ni
// servidores remotos. Protocolo: JSON-RPC 2.0, un mensaje por linea.
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDatabase, stats } from "./db.js";
import { loadConfig } from "./config.js";
import { createEmbedder } from "./embeddings.js";
import { hybridSearch, resolveQueryVec } from "./search.js";
import { ask } from "./rag.js";
import { indexFolder } from "./indexer.js";
import { listTrails, relate, showTrail } from "./trails.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MCP_PROTOCOL_VERSION = "2024-11-05";

function serverVersion() {
  try {
    return JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Definicion de herramientas MCP (JSON Schema de cada entrada). */
export const TOOLS = [
  {
    name: "memex_search",
    description:
      "Busca en el indice local de Memex (documentos, notas, codigo, PDFs, OCR...). " +
      "Devuelve fragmentos con su ruta y puntuacion.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto a buscar" },
        mode: { type: "string", enum: ["hybrid", "lexical", "semantic"], description: "Modo (def. hybrid)" },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Numero de resultados (def. 10)" },
        any: { type: "boolean", description: "Unir terminos con OR" },
      },
      required: ["query"],
    },
  },
  {
    name: "memex_ask",
    description: "Responde una pregunta usando el contexto local, con citas a tus archivos.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Pregunta en lenguaje natural" },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["question"],
    },
  },
  {
    name: "memex_relate",
    description: "Documentos mas parecidos a una ruta o consulta (por vectores).",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Ruta de archivo o consulta" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["ref"],
    },
  },
  {
    name: "memex_trails",
    description: "Lista los trails (caminos asociativos) existentes.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "memex_trail_show",
    description: "Muestra un trail: nodos y enlaces.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "memex_stats",
    description: "Estadisticas del indice (archivos, fragmentos, vectores, trails).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "memex_index",
    description: "Indexa (o reindexa) una carpeta local de forma incremental.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, force: { type: "boolean" } },
      required: ["path"],
    },
  },
];

const text = (value) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

/**
 * Ejecuta una herramienta y devuelve su resultado en formato MCP.
 * @returns {Promise<{content:Array, isError?:boolean}>}
 */
export async function callTool(ctx, name, args = {}) {
  const { db, embedder, config } = ctx;
  try {
    switch (name) {
      case "memex_search": {
        if (!args.query) throw new Error("falta 'query'");
        const mode = args.mode ?? "hybrid";
        const limit = args.limit ?? 10;
        const queryVec = await resolveQueryVec(embedder, args.query);
        const results = hybridSearch(db, args.query, { mode, limit, any: Boolean(args.any), embedder, queryVec });
        return text({ query: args.query, mode, count: results.length, results });
      }
      case "memex_ask": {
        if (!args.question) throw new Error("falta 'question'");
        const result = await ask(db, args.question, { config, embedder, limit: args.limit ?? 6 });
        return text(result);
      }
      case "memex_relate": {
        if (!args.ref) throw new Error("falta 'ref'");
        const results = await relate(db, args.ref, { limit: args.limit ?? 10, embedder });
        return text({ ref: args.ref, results });
      }
      case "memex_trails":
        return text({ trails: listTrails(db) });
      case "memex_trail_show": {
        if (!args.name) throw new Error("falta 'name'");
        const graph = showTrail(db, args.name);
        if (!graph) throw new Error(`no existe el trail: ${args.name}`);
        return text(graph);
      }
      case "memex_stats":
        return text(stats(db));
      case "memex_index": {
        if (!args.path) throw new Error("falta 'path'");
        return text(indexFolder(db, args.path, { force: Boolean(args.force) }));
      }
      default:
        throw new Error(`herramienta desconocida: ${name}`);
    }
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
}

/**
 * Procesa un mensaje JSON-RPC y devuelve la respuesta (o null si es notificacion).
 * @returns {Promise<object|null>}
 */
export async function handleMessage(ctx, msg) {
  const { id, method, params } = msg ?? {};
  const isNotification = id === undefined || id === null;

  try {
    let result;
    switch (method) {
      case "initialize":
        result = {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "memex-offline", version: serverVersion() },
        };
        break;
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "tools/call":
        result = await callTool(ctx, params?.name, params?.arguments ?? {});
        break;
      default:
        if (isNotification) return null;
        return errorResponse(id, -32601, `metodo no soportado: ${method}`);
    }
    return isNotification ? null : { jsonrpc: "2.0", id, result };
  } catch (err) {
    return isNotification ? null : errorResponse(id, -32603, err.message);
  }
}

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Arranca el servidor MCP leyendo lineas JSON-RPC de stdin y respondiendo por
 * stdout. No escribe nada mas en stdout (los avisos van a stderr).
 * @param {{dbPath:string, stdin?:NodeJS.ReadableStream, stdout?:NodeJS.WritableStream}} opts
 * @returns {Promise<void>} se resuelve cuando stdin se cierra
 */
export function runMcp(opts) {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const config = loadConfig();
  const embedder = createEmbedder(config);
  const db = openDatabase(opts.dbPath);
  const ctx = { db, embedder, config };

  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, crlfDelay: Infinity });
    let chain = Promise.resolve();

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      chain = chain.then(async () => {
        let msg;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          stdout.write(JSON.stringify(errorResponse(null, -32700, "JSON invalido")) + "\n");
          return;
        }
        const response = await handleMessage(ctx, msg);
        if (response) stdout.write(JSON.stringify(response) + "\n");
      });
    });

    rl.on("close", () => {
      chain.finally(() => {
        db.close();
        resolve();
      });
    });
  });
}
