// roof-features.js — FEATURE axis. Parametric procedural passes drawn AFTER the
// roof field: turrets, spire, buttresses, crenellations/merlons, walkable decks +
// rails + gardens, chimneys, dormers, ridge finials. Each attaches to roof ROLES
// (eave / ridge / peak / deck) or footprint corners, so they follow the geometry.

import { corner } from './roof-renderer.js';

const TAU = Math.PI * 2;
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) ^ 0x9e3779b9; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; }

// ── 3D primitive: axis-aligned box between two heights ───────────────────────
function drawBox(ctx, view, grid, x0, y0, wx, wy, hb, ht, pal) {
  const P = (gx, gy, h) => view.project(gx, gy, h);
  const x1 = x0 + wx, y1 = y0 + wy;
  const face = (pts, color) => { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.8; ctx.stroke(); };
  // east (right) face
  face([P(x1, y0, ht), P(x1, y1, ht), P(x1, y1, hb), P(x1, y0, hb)], pal.east);
  // south (front) face
  face([P(x0, y1, ht), P(x1, y1, ht), P(x1, y1, hb), P(x0, y1, hb)], pal.south);
  // top
  face([P(x0, y0, ht), P(x1, y0, ht), P(x1, y1, ht), P(x0, y1, ht)], pal.top);
}

