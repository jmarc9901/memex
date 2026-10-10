// Memex Offline - lectura de archivos comprimidos (ZIP y gzip) sin dependencias.
//
// Solo leemos lo necesario del formato ZIP: el End Of Central Directory, las
// entradas del directorio central y los datos de cada entrada (metodo 0 =
// almacenado, 8 = deflate). Se ignoran entradas de directorio, cifradas y de
// metodos no soportados.
import { inflateRawSync, gunzipSync } from "node:zlib";

export const ARCHIVE_EXTENSIONS = new Set([".zip", ".gz"]);
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024; // tamano descomprimido total
export const MAX_ENTRIES = 5000;

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

/** ¿El buffer empieza con la firma de un ZIP? */
export function isZip(buf) {
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    ((buf[2] === 0x03 && buf[3] === 0x04) || (buf[2] === 0x05 && buf[3] === 0x06))
  );
}

/** Localiza el End Of Central Directory (los comentarios pueden tener firma). */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Lee las entradas de un ZIP y devuelve sus datos ya descomprimidos.
 * @param {Buffer} buf
 * @param {{maxBytes?:number, maxEntries?:number}} [opts]
 * @returns {Array<{name:string, data:Buffer}>}
 */
export function readZip(buf, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_ARCHIVE_BYTES;
  const maxEntries = opts.maxEntries ?? MAX_ENTRIES;
  if (!isZip(buf)) throw new Error("no es un ZIP valido");

  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("no se encontro el directorio del ZIP");

  const total = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  let used = 0;

  for (let i = 0; i < total && entries.length < maxEntries; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL_SIG) break;

    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // entrada de directorio
    if (flags & 0x1) continue; // cifrado
    if (uncompressedSize > maxBytes || used + uncompressedSize > maxBytes) continue;

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > buf.length) continue;

    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    let data;
    try {
      if (method === 0) data = Buffer.from(raw);
      else if (method === 8) data = inflateRawSync(raw);
      else continue; // metodo no soportado (bzip2, lzma, zstd...)
    } catch {
      continue; // datos corruptos: saltamos la entrada
    }

    used += data.length;
    entries.push({ name, data });
  }

  return entries;
}

/**
 * Descomprime un archivo .gz de un unico contenido.
 * @param {Buffer} buf
 * @returns {string|null}
 */
export function gunzipText(buf) {
  try {
    return gunzipSync(buf).toString("utf8");
  } catch {
    return null;
  }
}
