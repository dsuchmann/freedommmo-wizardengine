// src/render/dressing/vine-render.js
// D2 climbing-vine RENDER — tiles the generated kit (vine_root_base / vine_segment / vine_fork /
// vine_leaf_cluster) along the placement splines from vine-index.js, painting INTO the building silhouette
// bitmap during the BEFORE-roof pass of building-occluder.drawBuildingTextured(). So the vine (a) inherits GL
// lighting/CRT like the wall, (b) is OCCLUDED at the top by the roof eave (the climb caps at the eave), and
// (c) is part of the depth-sorted CACHED sprite — the static stem bakes once (no per-frame cost). The one
// animating piece (leaf flutter) is deferred to the dynamic layer. Per-biome SKIN is just the art on disk
// (grassland=ivy, …); this renderer is biome-invariant. Gated by renderOn('vines').
import { buildVineSplines, getVineShape, BIOME_FORM } from './vine-index.js';
import { projectSocket } from './socket-index.js';
import { rand2 } from '../../core/random.js';

// Per-FORM "stem" style for the CONTIGUITY underlay: a continuous tapered stroke is drawn along each branch in
// this colour FIRST (one unbroken silhouette → reads as a single organism, not stacked stamps), then the PixelLab
// asset is stamped ON TOP for the real surface texture (user 2026-06-27: tiled sprites looked copy-pasted; draw
// the structure, blend in the asset). stemW = stroke width as a fraction of the piece size.
const FORM_STYLE = {
  vine:    { stemColor: '#3b2a17', stemW: 0.30 },
  crystal: { stemColor: '#9fb4d4', stemW: 0.34 },
  column:  { stemColor: '#1b1920', stemW: 0.60 },
  spire:   { stemColor: '#574b3f', stemW: 0.50 },
  mound:   { stemColor: '#c3a368', stemW: 0.72 },
};
const formStyleOf = (biome) => FORM_STYLE[BIOME_FORM[biome] || 'vine'] || FORM_STYLE.vine;

const ROOT = '/assets/pixelab/buildings/dressing/';
const _img = new Map();
function img(url) { let im = _img.get(url); if (!im) { im = new Image(); im.src = url; _img.set(url, im); } return (im.complete && im.naturalWidth) ? im : null; }
function variants(biome, piece) { const a = []; for (let i = 0; i < 8; i++) { const im = img(ROOT + biome + '/' + piece + '/base__v' + i + '.png'); if (im) a.push(im); } return a; }

// chance=null → use the live selective defaults (buildVineSplines: ~15% of buildings). Set window._vines.chance
// (0..1) + call window.invalidateBuildingSprites() to re-bake denser for testing. segTile = segment draw size
// (tiles); stepFrac = overlap spacing as a fraction of segTile (smaller = denser/more continuous).
export const VINE_RENDER = { enabled: true, chance: null, segTile: 1.0, stepFrac: 0.42, leafTile: 0.85, stem: true };
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

// SHAPE-FILL render mode (for the BASAL form, e.g. desert sand mound). A heap is too-simple a geometry to tile a
// sprite (it reads as stamped fans); instead DRAW the mound silhouette procedurally and FILL it with a flat
// PixelLab TEXTURE (pixel-interpolated), plus dune shading — user 2026-06-27. The skeleton's arc is the mound's
// top profile; the run groundline is its base.
const SAND_GRAIN = ['#cda968', '#bf9a58', '#d8b87a', '#b0894e', '#e0c488', '#9a7740', '#86682f'];
function drawMound(ctx, b, biome, splines, camX, camY, tilePx, w, h) {
  const tex = img(ROOT + biome + '/sand_texture/base__v0.png'); // flat fill texture (fallback to a colour)
  for (const sp of splines) {
    const br = sp.branches[0]; if (!br || br.pts.length < 2) continue;
    const arc = br.pts.map((pt) => proj(b, sp.runY, pt, camX, camY, tilePx));     // undulating TOP profile
    const baseY = proj(b, sp.runY, { cxLocal: br.pts[0].cxLocal, v: 0 }, camX, camY, tilePx).y; // groundline
    let minX = 1e9, maxX = -1e9, minY = 1e9;
    for (const p of arc) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; }
    if (maxX < -32 || minX > w + 32 || minY > h + 32 || baseY < -32) continue;
    const coreBot = baseY - 0.12 * tilePx; // the SOLID part stops just shy of the groundline; below is all grains
    const bx = Math.floor(minX) - 1, by = Math.floor(minY) - 1, bw = Math.ceil(maxX - minX) + 2, bh = Math.ceil(coreBot - minY) + 2;
    ctx.save();
    // SOLID core: undulating top (arc) → a flat-ish line just above the groundline. The whole BOTTOM is then a
    // grain dissolve (below), so there is NO clean solid bottom line where it meets the floor.
    ctx.beginPath(); ctx.moveTo(arc[0].x, arc[0].y);
    for (let i = 1; i < arc.length; i++) ctx.lineTo(arc[i].x, arc[i].y);
    ctx.lineTo(arc[arc.length - 1].x, coreBot); ctx.lineTo(arc[0].x, coreBot);
    ctx.closePath(); ctx.clip();
    ctx.fillStyle = '#cda968'; ctx.fillRect(bx, by, bw, bh);                       // opaque base (beats alpha<0.5 discard)
    if (tex) { const pat = ctx.createPattern(tex, 'repeat'); if (pat) { ctx.fillStyle = pat; ctx.fillRect(bx, by, bw, bh); } }
    const g = ctx.createLinearGradient(0, minY, 0, coreBot);                       // dune shading: lit crest → shadowed foot
    g.addColorStop(0, 'rgba(255,246,214,0.30)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(54,36,12,0.42)');
    ctx.fillStyle = g; ctx.fillRect(bx, by, bw, bh);
    ctx.restore();
    // DISSOLVE the edges into a grain field: dense (near-solid) at the edge, thinning to a long sparse tail.
    // shaded — some grains darker — so it reads as scattered sand on the floor, not a flat colour wash.
    const scatter = (edge, dirY, band, count, fall) => {
      for (const p of edge) for (let gi = 0; gi < count; gi++) {
        const r = rand2((p.x * 5) | 0, ((p.y * 5) | 0) + gi * 17, 0xD2E1);
        const px = Math.round(p.x + (rand2((p.x * 3) | 0, ((p.y * 3) | 0) + gi, 0xD2E2) - 0.5) * 4.5);
        const py = Math.round(p.y + dirY * Math.pow(r, fall) * band);
        if (px < -2 || px > w + 2 || py < -2 || py > h + 2) continue;
        const sz = r < 0.5 ? 2 : 1;                                                // bigger chunks near the edge
        ctx.fillStyle = SAND_GRAIN[(gi + (px & 7)) % SAND_GRAIN.length];
        ctx.fillRect(px, py, sz, sz);
      }
    };
    const ground = arc.map((p) => ({ x: p.x, y: baseY }));                          // bottom dissolve anchored at the groundline
    scatter(arc, -1, 0.6 * tilePx, 7, 2.0);    // TOP (against the wall): a soft grainy contact edge
    scatter(ground, 1, 1.5 * tilePx, 22, 2.3); // BOTTOM: dense at the base → LONG sparse tail spilling onto the floor
  }
}

