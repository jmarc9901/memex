// Memex Offline - preguntas en lenguaje natural (RAG) con capa opcional.
//
// Offline-first: la recuperacion siempre es local. La generacion se delega a
// una API compatible con OpenAI (Groq, OpenRouter, llama.cpp, Ollama...) solo
// si el usuario ha configurado una clave o un base_url. Sin eso, `ask`
// devuelve los fragmentos relevantes para que los leas tu mismo.
import { hybridSearch } from "./search.js";

const PROVIDER_BASE_URLS = {
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
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
export function retrieveContext(db, question, { limit = 6, embedder } = {}) {
  const hits = hybridSearch(db, question, { mode: "hybrid", limit, embedder });
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
 * Pregunta en lenguaje natural con RAG.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} question
 * @param {{config:object, embedder?:Function, limit?:number, fetchImpl?:Function}} opts
 * @returns {Promise<{answer:string|null, model?:string, offline:boolean, context:Array, error?:string}>}
 */
export async function ask(db, question, opts) {
  const { config, embedder, limit = 6 } = opts;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const context = retrieveContext(db, question, { limit, embedder });

  const rag = config.rag ?? {};
  const baseUrl = resolveBaseUrl(rag);
  if (!baseUrl || (!rag.api_key && !isLocal(baseUrl))) {
    return { answer: null, offline: true, context };
  }

  const { system, user } = buildPrompt(question, context);
  try {
    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(rag.api_key ? { authorization: `Bearer ${rag.api_key}` } : {}),
      },
      body: JSON.stringify({
        model: rag.model || undefined,
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

function isLocal(url) {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/.test(url);
}
