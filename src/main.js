const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const stats = document.getElementById('stats');

const TILE = 16;
const CHUNK = 64;
const SEED = 42;
const LOAD_RADIUS = 2;
const player = { x: 0, y: 0, speed: 9 };
const keys = new Set();
const chunks = new Map();
let last = performance.now();
let frame = 0;

const BIOMES = {
  ocean: { color: '#1c5d8f', walk: false },
  beach: { color: '#d8bd75', walk: true },
  grassland: { color: '#5fa64b', walk: true },
  forest: { color: '#2f7137', walk: true },
  dense_forest: { color: '#1f4e2d', walk: true },
  savanna: { color: '#b3a24c', walk: true },
  desert: { color: '#d7a94f', walk: true },
  hills: { color: '#827d55', walk: true },
  mountain: { color: '#777b82', walk: true },
  snow: { color: '#d9e6eb', walk: true },
  swamp: { color: '#42694a', walk: true }
};

function resize() {
  canvas.width = Math.floor(window.innerWidth * window.devicePixelRatio);
  canvas.height = Math.floor(window.innerHeight * window.devicePixelRatio);
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}
window.addEventListener('resize', resize);
resize();

window.addEventListener('keydown', e => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

function hash(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = Math.imul(n, 9);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967295;
}

function rand2(x, y, salt = 0) {
  return hash(Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(SEED + salt, 1442695041));
}

function smoothNoise(x, y, scale, salt) {
  const fx = x / scale, fy = y / scale;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = rand2(x0, y0, salt), b = rand2(x0 + 1, y0, salt);
  const c = rand2(x0, y0 + 1, salt), d = rand2(x0 + 1, y0 + 1, salt);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

function fbm(x, y, salt) {
  let v = 0, amp = .5, scale = 180;
  for (let i = 0; i < 5; i++) {
    v += smoothNoise(x, y, scale, salt + i * 31) * amp;
    scale *= .48;
    amp *= .5;
  }
  return v;
}

function lerp(a, b, t) { return a + (b - a) * t; }
function chunkKey(cx, cy) { return `${cx},${cy}`; }
function floorDiv(v, d) { return Math.floor(v / d); }

function classify(wx, wy) {
  const elevation = fbm(wx, wy, 10) + fbm(wx, wy, 99) * .35 - .12;
  const moisture = fbm(wx + 9000, wy - 4000, 20);
  const heat = fbm(wx - 3000, wy + 7000, 30) - Math.abs(wy) / 9000;
  let biome;
  if (elevation < .30) biome = 'ocean';
  else if (elevation < .35) biome = 'beach';
  else if (elevation > .77) biome = heat < .35 ? 'snow' : 'mountain';
  else if (elevation > .67) biome = 'hills';
  else if (moisture > .76 && heat > .35) biome = 'swamp';
  else if (moisture > .68) biome = heat > .52 ? 'dense_forest' : 'forest';
  else if (moisture < .28 && heat > .50) biome = 'desert';
  else if (moisture < .40) biome = 'savanna';
  else biome = 'grassland';
  return { biome, elevation, moisture, heat, walk: BIOMES[biome].walk };
}

function makeChunk(cx, cy) {
  const tiles = new Array(CHUNK * CHUNK);
  const objects = [];
  for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) {
    const wx = cx * CHUNK + x, wy = cy * CHUNK + y;
    const t = classify(wx, wy);
    tiles[y * CHUNK + x] = t;
    const r = rand2(wx, wy, 777);
    if (t.biome === 'forest' && r > .955) objects.push({ x, y, kind: 'tree' });
    if (t.biome === 'dense_forest' && r > .91) objects.push({ x, y, kind: 'tree' });
    if (t.biome === 'grassland' && r > .982) objects.push({ x, y, kind: 'flower' });
    if ((t.biome === 'hills' || t.biome === 'mountain') && r > .965) objects.push({ x, y, kind: 'rock' });
  }
  return { cx, cy, tiles, objects };
}

function getChunk(cx, cy) {
  const key = chunkKey(cx, cy);
  if (!chunks.has(key)) chunks.set(key, makeChunk(cx, cy));
  return chunks.get(key);
}

function streamChunks() {
  const pcx = floorDiv(player.x, CHUNK), pcy = floorDiv(player.y, CHUNK);
  for (let cy = pcy - LOAD_RADIUS; cy <= pcy + LOAD_RADIUS; cy++) {
    for (let cx = pcx - LOAD_RADIUS; cx <= pcx + LOAD_RADIUS; cx++) getChunk(cx, cy);
  }
  for (const [key, c] of chunks) {
    if (Math.abs(c.cx - pcx) > LOAD_RADIUS + 1 || Math.abs(c.cy - pcy) > LOAD_RADIUS + 1) chunks.delete(key);
  }
}

function update(dt) {
  let dx = 0, dy = 0;
  if (keys.has('w') || keys.has('arrowup')) dy--;
  if (keys.has('s') || keys.has('arrowdown')) dy++;
  if (keys.has('a') || keys.has('arrowleft')) dx--;
  if (keys.has('d') || keys.has('arrowright')) dx++;
  if (dx || dy) {
    const m = Math.hypot(dx, dy);
    player.x += (dx / m) * player.speed * dt;
    player.y += (dy / m) * player.speed * dt;
  }
  streamChunks();
}

function draw() {
  const w = window.innerWidth, h = window.innerHeight;
  ctx.fillStyle = '#071019';
  ctx.fillRect(0, 0, w, h);
  const camX = player.x * TILE - w / 2;
  const camY = player.y * TILE - h / 2;
  const minTX = Math.floor(camX / TILE) - 1;
  const minTY = Math.floor(camY / TILE) - 1;
  const maxTX = Math.ceil((camX + w) / TILE) + 1;
  const maxTY = Math.ceil((camY + h) / TILE) + 1;

  for (let ty = minTY; ty <= maxTY; ty++) for (let tx = minTX; tx <= maxTX; tx++) {
    const cx = floorDiv(tx, CHUNK), cy = floorDiv(ty, CHUNK);
    const lx = tx - cx * CHUNK, ly = ty - cy * CHUNK;
    const tile = getChunk(cx, cy).tiles[ly * CHUNK + lx];
    ctx.fillStyle = shade(BIOMES[tile.biome].color, (tile.elevation - .5) * .28);
    ctx.fillRect(Math.floor(tx * TILE - camX), Math.floor(ty * TILE - camY), TILE, TILE);
  }

  for (const c of chunks.values()) for (const o of c.objects) {
    const sx = (c.cx * CHUNK + o.x) * TILE - camX;
    const sy = (c.cy * CHUNK + o.y) * TILE - camY;
    if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
    if (o.kind === 'tree') { ctx.fillStyle = '#12391f'; ctx.beginPath(); ctx.arc(sx + 8, sy + 8, 7, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#6b4928'; ctx.fillRect(sx + 6, sy + 8, 4, 7); }
    if (o.kind === 'rock') { ctx.fillStyle = '#555a5f'; ctx.fillRect(sx + 4, sy + 5, 9, 8); }
    if (o.kind === 'flower') { ctx.fillStyle = '#ffd6f2'; ctx.fillRect(sx + 7, sy + 7, 3, 3); }
  }

  ctx.fillStyle = '#f6f1d0';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1b1b1b';
  ctx.stroke();
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, r + amount * 255));
  g = Math.max(0, Math.min(255, g + amount * 255));
  b = Math.max(0, Math.min(255, b + amount * 255));
  return `rgb(${r|0},${g|0},${b|0})`;
}

function hud() {
  const t = classify(Math.floor(player.x), Math.floor(player.y));
  stats.innerHTML = `WASD / arrows to move<br>seed ${SEED} · chunks ${chunks.size}<br>tile ${Math.floor(player.x)}, ${Math.floor(player.y)} · chunk ${floorDiv(player.x, CHUNK)}, ${floorDiv(player.y, CHUNK)}<br>biome ${t.biome}<br>elev ${t.elevation.toFixed(2)} moist ${t.moisture.toFixed(2)} heat ${t.heat.toFixed(2)}`;
}

function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  if ((frame++ & 7) === 0) hud();
  requestAnimationFrame(loop);
}
streamChunks();
requestAnimationFrame(loop);
