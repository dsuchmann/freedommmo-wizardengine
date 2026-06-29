// src/render/floor-view.js — main-thread interior floor-view overlay (spec §3-§5).
// Ported from the signed-off mockup (.superpowers/brainstorm/mockup-staging/floor-view.html).
// Draws ONE floor at a time on a centered focus transform, on top of the dimmed world,
// with stair-slide / lift-express transitions. Consumes resolveFloorLayout (Plan 1).
import { resolveFloorLayout } from '../../sim/world/buildings/floor-layout.js';
import {
  getFloorView, isFloorViewActive, changeFloor, gotoFloor, clearTransition,
  enterUnit, exitUnit,
} from './floor-view-state.js';

// ── world transform stash (for the ENTER click: screen → which building) ──
let _world = { camX: 0, camY: 0, tilePx: 32, w: 0, h: 0 };
export function updateFloorViewTransform(camX, camY, tilePx, w, h) { _world = { camX, camY, tilePx, w, h }; }
export function screenToWorldTile(sx, sy) {
  return { tileX: (sx + _world.camX) / _world.tilePx, tileY: (sy + _world.camY) / _world.tilePx };
}

// ── wall style toggle ──
let _wallStyle = 'doll'; // 'doll' | 'plan'
export function toggleWallStyle() { _wallStyle = _wallStyle === 'doll' ? 'plan' : 'doll'; }

// ── centered focus transform (ported from mockup view()) ──
export function focusTransform(layout, w, h) {
  const b = layout.bounds, pad = 2.2;
  const bw = b.maxX - b.minX + 1, bh = b.maxY - b.minY + 1;
  const tile = Math.max(16, Math.min(54, Math.min(w / (bw + pad), h / (bh + pad + 1.4))));
  const ox = (w - bw * tile) / 2 - b.minX * tile;
  const oy = (h - bh * tile) / 2 - b.minY * tile + tile * 0.5;
  return { tile, ox, oy };
}

const UNIT_COLORS = { apartment:'#6f8fb8', shop:'#c9a14b', business:'#c9a14b', house:'#7fa86b',
  lobby:'#9aa3b5', common:'#9aa3b5', hall:'#9aa3b5', gallery:'#8f86b8', storage:'#8a7a64', crypt:'#7a6f86', default:'#7a6a52' };
const COL = { circ:'#3b4663', door:'#c98a4b', stair:'#ffc24a', lift:'#5ad1ff' };
const unitColor = k => UNIT_COLORS[k] || UNIT_COLORS.default;

// Animation tuning
const STAIR_MS = 360, LIFT_MS = 600;
let _transStart = null, _transRef = null;

/** Resolve the layout for a given floor of the active building (memoized per floor index). */
let _layoutCache = { key: '', layout: null };
function layoutFor(fv, floorIndex) {
  const key = `${fv.buildingId}:${floorIndex}`;
  if (_layoutCache.key !== key) _layoutCache = { key, layout: resolveFloorLayout(fv.node, floorIndex) };
  return _layoutCache.layout;
}

/** Memoize derived tile data (present-set + pre-parsed coords) on the layout object.
 *  Computed once per layout (layouts are themselves memoized by layoutFor), reused every
 *  frame — avoids rebuilding the Set and re-running split(',').map(Number) per draw call. */
function presentFor(layout) {
  if (!layout._presentCache) {
    const set = new Set(layout.walkable);
    for (const u of layout.units) for (const t of u.tiles) set.add(`${t.x},${t.y}`);
    const coords = [];
    for (const k of set) { const i = k.indexOf(','); coords.push({ x: +k.slice(0, i), y: +k.slice(i + 1) }); }
    const walkCoords = [];
    for (const k of layout.walkable) { const i = k.indexOf(','); walkCoords.push({ x: +k.slice(0, i), y: +k.slice(i + 1) }); }
    layout._presentCache = { set, coords, walkCoords };
  }
  return layout._presentCache;
}

