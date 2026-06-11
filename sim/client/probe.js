// sim/client/probe.js — probe view of the sim (NOT the game renderer; Plan E binds that).
const SCALE = 32;                       // px per tile
const VIEW = { x: 0, y: 0, w: 40, h: 25 };
const COLORS = {
  grass: '#4a8f3c', berry_bush: '#b3458f', tree: '#2e5d34',
  grazer: '#c9a04e', corpse: '#6b5b4a', player: '#fff',
};
const STAGE_R = { seedling: 3, growing: 5, mature: 7, corpse: 5 };

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);
let entities = [], deltas = [], tick = 0, playerR = 0;

const ws = new WebSocket('ws://127.0.0.1:8787');
ws.onopen = () => {
  $('status').textContent = 'attached';
  ws.send(JSON.stringify({ type: 'hello', viewport: VIEW }));
};
ws.onclose = () => { $('status').textContent = 'sim gone'; };
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.type === 'snapshot') { entities = m.entities; deltas = m.deltas; }
  else if (m.type === 'tick-delta') { entities = m.upserts; playerR = m.player.R; deltas = m.deltas; }
  else if (m.type === 'events') {
    for (const e of m.events) if (e.type === 'delta_healed' || e.type === 'chop' || e.type === 'death') log(e);
  }
  else if (m.type === 'time') { tick = m.tick; }
  draw();
};

function log(e) { $('status').textContent = `${e.type} @day ${(e.tick / 86400).toFixed(1)}`; }

function draw() {
  ctx.fillStyle = '#1a2412'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#3a2f24';
  for (const d of deltas) ctx.fillRect(d.x * SCALE - 6, d.y * SCALE - 6, 12, 12);  // scars
  for (const e of entities) {
    // corpse keys by type (its species field holds what it WAS — that colors the living, not the dead)
    ctx.fillStyle = e.type === 'corpse' ? COLORS.corpse : (COLORS[e.species ?? e.type] ?? '#888');
    ctx.beginPath();
    ctx.arc(e.x * SCALE, e.y * SCALE, STAGE_R[e.stage] ?? 4, 0, Math.PI * 2);
    ctx.fill();
  }
  $('clock').textContent = `day ${(tick / 86400).toFixed(2)}`;
  $('wallet').textContent = `wallet: ${playerR.toFixed(0)} tu`;
}

cv.addEventListener('click', ev => {
  const x = ev.offsetX / SCALE, y = ev.offsetY / SCALE;
  let best = null, bd = 1;                              // within 1 tile
  for (const e of entities) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return;
  const verb = $('chopmode').checked ? 'chop' : 'pick';
  ws.send(JSON.stringify({ type: 'intent', verb, target: best.id }));
});

$('ff').addEventListener('click', () => ws.send(JSON.stringify({ type: 'admin', op: 'ff', days: 7 })));
