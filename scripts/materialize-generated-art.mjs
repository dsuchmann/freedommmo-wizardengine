/* global Buffer */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import zlib from 'node:zlib';

const seedSheets = [
  { output: 'assets/generated/terrain/terrain_micro_layers_v1.png', rows: ['grass', 'mystic_grass', 'wildflowers', 'aether_flowers', 'water', 'snow_lichen', 'leaf_litter', 'pebbles'], palette: ['#3f8a34', '#49d6c5', '#ffd6f2', '#8a5bd6', '#8fd8ff', '#d8f0f3', '#73512e', '#9b958d'] },
  { output: 'assets/generated/vegetation/vegetation_objects_v1.png', rows: ['broadleaf', 'mystic_tree', 'conifer', 'burnt', 'frozen', 'waterlogged', 'underbrush', 'glow_shrub'], palette: ['#12391f', '#52309b', '#1f4d38', '#35231f', '#bfe6ee', '#254333', '#315d29', '#49d6c5'] },
  { output: 'assets/generated/geology/geology_objects_v1.png', rows: ['boulder', 'crystal', 'ice_rock', 'ore', 'cave', 'volcanic', 'wet', 'rune'], palette: ['#60666b', '#7fffea', '#c9e5ee', '#b98b45', '#25232a', '#4a2b25', '#7e8c91', '#8a5bd6'] }
];

for (const sheet of seedSheets) writeSheet(sheet.output, sheet.rows, sheet.palette);

const biomes = ['deep_ocean', 'ocean', 'shallow_water', 'beach', 'river', 'lake', 'grassland', 'forest', 'dense_forest', 'tropical_forest', 'taiga', 'savanna', 'steppe', 'desert', 'swamp', 'tundra', 'arctic', 'hills', 'mountains', 'volcanic', 'mystic'];
const biomeColors = {
  deep_ocean: '#123d68', ocean: '#1c5d8f', shallow_water: '#2f83a7', beach: '#d8bd75', river: '#287ca4', lake: '#236f93', grassland: '#5fa64b', forest: '#2f7137', dense_forest: '#1f4e2d', tropical_forest: '#247b3d', taiga: '#315d4c', savanna: '#b3a24c', steppe: '#8f9a54', desert: '#d7a94f', swamp: '#42694a', tundra: '#9fb0aa', arctic: '#c9e5ee', hills: '#827d55', mountains: '#777b82', volcanic: '#4a3f3c', mystic: '#8a5bd6'
};
for (const biome of biomes) {
  writeSheet(`assets/generated/terrain/base/${biome}_base_tiles.png`, Array.from({ length: 8 }, (_, i) => `${biome}_base_${i}`), ramp(biomeColors[biome]));
  writeSheet(`assets/generated/terrain/micro/${biome}_micro_layers.png`, ['soil', 'cover', 'blades', 'flowers', 'debris', 'wet', 'climate', 'special'], ramp(biomeColors[biome]));
  writeSheet(`assets/generated/objects/nature/${biome}_nature_objects.png`, ['tree', 'shrub', 'grass', 'rock', 'log', 'flowers', 'resource', 'special'], ramp(biomeColors[biome]));
}

console.log('Materialized generated PNG art sheets');

function writeSheet(path, rows, palette) {
  const cell = 32, cols = 8, width = cell * cols, height = cell * rows.length;
  const rgba = Buffer.alloc(width * height * 4);
  for (let row = 0; row < rows.length; row++) {
    for (let frame = 0; frame < cols; frame++) drawCell(rgba, width, frame * cell, row * cell, cell, palette[row % palette.length], row, frame, rows[row]);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(width, height, rgba));
}

