#!/usr/bin/env node
// Memex Offline - genera los iconos PNG de la extension sin dependencias.
//
// Chrome exige PNG reales; este script los dibuja por codigo (lupa verde sobre
// fondo redondeado) y los codifica con `node:zlib`. Asi el repositorio no
// depende de ninguna herramienta de diseno para regenerarlos:
//
//   node scripts/make-icons.js
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "extension", "icons");
const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;

// --- CRC32 (PNG) -----------------------------------------------------------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Codifica pixeles RGBA (Uint8Array, size*size*4) como PNG. */
function encodePng(size, pixels) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filtro "none"
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Dibujo ----------------------------------------------------------------

const BG = [15, 17, 21];
const ACCENT = [76, 195, 138];

function roundedRect(x, y, halfW, halfH, radius) {
  const dx = Math.abs(x) - (halfW - radius);
  const dy = Math.abs(y) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

function capsule(x, y, ax, ay, bx, by, halfWidth) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(x - (ax + t * vx), y - (ay + t * vy)) - halfWidth;
}

/** Color RGBA de un punto en coordenadas [0,1]. */
function shade(x, y) {
  if (roundedRect(x - 0.5, y - 0.5, 0.5, 0.5, 0.22) > 0) return [0, 0, 0, 0];
  const ring = Math.abs(Math.hypot(x - 0.44, y - 0.44) - 0.2) - 0.048;
  const handle = capsule(x, y, 0.585, 0.585, 0.76, 0.76, 0.05);
  return Math.min(ring, handle) <= 0 ? [...ACCENT, 255] : [...BG, 255];
}

function render(size) {
  const pixels = new Uint8Array(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const [cr, cg, cb, ca] = shade(
            (px + (sx + 0.5) / SUPERSAMPLE) / size,
            (py + (sy + 0.5) / SUPERSAMPLE) / size
          );
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const at = (py * size + px) * 4;
      pixels[at] = a ? Math.round(r / a) : 0;
      pixels[at + 1] = a ? Math.round(g / a) : 0;
      pixels[at + 2] = a ? Math.round(b / a) : 0;
      pixels[at + 3] = Math.round(a / samples);
    }
  }
  return encodePng(size, pixels);
}

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT, `icon${size}.png`);
  writeFileSync(file, render(size));
  process.stdout.write(`✓ ${file}\n`);
}
