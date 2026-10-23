// Memex Offline - onboarding en un comando (`memex init`).
//
// Deja el proyecto listo para usar, todo en local:
//   1. Descarga (si hace falta) un modelo ONNX pequeno + su vocab a ~/.memex.
//   2. Escribe la configuracion.
//   3. Indexa la carpeta y calcula los embeddings.
// Si no hay red o falla la descarga, avisa y sigue con el proveedor "hash",
// de modo que el comando nunca deja el proyecto roto.
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { configPath, loadConfig, saveConfig } from "./config.js";
import { embeddedChunkCount, openDatabase } from "./db.js";
import { createEmbedder, isAsyncEmbedder } from "./embeddings.js";
import { embedIndex, indexFolder } from "./indexer.js";
import { detectHardware } from "./hardware.js";
import { DEFAULT_EMBED_MODEL, selectModel } from "./modelcatalog.js";

// Compatibilidad: el modelo por defecto sigue siendo el MiniLM ingles. El
// instalador de la UI puede pasar una entrada del catalogo (p. ej. multilingue)
// y `runInit` la respeta.
export const DEFAULT_MODEL = {
  name: DEFAULT_EMBED_MODEL.id,
  id: DEFAULT_EMBED_MODEL.id,
  dim: DEFAULT_EMBED_MODEL.dim,
  sizeMb: DEFAULT_EMBED_MODEL.sizeMb,
  urls: {
    vocab: DEFAULT_EMBED_MODEL.urls.tokenizer,
    tokenizer: DEFAULT_EMBED_MODEL.urls.tokenizer,
    model: DEFAULT_EMBED_MODEL.urls.model,
  },
  files: DEFAULT_EMBED_MODEL.files,
  cased: DEFAULT_EMBED_MODEL.cased,
};

/** Carpeta local donde se guardan los modelos (configurable con MEMEX_MODELS_DIR). */
export function modelsDir() {
  return process.env.MEMEX_MODELS_DIR || join(homedir(), ".memex", "models");
}

/**
 * Descarga un archivo a disco.
 * @param {string} url
 * @param {string} dest
 * @param {{fetchImpl?:Function}} [opts]
 * @returns {Promise<number>} bytes escritos
 */
export async function downloadFile(url, dest, opts = {}) {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const res = await doFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return buf.length;
}

/**
 * Prepara el modelo ONNX: usa uno local o descarga el elegido.
 * @param {{model?:string, tokenizer?:string, download?:boolean, fetchImpl?:Function,
 *          entry?:object}} [opts]
 * @returns {Promise<{model:string, tokenizer:string, entry:object}>}
 */
export async function setupModel(opts = {}) {
  if (opts.model) {
    const model = resolve(opts.model);
    if (!existsSync(model)) throw new Error(`no existe el modelo: ${model}`);
    const tokenizer = opts.tokenizer ? resolve(opts.tokenizer) : join(dirname(model), "vocab.txt");
    return { model, tokenizer, entry: opts.entry ?? null };
  }

  const entry = opts.entry ?? DEFAULT_EMBED_MODEL;
  const dir = join(modelsDir(), entry.id ?? DEFAULT_MODEL.name);
  const modelFile = entry.files?.model ?? "model_quantized.onnx";
  const tokenizerFile = entry.files?.tokenizer ?? entry.files?.vocab ?? "vocab.txt";
  const modelPath = join(dir, modelFile);
  const vocabPath = join(dir, tokenizerFile);
  const modelUrl = entry.urls?.model ?? DEFAULT_MODEL.urls.model;
  const vocabUrl = entry.urls?.tokenizer ?? entry.urls?.vocab ?? DEFAULT_MODEL.urls.vocab;

  let downloaded = 0;
  let skipped = 0;
  if (opts.download !== false) {
    // Reutiliza lo ya descargado: repetir `memex init` no debe volver a bajar
    // 23 MB (o 180 MB con el modelo multilingue) cada vez.
    const cached = (file) => {
      try {
        return statSync(file).size > 0;
      } catch {
        return false;
      }
    };
    for (const [url, dest] of [
      [vocabUrl, vocabPath],
      [modelUrl, modelPath],
    ]) {
      if (!opts.force && cached(dest)) {
        skipped += 1;
        continue;
      }
      await downloadFile(url, dest, opts);
      downloaded += 1;
    }
  }
  return { model: modelPath, tokenizer: vocabPath, entry, downloaded, skipped };
}

