// Memex Offline - extraccion de texto y chunking. Todo local, sin red.
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { IMAGE_EXTENSIONS, ocrImage } from "./ocr.js";
import { MEDIA_EXTENSIONS, transcribeMedia } from "./media.js";

export const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".rst", ".org", ".log", ".csv", ".tsv",
  ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".env",
  ".html", ".htm", ".xml", ".tex", ".srt", ".vtt",
]);

export const CODE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".rb", ".php", ".go",
  ".rs", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".swift", ".sh",
  ".bash", ".zsh", ".ps1", ".sql", ".css", ".scss", ".vue", ".lua", ".r",
]);

export const PDF_EXTENSIONS = new Set([".pdf"]);

// Extensiones de imagen/medios viven en sus modulos (ocr.js / media.js).
export { IMAGE_EXTENSIONS } from "./ocr.js";
export { MEDIA_EXTENSIONS, AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from "./media.js";

export const SUPPORTED_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ...CODE_EXTENSIONS,
  ...PDF_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...MEDIA_EXTENSIONS,
]);

export const DEFAULT_IGNORES = new Set([
  ".git", ".hg", ".svn", "node_modules", ".memex", ".venv", "venv",
  "__pycache__", "dist", "build", ".next", ".cache",
]);

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const CHUNK_SIZE = 1600;
const CHUNK_OVERLAP = 200;

/**
 * Recorre una carpeta y devuelve los archivos soportados.
 * @param {string} root
 * @param {{ignore?:Set<string>}} [opts]
 * @returns {string[]} rutas absolutas
 */
export function walkFiles(root, opts = {}) {
  const ignore = opts.ignore ?? DEFAULT_IGNORES;
  const base = resolve(root);
  const out = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        if (SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
          out.push(full);
        }
      }
    }
  };
  visit(base);
  return out;
}

/**
 * Extrae el texto de un archivo. Devuelve null si no es indexable.
 * @param {string} path
 * @returns {{text:string, extractor:string}|null}
 */
export function extractText(path) {
  const ext = extname(path).toLowerCase();

  if (PDF_EXTENSIONS.has(ext)) {
    const pdf = extractPdf(path);
    return pdf ? { text: pdf.text, extractor: pdf.extractor } : null;
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    const text = ocrImage(path);
    return text ? { text, extractor: "ocr" } : null;
  }

  if (MEDIA_EXTENSIONS.has(ext)) {
    const text = transcribeMedia(path);
    return text ? { text, extractor: "whisper" } : null;
  }

  let buf;
  try {
    buf = readFileSync(path);
  } catch {
    return null;
  }
  if (buf.length === 0 || buf.length > MAX_FILE_BYTES) return null;
  if (looksBinary(buf)) return null;

  const text = buf.toString("utf8");
  if (text.trim().length === 0) return null;
  return { text, extractor: "text" };
}

/** Heuristica sencilla: un byte NUL en el primer KB indica binario. */
function looksBinary(buf) {
  const n = Math.min(buf.length, 1024);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * Intenta extraer texto de un PDF usando herramientas externas si existen.
 * Sin dependencias npm: usa `pdftotext` (poppler) o `mutool` (mupdf).
 * @returns {{text:string, extractor:string}|null}
 */
export function extractPdf(path) {
  const tools = [
    { cmd: "pdftotext", extractor: "pdftotext", args: ["-q", path, "-"] },
    { cmd: "mutool", extractor: "mutool", args: ["draw", "-F", "text", path] },
  ];
  for (const { cmd, extractor, args } of tools) {
    const res = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (res.error) continue; // herramienta no instalada
    if (res.status === 0 && res.stdout && res.stdout.trim()) return { text: res.stdout, extractor };
  }
  return null;
}

/**
 * Trocea texto en fragmentos de tamano acotado respetando parrafos.
 * @param {string} text
 * @returns {string[]}
 */
export function chunkText(text) {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/);
  const chunks = [];
  let current = "";

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const paragraph of paragraphs) {
    for (const piece of splitLong(paragraph, CHUNK_SIZE)) {
      if (current.length + piece.length + 2 > CHUNK_SIZE && current) push();
      current = current ? current + "\n\n" + piece : piece;
    }
  }
  push();
  return chunks;
}

/** Divide un bloque demasiado largo en trozos con solape. */
function splitLong(block, size) {
  if (block.length <= size) return [block];
  const out = [];
  let i = 0;
  while (i < block.length) {
    out.push(block.slice(i, i + size));
    i += size - CHUNK_OVERLAP;
  }
  return out;
}
