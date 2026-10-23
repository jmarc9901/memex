#!/usr/bin/env node
// Memex Offline - instalador de la interfaz web (UI).
//
// Deja la UI lista para usar en un solo paso: detecta el hardware, descarga el
// modelo que mejor encaja desde Hugging Face, escribe la configuracion, indexa
// la carpeta elegida y genera lanzadores (`memex-ui.sh` / `memex-ui.cmd`) que
// arrancan el servidor y abren el navegador.
//
//   node scripts/install-ui.js [carpeta] [--no-model] [--lang L] [--quality Q]
//                              [--no-index] [--port N] [--db RUTA] [--start] [--help]
import { chmodSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runInit, setupModel } from "../src/init.js";
import { loadConfig, saveConfig, configPath } from "../src/config.js";
import { detectHardware, hardwareLines } from "../src/hardware.js";
import { selectModel } from "../src/modelcatalog.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("-")));
const VALUE_FLAGS = new Set(["--port", "--db", "--lang", "--quality"]);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (...names) => names.some((n) => flags.has(n));
// El valor de --port/--db/... no es una carpeta: hay que saltarlo al buscar
// el argumento posicional, o `--port 5000` intentaria indexar "5000".
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (VALUE_FLAGS.has(arg)) {
    i += 1;
    continue;
  }
  if (!arg.startsWith("-")) positional.push(arg);
}

if (has("--help", "-h")) {
  process.stdout.write(
    `Instalador de la UI de Memex Offline\n\n` +
      `Uso: node scripts/install-ui.js [carpeta] [opciones]\n\n` +
      `  --no-model     No descarga el modelo neuronal (usa embeddings hash)\n` +
      `  --lang L       Idioma del modelo (por defecto es; usa en para corpus en ingles)\n` +
      `  --quality Q    Prioridad del modelo: auto (defecto), speed o best\n` +
      `  --no-index     Prepara todo pero no indexa ninguna carpeta\n` +
      `  --port N       Puerto de la UI (por defecto 4747)\n` +
      `  --db RUTA      Base de datos del indice (por defecto ./.memex/index.db)\n` +
      `  --start        Arranca la UI justo despues de instalar\n` +
      `  --force        Vuelve a descargar el modelo aunque ya exista\n` +
      `  -h, --help     Muestra esta ayuda\n\n` +
      `Genera memex-ui.sh / memex-ui.cmd en la carpeta actual.\n`
  );
  process.exit(0);
}

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
const useColor = (process.stdout.isTTY ?? false) && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `${code}${text}${C.reset}` : text);
const color = {
  bold: (t) => paint(C.bold, t),
  dim: (t) => paint(C.dim, t),
  green: (t) => paint(C.green, t),
  yellow: (t) => paint(C.yellow, t),
  cyan: (t) => paint(C.cyan, t),
  red: (t) => t,
};

const folder = resolve(positional[0] ?? process.cwd());
const portValue = valueOf("--port");
const port = portValue === undefined ? 4747 : Number(portValue);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write(`install-ui: puerto invalido: ${portValue}\n`);
  process.exit(1);
}
const dbPath = resolve(valueOf("--db") ?? process.env.MEMEX_DB ?? resolve(process.cwd(), ".memex", "index.db"));
const noIndex = has("--no-index");
const noModel = has("--no-model");
const language = valueOf("--lang") ?? "es";
const quality = valueOf("--quality") ?? "auto";

/** Escribe los lanzadores de la UI en la carpeta desde la que se ejecuta. */
function writeLaunchers() {
  const sh = [
    "#!/usr/bin/env bash",
    "# Lanzador de la UI de Memex Offline (generado por scripts/install-ui.js).",
    'cd "$(dirname "$0")"',
    `URL="http://127.0.0.1:${port}"`,
    'echo "Memex en $URL  (Ctrl+C para detener)"',
    '(command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL") || (command -v open >/dev/null 2>&1 && open "$URL") || true',
    `exec node "${ROOT}/bin/memex.js" serve --db "${dbPath}" --port ${port}`,
    "",
  ].join("\n");
  const cmd = [
    "@echo off",
    "rem Lanzador de la UI de Memex Offline (generado por scripts/install-ui.js).",
    'cd /d "%~dp0"',
    `echo Memex en http://127.0.0.1:${port}  (Ctrl+C para detener)`,
    `start "" http://127.0.0.1:${port}`,
    `node "${ROOT}\\bin\\memex.js" serve --db "${dbPath}" --port ${port}`,
    "",
  ].join("\r\n");

  // En la carpeta actual, no dentro de node_modules ni del clon: el lanzador
  // lleva rutas absolutas y es un artefacto local de esta maquina.
  const launcherDir = process.cwd();
  const shPath = resolve(launcherDir, "memex-ui.sh");
  const cmdPath = resolve(launcherDir, "memex-ui.cmd");
  writeFileSync(shPath, sh, "utf8");
  writeFileSync(cmdPath, cmd, "utf8");
  try {
    chmodSync(shPath, 0o755);
  } catch {
    /* en Windows chmod no aplica; no es un error */
  }
  return { shPath, cmdPath };
}