/** Paint a building's vines into ctx (the silhouette bitmap), BEFORE the roof. No-op when the art isn't loaded
 *  (the building has no vine that frame; the cache waits via vineArtReady) or the building rolls no vine. */
export function drawVinePass(ctx, b, camX, camY, tilePx, w, h) {
  const cfg = (typeof window !== 'undefined' && window._vines) || VINE_RENDER;
  if (cfg.enabled === false) return;
  const biome = b && b.biome; if (!biome) return;
  const opts = (cfg.chance != null) ? { rules: { buildingChance: cfg.chance, rootChance: Math.max(cfg.chance, 0.6) } } : {};
  let splines; try { splines = buildVineSplines(b, opts); } catch { return; }
  if (!splines.length) return;
  // BASAL forms (sand mound) render as a procedural SHAPE filled with a TEXTURE — NOT a tiled kit (a heap tiles
  // ugly). Gate on the fill TEXTURE it actually uses, not vine_segment.
  if (getVineShape(biome).basal) {
    if (!img(ROOT + biome + '/sand_texture/base__v0.png')) return; // fill texture not loaded yet → absent
    ctx.save(); ctx.imageSmoothingEnabled = false; try { drawMound(ctx, b, biome, splines, camX, camY, tilePx, w, h); } catch { /* skip */ } ctx.restore(); return;
  }
  // KIT-tiled forms need their segment + accent art.
  const segs = variants(biome, 'vine_segment'); if (!segs.length) return; // art not loaded → absent
  const roots = variants(biome, 'vine_root_base');
  const forks = variants(biome, 'vine_fork');
  const leaves = variants(biome, 'vine_leaf_cluster');
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
  const blitRot = (sprite, x, y, sz, ang, flip) => {
    if (!sprite || x < -sz * 1.6 || x > w + sz * 1.6 || y < -sz * 1.6 || y > h + sz * 1.6) return;
    ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(ang); if (flip) ctx.scale(-1, 1);
    ctx.drawImage(sprite, 0, 0, sprite.naturalWidth, sprite.naturalHeight, -sz / 2, -sz / 2, sz, sz);
    ctx.restore();
  };
  // CONTIGUITY UNDERLAY — one continuous tapered stroke along the whole branch (a single unbroken silhouette in
  // the form's stem colour), drawn BEFORE the texture stamps so the organism reads as one piece, not stacked tiles.
  const style = formStyleOf(biome);
  const drawStem = (path, depth) => {
    if (cfg.stem === false || path.length < 2) return;
    ctx.save(); ctx.strokeStyle = style.stemColor; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, seg * style.stemW * (1 - depth * 0.22));
    ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke(); ctx.restore();
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
      drawStem(path, br.depth); // continuous silhouette UNDER the texture
      for (let i = 0; i < path.length; i++) {
        const a = path[Math.max(0, i - 1)], c = path[Math.min(path.length - 1, i + 1)];
        const ang = Math.atan2(c.x - a.x, -(c.y - a.y)); // 0 = straight up
        blitRot(segSprite, path[i].x, path[i].y, seg, ang, (i % 2) === 1); // alt-flip → break the copy-paste repeat
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
