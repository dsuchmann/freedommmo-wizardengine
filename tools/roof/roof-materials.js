// roof-materials.js — MATERIAL axis. Each material is a procedural canvas skin
// drawn into a tile's projected quad. No external art. A material exposes:
//   fillTile(ctx, quad, tile, shade, view, grid)  -> paint one roof tile
//   fasciaColor(shade) -> color for the eave thickness
// The repeatable per-tile MOTIF in each recipe is exactly what could later be
// baked into a PixelLab swatch; for now the engine draws it live.

// ── small helpers ────────────────────────────────────────────────────────────
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) ^ 0x9e3779b9; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; }
function hsl(h, s, l) { return `hsl(${((h % 360) + 360) % 360} ${clamp(s, 0, 100)}% ${clamp(l, 0, 100)}%)`; }
// local frame of a projected quad [TL,TR,BR,BL] -> point at (s,t) in [0,1]
function lf(q) {
  const ux = q[1].x - q[0].x, uy = q[1].y - q[0].y;
  const vx = q[3].x - q[0].x, vy = q[3].y - q[0].y;
  return (s, t) => ({ x: q[0].x + s * ux + t * vx, y: q[0].y + s * uy + t * vy });
}
function poly(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); }
function fillQuad(ctx, q, color) { poly(ctx, q); ctx.fillStyle = color; ctx.fill(); }

// shade a base [h,s,l] by a 0..1 light factor + small per-tile jitter
function tone(base, shade, jitter = 0) {
  return hsl(base[0] + jitter * 8, base[1], base[2] * (0.45 + 0.75 * shade) + jitter * 4);
}

