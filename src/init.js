// Memex Offline - onboarding en un comando (`memex init`).
//
// Deja el proyecto listo para usar, todo en local:
//   1. Descarga (si hace falta) un modelo ONNX pequeno + su vocab a ~/.memex.
//   2. Escribe la configuracion.
//   3. Indexa la carpeta y calcula los embeddings.
// Si no hay red o falla la descarga, avisa y sigue con el proveedor "hash",
// de modo que el comando nunca deja el proyecto roto.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { configPath, loadConfig, saveConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { createEmbedder, isAsyncEmbedder } from "./embeddings.js";
import { embedIndex, indexFolder } from "./indexer.js";

export const DEFAULT_MODEL = {
  name: "all-MiniLM-L6-v2",
  dim: 384,
  urls: {
    vocab: "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/vocab.txt",
    model: "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx",
  },
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
 * Prepara el modelo ONNX: usa uno local o descarga el por defecto.
 * @param {{model?:string, tokenizer?:string, download?:boolean, fetchImpl?:Function}} [opts]
 * @returns {Promise<{model:string, tokenizer:string}>}
 */
export async function setupModel(opts = {}) {
  if (opts.model) {
    const model = resolve(opts.model);
    if (!existsSync(model)) throw new Error(`no existe el modelo: ${model}`);
    const tokenizer = opts.tokenizer ? resolve(opts.tokenizer) : join(dirname(model), "vocab.txt");
    return { model, tokenizer };
  }
  const dir = join(modelsDir(), DEFAULT_MODEL.name);
  const modelPath = join(dir, "model_quantized.onnx");
  const vocabPath = join(dir, "vocab.txt");
  if (opts.download !== false) {
    await downloadFile(DEFAULT_MODEL.urls.vocab, vocabPath, opts);
    await downloadFile(DEFAULT_MODEL.urls.model, modelPath, opts);
  }
  return { model: modelPath, tokenizer: vocabPath };
}

/**
 * Ejecuta el onboarding completo.
 * @param {{out:NodeJS.WritableStream, color:object, flags:object, dbPath:string}} opts
 */
export async function runInit({ out, color, flags, dbPath }) {
  const root = flags._[1] ? resolve(flags._[1]) : process.cwd();
  const useHash = Boolean(flags["no-model"]) || Boolean(flags.hash);
  const config = loadConfig();

  let provider = "hash";
  if (!useHash) {
    try {
      const info = await setupModel({
        model: flags.model,
        tokenizer: flags.tokenizer,
        download: !flags.model,
      });
      config.embed_provider = "onnx";
      config.embed_dim = flags.dim ? Number(flags.dim) : DEFAULT_MODEL.dim;
      config.embed_model = info.model;
      config.embed_tokenizer = info.tokenizer || "";
      provider = "onnx";
      out.write(`${color.green("✓")} Modelo ONNX listo ${color.dim(info.model)}\n`);
    } catch (err) {
      config.embed_provider = "hash";
      config.embed_model = "";
      config.embed_tokenizer = "";
      out.write(
        `${color.yellow("!")} No se pudo preparar el modelo ONNX (${err.message}); uso embeddings hash.\n`
      );
    }
  } else {
    config.embed_provider = "hash";
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

    out.write(`${color.green("✓")} Listo\n`);
    out.write(`  carpeta      : ${color.dim(root)}\n`);
    out.write(`  archivos     : ${text.added + text.updated} indexados (${text.unchanged} sin cambios)\n`);
    out.write(`  fragmentos   : ${vectors.embedded + (isAsyncEmbedder(embedder) ? 0 : text.added + text.updated)} con vector\n`);
    out.write(`  proveedor    : ${provider}${provider === "onnx" ? ` (dim ${config.embed_dim})` : ""}\n`);
    out.write(`  indice       : ${color.dim(dbPath)}\n`);
    out.write(`\n${color.bold("Siguiente:")} ${color.cyan('memex search "algo"')} o ${color.cyan("memex serve")}\n`);
    return { root, provider, text, vectors, config_path: configPath() };
  } finally {
    db.close();
  }
}
