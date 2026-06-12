// Pure PNG alpha-bbox reader: tight bounding box of pixels with alpha > 0.
// Supports 8-bit non-interlaced color types 6 (RGBA), 4 (gray+alpha),
// 2/0 (no alpha -> full extent). node:zlib only; no deps.
import zlib from 'node:zlib';

export function alphaBBoxFromBuffer(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const bitDepth = buf[24], colorType = buf[25], interlace = buf[28];
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');
  if (colorType === 2 || colorType === 0) return { x: 0, y: 0, w, h }; // no alpha channel
  if (colorType !== 6 && colorType !== 4) throw new Error(`unsupported color type ${colorType}`);
  const bpp = colorType === 6 ? 4 : 2; // bytes/pixel; alpha is the last byte

  // concat IDAT chunks
  let off = 8, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));

  // unfilter scanlines (filters 0-4) and scan alpha in one pass
  const stride = w * bpp;
  let prev = Buffer.alloc(stride);
  let minX = w, minY = h, maxX = -1, maxY = -1;
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
    for (let x = 0; x < w; x++) {
      if (line[x * bpp + bpp - 1] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    prev = line;
  }
  if (maxX < 0) return null; // fully transparent
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function alphaBBoxFromFile(fs, file) {
  return alphaBBoxFromBuffer(fs.readFileSync(file));
}