async function main() {
  process.stdout.write(`${color.bold("Memex Offline")} ${color.dim("- instalador de la UI")}\n\n`);

  const profile = detectHardware();
  process.stdout.write(`${color.bold("Hardware detectado")}\n`);
  for (const line of hardwareLines(profile)) process.stdout.write(`  ${color.dim(line)}\n`);
  const entry = selectModel(profile, { language, quality });
  process.stdout.write(
    `\n${color.green("✓")} Modelo recomendado: ${color.bold(entry.id)} ` +
      `${color.dim(`(${entry.sizeMb} MB, dim ${entry.dim})`)}\n`
  );
  if (profile.memoryGb && profile.memoryGb < entry.minRamGb) {
    process.stdout.write(
      `${color.yellow("!")} El modelo pide ${entry.minRamGb} GB de RAM y el equipo tiene ` +
        `${profile.memoryGb} GB; si va lento, usa --quality speed o --no-model.\n`
    );
  }
  process.stdout.write("\n");

  if (noIndex) {
    // Solo prepara modelo y config, sin tocar ninguna carpeta.
    const config = loadConfig();
    if (noModel) {
      config.embed_provider = "hash";
      config.embed_dim = 256;
      // Limpia restos de una instalacion ONNX anterior: si no, la config dice
      // `hash` pero conserva rutas de un modelo que ya no se usa.
      config.embed_model = "";
      config.embed_tokenizer = "";
      config.embed_cased = false;
    } else {
      process.stdout.write(`${color.dim(`descargando ${entry.id} de Hugging Face …`)}
`);
      const info = await setupModel({ entry, download: true, force: has("--force") });
      config.embed_provider = "onnx";
      config.embed_dim = entry.dim;
      config.embed_model = info.model;
      config.embed_tokenizer = info.tokenizer;
      config.embed_cased = Boolean(entry.cased);
    }
    saveConfig(config);
    process.stdout.write(`${color.green("✓")} Configuracion escrita ${color.dim(configPath())}\n`);
    process.stdout.write(`\n${color.yellow("!")} --no-index: no se indexo ninguna carpeta.\n`);
  } else {
    // Onboarding completo: modelo + config + indexado incremental de la carpeta.
    await runInit({
      out: process.stdout,
      color,
      dbPath,
      modelEntry: entry,
      flags: {
        _: ["init", folder],
        "no-model": noModel,
        lang: language,
        quality,
        force: true, // reindexa siempre la carpeta elegida
        "force-download": has("--force"),
      },
    });
  }

  const { shPath, cmdPath } = writeLaunchers();
  process.stdout.write(
    `\n${color.green("✓")} Lanzadores creados:\n` +
      `  ${color.dim(cmdPath)}   ${color.dim("(Windows)")}\n` +
      `  ${color.dim(shPath)}    ${color.dim("(Linux/macOS)")}\n`
  );
  process.stdout.write(
    `\n${color.bold("Abrir la UI:")}\n` +
      `  - Doble clic en memex-ui.cmd, o\n` +
      `  - ${color.cyan(`memex serve --port ${port}`)}\n` +
      `  - URL: ${color.cyan(`http://127.0.0.1:${port}`)}\n` +
      `\n${color.dim("Guia de prueba paso a paso: docs/PROBAR-UI.md")}\n`
  );

  if (has("--start")) {
    const { startServer } = await import("../src/server.js");
    process.stdout.write(`\n${color.dim("Arrancando la UI … (Ctrl+C para detener)")}\n`);
    const handle = startServer({
      dbPath,
      port,
      onListen: ({ host, port: p }) =>
        process.stdout.write(`${color.green("✓")} http://${host}:${p}\n`),
    });
    const stop = () => handle.close().then(() => process.exit(0));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
}

main().catch((err) => {
  process.stderr.write(`install-ui: ${err?.message ?? err}\n`);
  process.exit(1);
});
