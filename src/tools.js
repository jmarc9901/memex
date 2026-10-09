// Memex Offline - deteccion de herramientas externas opcionales.
import { spawnSync } from "node:child_process";

const cache = new Map();

/**
 * Comprueba si un comando existe en el PATH (cacheado).
 * @param {string} cmd
 * @param {string[]} [args]
 * @returns {boolean}
 */
export function hasCommand(cmd, args = ["--version"]) {
  const key = cmd + " " + args.join(" ");
  if (cache.has(key)) return cache.get(key);
  let available = false;
  try {
    const res = spawnSync(cmd, args, { stdio: "ignore" });
    available = !res.error;
  } catch {
    available = false;
  }
  cache.set(key, available);
  return available;
}

/**
 * Ejecuta un comando y devuelve su stdout como texto, o null si falla.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{cwd?:string}} [opts]
 */
export function runCapture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...opts,
  });
  if (res.error || res.status !== 0) return null;
  return res.stdout ?? "";
}
