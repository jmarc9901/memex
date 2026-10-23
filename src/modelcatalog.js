// Memex Offline - catalogo de modelos de embeddings locales.
//
// Solo se listan modelos que el cargador ONNX de `src/onnx.js` sabe usar:
// vocabulario WordPiece (`vocab.txt`) y una entrada `last_hidden_state`.
// Los modelos con tokenizer SentencePiece (XLM-R, E5 multilingue, etc.) no
// encajan todavia y por eso no aparecen aqui.
//
// La descarga es opcional: sin red se sigue usando el proveedor `hash`.

export const EMBED_MODELS = Object.freeze([
  {
    id: "all-MiniLM-L6-v2",
    label: "all-MiniLM-L6-v2 (ingles, rapido)",
    dim: 384,
    sizeMb: 23,
    languages: ["en"],
    minRamGb: 2,
    quality: 1,
    cased: false, // vocabulario uncased: minusculas y sin acentos
    urls: {
      tokenizer: "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/vocab.txt",
      model:
        "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx",
    },
    files: {
      tokenizer: "vocab.txt",
      model: "model_quantized.onnx",
    },
  },
  {
    id: "bert-base-multilingual-cased",
    label: "BERT multilingue (es/en, mas pesado)",
    dim: 768,
    sizeMb: 180,
    languages: ["multi"],
    minRamGb: 6,
    quality: 3,
    cased: true, // vocabulario cased: conserva mayusculas y acentos
    urls: {
      tokenizer:
        "https://huggingface.co/Xenova/bert-base-multilingual-cased/resolve/main/vocab.txt",
      model:
        "https://huggingface.co/Xenova/bert-base-multilingual-cased/resolve/main/onnx/model_quantized.onnx",
    },
    files: {
      tokenizer: "vocab.txt",
      model: "model_quantized.onnx",
    },
  },
]);

/** Entrada por defecto (la misma que usaba `init` antes del catalogo). */
export const DEFAULT_EMBED_MODEL =
  EMBED_MODELS.find((model) => model.id === "all-MiniLM-L6-v2") ?? EMBED_MODELS[0];

const QUALITIES = new Set(["auto", "speed", "best"]);

/** Normaliza el idioma pedido. */
export function normalizeLanguage(language) {
  const value = String(language ?? "en").trim().toLowerCase();
  if (value === "es" || value.startsWith("es-") || value === "spanish") return "es";
  if (value === "en" || value.startsWith("en-") || value === "english") return "en";
  if (value === "multi" || value === "auto" || value === "all") return "multi";
  return value;
}

/** ¿El modelo cubre el idioma pedido? */
export function supportsLanguage(model, language) {
  const wanted = normalizeLanguage(language);
  if (wanted === "multi") return model.languages.includes("multi");
  return model.languages.includes(wanted) || model.languages.includes("multi");
}

/** Modelos compatibles con un idioma, ordenados de menos a mas pesados. */
export function modelsForLanguage(language) {
  return EMBED_MODELS.filter((model) => supportsLanguage(model, language)).sort(
    (a, b) => a.sizeMb - b.sizeMb
  );
}

/**
 * Elige el modelo que mejor encaja con el hardware y el idioma.
 *
 * `quality`:
 *   - `speed`: el mas pequeno que quepa en RAM.
 *   - `best`: el de mayor calidad que quepa en RAM.
 *   - `auto`: multilingue cuando el corpus no es ingles y hay RAM suficiente;
 *             en caso contrario, el mas pequeno.
 *
 * @param {{memoryGb?:number, cores?:number}} [profile]
 * @param {{language?:string, quality?:string}} [opts]
 * @returns {typeof EMBED_MODELS[number]}
 */
export function selectModel(profile = {}, opts = {}) {
  const quality = String(opts.quality ?? "auto").toLowerCase();
  if (!QUALITIES.has(quality)) {
    throw new Error(`quality invalida: ${quality} (usa auto, speed o best)`);
  }
  const language = normalizeLanguage(opts.language ?? "en");
  const candidates = modelsForLanguage(language);
  if (!candidates.length) {
    throw new Error(`no hay modelos para el idioma: ${language}`);
  }

  // Si no conocemos la RAM, asumimos un equipo normal. Si el equipo no llega
  // al minimo de ningun modelo, seguimos con el mas pequeno: es mejor avisar
  // (lo hace el instalador) que impedir el onboarding.
  const memory = Number(profile.memoryGb);
  const fits = Number.isFinite(memory)
    ? candidates.filter((model) => memory >= model.minRamGb)
    : candidates;
  const pool = fits.length ? fits : [candidates[0]];

  if (quality === "speed") {
    return pool.reduce((best, model) => (model.sizeMb < best.sizeMb ? model : best));
  }

  if (quality === "best") {
    return pool.reduce((best, model) => {
      if (model.quality !== best.quality) return model.quality > best.quality ? model : best;
      return model.sizeMb > best.sizeMb ? model : best;
    });
  }

  const multilingual = pool.find((model) => model.languages.includes("multi"));
  if (language !== "en" && multilingual) return multilingual;
  return pool.reduce((best, model) => (model.sizeMb < best.sizeMb ? model : best));
}
