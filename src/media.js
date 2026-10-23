// Memex Offline - transcripcion de audio y video (Fase 4).
//
// Estrategia pluggable, sin dependencias npm:
//   1) whisper.cpp  (binario `whisper-cli` / `main`) + un modelo .bin local,
//      previa extraccion de audio a WAV 16 kHz con ffmpeg si hace falta.
//   2) whisper de Python (`whisper`), que acepta el fichero directamente.
// Si no hay ninguna herramienta, devuelve null y el archivo se omite.
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { hasCommand, runCapture } from "./tools.js";

export const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".wma",
]);

export const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mkv", ".mov", ".avi", ".webm", ".flv", ".wmv", ".m4v",
]);

export const MEDIA_EXTENSIONS = new Set([...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS]);

/** Modelo de Whisper (ruta .bin para whisper.cpp, o nombre para Python). */
export function whisperModel() {
  return process.env.MEMEX_WHISPER_MODEL || "";
}

export function whisperAvailable() {
  // `main` era el nombre del binario legacy de whisper.cpp, pero cualquier
  // proyecto compilado deja un `main` en el PATH: se detectaba transcripcion
  // donde no la habia. Solo se aceptan los nombres inequivocos.
  return hasCommand("whisper-cli", ["--help"]) || hasCommand("whisper", ["--help"]);
}

/**
 * Transcribe un archivo de audio o video.
 * @param {string} path
 * @returns {string|null}
 */
export function transcribeMedia(path) {
  if (!MEDIA_EXTENSIONS.has(extname(path).toLowerCase())) return null;
  const model = whisperModel();
  if (!model) return null;

  const tmp = mkdtempSync(join(tmpdir(), "memex-stt-"));
  try {
    const cpp = transcribeWithWhisperCpp(path, model, tmp);
    if (cpp) return cpp;
    return transcribeWithPythonWhisper(path, model, tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function transcribeWithWhisperCpp(path, model, tmp) {
  const bin = hasCommand("whisper-cli", ["--help"]) ? "whisper-cli" : null;
  if (!bin) return null;

  // whisper.cpp necesita audio PCM 16 kHz mono; convertimos con ffmpeg salvo
  // que ya sea un WAV.
  let input = path;
  if (extname(path).toLowerCase() !== ".wav") {
    if (hasCommand("ffmpeg", ["-version"])) {
      const wav = join(tmp, "audio.wav");
      const ok = runCapture("ffmpeg", ["-y", "-i", path, "-ar", "16000", "-ac", "1", wav]);
      if (ok !== null && existsSync(wav)) input = wav;
    }
  }

  const outBase = join(tmp, "out");
  const capture = runCapture(bin, [
    "-m", model, "-f", input, "-otxt", "-of", outBase, "-l", "auto",
  ]);
  const txt = outBase + ".txt";
  if (existsSync(txt)) return readTxt(txt);
  const fromStdout = capture ? cleanStdout(capture) : null;
  return fromStdout || null;
}

function transcribeWithPythonWhisper(path, model, tmp) {
  if (!hasCommand("whisper", ["--help"])) return null;
  const capture = runCapture("whisper", [
    path, "--model", model, "--output_format", "txt", "--output_dir", tmp,
  ]);
  const txt = join(tmp, basename(path, extname(path)) + ".txt");
  if (existsSync(txt)) return readTxt(txt);
  return capture ? cleanStdout(capture) : null;
}

function readTxt(path) {
  try {
    const text = readFileSync(path, "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}

/** Limpia la salida cruda de whisper.cpp (`[00:00.000 --> ...] texto`). */
function cleanStdout(text) {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/^\[[^\]]*\]\s*/, "").trim())
    .filter(Boolean);
  const cleaned = lines.join(" ").trim();
  return cleaned || null;
}