function drawCell(buf, width, ox, oy, cell, color, row, frame, label) {
  const c = hex(color), dark = shade(c, 0.55), light = shade(c, 1.35), glow = row % 3 === 1;
  const sway = Math.sin((frame / 8) * Math.PI * 2) * 3;
  if (label.includes('water') || label.includes('ocean') || label === 'river' || label === 'lake') {
    ellipse(buf, width, ox + 16, oy + 17, 15, 7, shade(c, 1.12), 190);
    curve(buf, width, ox + 5, oy + 14 + Math.round(sway), ox + 26, oy + 11, light, 180);
    curve(buf, width, ox + 3, oy + 22, ox + 28, oy + 20 + Math.round(sway), light, 110);
    return;
  }
  if (label.includes('tree') || label.includes('broadleaf') || label.includes('conifer') || label.includes('mystic')) {
    ellipse(buf, width, ox + 16, oy + 27, 10, 3, [0,0,0], 70);
    poly(buf, width, [[ox+14,oy+29],[ox+16,oy+14],[ox+20,oy+14],[ox+20,oy+29]], dark, 255);
    for (const b of [[16,10,10],[10,14,7],[22,14,8],[16,18,9],[13,7,6],[21,8,6]]) ellipse(buf, width, ox + b[0] + sway, oy + b[1], b[2], b[2] * 0.8, c, 240);
    if (glow) ellipse(buf, width, ox + 13 + sway, oy + 8, 2, 2, light, 220);
    return;
  }
  if (label.includes('rock') || label.includes('boulder') || label.includes('ore') || label.includes('stone')) {
    ellipse(buf, width, ox + 16, oy + 26, 10, 3, [0,0,0], 70);
    poly(buf, width, [[ox+6,oy+24],[ox+9,oy+16],[ox+15,oy+12],[ox+25,oy+15],[ox+27,oy+23],[ox+17,oy+27]], dark, 255);
    poly(buf, width, [[ox+11,oy+16],[ox+16,oy+13],[ox+23,oy+16],[ox+15,oy+18]], light, 210);
    return;
  }
  if (label.includes('flower')) {
    for (let i = 0; i < 5; i++) {
      const x = ox + 7 + i * 4;
      curve(buf, width, x, oy + 27, x + Math.round(Math.sin(frame + i) * 2), oy + 17, dark, 255);
      ellipse(buf, width, x + 1, oy + 16, 2, 2, light, 255);
    }
    return;
  }
  ellipse(buf, width, ox + 16, oy + 22, 14, 7, shade(c, 0.75), 120);
  for (let i = 0; i < 10; i++) curve(buf, width, ox + 4 + i * 3, oy + 28, ox + 5 + i * 3 + Math.round(sway), oy + 13 + (i % 4), i % 2 ? c : light, 230);
}

function setPx(buf, width, x, y, rgb, a = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= width || y >= buf.length / 4 / width) return;
  const i = (y * width + x) * 4;
  const alpha = a / 255, inv = 1 - alpha;
  buf[i] = rgb[0] * alpha + buf[i] * inv;
  buf[i+1] = rgb[1] * alpha + buf[i+1] * inv;
  buf[i+2] = rgb[2] * alpha + buf[i+2] * inv;
  buf[i+3] = Math.min(255, a + buf[i+3] * inv);
}
function ellipse(buf, w, cx, cy, rx, ry, rgb, a) { for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x*x)/(rx*rx)+(y*y)/(ry*ry)<=1) setPx(buf,w,cx+x,cy+y,rgb,a); }
function curve(buf,w,x1,y1,x2,y2,rgb,a){ for(let t=0;t<=1;t+=0.04){ const x=x1+(x2-x1)*t; const y=y1+(y2-y1)*t-Math.sin(t*Math.PI)*4; setPx(buf,w,x,y,rgb,a); setPx(buf,w,x+1,y,rgb,a*0.7); }}
function poly(buf,w,pts,rgb,a){ const minY=Math.floor(Math.min(...pts.map(p=>p[1]))), maxY=Math.ceil(Math.max(...pts.map(p=>p[1]))); for(let y=minY;y<=maxY;y++){ const xs=[]; for(let i=0,j=pts.length-1;i<pts.length;j=i++){ const [xi,yi]=pts[i], [xj,yj]=pts[j]; if((yi>y)!==(yj>y)) xs.push((xj-xi)*(y-yi)/(yj-yi)+xi); } xs.sort((a,b)=>a-b); for(let k=0;k<xs.length;k+=2) for(let x=Math.floor(xs[k]);x<=Math.ceil(xs[k+1]);x++) setPx(buf,w,x,y,rgb,a); }}
function hex(h){ const n=parseInt(h.slice(1),16); return [(n>>16)&255,(n>>8)&255,n&255]; }
function shade(c,m){ return c.map(v=>Math.max(0,Math.min(255,Math.round(v*m)))); }
function ramp(h){ const c=hex(h); return [shade(c,.7), c, shade(c,1.25), shade(c,.55), shade(c,1.45), shade(c,.85), shade(c,1.1), shade(c,.6)].map(rgb=>'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('')); }

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunks = [chunk('IHDR', ihdr(width, height)), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))];
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), ...chunks]);
}
function ihdr(w,h){ const b=Buffer.alloc(13); b.writeUInt32BE(w,0); b.writeUInt32BE(h,4); b[8]=8; b[9]=6; return b; }
function chunk(type,data){ const t=Buffer.from(type); const len=Buffer.alloc(4); len.writeUInt32BE(data.length); const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t,data]))>>>0); return Buffer.concat([len,t,data,crc]); }
function crc32(buf){ let c=~0; for(const b of buf){ c^=b; for(let k=0;k<8;k++) c=(c>>>1)^(0xedb88320&-(c&1)); } return ~c; }
