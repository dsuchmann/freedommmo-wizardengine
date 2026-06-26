// src/render/dressing/vine-overlay.js
// In-GL placement overlay for the D2 climbing-vine SPLINES (the de-risk step before generating any ivy art).
// Draws each vine's climb path as a stem line + a root marker + leaf dots, composited into the SCENE FBO via
// gl-compositor.drawSceneOverlayBitmap() (CLAUDE.md: world content goes through GL, never a 2D top-pass) — so
// the paths sit on the walls under the same lighting/CRT as the building. Toggle:
//     window._vineOverlay.enabled = true        // show the paths
//     window._vineOverlay.rootChance = 1        // (optional) crank density so every bare strip roots a vine
// Mirrors socket-overlay.js. Non-premultiplied alpha — drawSceneOverlayBitmap re-premultiplies.
import { buildVineSplines } from './vine-index.js';
import { projectSocket } from './socket-index.js';

export const VINE_OVERLAY = { enabled: false, rootChance: null };
if (typeof window !== 'undefined') window._vineOverlay = window._vineOverlay || VINE_OVERLAY;

let _cv = null, _cx = null;
function ensure(w, h) {
  if (!_cv || _cv.width !== w || _cv.height !== h) {
    _cv = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h)
      : (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!_cv) return false;
    _cv.width = w; _cv.height = h; _cx = _cv.getContext('2d');
  }
  return true;
}

function proj(b, runY, pt, camX, camY, tilePx) {
  return projectSocket(b, { runY, cxLocal: pt.cxLocal, v: pt.v, floor: 0, kind: 'vine' }, camX, camY, tilePx);
}

/** Per-frame vine-path bitmap for the near buildings, or null when disabled / empty / no canvas. */
export function buildVineOverlayBitmap(buildings, camX, camY, tilePx, w, h) {
  const cfg = (typeof window !== 'undefined' && window._vineOverlay) || VINE_OVERLAY;
  if (!cfg.enabled || !buildings || !buildings.length) return null;
  if (!ensure(w, h)) return null;
  const ctx = _cx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  // The proof knob cranks BOTH gates (per-building + per-strip) so vines show everywhere for testing; leave it
  // null to see the realistic selective ~15%-of-buildings default.
  const opts = (cfg.rootChance != null) ? { rules: { rootChance: cfg.rootChance, buildingChance: cfg.rootChance } } : {};
  let drew = false;
  for (const b of buildings) {
    let splines; try { splines = buildVineSplines(b, opts); } catch { continue; }
    for (const sp of splines) {
      // Draw deepest twigs first so the thicker main stem reads ON TOP (a hint of the eventual paint order).
      const branches = sp.branches.slice().sort((a, c) => c.depth - a.depth);
      let any = false;
      for (const br of branches) {
        const pts = br.pts.map((pt) => proj(b, sp.runY, pt, camX, camY, tilePx));
        if (pts.every((p) => p.x < -32 || p.x > w + 32 || p.y < -32 || p.y > h + 32)) continue;
        any = true;
        // stem — thicker/darker at the trunk (depth 0), thinner for twigs
        ctx.strokeStyle = br.depth === 0 ? 'rgba(34,96,42,0.95)' : 'rgba(58,134,64,0.9)';
        ctx.lineWidth = Math.max(1.4, 3.2 - br.depth); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        // leaf dots — denser on lusher vines (complexity) and toward the tips
        ctx.fillStyle = 'rgba(108,194,74,0.95)';
        const every = sp.complexity > 0.66 ? 1 : sp.complexity > 0.33 ? 2 : 3;
        for (let i = 1; i < pts.length; i += every) { ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, 2.6, 0, Math.PI * 2); ctx.fill(); }
      }
      if (!any) continue;
      // root marker at the wall base (main stem's first point)
      const root = proj(b, sp.runY, sp.branches[0].pts[0], camX, camY, tilePx);
      ctx.fillStyle = '#7a4a2c'; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(root.x, root.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      drew = true;
    }
  }
  return drew ? _cv : null;
}