// ── 3D primitive: cone (turret cap / spire) ──────────────────────────────────
function drawCone(ctx, view, grid, cx, cy, r, hb, ht, color, lightAz = 235) {
  const apex = view.project(cx, cy, ht);
  const N = 20, la = (lightAz * Math.PI) / 180;
  const pts = [];
  for (let k = 0; k <= N; k++) { const a = (k / N) * TAU; pts.push({ a, p: view.project(cx + r * Math.cos(a), cy + r * Math.sin(a) * view.yScale, hb) }); }
  // base disc
  ctx.beginPath(); ctx.moveTo(pts[0].p.x, pts[0].p.y); for (const q of pts) ctx.lineTo(q.p.x, q.p.y); ctx.closePath();
  ctx.fillStyle = shadeHex(color, 0.5); ctx.fill();
  for (let k = 0; k < N; k++) {
    const m = (pts[k].a + pts[k + 1].a) / 2;
    const lit = 0.45 + 0.55 * Math.max(0, Math.cos(m - la));
    ctx.beginPath(); ctx.moveTo(apex.x, apex.y); ctx.lineTo(pts[k].p.x, pts[k].p.y); ctx.lineTo(pts[k + 1].p.x, pts[k + 1].p.y); ctx.closePath();
    ctx.fillStyle = shadeHex(color, lit); ctx.fill();
  }
}
function drawCyl(ctx, view, grid, cx, cy, r, hb, ht, color) {
  const seg = 16;
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * TAU, a1 = ((k + 1) / seg) * TAU;
    const lit = 0.4 + 0.6 * Math.max(0, Math.cos((a0 + a1) / 2 - 4.1));
    const p0 = view.project(cx + r * Math.cos(a0), cy + r * Math.sin(a0) * view.yScale, ht);
    const p1 = view.project(cx + r * Math.cos(a1), cy + r * Math.sin(a1) * view.yScale, ht);
    const p2 = view.project(cx + r * Math.cos(a1), cy + r * Math.sin(a1) * view.yScale, hb);
    const p3 = view.project(cx + r * Math.cos(a0), cy + r * Math.sin(a0) * view.yScale, hb);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.closePath();
    ctx.fillStyle = shadeHex(color, lit); ctx.fill();
  }
}
function shadeHex(hex, f) {
  // hex like '#rrggbb'
  const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

const STONE = { top: '#9b958a', south: '#746e64', east: '#585349' };
const DARKWOOD = { top: '#6b4e33', south: '#4d3923', east: '#3a2b1a' };

// ── footprint corner detection (for turrets / buttresses) ────────────────────
function cornerTiles(grid) {
  const out = [];
  const fpAt = (i, j) => i >= 0 && j >= 0 && i < grid.W && j < grid.H && grid.fp[j * grid.W + i];
  for (let j = 0; j < grid.H; j++) for (let i = 0; i < grid.W; i++) {
    if (!fpAt(i, j)) continue;
    const n = fpAt(i, j - 1), s = fpAt(i, j + 1), e = fpAt(i + 1, j), w = fpAt(i - 1, j);
    const ext = (n ? 0 : 1) + (s ? 0 : 1) + (e ? 0 : 1) + (w ? 0 : 1);
    if (ext >= 2 && !(n && s) && !(e && w)) out.push({ i, j, gx: grid.gox + i, gy: grid.goy + j, n: !n, s: !s, e: !e, w: !w });
  }
  // outermost first (corners of the bbox preferred)
  const cxc = grid.bbox.x0 + grid.bbox.w / 2, cyc = grid.bbox.y0 + grid.bbox.h / 2;
  return out.sort((a, b) => Math.hypot(b.gx - cxc, b.gy - cyc) - Math.hypot(a.gx - cxc, a.gy - cyc));
}

export function makeFeatures(cfg) {
  const has = (id) => (cfg.features || []).includes(id);
  return {
    draw(ctx, grid, view, c, light) {
      const scale = c.featureScale ?? 1;
      const corners = cornerTiles(grid);
      const matColor = c._roofHexTop || '#8a5a33';

      if (has('buttress')) {
        const nb = Math.min(c.buttressCount ?? 4, corners.length);
        for (let k = 0; k < nb; k++) {
          const cc = corners[k];
          const baseH = -2.4 * scale; // springs from the ground
          const topH = grid.height[cc.j * grid.W + cc.i] || 0.4;
          const ox = cc.e ? 0.55 : cc.w ? -0.35 : 0.1, oy = cc.s ? 0.55 : cc.n ? -0.35 : 0.1;
          drawBox(ctx, view, grid, cc.gx + ox, cc.gy + oy, 0.5 * scale, 0.5 * scale, baseH, topH, STONE);
        }
      }

      if (has('turret')) {
        const nt = Math.min(c.turretCount ?? 4, corners.length);
        const r = 0.7 * scale;
        for (let k = 0; k < nt; k++) {
          const cc = corners[k];
          const wallTop = (grid.height[cc.j * grid.W + cc.i] || 0.5) + 1.6 * scale;
          drawCyl(ctx, view, grid, cc.gx + 0.5, cc.gy + 0.5, r, -2.0, wallTop, '#8d877b');
          // crenellated parapet ring
          const merlons = 8;
          for (let m = 0; m < merlons; m++) {
            const a = (m / merlons) * TAU; if (m % 2) continue;
            const mx = cc.gx + 0.5 + r * 0.8 * Math.cos(a), my = cc.gy + 0.5 + r * 0.8 * Math.sin(a) * view.yScale;
            drawBox(ctx, view, grid, mx - 0.12, my - 0.12, 0.24, 0.24, wallTop, wallTop + 0.5 * scale, STONE);
          }
          drawCone(ctx, view, grid, cc.gx + 0.5, cc.gy + 0.5, r * 1.15, wallTop, wallTop + 2.4 * scale, matColor, c.lightAngle);
          if (has('banner')) drawBanner(ctx, view, cc.gx + 0.5, cc.gy + 0.5, wallTop + 2.4 * scale, scale, c.bannerHue ?? 0);
        }
      }

      if (has('spire')) {
        const peak = grid.roleTiles.peak[0] || grid.tiles.reduce((a, b) => (b.h > (a?.h ?? -1) ? b : a), null);
        if (peak) {
          drawCone(ctx, view, grid, peak.gx + 0.5, peak.gy + 0.5, 0.5 * scale, peak.h, peak.h + 3.6 * scale, matColor, c.lightAngle);
          const top = view.project(peak.gx + 0.5, peak.gy + 0.5, peak.h + 3.6 * scale);
          ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(top.x, top.y, view.tile * 0.16 * scale, 0, TAU); ctx.fill();
          if (has('banner')) drawBanner(ctx, view, peak.gx + 0.5, peak.gy + 0.5, peak.h + 3.6 * scale, scale, c.bannerHue ?? 30);
        }
      }

      if (has('crenellation')) {
        // merlons along the outer eave ring of a flat/parapet/deck roof
        const ring = grid.roleTiles.eave.concat(grid.roleTiles.deck.filter(t => onPerimeter(grid, t)));
        let idx = 0;
        for (const t of dedupePerimeter(grid)) {
          if (idx++ % 2) continue;
          const h = grid.height[t.j * grid.W + t.i] || 0.5;
          drawBox(ctx, view, grid, t.gx + 0.28, t.gy + 0.28, 0.44, 0.44, h, h + 0.6 * scale, STONE);
        }
      }

      if (has('walkdeck')) {
        const deck = grid.roleTiles.deck;
        // rail posts around the deck perimeter
        for (const t of deck) {
          if (!onPerimeter(grid, t)) continue;
          const h = grid.height[t.j * grid.W + t.i] || 0.5;
          drawBox(ctx, view, grid, t.gx + 0.42, t.gy + 0.42, 0.16, 0.16, h, h + 0.45 * scale, DARKWOOD);
        }
        if (has('garden')) for (const t of deck) {
          if (hash2(t.gx * 5, t.gy * 7) > 0.5) continue;
          const h = grid.height[t.j * grid.W + t.i] || 0.5;
          const p = view.project(t.gx + 0.5, t.gy + 0.5, h);
          ctx.fillStyle = '#4f7a3a'; ctx.beginPath(); ctx.arc(p.x, p.y - view.tile * 0.1, view.tile * 0.18 * scale, 0, TAU); ctx.fill();
          ctx.fillStyle = '#6fae54'; ctx.beginPath(); ctx.arc(p.x - view.tile * 0.08, p.y - view.tile * 0.16, view.tile * 0.1 * scale, 0, TAU); ctx.fill();
        }
      }

      if (has('chimney')) {
        const slopes = grid.roleTiles.slope.filter(t => t.h > grid.maxHeight * 0.45);
        const nc = Math.min(c.chimneyCount ?? 1, slopes.length);
        for (let k = 0; k < nc; k++) {
          const t = slopes[Math.floor(hash2(k + 3, 11) * slopes.length)]; if (!t) continue;
          const h = t.h;
          drawBox(ctx, view, grid, t.gx + 0.3, t.gy + 0.3, 0.5 * scale, 0.5 * scale, h, h + 1.3 * scale, { top: '#3a3330', south: '#2c2623', east: '#211c1a' });
        }
      }

      if (has('dormer')) {
        const slopes = grid.roleTiles.slope.filter(t => t.dir === 's' && t.h > 0.4 && t.h < grid.maxHeight * 0.8);
        const nd = Math.min(c.dormerCount ?? 2, slopes.length);
        for (let k = 0; k < nd; k++) {
          const t = slopes[Math.floor((k + 1) / (nd + 1) * slopes.length)]; if (!t) continue;
          const h = t.h;
          drawBox(ctx, view, grid, t.gx + 0.2, t.gy + 0.1, 0.6 * scale, 0.5 * scale, h - 0.2, h + 0.7 * scale, { top: matColor && shadeHex(matColor, 0.9) || '#7a4', south: '#caa', east: '#a88' });
        }
      }

      if (has('finial')) {
        for (const t of grid.roleTiles.peak.concat(grid.roleTiles.ridge.filter(r => isRidgeEnd(grid, r)))) {
          const p = view.project(t.gx + 0.5, t.gy + 0.5, t.h + 0.3 * scale);
          ctx.fillStyle = '#caa15a'; ctx.beginPath(); ctx.arc(p.x, p.y, view.tile * 0.12 * scale, 0, TAU); ctx.fill();
        }
      }
    },
  };
}

function drawBanner(ctx, view, gx, gy, h, scale, hue) {
  const top = view.project(gx, gy, h + 1.2 * scale), bot = view.project(gx, gy, h);
  ctx.strokeStyle = '#3a2c1a'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(bot.x, bot.y); ctx.stroke();
  ctx.fillStyle = `hsl(${hue} 70% 50%)`;
  ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(top.x + view.tile * 0.9 * scale, top.y + view.tile * 0.18); ctx.lineTo(top.x + view.tile * 0.7 * scale, top.y + view.tile * 0.5); ctx.lineTo(top.x, top.y + view.tile * 0.45); ctx.closePath(); ctx.fill();
}

function onPerimeter(grid, t) {
  const fpAt = (i, j) => i >= 0 && j >= 0 && i < grid.W && j < grid.H && grid.fp[j * grid.W + i];
  return !fpAt(t.i, t.j - 1) || !fpAt(t.i, t.j + 1) || !fpAt(t.i + 1, t.j) || !fpAt(t.i - 1, t.j);
}
function dedupePerimeter(grid) {
  return grid.tiles.filter(t => !t.isOverhang && onPerimeter(grid, t)).sort((a, b) => (a.gy - b.gy) || (a.gx - b.gx));
}
function isRidgeEnd(grid, t) {
  const get = (i, j) => grid.tiles.find(x => x.i === i && x.j === j);
  const ridgeN = (di, dj) => { const n = get(t.i + di, t.j + dj); return n && (n.role === 'ridge' || n.role === 'peak'); };
  const cnt = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => ridgeN(a, b)).length;
  return cnt <= 1;
}
