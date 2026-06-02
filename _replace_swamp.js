const fs = require('fs');
const c = fs.readFileSync('src/render/tile-painter.js', 'utf8');
const start = c.indexOf('// Procedural swamp enrichment.');
const restorePos = c.indexOf('  ctx.restore();', start);
const funcEnd = c.indexOf('}', restorePos) + 1;
const oldBlock = c.substring(start, funcEnd);

const newBlock = `  // High-density environmental decoration: procedurally draw many small varied
  // objects that feel contextual to the swamp — reeds, mud cracks, hummocks,
  // puddles, root traces, mushrooms, pebbles. All sub-tile scale (2-8px).
  const wetness = clamp((moisture - 0.48) / 0.42, 0, 1);
  const mossiness = clamp(density * 0.72 + wetness * 0.28, 0, 1);
  const baseSeed = tile.wx * 313 + tile.wy * 997;
  const objCount = Math.floor(6 + density * 6 + wetness * 4 + rand2(tile.wx, tile.wy, 16101) * 4);

  for (let i = 0; i < objCount; i++) {
    const seed = baseSeed + i * 37;
    const objType = (seed + Math.floor(i * 7.3)) % 10;
    const px = sx + Math.floor(rand2(tile.wx, tile.wy, 16102 + i * 7) * (size - 6)) + 3;
    const py = sy + Math.floor(rand2(tile.wx, tile.wy, 16103 + i * 7) * (size - 6)) + 3;

    // 0-2: Reed/cattail stalk — thin vertical green line with brown top
    if (objType < 3 && density > 0.15) {
      const h = 3 + Math.floor(rand2(tile.wx, tile.wy, 16110 + i) * 6);
      const brown = rand2(tile.wx, tile.wy, 16111 + i) > 0.55;
      ctx.strokeStyle = brown ? \`rgba(80, 62, 28, \${(0.28 + wetness * 0.14).toFixed(3)})\` : \`rgba(50, 115, 42, \${(0.22 + wetness * 0.14).toFixed(3)})\`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py + h);
      ctx.lineTo(px + (brown ? 1 : 0), py);
      ctx.stroke();
      if (brown) {
        ctx.fillStyle = \`rgba(60, 42, 18, 0.22)\`;
        ctx.fillRect(px - 1, py - 1, 3, 2);
      }
      continue;
    }

    // 3-4: Mud crack — short dark jagged line
    if (objType < 5 && wetness < 0.65) {
      const len = 2 + Math.floor(rand2(tile.wx, tile.wy, 16120 + i) * 4);
      ctx.strokeStyle = \`rgba(18, 22, 16, \${(0.20 + (1 - wetness) * 0.16).toFixed(3)})\`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      const dx = Math.floor(rand2(tile.wx, tile.wy, 16121 + i) * len) - Math.floor(len * 0.4);
      const dy = Math.floor(rand2(tile.wx, tile.wy, 16122 + i) * len) - Math.floor(len * 0.4);
      ctx.lineTo(px + dx, py + dy);
      if (rand2(tile.wx, tile.wy, 16123 + i) > 0.6) {
        ctx.moveTo(px + dx, py + dy);
        ctx.lineTo(px + dx + Math.floor(dx * 0.5), py + dy - Math.floor(dy * 0.4));
      }
      ctx.stroke();
      continue;
    }

    // 5: Moss hummock — small rounded green patch
    if (objType === 5 && mossiness > 0.22) {
      const w = 2 + Math.floor(rand2(tile.wx, tile.wy, 16130 + i) * 4);
      const h = 1 + Math.floor(rand2(tile.wx, tile.wy, 16131 + i) * 2);
      ctx.fillStyle = \`rgba(52, 108, 44, \${(0.16 + mossiness * 0.16).toFixed(3)})\`;
      ctx.fillRect(px, py, w, h);
      ctx.fillStyle = \`rgba(68, 128, 52, \${(0.10 + mossiness * 0.14).toFixed(3)})\`;
      ctx.fillRect(px, py, w - 1, h - 1);
      continue;
    }

    // 6: Dark wet puddle — small oval dark patch
    if (objType === 6 && wetness > 0.28) {
      const w = 2 + Math.floor(rand2(tile.wx, tile.wy, 16140 + i) * 4);
      const h = 1 + Math.floor(rand2(tile.wx, tile.wy, 16141 + i) * 2);
      ctx.fillStyle = \`rgba(18, 30, 26, \${(0.18 + wetness * 0.20).toFixed(3)})\`;
      ctx.beginPath();
      ctx.ellipse(px + w / 2, py + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    // 7: Root trace — thin brown line along ground
    if (objType === 7 && density > 0.30) {
      const len = 3 + Math.floor(rand2(tile.wx, tile.wy, 16150 + i) * 5);
      ctx.strokeStyle = \`rgba(38, 28, 18, \${(0.14 + density * 0.12).toFixed(3)})\`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + len, py + Math.floor(rand2(tile.wx, tile.wy, 16151 + i) * 2) - 1);
      if (rand2(tile.wx, tile.wy, 16152 + i) > 0.55) {
        ctx.moveTo(px + Math.floor(len * 0.5), py);
        ctx.lineTo(px + Math.floor(len * 0.5) - 1, py - 2);
      }
      ctx.stroke();
      continue;
    }

    // 8: Tiny mushroom — rare, small cap on stalk
    if (objType === 8 && density > 0.45 && rand2(tile.wx, tile.wy, 16160 + i) > 0.50) {
      const stalkH = 2 + Math.floor(rand2(tile.wx, tile.wy, 16161 + i) * 2);
      ctx.strokeStyle = \`rgba(48, 38, 28, 0.18)\`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py + stalkH);
      ctx.lineTo(px, py + 1);
      ctx.stroke();
      ctx.fillStyle = \`rgba(168, 68, 48, 0.20)\`;
      ctx.fillRect(px - 2, py - 1, 4, 2);
      continue;
    }

    // 9: Organic fleck — tiny dark speck
    if (objType === 9) {
      ctx.fillStyle = \`rgba(10, 17, 14, \${(0.12 + wetness * 0.14).toFixed(3)})\`;
      ctx.fillRect(px, py, 1 + Math.floor(rand2(tile.wx, tile.wy, 16170 + i) * 3), 1);
      continue;
    }
  }

  // Puddle glint — one per tile, subtle light reflection
  if (wetness > 0.38 && rand2(tile.wx, tile.wy, 16180) < wetness * 0.66) {
    ctx.strokeStyle = \`rgba(158, 180, 137, \${(0.10 + wetness * 0.08).toFixed(3)})\`;
    ctx.lineWidth = 1;
    const gx = sx + Math.floor(rand2(tile.wx, tile.wy, 16181) * (size - 8)) + 4;
    const gy = sy + Math.floor(rand2(tile.wx, tile.wy, 16182) * (size - 6)) + 3;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + Math.floor(size * 0.22), gy - 1);
    ctx.stroke();
  }`;

console.log('Old block length:', oldBlock.length);
console.log('New block length:', newBlock.length);

const result = c.replace(oldBlock, newBlock);
fs.writeFileSync('src/render/tile-painter.js', result);
console.log('Replacement done. File length:', result.length);
