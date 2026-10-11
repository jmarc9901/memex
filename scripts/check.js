// Chequeo de sintaxis sin dependencias: valida cada archivo .js con `node --check`.
// Sirve como "lint" minimo en CI y en local. No ejecuta el codigo.
import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOTS = ["bin", "src", "web", "extension", "test", "scripts"];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && full.endsWith(".js")) out.push(full);
  }
  return out;
}

const files = [];
for (const root of ROOTS) {
  try {
    if (statSync(root).isDirectory()) walk(root, files);
  } catch {
    /* carpeta ausente: se ignora */
  }
}

let failed = 0;
for (const file of files.sort()) {
  const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (res.status !== 0) {
    failed += 1;
    process.stderr.write(`✗ ${file}\n${res.stderr}`);
  }
}

if (failed) {
  process.stderr.write(`\n${failed} archivo(s) con errores de sintaxis.\n`);
  process.exit(1);
}
process.stdout.write(`✓ sintaxis correcta en ${files.length} archivo(s)\n`);
