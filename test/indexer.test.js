import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, search as ftsSearch, stats } from "../src/db.js";
import { buildMatch } from "../src/query.js";
import { indexFolder, indexFolderAsync } from "../src/indexer.js";

function makeRoot(name = "memex-index-") {
  return mkdtempSync(join(tmpdir(), name));
}

test("reindexar elimina del indice los archivos borrados del disco", () => {
  const root = makeRoot();
  const db = openDatabase(join(root, ".memex", "index.db"));
  try {
    writeFileSync(join(root, "notas.md"), "ansiedad y proyecto X");
    writeFileSync(join(root, "receta.txt"), "tarta de manzana");
    assert.equal(indexFolder(db, root).added, 2);

    rmSync(join(root, "notas.md"));
    const summary = indexFolder(db, root);

    assert.equal(summary.pruned, 1, "debe contar el archivo eliminado");
    assert.equal(stats(db).files, 1);
    assert.equal(stats(db).chunks, 1);
    assert.equal(ftsSearch(db, buildMatch("ansiedad")).length, 0, "no debe quedar texto muerto");
    assert.equal(ftsSearch(db, buildMatch("manzana")).length, 1);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("la poda solo afecta a la carpeta que se esta indexando", () => {
  const tmp = makeRoot();
  const rootA = join(tmp, "a");
  const rootB = join(tmp, "b");
  mkdirSync(rootA);
  mkdirSync(rootB);
  writeFileSync(join(rootA, "a.md"), "contenido de la carpeta a");
  writeFileSync(join(rootB, "b.md"), "contenido de la carpeta b");

  const db = openDatabase(join(tmp, "shared.db"));
  try {
    indexFolder(db, rootA);
    indexFolder(db, rootB);
    assert.equal(stats(db).files, 2);

    rmSync(join(rootA, "a.md"));
    const summary = indexFolder(db, rootA);

    assert.equal(summary.pruned, 1);
    assert.equal(stats(db).files, 1, "la carpeta B no se toca");
    assert.equal(ftsSearch(db, buildMatch("carpeta")).length, 1);
  } finally {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("prune:false conserva los archivos borrados (opt-out explicito)", () => {
  const root = makeRoot();
  const db = openDatabase(join(root, ".memex", "index.db"));
  try {
    writeFileSync(join(root, "a.md"), "hola");
    indexFolder(db, root);
    rmSync(join(root, "a.md"));

    const summary = indexFolder(db, root, { prune: false });
    assert.equal(summary.pruned, 0);
    assert.equal(stats(db).files, 1);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("indexar una ruta inexistente o un archivo suelto es un error claro", () => {
  const root = makeRoot();
  const db = openDatabase(join(root, "index.db"));
  try {
    assert.throws(() => indexFolder(db, join(root, "no-existe")), /no existe la carpeta/);
    const file = join(root, "suelto.txt");
    writeFileSync(file, "x");
    assert.throws(() => indexFolder(db, file), /no es una carpeta/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("indexFolderAsync produce el mismo resumen y tambien poda", async () => {
  const root = makeRoot("memex-async-");
  const db = openDatabase(join(root, ".memex", "index.db"));
  try {
    writeFileSync(join(root, "a.md"), "ansiedad");
    writeFileSync(join(root, "b.md"), "receta");
    const first = await indexFolderAsync(db, root);
    assert.equal(first.added, 2);

    rmSync(join(root, "b.md"));
    const second = await indexFolderAsync(db, root);
    assert.equal(second.pruned, 1);
    assert.equal(second.unchanged, 1);
    assert.equal(stats(db).files, 1);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