/** MAIN ENTRY — call from canvas-renderer after the world + overlays are drawn. */
export function drawFloorView(ctx, w, h, now) {
  if (!isFloorViewActive()) { _transStart = null; _transRef = null; return; }
  const fv = getFloorView();

  // dim the world behind the floor view (reuse the renderer's fillRect-dim idiom)
  ctx.save();
  ctx.fillStyle = 'rgba(10,13,20,0.78)';
  ctx.fillRect(0, 0, w, h);

  const layout = layoutFor(fv, fv.floorIndex);
  const V = focusTransform(layout, w, h);

  if (fv.transition) {
    if (_transRef !== fv.transition) { _transRef = fv.transition; _transStart = now; }
    const dur = fv.transition.kind === 'lift' ? LIFT_MS : STAIR_MS;
    const k = Math.min(1, (now - _transStart) / dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOut
    const slide = h * 0.9, dir = fv.transition.dir;
    const fromLayout = layoutFor(fv, fv.transition.from);
    const Vf = focusTransform(fromLayout, w, h);
    const factor = fv.transition.kind === 'lift' ? 0.25 : 1;
    drawFloorLayer(ctx, fromLayout, Vf, 1 - e, dir * slide * factor * e, w, h);
    drawFloorLayer(ctx, layout, V, e, -dir * slide * factor * (1 - e), w, h);
    if (k >= 1) { clearTransition(); _transRef = null; }
  } else {
    drawFloorLayer(ctx, layout, V, 1, 0, w, h);
  }

  drawHud(ctx, fv, layout, w, h);
  ctx.restore();
}

// ── per-floor draw (ported from mockup drawFloor + drawWalls + glyphs) ──
function drawFloorLayer(ctx, layout, V, alpha, yShift, w, h) {
  const { tile, ox, oy } = V;
  const sx = x => ox + x * tile, sy = y => oy + y * tile + yShift;
  ctx.save(); ctx.globalAlpha = alpha;
  const { set: present, coords: presentCoords, walkCoords } = presentFor(layout);

  // drop shadow
  ctx.fillStyle = '#0008';
  for (const c of presentCoords) ctx.fillRect(sx(c.x) + 2, sy(c.y) + 3, tile, tile);
  // circulation
  ctx.fillStyle = COL.circ;
  for (const c of walkCoords) ctx.fillRect(sx(c.x), sy(c.y), tile - 1, tile - 1);
  // units (+ multi-floor badge)
  const multi = new Set(layout.multiFloorUnits);
  for (const u of layout.units) {
    ctx.fillStyle = unitColor(u.unitKind);
    for (const t of u.tiles) ctx.fillRect(sx(t.x), sy(t.y), tile - 1, tile - 1);
    outline(ctx, u.tiles, sx, sy, tile, '#0b0e14', 2);
    const c = centroid(u.tiles);
    label(ctx, multi.has(u.id) ? `${u.unitKind} ⇡` : u.unitKind, sx(c.x) + tile / 2, sy(c.y) + tile / 2);
  }
  // doors
  ctx.fillStyle = COL.door;
  for (const u of layout.units) ctx.fillRect(sx(u.doorTile.x) + tile * 0.3, sy(u.doorTile.y) + tile * 0.3, tile * 0.4, tile * 0.4);
  // walls (dollhouse-cutaway default / floor-plan)
  drawWalls(ctx, present, presentCoords, sx, sy, tile);
  // stair + lift glyphs (fixed per-column positions)
  if (layout.stairTile) glyph(ctx, sx(layout.stairTile.x), sy(layout.stairTile.y), tile, COL.stair, '≡');
  if (layout.liftTile) glyph(ctx, sx(layout.liftTile.x), sy(layout.liftTile.y), tile, COL.lift, '⇅');
  ctx.restore();
}

function drawWalls(ctx, present, coords, sx, sy, tile) {
  const has = (x, y) => present.has(`${x},${y}`);
  const wH = _wallStyle === 'plan' ? 0 : tile * 0.85;
  const nearH = _wallStyle === 'plan' ? 0 : tile * 0.18;
  for (const c of coords) {
    const x = c.x, y = c.y; const X = sx(x), Y = sy(y);
    if (!has(x, y - 1)) { // far/north wall
      if (wH > 0) { ctx.fillStyle = '#3a4253'; ctx.fillRect(X, Y - wH, tile, wH); brick(ctx, X, Y - wH, tile, wH); }
      else stroke(ctx, X, Y, X + tile, Y);
    }
    if (!has(x, y + 1)) { // near/south sill (cutaway)
      if (nearH > 0) { ctx.fillStyle = '#525c70'; ctx.fillRect(X, Y + tile - nearH, tile, nearH); }
      else stroke(ctx, X, Y + tile, X + tile, Y + tile);
    }
    if (!has(x - 1, y)) { ctx.fillStyle = _wallStyle === 'plan' ? '#0b0e14' : '#454e60'; ctx.fillRect(X, Y, Math.max(2, tile * 0.1), tile); }
    if (!has(x + 1, y)) { ctx.fillStyle = _wallStyle === 'plan' ? '#0b0e14' : '#454e60'; ctx.fillRect(X + tile - Math.max(2, tile * 0.1), Y, Math.max(2, tile * 0.1), tile); }
  }
}

// ── small helpers (ported) ──
function centroid(ts) { let x = 0, y = 0; for (const t of ts) { x += t.x; y += t.y; } return { x: x / ts.length, y: y / ts.length }; }
function stroke(ctx, x0, y0, x1, y1) { ctx.strokeStyle = '#0b0e14'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
function brick(ctx, X, Y, w, h) { ctx.strokeStyle = '#0007'; ctx.lineWidth = 1; const r = Math.max(4, h / 4); for (let yy = Y; yy < Y + h; yy += r) { ctx.beginPath(); ctx.moveTo(X, yy); ctx.lineTo(X + w, yy); ctx.stroke(); } }
function outline(ctx, ts, sx, sy, t, style, lw) { const s = new Set(ts.map(p => `${p.x},${p.y}`)); ctx.strokeStyle = style; ctx.lineWidth = lw; for (const p of ts) { const X = sx(p.x), Y = sy(p.y); ctx.beginPath();
  if (!s.has(`${p.x},${p.y - 1}`)) { ctx.moveTo(X, Y); ctx.lineTo(X + t, Y); }
  if (!s.has(`${p.x},${p.y + 1}`)) { ctx.moveTo(X, Y + t); ctx.lineTo(X + t, Y + t); }
  if (!s.has(`${p.x - 1},${p.y}`)) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + t); }
  if (!s.has(`${p.x + 1},${p.y}`)) { ctx.moveTo(X + t, Y); ctx.lineTo(X + t, Y + t); }
  ctx.stroke(); } }
