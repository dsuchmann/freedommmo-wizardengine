// src/render/dressing/vine-index.js
// D2 PLACED GROWTH — climbing-vine SPLINE placement (the "grow" capability beyond the D2 coverage decals).
// The manifest category `d2_ivy_vines` declares: one-or-more vine ROOTS seeded at the wall base (foundation
// course), growing UPWARD as a spline (anchor `wall_base_to_eave`, method `spline`, fit `grow`), tiling
// segment pieces, capped at min(rule_cap, wall_top) with a per-root random fraction (climb maturity would be
// an AGE scalar but age is honestly absent → a per-root random, NOT a faked age), ROUTING AROUND aperture
// blocked-zones (windows / door / above-door sign zone). Density 0–3 roots per wall surface (run).
//
// This module emits the PLACEMENT only — the climb PATHS in building-LOCAL terms — so an in-GL overlay
// (vine-overlay.js) can prove the addressing BEFORE any PixelLab segment art is generated. The eventual
// renderer tiles the generated ivy_root_base/segment/fork/leaf_cluster kit along these same paths.
//
// Pure (no DOM), unit-tested. A vine point is { cxLocal, v } where v = height in STOREY-BANDS (0 = wall base,
// `stories` = eave); project it with the SAME storey-stack as a socket: projectSocket(b,{runY,cxLocal,v,floor:0},…).
import { buildingFloors } from '../building-shadow.js';
import { southRuns } from '../building-tiles.js';
import { rand2 } from '../../core/random.js';

// Placement rules (tunable live via the overlay/Dev HUD for the proof; bake the chosen values into the field's
// DEFAULTS once tuned). The avoid-set (windows / door / above_door) is realised as blocked x-COLUMNS: windows
// stack on every storey so a window column is blocked full-height; the door column is blocked full-height too
// (covers the door path AND the above-door sign zone the manifest lists). The vine climbs only the BARE strips
// between those columns → it never crosses glass or the doorway.
export const VINE_RULES = {
  doorHalf: 1.3,   // door column half-width to keep clear (tiles) — door span + its above-door sign zone
  winHalf: 1.0,    // window column half-width to keep clear (windows stack every storey → full-height block)
  minStrip: 0.7,   // a climbable bare strip must be at least this wide to host a vine root
  edge: 0.15,      // keep the root off the very wall corner
  maxRoots: 3,     // manifest: 0–3 roots per wall surface (run)
  rootChance: 0.5, // per clear strip: chance a vine roots there (× abandonBoost). PROOF default is generous so
                   // the placement is visible; shipped density is ~0.2 ordinary, ~0.85 for the abandoned role.
  capMin: 0.55, capSpan: 0.45, // climb height = (capMin + capSpan·rand)·stories per root (age honestly absent)
  meanderAmp: 0.3, // max horizontal wander of the stem (tiles), further bounded by the strip width
};

// Merge sorted [a,b] intervals into non-overlapping spans.
function mergeIntervals(iv) {
  iv.sort((a, c) => a[0] - c[0]);
  const out = [];
  for (const x of iv) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
    else out.push([x[0], x[1]]);
  }
  return out;
}

/** Climbing-vine splines for a building. Returns [{ runY, rootX, pts:[{cxLocal,v}] }] in building-local terms.
 *  Each vine roots at the wall base inside a BARE strip (clear of door/window columns) and climbs, meandering
 *  within that strip (so the stem never crosses an aperture), up to a per-root height cap.
 *  opts: { rules?: Partial<VINE_RULES>, abandonBoost?: number }. */
export function buildVineSplines(b, opts = {}) {
  const fp = b && b.footprint; if (!fp) return [];
  const runs = southRuns(fp); if (!runs.length) return [];
  const stories = Math.max(1, buildingFloors(b));
  const R = { ...VINE_RULES, ...(opts.rules || {}) };
  const boost = opts.abandonBoost || 1; // abandoned/overgrown role turns the field up (D7); 1× until that role exists
  const splines = [];
  for (const r of runs) {
    // Blocked x-columns within this run (doors + windows), merged.
    const occ = [];
    for (const d of (fp.doors || [])) if (d.x >= r.x0 && d.x < r.x1) occ.push([d.x + 0.5 - R.doorHalf, d.x + 0.5 + R.doorHalf]);
    for (const wn of (fp.windows || [])) if (wn.x >= r.x0 && wn.x < r.x1) occ.push([wn.x + 0.5 - R.winHalf, wn.x + 0.5 + R.winHalf]);
    const blocked = mergeIntervals(occ);
    // Bare climbable strips inside [r.x0+edge, r.x1-edge].
    const lo = r.x0 + R.edge, hi = r.x1 - R.edge;
    const strips = [];
    let cur = lo;
    for (const [a, c] of blocked) { if (a > cur) strips.push([cur, Math.min(a, hi)]); cur = Math.max(cur, c); }
    if (cur < hi) strips.push([cur, hi]);
    // Widest strips first; seed up to maxRoots, gated by a deterministic per-strip chance.
    const wide = strips.filter((s) => s[1] - s[0] >= R.minStrip).sort((a, c) => (c[1] - c[0]) - (a[1] - a[0]));
    let rooted = 0;
    for (let si = 0; si < wide.length && rooted < R.maxRoots; si++) {
      const [a, c] = wide[si];
      const seed = rand2((b.x + r.x0 + si * 7) | 0, (b.y + r.y) | 0, 0xD2A1);
      if (seed > Math.min(1, R.rootChance * boost)) continue;
      const seed2 = rand2((b.x + r.x0 + si * 7) | 0, (b.y + r.y + 13) | 0, 0xD2A2);
      const width = c - a;
      const rootX = (a + c) / 2 + (seed2 - 0.5) * Math.max(0, width - R.minStrip);
      const amp = Math.min(R.meanderAmp, Math.max(0, (width - 0.4) / 2));
      const top = (R.capMin + R.capSpan * seed2) * stories;
      const N = Math.max(8, Math.round(top * 6)); // ~6 samples per storey-band
      const phase = seed * 6.2832;
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const v = (top * i) / N;
        // Organic horizontal wander (two octaves), CLAMPED into the strip so the stem never crosses an aperture.
        let cx = rootX + amp * Math.sin(v * 2.1 + phase) + amp * 0.4 * Math.sin(v * 5.3 + phase * 1.7);
        cx = Math.max(a + 0.1, Math.min(c - 0.1, cx));
        pts.push({ cxLocal: cx, v });
      }
      splines.push({ runY: r.y, rootX, pts });
      rooted++;
    }
  }
  return splines;
}
