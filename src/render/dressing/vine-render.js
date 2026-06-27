// src/render/dressing/vine-render.js
// D2 climbing-vine RENDER — tiles the generated kit (vine_root_base / vine_segment / vine_fork /
// vine_leaf_cluster) along the placement splines from vine-index.js, painting INTO the building silhouette
// bitmap during the BEFORE-roof pass of building-occluder.drawBuildingTextured(). So the vine (a) inherits GL
// lighting/CRT like the wall, (b) is OCCLUDED at the top by the roof eave (the climb caps at the eave), and
// (c) is part of the depth-sorted CACHED sprite — the static stem bakes once (no per-frame cost). The one
// animating piece (leaf flutter) is deferred to the dynamic layer. Per-biome SKIN is just the art on disk
// (grassland=ivy, …); this renderer is biome-invariant. Gated by renderOn('vines').
import { buildVineSplines, getVineShape } from './vine-index.js';
import { projectSocket } from './socket-index.js';
import { rand2 } from '../../core/random.js';

const ROOT = '/assets/pixelab/buildings/dressing/';
const _img = new Map();
function img(url) { let im = _img.get(url); if (!im) { im = new Image(); im.src = url; _img.set(url, im); } return (im.complete && im.naturalWidth) ? im : null; }
function variants(biome, piece) { const a = []; for (let i = 0; i < 8; i++) { const im = img(ROOT + biome + '/' + piece + '/base__v' + i + '.png'); if (im) a.push(im); } return a; }

// chance=null → use the live selective defaults (buildVineSplines: ~15% of buildings). Set window._vines.chance
// (0..1) + call window.invalidateBuildingSprites() to re-bake denser for testing. segTile = segment draw size
// (tiles); stepFrac = overlap spacing as a fraction of segTile (smaller = denser/more continuous).
export const VINE_RENDER = { enabled: true, chance: null, segTile: 1.0, stepFrac: 0.55, leafTile: 0.85 };
if (typeof window !== 'undefined') window._vines = window._vines || VINE_RENDER;

/** True once this biome's vine SEGMENT art is on disk + decoded — the cache's completeness check waits on this
 *  so it never freezes a vine-bearing building's sprite BEFORE the ivy loaded. */
export function vineArtReady(biome) { return variants(biome, 'vine_segment').length > 0; }

function proj(b, runY, pt, camX, camY, tilePx) {
  return projectSocket(b, { runY, cxLocal: pt.cxLocal, v: pt.v, floor: 0, kind: 'vine' }, camX, camY, tilePx);
}

