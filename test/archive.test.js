import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, gzipSync } from "node:zlib";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readZip, isZip, gunzipText } from "../src/archive.js";
import { extractArchive, extractText, SUPPORTED_EXTENSIONS } from "../src/extract.js";

/** Construye un ZIP minimo y valido (metodo 0 = almacenado, 8 = deflate). */
function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.deflate ? deflateRawSync(entry.data) : entry.data;
    const method = entry.deflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(0, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(entry.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);

    locals.push(local, name, data);
    central.push(dir, name);
    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

test("isZip detecta la firma y readZip devuelve las entradas", () => {
  const zip = makeZip([
    { name: "a.txt", data: Buffer.from("hola zip"), deflate: false },
    { name: "sub/b.md", data: Buffer.from("contenido deflate repetido ".repeat(20)), deflate: true },
  ]);
  assert.equal(isZip(zip), true);
  assert.equal(isZip(Buffer.from("no soy un zip")), false);

  const entries = readZip(zip);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, "a.txt");
  assert.equal(entries[0].data.toString("utf8"), "hola zip");
  assert.equal(entries[1].name, "sub/b.md");
  assert.match(entries[1].data.toString("utf8"), /contenido deflate/);
});

test("readZip omite directorios, cifrado y respeta los limites", () => {
  const zip = makeZip([
    { name: "dir/", data: Buffer.alloc(0), deflate: false },
    { name: "big.txt", data: Buffer.from("x".repeat(500)), deflate: false },
    { name: "ok.txt", data: Buffer.from("ok"), deflate: false },
  ]);
  const names = readZip(zip).map((e) => e.name);
  assert.deepEqual(names, ["big.txt", "ok.txt"]);

  // maxBytes descarta la entrada grande
  const limited = readZip(zip, { maxBytes: 100 }).map((e) => e.name);
  assert.deepEqual(limited, ["ok.txt"]);

  assert.throws(() => readZip(Buffer.from("nope")), /ZIP/);
});

test("gunzipText descomprime un .gz de texto", () => {
  const gz = gzipSync(Buffer.from("hola gzip"));
  assert.equal(gunzipText(gz), "hola gzip");
  assert.equal(gunzipText(Buffer.from("no gzip")), null);
});

test("las extensiones de archivo estan soportadas", () => {
  assert.ok(SUPPORTED_EXTENSIONS.has(".zip"));
  assert.ok(SUPPORTED_EXTENSIONS.has(".gz"));
});

test("extractArchive indexa el texto de un ZIP y omite lo binario", () => {
  const root = mkdtempSync(join(tmpdir(), "memex-zip-"));
  try {
    const zip = makeZip([
      { name: "notas.md", data: Buffer.from("# Notas\n\nHable de ansiedad."), deflate: true },
      { name: "script.py", data: Buffer.from("def buscar(texto):\n    return texto"), deflate: true },
      { name: "logo.png", data: Buffer.from([137, 80, 78, 71, 0, 1, 2]), deflate: false },
      { name: "vacio.txt", data: Buffer.from("   "), deflate: false },
    ]);
    const zipPath = join(root, "paquete.zip");
    writeFileSync(zipPath, zip);

    const res = extractText(zipPath);
    assert.equal(res.extractor, "zip");
    assert.match(res.text, /notas\.md/);
    assert.match(res.text, /ansiedad/);
    assert.match(res.text, /script\.py/);
    assert.doesNotMatch(res.text, /logo\.png/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extractArchive indexa un .gz de texto y omite binarios", () => {
  const root = mkdtempSync(join(tmpdir(), "memex-gz-"));
  try {
    const gzPath = join(root, "log.txt.gz");
    writeFileSync(gzPath, gzipSync(Buffer.from("linea de registro con ansiedad")));
    const res = extractArchive(gzPath, ".gz");
    assert.equal(res.extractor, "gzip");
    assert.match(res.text, /ansiedad/);

    const binPath = join(root, "data.bin.gz");
    writeFileSync(binPath, gzipSync(Buffer.from([0, 1, 2, 3, 0])));
    assert.equal(extractArchive(binPath, ".gz"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extractArchive devuelve null para un ZIP sin texto indexable", () => {
  const root = mkdtempSync(join(tmpdir(), "memex-zip2-"));
  try {
    const zipPath = join(root, "solo-bin.zip");
    writeFileSync(zipPath, makeZip([{ name: "a.png", data: Buffer.from([137, 80, 78, 71]), deflate: false }]));
    assert.equal(extractArchive(zipPath, ".zip"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