// ── recipe registry ──────────────────────────────────────────────────────────
// Each recipe: { base:[h,s,l], fascia:[h,s,l], draw(ctx,q,P,shade,jit) }
const RECIPES = {
  shingle: {
    base: [28, 38, 46], fascia: [26, 30, 22],
    draw(ctx, q, P, shade, jit) {
      fillQuad(ctx, q, tone(this.base, shade, jit));
      const at = lf(q), rows = 3, off = (P.tile.gx % 2) * 0.5;
      ctx.lineWidth = 1;
      for (let r = 0; r < rows; r++) {
        const t0 = r / rows, t1 = (r + 0.92) / rows;
        for (let c = 0; c < 3; c++) {
          const s0 = (c + off) / 3 % 1, s1 = s0 + 1 / 3;
          poly(ctx, [at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)]);
          ctx.fillStyle = tone(this.base, shade * (0.86 + 0.18 * hash2(P.tile.gx + c, P.tile.gy + r)), jit);
          ctx.fill();
        }
        ctx.strokeStyle = `rgba(0,0,0,${0.22 * P.weatherDark})`;
        const a = at(0, t1), b = at(1, t1); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    },
  },
  slate: {
    base: [220, 10, 40], fascia: [220, 8, 22],
    draw(ctx, q, P, shade, jit) {
      fillQuad(ctx, q, tone(this.base, shade, jit));
      const at = lf(q);
      for (let r = 0; r < 3; r++) {
        const t1 = (r + 1) / 3;
        ctx.strokeStyle = `rgba(0,0,0,0.3)`; ctx.lineWidth = 1;
        const a = at(0, t1 - 0.02), b = at(1, t1 - 0.02); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        for (let c = 0; c < 4; c++) {
          const s = (c + (r % 2) * 0.5) / 4;
          const p0 = at(s, t1 - 1 / 3), p1 = at(s, t1);
          ctx.strokeStyle = `rgba(255,255,255,0.06)`; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        }
      }
    },
  },
  clay: {
    base: [16, 62, 50], fascia: [14, 45, 28],
    draw(ctx, q, P, shade, jit) {
      fillQuad(ctx, q, tone(this.base, shade * 0.9, jit));
      const at = lf(q), cols = 4;
      for (let c = 0; c < cols; c++) {
        const s0 = c / cols, sm = (c + 0.5) / cols, s1 = (c + 1) / cols;
        poly(ctx, [at(s0, 0), at(sm, 0), at(sm, 1), at(s0, 1)]);
        ctx.fillStyle = tone([this.base[0], this.base[1], this.base[2] + 8], shade, jit); ctx.fill();
        const hl = at(sm, 0.5);
        ctx.strokeStyle = `rgba(255,230,200,0.18)`; ctx.lineWidth = 1;
        const a = at(sm, 0), b = at(sm, 1); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    },
  },
  thatch: {
    base: [44, 52, 48], fascia: [40, 45, 30],
    draw(ctx, q, P, shade, jit) {
      fillQuad(ctx, q, tone(this.base, shade * 0.92, jit));
      const at = lf(q);
      ctx.lineWidth = 1;
      for (let n = 0; n < 9; n++) {
        const s = hash2(P.tile.gx * 7 + n, P.tile.gy * 3);
        const p0 = at(s, 0.05 + 0.1 * hash2(n, P.tile.gy)), p1 = at(s + 0.04 - 0.08 * hash2(n, 1), 0.95);
        ctx.strokeStyle = tone(this.base, shade * (0.7 + 0.5 * hash2(n, P.tile.gx)), jit);
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
    },
  },
  flatstone: {
    base: [40, 8, 52], fascia: [40, 8, 30],
    draw(ctx, q, P, shade, jit) {
      fillQuad(ctx, q, tone(this.base, shade, jit));
      const at = lf(q);
      ctx.strokeStyle = `rgba(0,0,0,0.32)`; ctx.lineWidth = 1;
      for (let n = 0; n < 3; n++) {
        const a = at(hash2(P.tile.gx, n), 0), b = at(hash2(P.tile.gx + 5, n), 1);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        const c = at(0, (n + 1) / 3 * hash2(n, P.tile.gy)), d = at(1, (n + 1) / 3); ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
      }
    },
  },
  plank: {
    base: [30, 40, 42], fascia: [28, 38, 24],
    draw(ctx, q, P, shade, jit) {
      fillQuad(ctx, q, tone(this.base, shade, jit));
      const at = lf(q);
      for (let r = 0; r < 2; r++) {
        const t1 = (r + 1) / 2;
        ctx.strokeStyle = `rgba(0,0,0,0.34)`; ctx.lineWidth = 1.2;
        const a = at(0, t1 - 0.01), b = at(1, t1 - 0.01); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = `rgba(255,240,210,0.07)`;
        const g = at(0, t1 - 0.5), h = at(1, t1 - 0.5); ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.lineTo(h.x, h.y); ctx.stroke();
      }
    },
  },
  copper: {
    base: [22, 70, 50], fascia: [20, 60, 30],
    draw(ctx, q, P, shade, jit) {
      fillQuad(ctx, q, tone(this.base, shade * 1.05, jit));
      const at = lf(q);
      for (let c = 0; c < 3; c++) {
        const s = (c + 0.5) / 3;
        ctx.strokeStyle = `rgba(255,220,170,${0.3 * shade})`; ctx.lineWidth = 1.4;
        const a = at(s, 0), b = at(s, 1); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = `rgba(0,0,0,0.2)`; const c1 = at(s + 1 / 6, 0), c2 = at(s + 1 / 6, 1); ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.stroke();
      }
    },
  },
  patina: {
    base: [158, 36, 52], fascia: [160, 30, 30],
    draw(ctx, q, P, shade, jit) {
      fillQuad(ctx, q, tone(this.base, shade, jit));
      const at = lf(q);
      for (let n = 0; n < 6; n++) {
        const s = hash2(P.tile.gx * 3 + n, P.tile.gy * 5), t = hash2(n, P.tile.gx);
        const pt = at(s, t);
        ctx.fillStyle = `rgba(${30 + 60 * hash2(n, 2)},${120 + 40 * hash2(n, 3)},${110},0.25)`;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, view2(P) * (0.06 + 0.08 * hash2(n, 7)), 0, 6.28); ctx.fill();
      }
    },
  },
  metal: {
    base: [210, 6, 56], fascia: [210, 6, 32],
    draw(ctx, q, P, shade, jit) {
      fillQuad(ctx, q, tone(this.base, shade * 1.08, jit));
      const at = lf(q);
      for (let c = 0; c < 3; c++) {
        const s = (c + 0.5) / 3;
        ctx.strokeStyle = `rgba(255,255,255,${0.22 * shade})`; ctx.lineWidth = 1.3;
        const a = at(s, 0), b = at(s, 1); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    },
  },
  sod: {
    base: [104, 42, 38], fascia: [30, 40, 24],
    draw(ctx, q, P, shade, jit) {
      fillQuad(ctx, q, tone(this.base, shade * 0.95, jit + 0.3));
      const at = lf(q);
      for (let n = 0; n < 14; n++) {
        const s = hash2(P.tile.gx * 9 + n, P.tile.gy), t = hash2(n, P.tile.gy * 2);
        const p0 = at(s, t), p1 = at(s + 0.02, t - 0.12);
        ctx.strokeStyle = tone([100 + 20 * hash2(n, 1), 50, 40], shade, 0); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
    },
  },
  bone: {
    base: [44, 22, 78], fascia: [40, 18, 50],
    draw(ctx, q, P, shade, jit) {
      fillQuad(ctx, q, tone(this.base, shade, jit));
      const at = lf(q);
      for (let c = 0; c < 3; c++) {
        const s = (c + 0.5) / 3;
        ctx.strokeStyle = `rgba(90,80,60,0.3)`; ctx.lineWidth = 1.3;
        const a = at(s, 0.08), b = at(s, 0.92); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    },
  },
  crystal: {
    base: [264, 56, 56], fascia: [264, 40, 30],
    draw(ctx, q, P, shade, jit) {
      fillQuad(ctx, q, tone(this.base, shade * 1.1, jit));
      const at = lf(q), m = at(0.5, 0.4);
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * shade})`; ctx.lineWidth = 1.2;
      for (const c of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const e = at(c[0], c[1]); ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(e.x, e.y); ctx.stroke(); }
    },
  },
  glazed: {
    base: [200, 64, 50], fascia: [200, 50, 28],
    draw(ctx, q, P, shade, jit) {
      fillQuad(ctx, q, tone(this.base, shade, jit));
      const at = lf(q), cols = 4;
      for (let c = 0; c < cols; c++) {
        const s = (c + 0.5) / cols; const a = at(s, 0), b = at(s, 1);
        ctx.strokeStyle = `rgba(0,0,0,0.2)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      const g = at(0.3, 0.25); ctx.fillStyle = `rgba(255,255,255,${0.32 * shade})`; ctx.beginPath(); ctx.arc(g.x, g.y, view2(P) * 0.12, 0, 6.28); ctx.fill();
    },
  },
  mystic: {
    base: [286, 60, 40], fascia: [286, 50, 22],
    draw(ctx, q, P, shade, jit) {
      fillQuad(ctx, q, tone(this.base, shade, jit));
      const at = lf(q);
      for (let n = 0; n < 4; n++) {
        const s = hash2(P.tile.gx + n, P.tile.gy * 3), t = hash2(n, P.tile.gx + 1);
        const pt = at(s, t); const glow = 0.4 + 0.5 * hash2(n, 9);
        ctx.fillStyle = `rgba(${180 + 60 * hash2(n, 1)},${120},255,${0.5 * glow})`;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, view2(P) * 0.1 * glow, 0, 6.28); ctx.fill();
      }
    },
  },
};
function view2(P) { return P.view ? P.view.tile : 12; }

export const MATERIAL_IDS = Object.keys(RECIPES);

export function makeMaterial(id, params = {}) {
  const recipe = RECIPES[id] || RECIPES.shingle;
  const base = [
    params.hue != null ? +params.hue : recipe.base[0],
    params.sat != null ? +params.sat : recipe.base[1],
    params.light != null ? +params.light : recipe.base[2],
  ];
  const moss = params.moss ?? 0;
  // moss/age is folded into the BASE TONE (subtle green-shift + darken), NOT drawn as
  // overlay dots — keeps it reading as weathered texture, never circles.
  if (moss > 0) { base[0] = base[0] + (105 - base[0]) * moss * 0.22; base[1] = base[1] + (32 - base[1]) * moss * 0.12; base[2] *= (1 - moss * 0.1); }
  const weatherDark = 1 + (params.weathering ?? 0) * 1.2;
  return {
    id,
    fillTile(ctx, quad, tile, shade, view, grid) {
      const jit = (hash2(tile.gx, tile.gy) - 0.5) * (1 + (params.weathering ?? 0) * 2);
      const P = { tile, view, weatherDark, base };
      const local = Object.create(recipe); local.base = base;
      local.draw(ctx, quad, P, clamp(shade, 0, 1.2), jit);
      if (params.weathering) { poly(ctx, quad); ctx.fillStyle = `rgba(20,18,14,${0.22 * params.weathering})`; ctx.fill(); }
    },
    fasciaColor(shade) { return hsl(recipe.fascia[0], recipe.fascia[1], recipe.fascia[2] * (0.5 + 0.6 * shade)); },
  };
}
