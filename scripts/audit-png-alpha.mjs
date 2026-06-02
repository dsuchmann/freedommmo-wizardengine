import fs from 'fs';
import zlib from 'zlib';

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function readPngRgba(path) {
  const buf = fs.readFileSync(path);
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Not a PNG: ' + path);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`Unsupported PNG ${path}: bit=${bitDepth} colorType=${colorType}`);
  const idats = [];
  let pos = 8;
  while (pos < buf.length - 12) {
    const len = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString('ascii');
    if (type === 'IDAT') idats.push(buf.slice(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let inPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[inPos++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const rawVal = raw[inPos++];
      const left = x >= bpp ? out[rowStart + x - bpp] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[prevStart + x - bpp] : 0;
      let val;
      if (filter === 0) val = rawVal;
      else if (filter === 1) val = rawVal + left;
      else if (filter === 2) val = rawVal + up;
      else if (filter === 3) val = rawVal + Math.floor((left + up) / 2);
      else if (filter === 4) val = rawVal + paeth(left, up, upLeft);
      else throw new Error('Unsupported PNG filter ' + filter + ' in ' + path);
      out[rowStart + x] = val & 255;
    }
  }
  return { width, height, data: out };
}

export function alphaStats(path) {
  const png = readPngRgba(path);
  let opaque = 0, semi = 0, transparent = 0;
  for (let i = 3; i < png.data.length; i += 4) {
    const a = png.data[i];
    if (a === 0) transparent++;
    else if (a === 255) opaque++;
    else semi++;
  }
  return { path, width: png.width, height: png.height, opaque, semi, transparent, total: png.width * png.height, bytes: fs.statSync(path).size };
}

if (process.argv[2]) {
  for (const path of process.argv.slice(2)) console.log(JSON.stringify(alphaStats(path), null, 2));
}
