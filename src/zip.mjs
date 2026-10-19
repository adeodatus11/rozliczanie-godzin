// Skopiowane z repozytorium zastepstwa (src/lib/update/zip.mjs).
// Minimalny odczyt i zapis ZIP (format XLSX) na wbudowanych strumieniach
// przeglądarki. Bez bibliotek: strona aktualizacji nie może ciągnąć parsera
// XLSX do wspólnych skryptów serwisu (test budżetu w model.test.mjs).

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function pipe(bytes, stream) {
  const out = await new Response(
    new Blob([bytes]).stream().pipeThrough(stream),
  ).arrayBuffer();
  return new Uint8Array(out);
}

let crcTable;
function crc32(bytes) {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zwraca listę plików archiwum w oryginalnej kolejności: [{name, bytes, time, date}]. */
export async function readZip(input) {
  const b = new Uint8Array(input);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--)
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw Error("To nie jest plik XLSX (brak katalogu ZIP).");
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const files = [];
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw Error("Uszkodzony katalog ZIP.");
    const method = u16(b, p + 10),
      time = u16(b, p + 12),
      date = u16(b, p + 14);
    const size = u32(b, p + 20),
      nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30),
      commentLen = u16(b, p + 32),
      offset = u32(b, p + 42);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    if (u32(b, offset) !== 0x04034b50)
      throw Error(`Uszkodzony wpis ZIP: ${name}`);
    const start = offset + 30 + u16(b, offset + 26) + u16(b, offset + 28);
    const raw = b.subarray(start, start + size);
    let bytes;
    if (method === 0) bytes = raw.slice();
    else if (method === 8)
      bytes = await pipe(raw, new DecompressionStream("deflate-raw"));
    else throw Error(`Nieobsługiwana kompresja ZIP (${method}) w ${name}`);
    files.push({ name, bytes, time, date });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** Składa archiwum z listy [{name, bytes, time?, date?}]. */
export async function writeZip(files) {
  const parts = [],
    central = [];
  let offset = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    const data = await pipe(f.bytes, new CompressionStream("deflate-raw"));
    const crc = crc32(f.bytes),
      time = f.time ?? 0,
      date = f.date ?? 0x21;
    const local = new Uint8Array(30 + name.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 8, true);
    dv.setUint16(10, time, true);
    dv.setUint16(12, date, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, f.bytes.length, true);
    dv.setUint16(26, name.length, true);
    dv.setUint16(28, 0, true);
    local.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 8, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, f.bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(local, data);
    central.push(entry);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((s, e) => s + e.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...parts, ...central, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
