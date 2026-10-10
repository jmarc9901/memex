// Memex Offline - embeddings en CPU, sin GPU y sin red por defecto.
//
// Proveedor por defecto "hash": bolsa de palabras hasheada (feature hashing)
// sobre unigramas y bigramas, normalizada L2. Es determinista, instantanea y
// no necesita dependencias, asi que la busqueda por significado funciona sin
// instalar nada. Si el usuario instala onnxruntime-node, se puede activar el
// proveedor "onnx" con un modelo real (p.ej. all-MiniLM-L6-v2).

import { createRequire } from "node:module";

const ACCENTS = /[\u0300-\u036f]/g;
const TOKEN_RE = /[\p{L}\p{N}]+/gu;

/** Normaliza (minusculas, sin acentos) y trocea en terminos. */
export function tokenize(text, { minLength = 2 } = {}) {
  const tokens = [];
  for (const raw of text.toLowerCase().normalize("NFD").replace(ACCENTS, "").match(TOKEN_RE) ?? []) {
    if (raw.length >= minLength) tokens.push(raw);
  }
  return tokens;
}

/** Hash estable de 32 bits (FNV-1a). */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Embedding local por feature hashing (unigramas + bigramas + trigramas de
 * caracteres para tolerar erratas).
 * @param {string} text
 * @param {{dim?:number}} [opts]
 * @returns {Float32Array} vector normalizado
 */
export function hashEmbed(text, { dim = 256 } = {}) {
  const vec = new Float32Array(dim);
  const tokens = tokenize(text);
  if (!tokens.length) return vec;

  const add = (feature, weight) => {
    const h = fnv1a(feature);
    const index = h % dim;
    const sign = fnv1a(feature + "#") & 1 ? 1 : -1;
    vec[index] += sign * weight;
  };

  for (let i = 0; i < tokens.length; i++) {
    add(tokens[i], 1);
    if (i + 1 < tokens.length) add(tokens[i] + "_" + tokens[i + 1], 0.7);
    // trigramas de caracteres: robustez ante variaciones morfologicas
    const t = tokens[i];
    for (let j = 0; j + 3 <= t.length && j < 12; j++) {
      add(t.slice(j, j + 3), 0.3);
    }
  }

  normalize(vec);
  return vec;
}

function normalize(vec) {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

/** Similitud coseno entre dos vectores normalizados (= producto escalar). */
export function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/** Serializa a BLOB (Float32 little-endian). */
export function toBlob(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/** Deserializa desde BLOB. */
export function fromBlob(blob) {
  if (!blob) return null;
  const buf = Buffer.from(blob);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/**
 * Crea el proveedor de embeddings segun configuracion.
 * Devuelve una funcion `(text) => Float32Array`.
 * @param {{embed_provider?:string, embed_dim?:number}} config
 */
export function createEmbedder(config = {}) {
  const dim = config.embed_dim ?? 256;
  const provider = config.embed_provider ?? "hash";

  if (provider === "onnx") {
    // Carga diferida: solo si el usuario instalo onnxruntime-node.
    const require = createRequire(import.meta.url);
    let onnxInstalled = true;
    try {
      require("onnxruntime-node");
    } catch {
      // onnxruntime-node no instalado: caemos al proveedor hash sin fallar.
      onnxInstalled = false;
    }
    if (onnxInstalled) {
      throw new Error(
        'proveedor "onnx": onnxruntime-node esta instalado pero aun no hay un modelo configurado. ' +
          "Define el modelo y adapta createEmbedder, o usa embed_provider=\"hash\"."
      );
    }
  }

  const fn = (text) => hashEmbed(text, { dim });
  fn.provider = "hash";
  fn.dim = dim;
  return fn;
}
