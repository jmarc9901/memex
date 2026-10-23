#!/usr/bin/env node
// Memex Offline - instalador del CLI.
//
// Deja el comando `memex` disponible en el PATH (via `npm link`) tras
// comprobar la version de Node y pasar el chequeo de sintaxis y, si se quiere,
// los tests. Sin dependencias: solo la stdlib de Node.
//
//   node scripts/install-cli.js [--no-link] [--skip-tests] [--skip-check] [--help]
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const MIN_NODE = { major: 22, minor: 13 };

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("-")));
const has = (...names) => names.some((n) => flags.has(n));

if (has("--help", "-h")) {
  process.stdout.write(
    `Instalador del CLI de Memex Offline\n\n` +
      `Uso: node scripts/install-cli.js [opciones]\n\n` +
      `  --no-link      No ejecuta 'npm link' (solo comprueba el entorno)\n` +
      `  --skip-tests   No ejecuta la suite de tests\n` +
      `  --skip-check   No ejecuta el chequeo de sintaxis\n` +
      `  -h, --help     Muestra esta ayuda\n`
  );
  process.exit(0);
}

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m",
};
const useColor = (process.stdout.isTTY ?? false) && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `${code}${text}${C.reset}` : text);
const ok = (t) => paint(C.green, t);
const warn = (t) => paint(C.yellow, t);
const bad = (t) => paint(C.red, t);
const dim = (t) => paint(C.dim, t);

function run(cmd, cmdArgs) {
  // En Windows los ejecutables de npm son .cmd y requieren shell; los comandos
  // son fijos (no vienen del usuario), asi que no hay riesgo de inyeccion.
  const res = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return res.status ?? 1;
}

function main() {
  process.stdout.write(`${paint(C.bold, "Memex Offline")} ${dim("- instalador del CLI")}\n\n`);

  // 1) Version de Node.
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < MIN_NODE.major || (major === MIN_NODE.major && minor < MIN_NODE.minor)) {
    process.stderr.write(
      `${bad("✗")} Se requiere Node >= ${MIN_NODE.major}.${MIN_NODE.minor}.0 ` +
        `(tienes v${process.versions.node}).\n` +
        `  Instala una version reciente desde https://nodejs.org y vuelve a intentarlo.\n`
    );
    process.exit(1);
  }
  process.stdout.write(`${ok("✓")} Node v${process.versions.node}\n`);

  // 2) Sintaxis.
  if (!has("--skip-check")) {
    process.stdout.write(`${dim("· comprobando sintaxis (npm run check) …")}\n`);
    if (run("npm", ["run", "check"]) !== 0) {
      process.stderr.write(`${bad("✗")} El chequeo de sintaxis fallo.\n`);
      process.exit(1);
    }
  }

  // 3) Tests.
  if (!has("--skip-tests")) {
    process.stdout.write(`${dim("· ejecutando tests (npm test) …")}\n`);
    if (run("npm", ["test"]) !== 0) {
      process.stderr.write(`${bad("✗")} Los tests fallaron.\n`);
      process.exit(1);
    }
  }

  // 4) Enlazar el comando.
  if (has("--no-link")) {
    process.stdout.write(
      `\n${warn("!")} --no-link: no se enlaza el comando. Usalo asi:\n` +
        `    node ${join(ROOT, "bin", "memex.js")} --help\n`
    );
  } else {
    process.stdout.write(`${dim("· enlazando el comando global (npm link) …")}\n`);
    if (run("npm", ["link"]) !== 0) {
      process.stdout.write(
        `\n${warn("!")} No se pudo enlazar globalmente (permisos de npm). ` +
          `Prueba con permisos de administrador, o ejecutalo sin enlazar:\n` +
          `    node ${join(ROOT, "bin", "memex.js")} --help\n`
      );
    } else {
      process.stdout.write(`${ok("✓")} Comando 'memex' disponible en el PATH\n`);
    }
  }

  process.stdout.write(
    `\n${paint(C.bold, "Listo.")} Siguientes pasos:\n` +
      `  1. ${paint(C.cyan, "memex init <carpeta>")}   ${dim("detecta tu hardware, baja el modelo e indexa")}\n` +
      `  2. ${paint(C.cyan, "memex search \"algo\"")}\n` +
      `  3. ${paint(C.cyan, "memex serve")}            ${dim("abre la interfaz web en http://127.0.0.1:4747")}\n` +
      `\n${dim("Documentacion completa: docs/CLI.md")}\n`
  );
}

main();
