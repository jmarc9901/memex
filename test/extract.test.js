import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { walkFiles, extractText, SUPPORTED_EXTENSIONS } from "../src/extract.js";
import { ocrAvailable } from "../src/ocr.js";
import { whisperAvailable, whisperModel } from "../src/media.js";

test("las extensiones de imagen y medios son soportadas", () => {
  for (const ext of [".png", ".jpg", ".pdf", ".mp3", ".mp4", ".md", ".py"]) {
    assert.ok(SUPPORTED_EXTENSIONS.has(ext), `${ext} deberia estar soportada`);
  }
});

test("walkFiles recorre subcarpetas y salta las ignoradas", () => {
  const root = mkdtempSync(join(tmpdir(), "memex-walk-"));
  try {
    writeFileSync(join(root, "a.md"), "hola");
    writeFileSync(join(root, "b.png"), Buffer.from([137, 80, 78, 71]));
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules", "c.js"), "console.log(1)");
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "d.txt"), "mundo");

    const files = walkFiles(root).map((p) => p.replace(root, ""));
    assert.ok(files.some((f) => f.endsWith("a.md")));
    assert.ok(files.some((f) => f.endsWith("d.txt")));
    assert.ok(!files.some((f) => f.includes("node_modules")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("OCR y transcripcion degradan con gracia si faltan las herramientas", () => {
  const root = mkdtempSync(join(tmpdir(), "memex-media-"));
  try {
    const img = join(root, "foto.png");
    writeFileSync(img, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const audio = join(root, "nota.mp3");
    writeFileSync(audio, Buffer.from([0xff, 0xfb, 0x90, 0x00]));

    if (!ocrAvailable()) {
      assert.equal(extractText(img), null, "sin tesseract, la imagen se omite");
    } else {
      const res = extractText(img);
      // con tesseract presente puede haber o no texto en un PNG invalido
      assert.ok(res === null || res.extractor === "ocr");
    }

    if (!whisperAvailable() || !whisperModel()) {
      assert.equal(extractText(audio), null, "sin whisper/modelo, el audio se omite");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
