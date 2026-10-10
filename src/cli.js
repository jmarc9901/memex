// Memex Offline - interfaz de linea de comandos.
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { openDatabase, stats, clear } from "./db.js";
import { indexFolder } from "./indexer.js";
import { hybridSearch } from "./search.js";
import { createEmbedder } from "./embeddings.js";
import { loadConfig } from "./config.js";
import { ask } from "./rag.js";
import { startServer } from "./server.js";
import { toolStatus, configStatus, capabilitySummary, pingRag } from "./doctor.js";
import { benchmark } from "./bench.js";
import {
  addToTrail,
  ensureTrail,
  exportTrail,
  linkInTrail,
  listTrails,
  relate,
  removeTrail,
  showTrail,
} from "./trails.js";

const HELP = `Memex Offline - buscador personal 100% offline (SQLite FTS5 + embeddings en CPU)

Uso:
  memex index [carpeta] [--force] [--no-embed] [--db RUTA]
  memex search <consulta> [--mode hybrid|lexical|semantic] [-n N] [--any] [--json]
  memex ask <pregunta> [-n N] [--json]
  memex export <consulta> [--format jsonl|csv|md] [-o ARCHIVO] [-n N] [--any] [--mode MODO]
  memex relate <ref> [-n N] [--json]
  memex serve [--host H] [--port N] [--db RUTA]
  memex doctor [--ping] [--json]
  memex models [--json]
  memex bench [carpeta] [consulta...] [-n N] [--no-embed] [--json]
  memex stats [--json]
  memex clear
  memex trails [--json]
  memex trail create <nombre> [--desc TEXTO]
  memex trail add <nombre> <ref...> [--note TEXTO]
  memex trail link <nombre> <ref1> <ref2> [--label TEXTO]
  memex trail show <nombre> [--format json|dot|mermaid|md] [--json]
  memex trail rm <nombre>

Opciones:
  --db RUTA     Base de datos del indice (por defecto ./.memex/index.db o $MEMEX_DB)
  --force       Reindexa todo, ignorando la cache por mtime/tamano
  --no-embed    Indexa solo texto, sin calcular embeddings
  --mode MODO   hybrid (defecto), lexical o semantic
  -n, --limit   Numero maximo de resultados (por defecto 20)
  --any         Une los terminos con OR en vez de AND
  --format FMT  Formato: export (jsonl|csv|md) o trail show (json|dot|mermaid|md)
  -o, --out     Archivo de salida para export (por defecto stdout)
  --host H      Host del servidor (por defecto 127.0.0.1)
  --port N      Puerto del servidor (por defecto 4747 o $MEMEX_PORT)
  --ping        (doctor) Comprueba si los servidores RAG locales responden
  --json        Salida en JSON
  -h, --help    Muestra esta ayuda

Ejemplos:
  memex index ~/Documentos
  memex search "como me sentia" --mode semantic
  memex ask "que conclusiones saque del proyecto x"
  memex export "ansiedad" --format csv -o ansiedad.csv
  memex serve --port 4747
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

const VALUE_FLAGS = new Set([
  "--db", "--limit", "-n", "--mode", "--format", "-o", "--out", "--host", "--port",
]);

/** Parser de argumentos sencillo y sin dependencias. */
export function parseArgs(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`falta el valor de ${arg}`);
      return v;
    };
    switch (arg) {
      case "--db": flags.db = value(); break;
      case "--limit":
      case "-n": flags.limit = Number(value()); break;
      case "--mode": flags.mode = value(); break;
      case "--format": flags.format = value(); break;
      case "--out":
      case "-o": flags.out = value(); break;
      case "--host": flags.host = value(); break;
      case "--port": flags.port = Number(value()); break;
      case "--desc": flags.desc = value(); break;
      case "--note": flags.note = value(); break;
      case "--label": flags.label = value(); break;
      case "--force": flags.force = true; break;
      case "--no-embed": flags.noEmbed = true; break;
      case "--any": flags.any = true; break;
      case "--json": flags.json = true; break;
      case "-h":
      case "--help": flags.help = true; break;
      default:
        if (arg.startsWith("--") && !VALUE_FLAGS.has(arg)) flags[arg.slice(2)] = true;
        else flags._.push(arg);
    }
  }
  return flags;
}

export function defaultDbPath() {
  return process.env.MEMEX_DB || resolve(process.cwd(), ".memex", "index.db");
}

/**
 * @param {string[]} argv
 * @param {{stdout?:NodeJS.WriteStream, stderr?:NodeJS.WriteStream}} [io]
 */
export async function run(argv, io = {}) {
  const out = io.stdout ?? process.stdout;
  const color = makeColor((out.isTTY ?? false) && !process.env.NO_COLOR);
  const flags = parseArgs(argv);
  const command = flags._[0];

  if (!command || flags.help) {
    out.write(HELP + "\n");
    return;
  }

  const dbPath = flags.db ? resolve(flags.db) : defaultDbPath();

  switch (command) {
    case "index":
      return cmdIndex({ out, color, flags, dbPath });
    case "search":
    case "find":
      return cmdSearch({ out, color, flags, dbPath });
    case "ask":
      return cmdAsk({ out, color, flags, dbPath });
    case "export":
      return cmdExport({ out, color, flags, dbPath });
    case "serve":
      return cmdServe({ out, color, flags, dbPath });
    case "doctor":
      return cmdDoctor({ out, color, flags });
    case "models":
      return cmdModels({ out, color, flags });
    case "bench":
      return cmdBench({ out, color, flags });
    case "stats":
      return cmdStats({ out, color, flags, dbPath });
    case "clear":
      return cmdClear({ out, color, dbPath });
    case "relate":
      return cmdRelate({ out, color, flags, dbPath });
    case "trails":
      return cmdTrailsList({ out, color, flags, dbPath });
    case "trail":
      return cmdTrail({ out, color, flags, dbPath });
    default:
      throw new Error(`comando desconocido: ${command} (usa --help)`);
  }
}

function cmdIndex({ out, color, flags, dbPath }) {
  const root = flags._[1] ? resolve(flags._[1]) : process.cwd();
  const config = loadConfig();
  const embedder = flags.noEmbed ? null : createEmbedder(config);
  const db = openDatabase(dbPath);
  const started = Date.now();
  const summary = indexFolder(db, root, {
    force: flags.force,
    embedder,
    onProgress: ({ done, total, path }) => {
      if (out.isTTY) out.write(`\r${color.dim(`indexando ${done}/${total} - ${shorten(path, 60)}`)}`);
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
      `  embeddings          : ${embedder ? `${embedder.provider} (dim ${embedder.dim})` : "desactivados"}\n` +
      `  tiempo              : ${elapsed}s\n` +
      `  indice              : ${color.dim(dbPath)}\n`
  );
}

function cmdSearch({ out, color, flags, dbPath }) {
  const queryText = flags._.slice(1).join(" ").trim();
  if (!queryText) throw new Error('falta la consulta. Ej: memex search "ansiedad"');

  const mode = flags.mode ?? "hybrid";
  if (!["hybrid", "lexical", "semantic"].includes(mode)) {
    throw new Error(`modo invalido: ${mode} (usa hybrid, lexical o semantic)`);
  }

  const config = loadConfig();
  const embedder = mode === "lexical" ? null : createEmbedder(config);
  const db = openDatabase(dbPath);
  const limit = Number.isFinite(flags.limit) ? flags.limit : 20;
  const started = Date.now();
  const rows = hybridSearch(db, queryText, { mode, limit, any: Boolean(flags.any), embedder });
  const elapsed = Date.now() - started;
  db.close();

  if (flags.json) {
    out.write(
      JSON.stringify({ query: queryText, mode, took_ms: elapsed, count: rows.length, results: rows }, null, 2) + "\n"
    );
    return;
  }

  if (!rows.length) {
    out.write(`${color.yellow("Sin resultados")} para "${queryText}" ${color.dim(`(${elapsed} ms)`)}\n`);
    return;
  }

  out.write(
    `${color.bold(String(rows.length))} resultado(s) para "${queryText}" ${color.dim(`[${mode}] (${elapsed} ms)`)}\n\n`
  );
  rows.forEach((row, i) => {
    const rank = String(i + 1).padStart(2);
    const origin = [];
    if (row.lexical_rank !== null && row.lexical_rank !== undefined) origin.push("lex");
    if (row.semantic_rank !== null && row.semantic_rank !== undefined) origin.push("sem");
    out.write(
      `${color.green(rank + ".")} ${color.bold(row.name)} ${color.dim(`(${origin.join("+") || "?"})`)}  ${color.dim(row.path)}\n` +
        `    ${highlight(row.snippet, color)}\n\n`
    );
  });
}

async function cmdAsk({ out, color, flags, dbPath }) {
  const question = flags._.slice(1).join(" ").trim();
  if (!question) throw new Error('falta la pregunta. Ej: memex ask "que conclusiones saque"');

  const limit = Number.isFinite(flags.limit) ? flags.limit : 6;
  const config = loadConfig();
  const embedder = createEmbedder(config);
  const db = openDatabase(dbPath);
  const started = Date.now();
  const result = await ask(db, question, { config, embedder, limit });
  const elapsed = Date.now() - started;
  db.close();

  if (flags.json) {
    out.write(JSON.stringify({ question, ...result, took_ms: elapsed }, null, 2) + "\n");
    return;
  }

  if (result.answer) {
    out.write(`${color.bold("Respuesta")} ${color.dim(`(${result.model ?? "modelo"}, ${elapsed} ms)`)}:\n\n`);
    out.write(result.answer + "\n\n");
  } else if (result.error) {
    out.write(`${color.red("✗")} No se pudo generar la respuesta: ${result.error}\n`);
    out.write(`${color.dim("Fragmentos recuperados (modo offline):")}\n\n`);
  } else {
    out.write(`${color.yellow("Modo offline")} ${color.dim("(sin proveedor RAG configurado)")}\n`);
    out.write(`Fragmentos mas relevantes para ${color.cyan(question)}:\n\n`);
  }

  if (!result.context.length) {
    out.write(`${color.dim("No hay fragmentos en el indice. Indexa una carpeta primero.")}\n`);
    return;
  }
  for (const c of result.context) {
    out.write(`${color.green(`[${c.n}]`)} ${color.bold(c.name)} ${color.dim(c.path)}\n    ${c.text}\n\n`);
  }
}

function cmdExport({ out, color, flags, dbPath }) {
  const queryText = flags._.slice(1).join(" ").trim();
  if (!queryText) throw new Error('falta la consulta. Ej: memex export "ansiedad"');

  const format = flags.format ?? "jsonl";
  if (!["jsonl", "csv", "md"].includes(format)) {
    throw new Error(`formato invalido: ${format} (usa jsonl, csv o md)`);
  }

  const mode = flags.mode ?? "hybrid";
  const config = loadConfig();
  const embedder = mode === "lexical" ? null : createEmbedder(config);
  const db = openDatabase(dbPath);
  const limit = Number.isFinite(flags.limit) ? flags.limit : 20;
  const rows = hybridSearch(db, queryText, { mode, limit, any: Boolean(flags.any), embedder });
  db.close();

  const payload = formatExport(rows, { query: queryText, mode, format });
  if (flags.out) {
    writeFileSync(resolve(flags.out), payload, "utf8");
    out.write(`${color.green("✓")} ${rows.length} resultado(s) exportados a ${color.dim(resolve(flags.out))}\n`);
    return;
  }
  out.write(payload.endsWith("\n") ? payload : payload + "\n");
}

/** Serializa resultados de busqueda a jsonl, csv o markdown. */
export function formatExport(rows, { query = "", mode = "hybrid", format = "jsonl" } = {}) {
  if (format === "jsonl") {
    return rows.map((r) => JSON.stringify({ ...r, query })).join("\n");
  }
  if (format === "csv") {
    const head = ["rank", "name", "path", "ext", "chunk_index", "score", "snippet"];
    const lines = [head.join(",")];
    rows.forEach((r, i) => {
      lines.push(
        [i + 1, r.name, r.path, r.ext, r.chunk_index, r.score, stripMarkers(r.snippet)]
          .map(csvCell)
          .join(",")
      );
    });
    return lines.join("\n");
  }
  // markdown
  const lines = [`# Memex export`, "", `Consulta: \`${query}\` (${mode}) - ${rows.length} resultados`, ""];
  rows.forEach((r, i) => {
    lines.push(`## ${i + 1}. ${r.name}`);
    lines.push("");
    lines.push(`\`${r.path}\` - score ${Number(r.score).toFixed(4)}`);
    lines.push("");
    lines.push(stripMarkers(r.snippet));
    lines.push("");
  });
  return lines.join("\n");
}