function label(ctx, text, cx, cy) { ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const wbg = ctx.measureText(text).width + 8; ctx.fillStyle = '#0c0f15cc'; ctx.fillRect(cx - wbg / 2, cy - 8, wbg, 15); ctx.fillStyle = '#fff'; ctx.fillText(text, cx, cy); }
function glyph(ctx, X, Y, t, color, ch) { ctx.fillStyle = color; ctx.fillRect(X + 1, Y + 1, t - 2, t - 2); ctx.fillStyle = '#10131a'; ctx.font = `bold ${Math.round(t * 0.6)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, X + t / 2, Y + t / 2); }

// ── HUD: floor pill, use, controls hint, entered-unit card ──
function drawHud(ctx, fv, layout, w, h) {
  ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(20,24,33,0.85)'; ctx.fillRect(12, 12, 230, 46);
  ctx.fillStyle = '#ffc24a'; ctx.font = 'bold 15px sans-serif';
  ctx.fillText(`Floor ${fv.floorIndex}${fv.floorIndex < 0 ? ' (basement)' : fv.floorIndex === 0 ? ' (ground)' : ''}`, 20, 32);
  ctx.fillStyle = '#94a0b6'; ctx.font = '12px sans-serif';
  ctx.fillText(`${layout.use} · ${layout.units.length} unit(s) · [,/.] floor · ${liftHint(fv)}Esc exit`, 20, 50);
  if (fv.enteredUnitId) {
    const u = layout.units.find(u => u.id === fv.enteredUnitId);
    if (u) { ctx.fillStyle = 'rgba(20,24,33,0.95)'; const txt = `Entered ${u.unitKind} — Esc to step out`; const tw = ctx.measureText(txt).width + 24;
      ctx.fillRect((w - tw) / 2, h - 48, tw, 28); ctx.fillStyle = '#ffc24a'; ctx.fillText(txt, (w - tw) / 2 + 12, h - 30); }
  }
}
function liftHint(fv) { return fv.node.payload.lift ? '[l] lift · ' : ''; }

/** Click picking INSIDE the floor view: returns {type:'stair'|'lift'|'unit'|'empty', unitId?}. */
export function pickInFloorView(screenX, screenY, w, h) {
  const fv = getFloorView(); if (!fv || fv.transition) return { type: 'empty' };
  const layout = layoutFor(fv, fv.floorIndex);
  const V = focusTransform(layout, w, h);
  const tx = Math.floor((screenX - V.ox) / V.tile), ty = Math.floor((screenY - V.oy) / V.tile);
  if (layout.stairTile && layout.stairTile.x === tx && layout.stairTile.y === ty) return { type: 'stair' };
  if (layout.liftTile && layout.liftTile.x === tx && layout.liftTile.y === ty) return { type: 'lift' };
  for (const u of layout.units) if (u.tiles.some(t => t.x === tx && t.y === ty)) return { type: 'unit', unitId: u.id };
  return { type: 'empty' };
}
