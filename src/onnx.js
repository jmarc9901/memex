// Memex Offline - embeddings neuronales opcionales (ONNX), 100% locales.
//
// Este modulo aporta la "semantica real" que la Ruta 1 del roadmap dejaba
// pendiente: en lugar de feature hashing (lexico), usa un modelo BERT pequeno
// (p. ej. all-MiniLM-L6-v2) ejecutado con onnxruntime-node. Es COMPLETAMENTE
// OPCIONAL: si el paquete o el modelo no estan, `createEmbedder` avisa y cae al
// proveedor "hash". No hay dependencias obligatorias ni red.
//
// Flujo: texto -> tokenizer WordPiece (vocab.txt) -> input_ids/attention_mask
// -> sesion ONNX -> last_hidden_state -> mean pooling -> normalizacion L2.
//
// Dos detalles que antes se ignoraban y degradaban la calidad:
//   - Los modelos *cased* (el BERT multilingue) esperan mayusculas y acentos.
//     `basicClean` los respeta cuando `cased` esta activo.
//   - Los modelos aceptan lotes: `embedder.batch(textos)` procesa varios textos
//     por pasada en vez de uno, que es la diferencia entre minutos y horas al
//     vectorizar un corpus grande.
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
 * Normaliza el texto como BERT: minusculas y sin acentos si el modelo es
 * *uncased* (MiniLM ingles), o conservando mayusculas y acentos si es *cased*
 * (BERT multilingue). En ambos casos separa la puntuacion como token propio.
 * @param {string} text
 * @param {{cased?:boolean}} [opts]
 */
export function basicClean(text, { cased = false } = {}) {
  const value = String(text ?? "");
  if (cased) {
    return value
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}\s]/gu, " $& ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return value
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
 * @param {{maxLen?:number, cased?:boolean}} [opts]
 * @returns {{ids:number[], mask:number[], typeIds:number[]}}
 */
export function tokenizeBert(text, vocab, opts = {}) {
  const maxLen = opts.maxLen ?? 256;
  const cls = vocab.get("[CLS]") ?? 101;
  const sep = vocab.get("[SEP]") ?? 102;
  const unk = vocab.get("[UNK]") ?? 100;
  const pad = vocab.get("[PAD]") ?? 0;

  const ids = [cls];
  for (const token of basicClean(text, { cased: opts.cased }).split(" ")) {
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
 * @param {Float32Array|number[]} data  datos planos [seq, dim]
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
 * @param {{model:string, tokenizer?:string, maxLen?:number, cased?:boolean}} opts
 * @returns {((text:string)=>Promise<Float32Array>) & {
 *   provider:string, dim?:number, model:string, cased:boolean,
 *   batch:(texts:string[])=>Promise<Float32Array[]>}}
 */
export function createOnnxEmbedder(opts) {
  const { model, tokenizer, maxLen = 256, cased = false } = opts;
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

  /** Ejecuta la sesion con token_type_ids y reintenta sin ellos si el modelo no los acepta. */
  const runSession = async (session, runtime, encoded, batchSize) => {
    const tensor = (values) =>
      new runtime.Tensor("int64", values, [batchSize, maxLen]);
    try {
      return await session.run({
        input_ids: tensor(encoded.ids),
        attention_mask: tensor(encoded.mask),
        token_type_ids: tensor(encoded.typeIds),
      });
    } catch {
      return await session.run({
        input_ids: tensor(encoded.ids),
        attention_mask: tensor(encoded.mask),
      });
    }
  };

  /** Convierte `last_hidden_state` en un vector normalizado por fila. */
  const vectorsFrom = (out, batch, batchSize) => {
    const hidden = out.last_hidden_state ?? out[Object.keys(out)[0]];
    const dims = hidden.dims;
    const seq = dims[dims.length - 2];
    const dim = dims[dims.length - 1];
    const vectors = [];
    for (let row = 0; row < batchSize; row++) {
      const from = row * seq * dim;
      const slice = hidden.data.subarray(from, from + seq * dim);
      vectors.push(normalize(meanPool(slice, [seq, dim], batch[row].mask)));
    }
    return vectors;
  };

  /**
   * Vectoriza un lote de textos en una sola pasada.
   * @param {string[]} texts
   * @returns {Promise<Float32Array[]>}
   */
  const batch = async (texts) => {
    if (!Array.isArray(texts) || !texts.length) return [];
    const session = await getSession();
    const runtime = loadOrt();
    if (!vocab) vocab = loadVocab(vocabPath);

    const encoded = texts.map((text) => tokenizeBert(text, vocab, { maxLen, cased }));
    const batchSize = encoded.length;
    const size = batchSize * maxLen;
    // Un unico buffer por tensor: el runtime recibe [batchSize, maxLen].
    const ids = new BigInt64Array(size);
    const mask = new BigInt64Array(size);
    const typeIds = new BigInt64Array(size);
    for (let row = 0; row < batchSize; row++) {
      const enc = encoded[row];
      for (let j = 0; j < maxLen; j++) {
        ids[row * maxLen + j] = BigInt(enc.ids[j]);
        mask[row * maxLen + j] = BigInt(enc.mask[j]);
        typeIds[row * maxLen + j] = BigInt(enc.typeIds[j]);
      }
    }

    const out = await runSession(session, runtime, { ids, mask, typeIds }, batchSize);
    const vectors = vectorsFrom(out, encoded, batchSize);
    if (vectors[0]) fn.dim = vectors[0].length;
    return vectors;
  };

  /** Vectoriza un unico texto (azucar sobre `batch`). */
  const fn = async (text) => {
    const [vec] = await batch([String(text ?? "")]);
    return vec;
  };

  fn.provider = "onnx";
  fn.model = model;
  fn.cased = Boolean(cased);
  fn.batch = batch;
  return fn;
}