function csvCell(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function stripMarkers(text) {
  return String(text ?? "").replace(/\[\[(.+?)\]\]/g, "$1").replace(/\s+/g, " ").trim();
}

function cmdServe({ out, color, flags, dbPath }) {
  const host = flags.host;
  const port = Number.isFinite(flags.port) ? flags.port : undefined;
  const handle = startServer({
    dbPath,
    host,
    port,
    onListen: ({ host: h, port: p }) => {
      out.write(`${color.green("✓")} Memex escuchando en ${color.bold(`http://${h}:${p}`)}\n`);
      out.write(`  ${color.dim(`indice: ${dbPath}`)}\n`);
      out.write(`  ${color.dim("Ctrl+C para detener")}\n`);
    },
  });
  const stop = () => {
    handle.close().then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return handle.close;
}

async function cmdDoctor({ out, color, flags }) {
  const config = loadConfig();
  const tools = toolStatus();
  const caps = capabilitySummary(tools);
  const cfg = configStatus(config);

  if (flags.json && !flags.ping) {
    out.write(JSON.stringify({ tools, capabilities: caps, config: cfg }, null, 2) + "\n");
    return;
  }

  if (flags.ping) {
    const probes = await pingRag(config);
    if (flags.json) {
      out.write(JSON.stringify({ tools, capabilities: caps, config: cfg, rag: probes }, null, 2) + "\n");
      return;
    }
    out.write(`${color.bold("Servidores RAG")}\n`);
    for (const p of probes) {
      const mark = p.reachable ? color.green("✓") : color.dim("✗");
      const models = p.models.length ? color.dim(` (${p.models.slice(0, 5).join(", ")})`) : "";
      out.write(`  ${mark} ${p.provider.padEnd(12)} ${color.dim(p.url)}${models}\n`);
    }
    out.write("\n");
  }

  out.write(`${color.bold("Herramientas opcionales")}\n`);
  for (const tool of tools) {
    const mark = tool.available ? color.green("✓") : color.dim("✗");
    const env = tool.env ? color.dim(` [${tool.env}]`) : "";
    out.write(`  ${mark} ${tool.name.padEnd(12)} ${color.dim(tool.purpose)}${env}\n`);
  }
  out.write(`\n${color.bold("Capacidades")}\n`);
  out.write(
    `  PDF           : ${yesNo(caps.pdf, color)}\n` +
      `  OCR           : ${yesNo(caps.ocr, color)}\n` +
      `  transcripcion : ${yesNo(caps.transcription, color)}\n`
  );
  out.write(`\n${color.bold("Configuracion")}\n`);
  out.write(`  embeddings : ${cfg.embed_provider} (dim ${cfg.embed_dim})\n`);
  out.write(
    `  RAG        : ${cfg.rag_enabled ? color.green("activado") : color.dim("desactivado")}` +
      `${cfg.rag_provider ? color.dim(` (${cfg.rag_provider}${cfg.rag_model ? ` / ${cfg.rag_model}` : ""})`) : ""}\n`
  );
  out.write(`  RAG URL    : ${cfg.rag_base_url ?? color.dim("(sin definir)")}\n`);
  out.write(`  OCR idioma : ${cfg.ocr_lang}\n`);
  out.write(`  modelo STT : ${cfg.whisper_model ?? color.dim("(sin definir)")}\n`);
}

async function cmdModels({ out, color, flags }) {
  const config = loadConfig();
  const probes = await pingRag(config);

  if (flags.json) {
    out.write(JSON.stringify(probes, null, 2) + "\n");
    return;
  }

  const available = probes.filter((p) => p.models.length);
  if (!available.length) {
    out.write(`${color.yellow("Sin modelos locales detectados")}\n`);
    out.write(
      `${color.dim("Arranca Ollama (ollama serve), llama.cpp o LM Studio, o define rag.base_url.")}\n`
    );
    return;
  }
  for (const probe of probes) {
    if (!probe.models.length) continue;
    out.write(`${color.green("✓")} ${color.bold(probe.provider)} ${color.dim(probe.url)}\n`);
    for (const model of probe.models) out.write(`    ${model}\n`);
  }
}

function yesNo(value, color) {
  return value ? color.green("si") : color.yellow("no");
}

function cmdBench({ out, color, flags }) {
  const root = flags._[1] ? resolve(flags._[1]) : process.cwd();
  const queries = flags._.slice(2);
  const config = loadConfig();
  const embedder = flags.noEmbed ? null : createEmbedder(config);
  const limit = Number.isFinite(flags.limit) ? flags.limit : 10;
  const r = benchmark(root, { embedder, queries, limit });

  if (flags.json) {
    out.write(JSON.stringify(r, null, 2) + "\n");
    return;
  }

  out.write(`${color.bold("Benchmark")} ${color.dim(r.root)}\n`);
  out.write(`  archivos escaneados : ${r.scanned}\n`);
  out.write(`  indexados           : ${r.indexed}\n`);
  out.write(`  fragmentos          : ${r.chunks} (${r.embedded} con vector)\n`);
  out.write(
    `  indexado            : ${r.index_ms} ms ${color.dim(`(${r.files_per_s ?? "-"} archivos/s)`)}` +
      ` ${color.dim("· indice desechable")}\n`
  );
  out.write(
    `  busqueda (mediana)  : ${r.search_ms.median} ms ` +
      `${color.dim(`min ${r.search_ms.min} / max ${r.search_ms.max}, ${r.search_ms.count} consultas`)}` +
      `${r.mode ? color.dim(` [${r.mode}]`) : ""}\n`
  );
  out.write(`  memoria (RSS)       : ${r.rss_mb} MB\n`);
  if (r.queries.length) {
    out.write(`  consultas:\n`);
    for (const q of r.queries) {
      out.write(`    ${color.cyan(JSON.stringify(q.query))} -> ${q.hits} resultado(s) en ${q.ms} ms\n`);
    }
  }
}

function cmdStats({ out, color, flags, dbPath }) {
  const db = openDatabase(dbPath);
  const s = stats(db);
  db.close();
  if (flags.json) {
    out.write(JSON.stringify({ db: dbPath, ...s }, null, 2) + "\n");
    return;
  }
  out.write(
    `${color.bold("Indice")} ${color.dim(dbPath)}\n` +
      `  archivos   : ${s.files}\n` +
      `  fragmentos : ${s.chunks}\n` +
      `  con vector : ${s.embedded}\n` +
      `  trails     : ${s.trails}\n`
  );
  if (s.byExt.length) {
    out.write("  por extension:\n");
    for (const row of s.byExt) out.write(`    ${String(row.ext || "(sin ext)").padEnd(10)} ${row.n}\n`);
  }
}

function cmdClear({ out, color, dbPath }) {
  const db = openDatabase(dbPath);
  clear(db);
  db.close();
  out.write(`${color.green("✓")} Indice vaciado ${color.dim(dbPath)}\n`);
}

function cmdTrailsList({ out, color, flags, dbPath }) {
  const db = openDatabase(dbPath);
  const trails = listTrails(db);
  db.close();
  if (flags.json) {
    out.write(JSON.stringify(trails, null, 2) + "\n");
    return;
  }
  if (!trails.length) {
    out.write(`${color.yellow("No hay trails")}. Crea uno con: memex trail create <nombre>\n`);
    return;
  }
  out.write(`${color.bold(String(trails.length))} trail(s):\n`);
  for (const t of trails) {
    out.write(
      `  ${color.green(t.name)} ${color.dim(`${t.nodes} nodos, ${t.edges} enlaces`)}` +
        (t.description ? `  ${color.dim(t.description)}` : "") +
        "\n"
    );
  }
}

function cmdTrail({ out, color, flags, dbPath }) {
  const [sub, name, ...rest] = flags._.slice(1);
  const config = loadConfig();
  const embedder = createEmbedder(config);
  const db = openDatabase(dbPath);
  try {
    if (sub === "create") {
      if (!name) throw new Error("falta el nombre del trail");
      ensureTrail(db, name, flags.desc ?? "");
      out.write(`${color.green("✓")} Trail ${color.bold(name)} listo\n`);
      return;
    }
    if (sub === "add") {
      if (!name) throw new Error("uso: memex trail add <nombre> <ref...>");
      const refs = rest.length ? rest : [];
      if (!refs.length) throw new Error("indica al menos una ruta o consulta");
      for (const ref of refs) {
        const res = addToTrail(db, { trail: name, ref, note: flags.note, embedder });
        if (res.ok) out.write(`  + ${color.cyan(res.file.name)} ${color.dim(res.file.path)}\n`);
        else out.write(`  ${color.red("✗")} ${ref}: ${res.reason}\n`);
      }
      return;
    }
    if (sub === "link") {
      if (!name || rest.length < 2) throw new Error("uso: memex trail link <nombre> <ref1> <ref2>");
      const res = linkInTrail(db, { trail: name, from: rest[0], to: rest[1], label: flags.label, embedder });
      if (!res.ok) throw new Error(res.reason);
      out.write(`${color.green("✓")} Enlace creado en ${color.bold(name)}\n`);
      return;
    }
    if (sub === "show") {
      if (!name) throw new Error("uso: memex trail show <nombre>");
      const graph = showTrail(db, name);
      if (!graph) throw new Error(`no existe el trail: ${name}`);
      const format = flags.json ? "json" : flags.format;
      if (format && format !== "text") {
        out.write(exportTrail(graph, format) + "\n");
        return;
      }
      out.write(`${color.bold(graph.trail.name)} ${color.dim(graph.trail.description || "")}\n`);
      graph.nodes.forEach((n, i) => {
        out.write(`  ${String(i + 1).padStart(2)}. ${n.name} ${color.dim(n.path)}${n.note ? `  ${color.yellow(n.note)}` : ""}\n`);
      });
      if (graph.edges.length) {
        out.write("  enlaces:\n");
        for (const e of graph.edges) {
          out.write(`    ${e.from} -> ${e.to}${e.label ? ` (${e.label})` : ""}\n`);
        }
      }
      return;
    }
    if (sub === "rm" || sub === "remove") {
      if (!name) throw new Error("uso: memex trail rm <nombre>");
      removeTrail(db, name);
      out.write(`${color.green("✓")} Trail ${name} eliminado\n`);
      return;
    }
    throw new Error(`subcomando desconocido: ${sub ?? "(ninguno)"}`);
  } finally {
    db.close();
  }
}

function cmdRelate({ out, color, flags, dbPath }) {
  const ref = flags._.slice(1).join(" ").trim();
  if (!ref) throw new Error("uso: memex relate <ruta|consulta>");
  const limit = Number.isFinite(flags.limit) ? flags.limit : 10;
  const config = loadConfig();
  const embedder = createEmbedder(config);
  const db = openDatabase(dbPath);
  const results = relate(db, ref, { limit, embedder });
  db.close();

  if (flags.json) {
    out.write(JSON.stringify({ ref, results }, null, 2) + "\n");
    return;
  }
  if (!results.length) {
    out.write(`${color.yellow("Sin relaciones")} (indexa con embeddings activados).\n`);
    return;
  }
  out.write(`${color.bold("Documentos relacionados")} con ${color.cyan(ref)}\n`);
  for (const r of results) {
    out.write(`  ${color.green(r.score.toFixed(3))}  ${r.name}  ${color.dim(r.path)}\n`);
  }
}

function shorten(path, max) {
  if (path.length <= max) return path;
  return "…" + path.slice(path.length - max + 1);
}

function highlight(text, color) {
  return text.replace(/\[\[(.+?)\]\]/g, (_, m) => color.yellow(color.bold(m)));
}
