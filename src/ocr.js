// Memex Offline - OCR de imagenes y PDFs escaneados (Fase 3).
//
// Usa el binario `tesseract` si esta instalado. Sin el, devuelve null y los
// archivos de imagen simplemente se omiten: el resto del proyecto funciona.
import { extname } from "node:path";
import { hasCommand, runCapture } from "./tools.js";

export const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif", ".webp",
]);

/** Idioma por defecto de Tesseract (configurable con MEMEX_OCR_LANG). */
export function ocrLanguage() {
  return process.env.MEMEX_OCR_LANG || "eng";
}

/** ¿Hay OCR disponible? */
export function ocrAvailable() {
  return hasCommand("tesseract", ["--version"]);
}

/**
 * Extrae el texto de una imagen con Tesseract.
 * @param {string} path
 * @returns {string|null}
 */
export function ocrImage(path) {
  if (!IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) return null;
  if (!ocrAvailable()) return null;
  const out = runCapture("tesseract", [path, "stdout", "-l", ocrLanguage()]);
  if (out && out.trim()) return out.trim();
  return null;
}
