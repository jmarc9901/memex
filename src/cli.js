// Memex Offline - interfaz de linea de comandos.
import { resolve } from "node:path";
import { openDatabase, search, stats, clear } from "./db.js";
import { buildMatch } from "./query.js";
import { indexFolder } from "./indexer.js";

const HELP = `Memex Offline - buscador personal 100% offline (SQLite FTS5, sin LLM)

Uso:
  memex index [carpeta] [--force] [--db RUTA]   Indexa una carpeta (incremental)
  memex search <consulta> [-n N] [--any] [--json] [--db RUTA]
  memex stats [--json] [--db RUTA]
  memex clear [--db RUTA]

Opciones:
  --db RUTA    Base de datos del indice (por defecto ./.memex/index.db)
  --force      Reindexa todo, ignorando cache por mtime/tamano
  -n, --limit  Numero maximo de resultados (por defecto 20)
  --any        Une los terminos con OR en vez de AND
  --json       Salida en JSON
  -h, --help   Muestra esta ayuda

Ejemplos:
  memex index ~/Documentos
  memex search "ansiedad"
  memex search '"proyecto x" 2024' --json`;

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function makeColor(useColor) {
  const wrap = (code, text) => (useColor ? `${code}${text}${COLORS.reset}` : text);
  return {
    bold: (t) => wrap(COLORS.bold, t),
    dim: (t) => wrap(COLORS.dim, t),
    green: (t) => wrap(COLORS.green, t),
    cyan: (t) => wrap(COLORS.cyan, t),
    yellow: (t) => wrap(COLORS.yellow, t),
    red: (t) => wrap(COLORS.red, t),
  };
}

/** Parser de argumentos sencillo y sin dependencias. */
function parseArgs(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--db":
        flags.db = argv[++i];
        break;
      case "--limit":
      case "-n":
        flags.limit = Number(argv[++i]);
        break;
      case "--force":
        flags.force = true;
        break;
      case "--any":
        flags.any = true;
        break;
      case "--json":
        flags.json = true;
        break;
      case "-h":
      case "--help":
        flags.help = true;
        break;
      default:
        flags._.push(arg);
    }
  }
  return flags;
}

function defaultDbPath() {
  return process.env.MEMEX_DB || resolve(process.cwd(), ".memex", "index.db");
}

/**
 * @param {string[]} argv
 * @param {{stdout?:NodeJS.WriteStream, stderr?:NodeJS.WriteStream}} [io]
 */
export async function run(argv, io = {}) {
  const out = io.stdout ?? process.stdout;
  const err = io.stderr ?? process.stderr;
  const color = makeColor((out.isTTY ?? false) && !process.env.NO_COLOR);
  const flags = parseArgs(argv);
  const command = flags._[0];

  if (!command || flags.help) {
    out.write(HELP + "\n");
    return;
  }

  const dbPath = flags.db ? resolve(flags.db) : defaultDbPath();

  if (command === "index") {
    const root = flags._[1] ? resolve(flags._[1]) : process.cwd();
    const db = openDatabase(dbPath);
    const started = Date.now();
    const summary = indexFolder(db, root, {
      force: flags.force,
      onProgress: ({ done, total, path }) => {
        if (out.isTTY) {
          out.write(`\r${color.dim(`indexando ${done}/${total} - ${shorten(path, 60)}`)}`);
        }
      },
    });
    if (out.isTTY) out.write("\r\x1b[K");
    db.close();

    const elapsed = ((Date.now() - started) / 1000).toFixed(2);
    if (flags.json) {
      out.write(JSON.stringify({ db: dbPath, ...summary, seconds: Number(elapsed) }, null, 2) + "\n");
      return;
    }
    out.write(
      `${color.green("✓")} Indexado ${color.bold(shorten(summary.root, 60))}\n` +
        `  archivos escaneados : ${summary.scanned}\n` +
        `  nuevos              : ${color.green(summary.added)}\n` +
        `  actualizados        : ${color.cyan(summary.updated)}\n` +
        `  sin cambios         : ${summary.unchanged}\n` +
        `  no indexables       : ${summary.unsupported}\n` +
        `  errores             : ${summary.failed ? color.red(summary.failed) : 0}\n` +
        `  tiempo              : ${elapsed}s\n` +
        `  indice              : ${color.dim(dbPath)}\n`
    );
    return;
  }

  if (command === "search" || command === "find") {
    const queryText = flags._.slice(1).join(" ").trim();
    if (!queryText) throw new Error("falta la consulta. Ej: memex search \"ansiedad\"");
    let match;
    try {
      match = buildMatch(queryText, { any: flags.any });
    } catch (e) {
      throw new Error(e.message);
    }
    const db = openDatabase(dbPath);
    const limit = Number.isFinite(flags.limit) ? flags.limit : 20;
    const started = Date.now();
    const rows = search(db, match, { limit });
    const elapsed = Date.now() - started;
    db.close();

    if (flags.json) {
      out.write(JSON.stringify({ query: queryText, match, took_ms: elapsed, count: rows.length, results: rows }, null, 2) + "\n");
      return;
    }

    if (!rows.length) {
      out.write(`${color.yellow("Sin resultados")} para "${queryText}" ${color.dim(`(${elapsed} ms)`)}\n`);
      return;
    }

    out.write(`${color.bold(String(rows.length))} resultado(s) para "${queryText}" ${color.dim(`(${elapsed} ms)`)}\n\n`);
    rows.forEach((row, i) => {
      const rank = String(i + 1).padStart(2);
      out.write(
        `${color.green(rank + ".")} ${color.bold(row.name)}  ${color.dim(row.path)}\n` +
          `    ${highlight(row.snippet, color)}\n\n`
      );
    });
    return;
  }

  if (command === "stats") {
    const db = openDatabase(dbPath);
    const s = stats(db);
    db.close();
    if (flags.json) {
      out.write(JSON.stringify({ db: dbPath, ...s }, null, 2) + "\n");
      return;
    }
    out.write(
      `${color.bold("Indice")} ${color.dim(dbPath)}\n` +
        `  archivos : ${s.files}\n` +
        `  fragmentos: ${s.chunks}\n` +
        `  omitidos : ${s.skipped}\n`
    );
    if (s.byExt.length) {
      out.write("  por extension:\n");
      for (const row of s.byExt) out.write(`    ${String(row.ext || "(sin ext)").padEnd(10)} ${row.n}\n`);
    }
    return;
  }

  if (command === "clear") {
    const db = openDatabase(dbPath);
    clear(db);
    db.close();
    out.write(`${color.green("✓")} Indice vaciado ${color.dim(dbPath)}\n`);
    return;
  }

  throw new Error(`comando desconocido: ${command} (usa --help)`);
}

function shorten(path, max) {
  if (path.length <= max) return path;
  return "…" + path.slice(path.length - max + 1);
}

function highlight(text, color) {
  return text.replace(/\[\[(.+?)\]\]/g, (_, m) => color.yellow(color.bold(m)));
}
