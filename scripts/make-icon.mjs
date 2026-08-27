// Generate PNG sumber sederhana (kotak brand) untuk `tauri icon`.
// Tanpa dependency: tulis PNG RGBA 1024x1024 manual + zlib deflate.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SIZE = 1024;
// Brand navy #0000A8 dengan glyph gelap di tengah agar tidak polos.
const bg = [0, 0, 168, 255];
const fg = [12, 12, 28, 255];

function px(x, y) {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r = SIZE * 0.28;
  const d = Math.hypot(x - cx, y - cy);
  // Glyph "P": batang + kepala membulat (disederhanakan jadi cincin).
  const ring = d < r && d > r * 0.55;
  const bar = x > cx - r * 0.62 && x < cx - r * 0.35 && y > cy - r && y < cy + r;
  return ring || bar ? fg : bg;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// Raw scanlines (filter byte 0 per row)
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
let o = 0;
for (let y = 0; y < SIZE; y++) {
  raw[o++] = 0;
  for (let x = 0; x < SIZE; x++) {
    const [r, g, b, a] = px(x, y);
    raw[o++] = r;
    raw[o++] = g;
    raw[o++] = b;
    raw[o++] = a;
  }
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = process.argv[2] || "apps/desktop/icons/source.png";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
