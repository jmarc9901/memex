// Memex Offline - diagnostico de herramientas externas opcionales y config.
import { hasCommand } from "./tools.js";
import { resolveBaseUrl, probeEndpoint, LOCAL_PROVIDERS } from "./rag.js";

// Herramientas opcionales. `args` solo sirve para comprobar que el binario
// existe: `hasCommand` mira si el proceso pudo lanzarse, no su codigo de salida.
const TOOLS = [
  { name: "pdftotext", purpose: "texto de PDF (poppler)", args: ["-v"] },
  { name: "mutool", purpose: "texto de PDF (mupdf)", args: ["-v"] },
  { name: "tesseract", purpose: "OCR de imagenes", args: ["--version"], env: "MEMEX_OCR_LANG" },
  { name: "ffmpeg", purpose: "extraer audio antes de transcribir", args: ["-version"] },
  {
    name: "whisper-cli",
    purpose: "transcripcion de audio/video (whisper.cpp)",
    args: ["--help"],
    env: "MEMEX_WHISPER_MODEL",
  },
  { name: "whisper", purpose: "transcripcion de audio/video (Python)", args: ["--help"], env: "MEMEX_WHISPER_MODEL" },
];

/**
 * Estado de cada herramienta externa opcional.
 * @returns {Array<{name:string, purpose:string, available:boolean, env:string|null}>}
 */
export function toolStatus() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    purpose: tool.purpose,
    available: hasCommand(tool.name, tool.args),
    env: tool.env ?? null,
  }));
}

/**
 * Resumen de la configuracion efectiva (embeddings, RAG, idiomas).
 * @param {ReturnType<import('./config.js').loadConfig>} config
 */
export function configStatus(config = {}) {
  const rag = config.rag ?? {};
  return {
    embed_provider: config.embed_provider ?? "hash",
    embed_dim: config.embed_dim ?? 256,
    rag_enabled: Boolean(rag.enabled),
    rag_provider: rag.provider ?? null,
    rag_model: rag.model || null,
    rag_base_url: resolveBaseUrl(rag),
    ocr_lang: process.env.MEMEX_OCR_LANG || "eng",
    whisper_model: process.env.MEMEX_WHISPER_MODEL || null,
  };
}

/**
 * Sondea el endpoint RAG configurado y los presets locales (Ollama, llama.cpp,
 * LM Studio) para ver cuales estan levantados y que modelos ofrecen.
 * @param {object} config
 * @param {{fetchImpl?:Function}} [opts]
 * @returns {Promise<Array<{provider:string,url:string,reachable:boolean,models:string[]}>>}
 */
export async function pingRag(config = {}, opts = {}) {
  const rag = config.rag ?? {};
  const targets = [];
  const configured = resolveBaseUrl(rag);
  if (configured) {
    targets.push({ provider: rag.provider ?? "config", url: configured, apiKey: rag.api_key ?? "" });
  }
  for (const [provider, url] of Object.entries(LOCAL_PROVIDERS)) {
    if (!targets.some((t) => t.url === url)) targets.push({ provider, url, apiKey: "" });
  }

  const results = [];
  for (const target of targets) {
    const { reachable, models } = await probeEndpoint(target.url, {
      apiKey: target.apiKey,
      fetchImpl: opts.fetchImpl,
    });
    results.push({ provider: target.provider, url: target.url, reachable, models });
  }
  return results;
}

/** ¿Hay al menos una herramienta de PDF, OCR y transcripcion disponible? */
export function capabilitySummary(tools = toolStatus()) {
  const has = (names) => names.some((n) => tools.find((t) => t.name === n)?.available);
  return {
    pdf: has(["pdftotext", "mutool"]),
    ocr: has(["tesseract"]),
    transcription: has(["whisper-cli", "whisper"]),
  };
}
