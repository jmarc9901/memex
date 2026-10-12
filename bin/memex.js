#!/usr/bin/env node
// Memex Offline - punto de entrada del CLI.
//
// La version de Node se comprueba ANTES de cargar el resto: el proyecto usa
// `node:sqlite`, que solo dejo de exigir el flag `--experimental-sqlite` en
// Node 22.13.0 (y 23.4.0 en la linea 23). Sin esta guardia, en versiones
// anteriores el usuario veria un "Cannot find module 'node:sqlite'" opaco.
const MIN_NODE = { major: 22, minor: 13 };
const [major, minor] = process.versions.node.split(".").map(Number);

if (major < MIN_NODE.major || (major === MIN_NODE.major && minor < MIN_NODE.minor)) {
  console.error(
    `memex: se requiere Node >= ${MIN_NODE.major}.${MIN_NODE.minor}.0 (tienes v${process.versions.node}).\n` +
      `       Antes de 22.13 (23.4 en la linea 23) node:sqlite solo carga con --experimental-sqlite.`
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
      "memex: no se pudo cargar node:sqlite. Actualiza Node a >= 22.13.0 " +
        "o arranca de nuevo con --experimental-sqlite."
    );
    process.exit(1);
  }
  throw err;
}

run(process.argv.slice(2)).catch((err) => {
  console.error("memex: " + err.message);
  process.exit(1);
});