// Resample a projected polyline to evenly-spaced points every `step` px (so segments tile continuously along
// the meandering path regardless of the source sampling).
function resample(pts, step) {
  if (pts.length < 2) return pts.slice();
  const out = [pts[0]]; let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const x0 = pts[i - 1].x, y0 = pts[i - 1].y, x1 = pts[i].x, y1 = pts[i].y;
    const segLen = Math.hypot(x1 - x0, y1 - y0); if (segLen < 1e-3) continue;
    const dx = (x1 - x0) / segLen, dy = (y1 - y0) / segLen;
    let dist = step - carry;
    while (dist < segLen) { out.push({ x: x0 + dx * dist, y: y0 + dy * dist }); dist += step; }
    carry = segLen - (dist - step);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Paint a building's vines into ctx (the silhouette bitmap), BEFORE the roof. No-op when the art isn't loaded
 *  (the building has no vine that frame; the cache waits via vineArtReady) or the building rolls no vine. */
export function drawVinePass(ctx, b, camX, camY, tilePx, w, h) {
  const cfg = (typeof window !== 'undefined' && window._vines) || VINE_RENDER;
  if (cfg.enabled === false) return;
  const biome = b && b.biome; if (!biome) return;
  const segs = variants(biome, 'vine_segment'); if (!segs.length) return; // art not loaded → absent
  const roots = variants(biome, 'vine_root_base');
  const forks = variants(biome, 'vine_fork');
  const leaves = variants(biome, 'vine_leaf_cluster');
  const opts = (cfg.chance != null) ? { rules: { buildingChance: cfg.chance, rootChance: Math.max(cfg.chance, 0.6) } } : {};
  let splines; try { splines = buildVineSplines(b, opts); } catch { return; }
  if (!splines.length) return;
  const formSeg = getVineShape(biome).segTile || 1.0; // per-form piece size (thick basalt pillar vs thin tendril)
  const seg = Math.max(6, Math.round(tilePx * formSeg * (cfg.segTile || 1.0)));
  const leafSz = Math.max(6, Math.round(tilePx * formSeg * (cfg.leafTile || 0.85)));
  const step = Math.max(4, seg * (cfg.stepFrac || 0.55));
  const blit = (sprite, x, y, sz, dy0 = 0) => {
    if (!sprite || x < -sz || x > w + sz || y < -sz || y > h + sz) return;
    ctx.drawImage(sprite, 0, 0, sprite.naturalWidth, sprite.naturalHeight, Math.round(x - sz / 2), Math.round(y - sz / 2 + dy0), sz, sz);
  };
  // Stamp a segment ROTATED to the local path tangent so the stem FOLLOWS the skeleton's curve (the segment art
  // grows bottom→top, ang=0 is straight up; tilt = atan2(dx, -dy) of the path direction).
  const blitRot = (sprite, x, y, sz, ang) => {
    if (!sprite || x < -sz * 1.6 || x > w + sz * 1.6 || y < -sz * 1.6 || y > h + sz * 1.6) return;
    ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(ang);
    ctx.drawImage(sprite, 0, 0, sprite.naturalWidth, sprite.naturalHeight, -sz / 2, -sz / 2, sz, sz);
    ctx.restore();
  };
  ctx.save(); ctx.imageSmoothingEnabled = false;
  for (const sp of splines) {
    const vseed = Math.floor(rand2((b.x + Math.round(sp.rootX)) | 0, (b.y + sp.runY) | 0, 0xD2C1) * 1e6);
    const pick = (arr, salt) => (arr.length ? arr[(vseed ^ salt) % arr.length] : null);
    const segSprite = pick(segs, 0x11); // one ivy style per vine (consistent organism)
    // 1) STEMS — tile segments up every branch (deepest twigs first, trunk last → trunk reads on top), each
    //    ROTATED to the local path tangent so it follows the skeleton's meander/branch angle.
    for (const br of sp.branches.slice().sort((a, c) => c.depth - a.depth)) {
      const path = resample(br.pts.map((pt) => proj(b, sp.runY, pt, camX, camY, tilePx)), step);
      for (let i = 0; i < path.length; i++) {
        const a = path[Math.max(0, i - 1)], c = path[Math.min(path.length - 1, i + 1)];
        const ang = Math.atan2(c.x - a.x, -(c.y - a.y)); // 0 = straight up
        blitRot(segSprite, path[i].x, path[i].y, seg, ang);
      }
    }
    // 2) FORKS at each branch junction (a child branch's base)
    for (const br of sp.branches) { if (br.depth === 0) continue; const p = proj(b, sp.runY, br.pts[0], camX, camY, tilePx); blit(pick(forks, 0x22), p.x, p.y, seg); }
    // 3) ROOT BASE at the main stem's foot (its bottom sits ON the ground line → bias the sprite up a touch)
    { const p = proj(b, sp.runY, sp.branches[0].pts[0], camX, camY, tilePx); blit(pick(roots, 0x33), p.x, p.y, seg, -seg * 0.32); }
    // 4) LEAF tips at each branch end (most visible; deferred until the leaf art exists → no-op if empty)
    for (const br of sp.branches) { const tip = br.pts[br.pts.length - 1]; const p = proj(b, sp.runY, tip, camX, camY, tilePx); blit(pick(leaves, 0x44 + br.depth), p.x, p.y, leafSz); }
  }
  ctx.restore();
}