/**
 * Ejecuta el onboarding completo.
 * @param {{out:NodeJS.WritableStream, color:object, flags:object, dbPath:string,
 *          modelEntry?:object}} opts
 */
export async function runInit({ out, color, flags, dbPath, modelEntry }) {
  const root = flags._[1] ? resolve(flags._[1]) : process.cwd();
  const useHash = Boolean(flags["no-model"]) || Boolean(flags.hash);
  const config = loadConfig();
  const language = flags.lang ?? "en";
  const quality = flags.quality ?? "auto";
  let entry = modelEntry;
  if (!entry) {
    try {
      entry = selectModel(detectHardware(), { language, quality });
    } catch (err) {
      out.write(`${color.yellow("!")} ${err.message}; uso el modelo por defecto.\n`);
      entry = DEFAULT_EMBED_MODEL;
    }
  }

  const requestedDim = flags.dim === undefined ? null : Number(flags.dim);
  if (requestedDim !== null && (!Number.isInteger(requestedDim) || requestedDim < 8)) {
    throw new Error(`--dim invalido: ${flags.dim} (debe ser un entero >= 8)`);
  }

  let provider = "hash";
  if (!useHash) {
    try {
      const info = await setupModel({
        model: flags.model,
        tokenizer: flags.tokenizer,
        entry,
        download: !flags.model,
        // `--force` reindexa; no debe volver a bajar el modelo por sorpresa.
        force: Boolean(flags["force-download"]),
      });
      config.embed_provider = "onnx";
      config.embed_dim = requestedDim ?? entry.dim;
      config.embed_model = info.model;
      config.embed_tokenizer = info.tokenizer || "";
      config.embed_cased = Boolean(entry.cased);
      provider = "onnx";
      const reuse = info.skipped ? ` ${color.dim(`(${info.skipped} archivo(s) ya estaban en disco)`)}` : "";
      out.write(`${color.green("✓")} Modelo ONNX listo ${color.dim(info.model)}${reuse}\n`);
    } catch (err) {
      config.embed_provider = "hash";
      // Un hash de 384 dimensiones seguiria funcionando, pero rompe la
      // expectativa del proveedor por defecto y gasta memoria: se vuelve a 256.
      config.embed_dim = 256;
      config.embed_model = "";
      config.embed_tokenizer = "";
      config.embed_cased = false;
      out.write(
        `${color.yellow("!")} No se pudo preparar el modelo ONNX (${err.message}); uso embeddings hash.\n`
      );
    }
  } else {
    config.embed_provider = "hash";
    config.embed_dim = 256;
    config.embed_model = "";
    config.embed_tokenizer = "";
    config.embed_cased = false;
  }

  saveConfig(config);
  out.write(`${color.dim(`config: ${configPath()}`)}\n`);

  const embedder = createEmbedder(config);
  const db = openDatabase(dbPath);
  try {
    out.write(`${color.dim(`indexando ${root} …`)}\n`);
    const text = indexFolder(db, root, {
      force: Boolean(flags.force),
      embedder: isAsyncEmbedder(embedder) ? null : embedder,
    });
    const vectors = await embedIndex(db, { embedder, force: Boolean(flags.force) });
    // `text.added` cuenta archivos, no fragmentos: el resumen debe salir del
    // indice real, no de sumar peras y manzanas.
    const embedded = embeddedChunkCount(db);

    out.write(`${color.green("✓")} Listo\n`);
    out.write(`  carpeta      : ${color.dim(root)}\n`);
    out.write(`  archivos     : ${text.added + text.updated} indexados (${text.unchanged} sin cambios)\n`);
    out.write(`  fragmentos   : ${embedded} con vector\n`);
    out.write(`  proveedor    : ${provider}${provider === "onnx" ? ` (dim ${config.embed_dim})` : ""}\n`);
    out.write(`  indice       : ${color.dim(dbPath)}\n`);
    out.write(`\n${color.bold("Siguiente:")} ${color.cyan('memex search "algo"')} o ${color.cyan("memex serve")}\n`);
    return { root, provider, text, vectors, entry, config_path: configPath() };
  } finally {
    db.close();
  }
}
