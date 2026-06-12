// Dev debug overlay: draws live sim state (worn paths, road segments, deltas,
// event ticker) as translucent shapes. READ-ONLY over window._simClient.
// Toggle: key 9. Pure collector below is node-testable (no DOM at module top).
// Wire reality 2026-06-12: settlement geometry (territory/districts/plots) is
// NOT serialized to clients; only stripped events arrive. Extend
// collectDebugDrawables when the sim lane puts those on the wire — never fake.

const EVENT_CAP = 50;

export function collectDebugDrawables(sim) {
  const out = { paths: [], roads: [], deltas: [], tick: sim?.tick ?? -1 };
  if (!sim?.entities) return out;
  for (const e of sim.entities.values()) {
    if (e.type === 'path') out.paths.push({ x: e.x, y: e.y, wear: e.wear ?? 0 });
    else if (e.type === 'matter' && e.archetype === 'road_segment') out.roads.push({ x: e.x, y: e.y });
  }
  for (const d of sim.deltas ?? []) {
    if (d.x != null && d.y != null) out.deltas.push({ x: d.x, y: d.y, kind: d.kind });
  }
  return out;
}

export function accumulateEvents(seen, batch) {
  const have = new Set(seen.map(e => e.id));
  for (const e of batch ?? []) if (!have.has(e.id)) seen.push(e);
  if (seen.length > EVENT_CAP) seen.splice(0, seen.length - EVENT_CAP);
  return seen;
}

let enabled = false;
const seenEvents = [];
let lastEventsRef = null;

const DELTA_COLORS = { worn: 'rgba(255,180,0,0.9)', paved: 'rgba(130,130,255,0.9)' };

export function drawSimDebugOverlay(ctx, camX, camY, tilePx, w, h) {
  if (!enabled) return;
  const sim = (typeof window !== 'undefined') ? window._simClient : null;
  if (sim && sim.events !== lastEventsRef) {       // events batches are replaced; accumulate
    accumulateEvents(seenEvents, sim.events);
    lastEventsRef = sim.events;
  }
  const d = collectDebugDrawables(sim);
  const onScreen = (sx, sy) => sx > -tilePx && sy > -tilePx && sx < w + tilePx && sy < h + tilePx;

  ctx.save();
  for (const p of d.paths) {                       // worn-path intensity: amber, alpha by wear
    const sx = Math.floor(p.x * tilePx - camX), sy = Math.floor(p.y * tilePx - camY);
    if (!onScreen(sx, sy)) continue;
    ctx.fillStyle = `rgba(255,180,0,${(0.15 + 0.55 * Math.min(1, p.wear / 8)).toFixed(3)})`;
    ctx.fillRect(sx, sy, Math.ceil(tilePx), Math.ceil(tilePx));
  }
  for (const r of d.roads) {                       // road segments: blue outline boxes
    const sx = Math.floor(r.x * tilePx - camX), sy = Math.floor(r.y * tilePx - camY);
    if (!onScreen(sx, sy)) continue;
    ctx.fillStyle = 'rgba(130,130,255,0.25)';
    ctx.fillRect(sx, sy, Math.ceil(tilePx), Math.ceil(tilePx));
    ctx.strokeStyle = 'rgba(130,130,255,0.9)';
    ctx.strokeRect(sx + 0.5, sy + 0.5, Math.ceil(tilePx) - 1, Math.ceil(tilePx) - 1);
  }
  for (const dd of d.deltas) {                     // deltas: small corner ticks, color by kind
    const sx = Math.floor(dd.x * tilePx - camX), sy = Math.floor(dd.y * tilePx - camY);
    if (!onScreen(sx, sy)) continue;
    ctx.fillStyle = DELTA_COLORS[dd.kind] ?? 'rgba(255,0,255,0.9)';
    ctx.fillRect(sx + 2, sy + 2, Math.max(3, tilePx / 6), Math.max(3, tilePx / 6));
  }
  // event ticker, top-right: last 8 events; settlement_founded highlighted.
  ctx.font = '12px monospace';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(w - 320, 8, 312, 16 * 9 + 10);
  ctx.fillStyle = '#9ad';
  ctx.fillText(`SIM DEBUG  tick=${d.tick}  paths=${d.paths.length} roads=${d.roads.length} deltas=${d.deltas.length}`, w - 14, 22);
  seenEvents.slice(-8).forEach((e, i) => {
    ctx.fillStyle = e.type === 'settlement_founded' ? '#ffd24a' : '#ccc';
    ctx.fillText(`[${e.tick}] ${e.type}`, w - 14, 38 + 16 * i);
  });
  ctx.restore();
}

export function initSimDebugOverlay() {
  window.addEventListener('keydown', (e) => {
    if (e.key !== '9' || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable]')) return;
    enabled = !enabled;
  });
  window._simDebugOverlay = { toggle: () => { enabled = !enabled; }, isEnabled: () => enabled }; // probe hook
}
