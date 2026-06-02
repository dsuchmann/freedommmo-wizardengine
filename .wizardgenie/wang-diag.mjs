import fs from 'fs';
import zlib from 'zlib';

const txt = fs.readFileSync('src/assets/catalog-wang-terrain-defs.js', 'utf8');
const defs = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
const biomes = ['grassland','forest','dense_forest','tropical_forest','taiga','savanna','steppe','desert','swamp','tundra','arctic','hills','mountains','volcanic','mystic','beach','ocean','shallow_water','river','lake','deep_ocean'];

console.log('=== WANG TILE INVENTORY ===\n');
for (const b of biomes) {
  const w = defs[b];
  if (!w) {
    console.log(b + ': MISSING - no catalog entry');
    continue;
  }
  let count = 0;
  try {
    const buf = fs.readFileSync(w.dir + '/wang_15.png');
    let pos = 8;
    while (pos < buf.length - 4) {
      const len = buf.readUInt32BE(pos);
      if (buf.slice(pos + 4, pos + 8).toString() === 'IDAT') {
        const raw = zlib.inflateSync(buf.slice(pos + 8, pos + 8 + len));
        let opaque = 0;
        for (let i = 0; i < 1024; i++) {
          if (raw[Math.floor(i / 32) * 129 + 1 + (i % 32) * 4 + 3] > 128) opaque++;
        }
        count = opaque;
        break;
      }
      pos += 12 + len;
    }
  } catch (e) { /* skip */ }
  const status = count < 10 ? 'PLACEHOLDER (0-9 opaque px)' : 'HAS CONTENT (' + count + ' opaque px)';
  console.log(b + ': ' + w.dir + ' - ' + status);
}
console.log('\nBiomes WITH entries: ' + biomes.filter(b => defs[b]).join(', '));
console.log('Biomes WITHOUT entries: ' + biomes.filter(b => !defs[b]).join(', '));
