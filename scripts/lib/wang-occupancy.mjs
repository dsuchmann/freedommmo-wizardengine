// Wang tile occupancy analyzer (Plan B): which cells of an 8x8 grid inside a
// 32px wang tile contain the drawn wall/ledge band. Consumed at catalog/gen
// time for tilesets on the COLLIDABLE_WANG list (src/world/wang-collision.js).
// Input: { w, h, alpha } (decodeAlpha) — or any per-pixel band mask in the
// same shape (art-band analysis can feed a synthetic "alpha").
export function occupancyGrid(img, opts = {}) {
  const minFrac = opts.minFrac ?? 0.15;
  const grid = new Uint8Array(64);
  const cw = img.w / 8, ch = img.h / 8;
  for (let cy = 0; cy < 8; cy++) {
    for (let cx = 0; cx < 8; cx++) {
      let hits = 0, total = 0;
      const x0 = Math.floor(cx * cw), x1 = Math.floor((cx + 1) * cw);
      const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        total++;
        if (img.alpha[y * img.w + x] > 0) hits++;
      }
      grid[cy * 8 + cx] = total > 0 && hits / total >= minFrac ? 1 : 0;
    }
  }
  return grid;
}
