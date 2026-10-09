// Memex Offline - configuracion (archivo + variables de entorno).
//
// Precedencia: variables de entorno > archivo de config > valores por defecto.
// El archivo de config se busca, por orden, en:
//   $MEMEX_CONFIG, ./.memex/config.json, ~/.memex/config.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const DEFAULT_CONFIG = {
  embed_provider: "hash", // "hash" (cero deps) | "onnx" (si esta instalado)
  embed_dim: 256,
  rag: {
    enabled: false,
    provider: "openai-compatible", // openai-compatible | groq | openrouter
    base_url: "", // p.ej. http://localhost:8080/v1 (llama.cpp / Ollama)
    api_key: "",
    model: "",
  },
  server: {
    host: "127.0.0.1",
    port: 4747,
  },
};

/** Ruta del archivo de config activo. */
export function configPath() {
  if (process.env.MEMEX_CONFIG) return resolve(process.env.MEMEX_CONFIG);
  const local = resolve(process.cwd(), ".memex", "config.json");
  if (existsSync(local)) return local;
  return join(homedir(), ".memex", "config.json");
}

/**
 * Carga la configuracion fusionando defaults + archivo + entorno.
 * @returns {typeof DEFAULT_CONFIG}
 */
export function loadConfig() {
  const config = structuredClone(DEFAULT_CONFIG);
  const path = configPath();
  if (existsSync(path)) {
    try {
      deepMerge(config, JSON.parse(readFileSync(path, "utf8")));
    } catch {
      /* config invalida: se ignoran sus valores */
    }
  }
  // Overrides por entorno
  if (process.env.MEMEX_EMBED_PROVIDER) config.embed_provider = process.env.MEMEX_EMBED_PROVIDER;
  if (process.env.MEMEX_EMBED_DIM) config.embed_dim = Number(process.env.MEMEX_EMBED_DIM);
  if (process.env.MEMEX_RAG_API_KEY) config.rag.api_key = process.env.MEMEX_RAG_API_KEY;
  if (process.env.MEMEX_RAG_BASE_URL) config.rag.base_url = process.env.MEMEX_RAG_BASE_URL;
  if (process.env.MEMEX_RAG_MODEL) config.rag.model = process.env.MEMEX_RAG_MODEL;
  if (process.env.MEMEX_RAG_PROVIDER) config.rag.provider = process.env.MEMEX_RAG_PROVIDER;
  if (process.env.MEMEX_PORT) config.server.port = Number(process.env.MEMEX_PORT);
  config.rag.enabled = Boolean(config.rag.api_key || config.rag.base_url);
  return config;
}

/** Guarda la configuracion en el archivo activo. */
export function saveConfig(config) {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
  return path;
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = deepMerge(target[key] ?? {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}
