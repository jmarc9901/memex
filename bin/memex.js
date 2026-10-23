#!/usr/bin/env node
// Memex Offline - punto de entrada del CLI.
//
// La version de Node se comprueba ANTES de cargar el resto. El proyecto usa
// `node:sqlite` con FTS5, y el SQLite que trae Node 22.13 no compila FTS5: la
// creacion de `chunks_fts` falla con "no such module: fts5". Node 24 es la
// primera linea con FTS5 disponible en todas las plataformas.
const MIN_NODE = { major: 24, minor: 0 };
const [major, minor] = process.versions.node.split(".").map(Number);

if (major < MIN_NODE.major || (major === MIN_NODE.major && minor < MIN_NODE.minor)) {
  console.error(
    `memex: se requiere Node >= ${MIN_NODE.major}.${MIN_NODE.minor}.0 (tienes v${process.versions.node}).\n` +
      `       node:sqlite incluye FTS5 a partir de Node 24; en versiones anteriores el indice no se puede crear.`
  );
  process.exit(1);
}

let run;
try {
  ({ run } = await import("../src/cli.js"));
} catch (err) {
  // Caso residual: un build sin node:sqlite o con el flag aun obligatorio.
  if (/node:sqlite/i.test(String(err?.message ?? ""))) {
    console.error(
      "memex: no se pudo cargar node:sqlite. Actualiza Node a >= 24.0.0 " +
        "(las versiones anteriores no incluyen FTS5)."
    );
    process.exit(1);
  }
  throw err;
}

run(process.argv.slice(2)).catch((err) => {
  console.error("memex: " + err.message);
  process.exit(1);
});
