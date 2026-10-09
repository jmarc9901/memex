import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildMatch } from "../src/query.js";
import { chunkText } from "../src/extract.js";
import { openDatabase, search, stats, deleteFile } from "../src/db.js";
import { indexFolder } from "../src/indexer.js";

test("buildMatch une terminos con AND por defecto", () => {
  assert.equal(buildMatch("ansiedad proyecto"), "ansiedad AND proyecto");
});

test("buildMatch soporta OR y prefijos", () => {
  assert.equal(buildMatch("foo bar", { any: true }), "foo OR bar");
  assert.equal(buildMatch("proy*"), "proy*");
});

test("buildMatch respeta frases entre comillas y limpia puntuacion", () => {
  assert.equal(buildMatch('"proyecto x" 2024?'), '"proyecto x" AND 2024');
});

test("buildMatch rechaza consultas vacias", () => {
  assert.throws(() => buildMatch("   "), /vacia/);
});

test("chunkText divide por parrafos y respeta el tamano", () => {
  const text = Array.from({ length: 120 }, (_, i) => `Parrafo ${i} con contenido suficiente.`).join("\n\n");
  const chunks = chunkText(text);
  assert.ok(chunks.length > 1, "deberia producir varios chunks");
  for (const c of chunks) assert.ok(c.length <= 1600, "chunk demasiado grande");
});

function makeCorpus() {
  const root = mkdtempSync(join(tmpdir(), "memex-"));
  writeFileSync(join(root, "notas.md"), "# Notas\n\nHoy hable de ansiedad y de como me sentia.\n");
  writeFileSync(join(root, "diario.txt"), "Cancion favorita: la del verano.\n\nProyecto X conclusiones 2024.\n");
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "sub", "codigo.py"), "# script en python\ndef buscar(texto):\n    return texto\n");
  // archivo binario: no debe indexarse
  writeFileSync(join(root, "binario.dat"), Buffer.from([0, 1, 2, 3]));
  // extension no soportada
  writeFileSync(join(root, "imagen.png"), Buffer.from([137, 80, 78, 71]));
  return root;
}

test("indexa, busca (con acentos) y reporta estadisticas", () => {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  try {
    const summary = indexFolder(db, root);
    assert.equal(summary.added, 3, "debe indexar los 3 archivos de texto");

    const s = stats(db);
    assert.equal(s.files, 3);

    // coincidencia exacta
    const r1 = search(db, buildMatch("ansiedad"));
    assert.equal(r1.length, 1);
    assert.equal(r1[0].name, "notas.md");
    assert.match(r1[0].snippet, /\[\[ansiedad\]\]/);

    // insensible a acentos: "cancion" encuentra "Canción"
    const r2 = search(db, buildMatch("cancion"));
    assert.equal(r2.length, 1);
    assert.equal(r2[0].name, "diario.txt");

    // frase
    const r3 = search(db, buildMatch('"proyecto x"'));
    assert.equal(r3.length, 1);

    // OR
    const r4 = search(db, buildMatch("ansiedad python", { any: true }));
    assert.equal(r4.length, 2);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("el indexado es incremental (no reindexa sin cambios)", () => {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  try {
    indexFolder(db, root);
    const second = indexFolder(db, root);
    assert.equal(second.unchanged, 3);
    assert.equal(second.added, 0);

    // forzar reindexado
    const forced = indexFolder(db, root, { force: true });
    assert.equal(forced.updated, 3);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("eliminar un archivo borra sus chunks y resultados", () => {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  try {
    indexFolder(db, root);
    const path = join(root, "notas.md");
    deleteFile(db, path);
    assert.equal(search(db, buildMatch("ansiedad")).length, 0);
    assert.equal(stats(db).files, 2);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
