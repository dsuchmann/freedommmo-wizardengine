// Silhouette measurements for traversal templates (Plan B).
// Input: decoded alpha { w, h, alpha } + trim [x,y,w,h] (file px).
// Output (trim-local px, ints): {
//   bands[16]  — max silhouette row-width per vertical band (top -> bottom),
//   baseW      — max row width in the bottom 15% of the trim (footprint band),
//   coreW,coreX— narrowest row width + its center-x in the 20%..60%-from-bottom
//                band (the trunk), excluding empty rows,
//   visH       — trim height.
// }
// Raw measurements only — interpretation lives in src/world/traversal-templates.js,
// so template tuning never requires catalog regen.
export function measureSilhouette(img, trim) {
  if (!img || !trim) return null;
  const [tx, ty, tw, th] = trim;
  if (!(tw > 0) || !(th > 0)) return null;
  if (tx < 0 || ty < 0 || tx + tw > img.w || ty + th > img.h) {
    throw new Error(`trim [${tx},${ty},${tw},${th}] outside image ${img.w}x${img.h}`);
  }
  // per-row widths + centers within the trim window
  const widths = new Array(th).fill(0);
  const centers = new Array(th).fill(0);
  for (let y = 0; y < th; y++) {
    let minX = tw, maxX = -1;
    const row = (ty + y) * img.w;
    for (let x = 0; x < tw; x++) {
      if (img.alpha[row + tx + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (maxX >= 0) {
      widths[y] = maxX - minX + 1;
      centers[y] = (minX + maxX + 1) >> 1;
    }
  }
  // bands: 16 vertical bands, each the max row width inside the band
  const bands = new Array(16).fill(0);
  for (let b = 0; b < 16; b++) {
    const y0 = Math.floor(b * th / 16), y1 = Math.max(y0 + 1, Math.floor((b + 1) * th / 16));
    for (let y = y0; y < y1 && y < th; y++) if (widths[y] > bands[b]) bands[b] = widths[y];
  }
  // baseW: bottom 15% of rows
  let baseW = 0;
  for (let y = Math.floor(th * 0.85); y < th; y++) if (widths[y] > baseW) baseW = widths[y];
  // core: narrowest non-empty row where (th - 1 - y) / th in [0.20, 0.60]
  let coreW = 0, coreX = tw >> 1;
  for (let y = 0; y < th; y++) {
    const fromBottom = (th - 1 - y) / th;
    if (fromBottom < 0.20 || fromBottom > 0.60 || widths[y] === 0) continue;
    if (coreW === 0 || widths[y] < coreW) { coreW = widths[y]; coreX = centers[y]; }
  }
  if (coreW === 0) { coreW = baseW || bands.find(v => v > 0) || 0; }
  return { bands, baseW, coreW, coreX, visH: th };
}
