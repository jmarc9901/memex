// Memex Offline - embeddings neuronales opcionales (ONNX), 100% locales.
//
// Este modulo aporta la "semantica real" que la Ruta 1 del roadmap dejaba
// pendiente: en lugar de feature hashing (lexico), usa un modelo BERT pequeno
// (p. ej. all-MiniLM-L6-v2, ~90 MB) ejecutado con onnxruntime-node. Es
// COMPLETAMENTE OPCIONAL: si el paquete o el modelo no estan, `createEmbedder`
// avisa y cae al proveedor "hash". No hay dependencias obligatorias ni red.
//
// Flujo: texto -> tokenizer WordPiece (vocab.txt) -> input_ids/attention_mask
// -> sesion ONNX -> last_hidden_state -> mean pooling -> normalizacion L2.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

const require = createRequire(import.meta.url);

let ort = null;
let ortChecked = false;

/** Devuelve onnxruntime-node si esta instalado, o null (cacheado). */
export function loadOrt() {
  if (!ortChecked) {
    ortChecked = true;
    try {
      ort = require("onnxruntime-node");
    } catch {
      ort = null;
    }
  }
  return ort;
}

/** ¿Esta onnxruntime-node disponible en el entorno? */
export function onnxAvailable() {
  return Boolean(loadOrt());
}

const ACCENTS = /[\u0300-\u036f]/g;

/**
 * Normaliza el texto como BERT uncased: minusculas, sin acentos, separando la
 * puntuacion como tokens propios.
 * @param {string} text
 */
export function basicClean(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(ACCENTS, "")
    .replace(/[^a-z0-9\s]/g, " $& ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Carga un vocab.txt (una pieza por linea; el indice es la linea).
 * @param {string} path
 * @returns {Map<string, number>}
 */
export function loadVocab(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const vocab = new Map();
  lines.forEach((token, id) => {
    if (token !== "") vocab.set(token, id);
  });
  return vocab;
}

/**
 * Tokeniza una palabra con WordPiece (greedy longest-match, prefijo `##`).
 * Devuelve null si la palabra no puede descomponerse (-> [UNK]).
 * @param {string} token
 * @param {Map<string, number>} vocab
 * @param {number} [maxChars]
 * @returns {string[]|null}
 */
export function wordpiece(token, vocab, maxChars = 100) {
  if (token.length > maxChars) return null;
  if (vocab.has(token)) return [token];

  const pieces = [];
  let start = 0;
  while (start < token.length) {
    let end = token.length;
    let found = null;
    while (start < end) {
      let sub = token.slice(start, end);
      if (start > 0) sub = "##" + sub;
      if (vocab.has(sub)) {
        found = sub;
        break;
      }
      end -= 1;
    }
    if (found === null) return null;
    pieces.push(found);
    start = end;
  }
  return pieces;
}

/**
 * Convierte texto en tensores de entrada estilo BERT.
 * @param {string} text
 * @param {Map<string, number>} vocab
 * @param {{maxLen?:number}} [opts]
 * @returns {{ids:number[], mask:number[], typeIds:number[]}}
 */
export function tokenizeBert(text, vocab, opts = {}) {
  const maxLen = opts.maxLen ?? 256;
  const cls = vocab.get("[CLS]") ?? 101;
  const sep = vocab.get("[SEP]") ?? 102;
  const unk = vocab.get("[UNK]") ?? 100;
  const pad = vocab.get("[PAD]") ?? 0;

  const ids = [cls];
  for (const token of basicClean(text).split(" ")) {
    if (!token) continue;
    const pieces = wordpiece(token, vocab);
    if (!pieces) {
      ids.push(unk);
    } else {
      for (const piece of pieces) ids.push(vocab.get(piece) ?? unk);
    }
    if (ids.length >= maxLen - 1) break;
  }
  ids.push(sep);

  const mask = ids.map(() => 1);
  while (ids.length < maxLen) {
    ids.push(pad);
    mask.push(0);
  }
  return { ids, mask, typeIds: ids.map(() => 0) };
}

/**
 * Mean pooling sobre `last_hidden_state` respetando la attention mask.
 * @param {Float32Array|number[]} data  datos planos [1, seq, dim]
 * @param {number[]} dims
 * @param {number[]} mask
 * @returns {Float32Array}
 */
export function meanPool(data, dims, mask) {
  const seq = dims[dims.length - 2];
  const dim = dims[dims.length - 1];
  const out = new Float32Array(dim);
  let count = 0;
  for (let i = 0; i < seq; i++) {
    if (!mask[i]) continue;
    count += 1;
    const base = i * dim;
    for (let j = 0; j < dim; j++) out[j] += data[base + j];
  }
  if (count > 0) for (let j = 0; j < dim; j++) out[j] /= count;
  return out;
}

/** Normaliza un vector L2 (in-place) y lo devuelve. */
export function normalize(vec) {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

/** Resuelve la ruta del vocab: `tokenizer` explicito o `vocab.txt` junto al modelo. */
export function resolveVocabPath(modelPath, tokenizerPath) {
  if (tokenizerPath) return isAbsolute(tokenizerPath) ? tokenizerPath : join(process.cwd(), tokenizerPath);
  return join(dirname(modelPath), "vocab.txt");
}

/**
 * Crea un embedder neuronal asincrono a partir de un modelo ONNX local.
 * Carga la sesion de forma perezosa en la primera llamada.
 * @param {{model:string, tokenizer?:string, maxLen?:number}} opts
 * @returns {((text:string)=>Promise<Float32Array>) & {provider:string, dim?:number, model:string}}
 */
export function createOnnxEmbedder(opts) {
  const { model, tokenizer, maxLen = 256 } = opts;
  const vocabPath = resolveVocabPath(model, tokenizer);
  let sessionPromise = null;
  let vocab = null;

  const getSession = async () => {
    if (!sessionPromise) {
      const runtime = loadOrt();
      if (!runtime) throw new Error("onnxruntime-node no esta instalado");
      if (!existsSync(model)) throw new Error(`no se encuentra el modelo: ${model}`);
      sessionPromise = runtime.InferenceSession.create(model);
    }
    return sessionPromise;
  };

  const fn = async (text) => {
    const session = await getSession();
    if (!vocab) vocab = loadVocab(vocabPath);
    const runtime = loadOrt();
    const { ids, mask, typeIds } = tokenizeBert(text, vocab, { maxLen });
    const toTensor = (values) =>
      new runtime.Tensor("int64", BigInt64Array.from(values, (v) => BigInt(v)), [1, values.length]);

    let out;
    try {
      out = await session.run({
        input_ids: toTensor(ids),
        attention_mask: toTensor(mask),
        token_type_ids: toTensor(typeIds),
      });
    } catch {
      // Algunos modelos no aceptan token_type_ids: reintentamos sin el.
      out = await session.run({
        input_ids: toTensor(ids),
        attention_mask: toTensor(mask),
      });
    }
    const hidden = out.last_hidden_state ?? out[Object.keys(out)[0]];
    const vec = normalize(meanPool(hidden.data, hidden.dims, mask));
    fn.dim = vec.length;
    return vec;
  };

  fn.provider = "onnx";
  fn.model = model;
  return fn;
}
