// Pure PNG alpha-bbox reader: tight bounding box of pixels with alpha > 0.
// Supports 8-bit non-interlaced color types 6 (RGBA), 4 (gray+alpha),
// 2/0 (no alpha -> full extent). node:zlib only; no deps.
import zlib from 'node:zlib';

// Decode a PNG's alpha channel: { w, h, alpha: Uint8Array(w*h) }.
// Color types 2/0 (no alpha) -> all 255. Same support matrix as alphaBBoxFromBuffer.
export function decodeAlpha(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const bitDepth = buf[24], colorType = buf[25], interlace = buf[28];
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');
  if (colorType === 2 || colorType === 0) return { w, h, alpha: new Uint8Array(w * h).fill(255) };
  if (colorType !== 6 && colorType !== 4) throw new Error(`unsupported color type ${colorType}`);
  const bpp = colorType === 6 ? 4 : 2;
  let off = 8, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const alpha = new Uint8Array(w * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const fOff = y * (stride + 1), filter = raw[fOff];
    const line = raw.subarray(fOff + 1, fOff + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      line[i] = v;
    }
    for (let x = 0; x < w; x++) alpha[y * w + x] = line[x * bpp + bpp - 1];
    prev = line;
  }
  return { w, h, alpha };
}

export function alphaBBoxFromBuffer(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const colorType = buf[25];
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  if (colorType === 2 || colorType === 0) {
    // validate header constraints the same way decodeAlpha does
    if (buf[24] !== 8) throw new Error(`unsupported bit depth ${buf[24]}`);
    if (buf[28] !== 0) throw new Error('interlaced PNG unsupported');
    return { x: 0, y: 0, w, h };
  }
  const d = decodeAlpha(buf);
  let minX = d.w, minY = d.h, maxX = -1, maxY = -1;
  for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
    if (d.alpha[y * d.w + x] > 0) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function alphaBBoxFromFile(fs, file) {
  return alphaBBoxFromBuffer(fs.readFileSync(file));
}
