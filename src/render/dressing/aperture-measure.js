// src/render/dressing/aperture-measure.js
// Measures a window tile's OPENING by diffing it against the plain wall tile of the same material. The
// window tile is a create_object_state OF that base wall (same wall pattern, with a hole cut), so the two
// images differ ONLY where the opening is. The diff's bounding box gives the true opening, so the sill
// socket sits on the real glass (bottom-centre) instead of a guessed fraction. Measured once per material,
// cached; returns null until both tiles have loaded (the socket falls back to its default sill meanwhile).

import { onSceneDiscontinuity } from '../../core/scene-teardown.js';

const _imgs = new Map();
const _cache = new Map(); // windowUrl -> { xFrac, sillV } | null
onSceneDiscontinuity(function () {
  for (const v of _imgs.values()) { try { if (v) v.src = ''; } catch (e) {} }
  _imgs.clear();
  _cache.clear();
});
function img(url) { let im = _imgs.get(url); if (!im) { im = new Image(); im.src = url; _imgs.set(url, im); } return (im.complete && im.naturalWidth) ? im : null; }
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}

/** { xFrac, sillV } for the window opening (fractions of the tile), or null until the tiles load.
 *  xFrac = opening horizontal centre; sillV = sill height (0 = ground line, 1 = storey top). */
export function measureWindowAnchor(plainUrl, windowUrl) {
  if (_cache.has(windowUrl)) return _cache.get(windowUrl);
  const p = img(plainUrl), wv = img(windowUrl);
  if (!p || !wv) return null; // not loaded yet — caller uses the default sill until then
  const W = wv.naturalWidth, H = wv.naturalHeight;
  const cv = makeCanvas(W, H); if (!cv) return null;
  const cx = cv.getContext('2d', { willReadFrequently: true }); if (!cx) return null;
  cx.clearRect(0, 0, W, H); cx.drawImage(p, 0, 0, W, H);
  const A = cx.getImageData(0, 0, W, H).data;
  cx.clearRect(0, 0, W, H); cx.drawImage(wv, 0, 0, W, H);
  const B = cx.getImageData(0, 0, W, H).data;
  // The window opening (bright glass/frame replacing wall) is a STRONG, DENSE difference; a state regen
  // also leaves faint scattered noise across the whole wall. Count only strong diffs, per row + column,
  // then keep the dense band (≥25% of the peak) so the noise is ignored and we isolate the opening.
  const STRONG = 150;
  const rowCnt = new Int32Array(H), colCnt = new Int32Array(W);
  let maxRow = 0, maxCol = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) + Math.abs(A[i + 3] - B[i + 3]);
      if (d > STRONG) { rowCnt[y]++; colCnt[x]++; }
    }
  }
  for (let y = 0; y < H; y++) if (rowCnt[y] > maxRow) maxRow = rowCnt[y];
  for (let x = 0; x < W; x++) if (colCnt[x] > maxCol) maxCol = colCnt[x];
  let anchor;
  if (maxRow === 0) {
    anchor = { xFrac: 0.5, sillV: null }; // no opening detected → caller uses the default sill
  } else {
    const rT = Math.max(2, maxRow * 0.25), cT = Math.max(2, maxCol * 0.25);
    let minX = W, maxX = -1, minY = H, maxY = -1;
    for (let y = 0; y < H; y++) if (rowCnt[y] >= rT) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    for (let x = 0; x < W; x++) if (colCnt[x] >= cT) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    anchor = { xFrac: (minX + maxX) / 2 / W, sillV: 1 - (maxY + 1) / H };
    // Guards against state-regen noise (generated tiles aren't pixel-consistent): the renderer always
    // CENTRES the window, and a sill sits in the lower-middle of the wall. A measurement outside those
    // bounds is noise → snap x to centre / drop the sill so the caller uses its sensible default.
    if (Math.abs(anchor.xFrac - 0.5) > 0.15) anchor.xFrac = 0.5;
    if (!(anchor.sillV > 0.06 && anchor.sillV < 0.6)) anchor.sillV = null;
  }
  _cache.set(windowUrl, anchor);
  return anchor;
}
