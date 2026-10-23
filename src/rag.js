// Memex Offline - preguntas en lenguaje natural (RAG) con capa opcional.
//
// Offline-first: la recuperacion siempre es local. La generacion se delega a
// una API compatible con OpenAI (Groq, OpenRouter, llama.cpp, Ollama...) solo
// si el usuario ha configurado una clave o un base_url. Sin eso, `ask`
// devuelve los fragmentos relevantes para que los leas tu mismo.
import { hybridSearch, resolveQueryVec } from "./search.js";

// Endpoints por defecto. Los locales (ollama, llamacpp, lmstudio) no necesitan
// clave: basta con que el servidor este levantado en tu maquina.
const PROVIDER_BASE_URLS = {
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  ollama: "http://127.0.0.1:11434/v1",
  llamacpp: "http://127.0.0.1:8080/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
};

// Presets que corren en la propia maquina (Ruta 3: LLM local, sin nube).
export const LOCAL_PROVIDERS = {
  ollama: PROVIDER_BASE_URLS.ollama,
  llamacpp: PROVIDER_BASE_URLS.llamacpp,
  lmstudio: PROVIDER_BASE_URLS.lmstudio,
};

/** Resuelve la URL base del endpoint de chat. */
export function resolveBaseUrl(rag) {
  if (rag.base_url) return rag.base_url.replace(/\/$/, "");
  return PROVIDER_BASE_URLS[rag.provider] ?? null;
}

/**
 * Recupera el contexto local para una pregunta.
 * @returns {Array<{n:number,file_id:number,name:string,path:string,text:string,score:number}>}
 */
export async function retrieveContext(db, question, { limit = 6, embedder } = {}) {
  const queryVec = await resolveQueryVec(embedder, question);
  const hits = hybridSearch(db, question, { mode: "hybrid", limit, embedder, queryVec });
  return hits.map((hit, i) => ({
    n: i + 1,
    file_id: hit.file_id,
    name: hit.name,
    path: hit.path,
    text: stripMarkers(hit.snippet),
    score: hit.score,
  }));
}

function stripMarkers(text) {
  return text.replace(/\[\[(.+?)\]\]/g, "$1").replace(/\s*…\s*$/, "");
}

/** Construye el prompt con fragmentos numerados como contexto. */
export function buildPrompt(question, context) {
  const blocks = context
    .map((c) => `[${c.n}] (${c.name})\n${c.text}`)
    .join("\n\n");
  return {
    system:
      "Eres el asistente de Memex, un buscador personal offline. Responde en espanol " +
      "usando UNICAMENTE el contexto proporcionado. Cita las fuentes con [n]. " +
      "Si el contexto no basta, dilo claramente.",
    user: `Pregunta: ${question}\n\nContexto:\n${blocks}`,
  };
}

/**
 * Lista los modelos disponibles en un endpoint compatible con OpenAI.
 * Best-effort: si no responde o falla, devuelve una lista vacia.
 * @param {string} baseUrl
 * @param {{apiKey?:string, fetchImpl?:Function}} [opts]
 * @returns {Promise<string[]>}
 */
export async function listModels(baseUrl, opts = {}) {
  if (!baseUrl) return [];
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  try {
    const res = await doFetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {},
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data ?? []).map((m) => m?.id).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Comprueba si un endpoint esta levantado y que modelos ofrece.
 * @returns {Promise<{reachable:boolean, models:string[]}>}
 */
export async function probeEndpoint(baseUrl, opts = {}) {
  if (!baseUrl) return { reachable: false, models: [] };
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  try {
    const res = await doFetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {},
    });
    // Responde aunque devuelva error: el servidor esta levantado.
    if (!res.ok) return { reachable: true, models: [] };
    const data = await res.json().catch(() => ({}));
    return { reachable: true, models: (data?.data ?? []).map((m) => m?.id).filter(Boolean) };
  } catch {
    return { reachable: false, models: [] };
  }
}

/**
 * Pregunta en lenguaje natural con RAG.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} question
 * @param {{config:object, embedder?:Function, limit?:number, fetchImpl?:Function}} opts
 * @returns {Promise<{answer:string|null, model?:string, offline:boolean, context:Array, error?:string}>}
 */
export async function ask(db, question, opts) {
  const { config, embedder, limit = 6 } = opts;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const context = await retrieveContext(db, question, { limit, embedder });

  const rag = config.rag ?? {};
  const baseUrl = resolveBaseUrl(rag);
  if (!baseUrl || (!rag.api_key && !isLocalUrl(baseUrl))) {
    return { answer: null, offline: true, context };
  }

  const { system, user } = buildPrompt(question, context);
  // Si no hay modelo configurado, tomamos el primero que ofrezca el endpoint.
  // Asi funciona "out of the box" contra un LLM local (Ollama, llama.cpp...).
  let model = rag.model || "";
  if (!model) {
    const available = await listModels(baseUrl, { apiKey: rag.api_key, fetchImpl: doFetch });
    model = available[0] ?? "";
  }
  try {
    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(rag.api_key ? { authorization: `Bearer ${rag.api_key}` } : {}),
      },
      body: JSON.stringify({
        model: model || undefined,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      return { answer: null, offline: false, context, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const answer = data?.choices?.[0]?.message?.content?.trim() ?? null;
    return { answer, model: data?.model, offline: false, context };
  } catch (err) {
    return { answer: null, offline: false, context, error: err.message };
  }
}

/**
 * ¿La URL apunta a la propia maquina? Se compara el hostname completo (no una
 * regex sobre la cadena): `http://localhost.evil.example` no es local aunque
 * contenga la palabra "localhost".
 * @param {string} url
 * @returns {boolean}
 */
export function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (
      host === "localhost" ||
      host === "::1" ||
      host === "0.0.0.0" ||
      /^127\.\d{1,3}(\.\d{1,3}){2}$/.test(host)
    );
  } catch {
    return false;
  }
}
