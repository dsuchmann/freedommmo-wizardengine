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
//
// DRAW ORDER (locked for the render step, user 2026-06-26): the vine clings to the WALL, so the static kit
// (root_base + segment + fork) BAKES INTO the building silhouette in the BEFORE-roof pass of
// building-occluder.drawBuildingTextured() — right after the D2 growth pass, before drawRoof() — so (a) the roof
// EAVE occludes the vine top (the climb caps at v≤stories, the eave, so it never paints over the roof), (b) the
// vine is part of the depth-sorted cached sprite (player/other buildings sort correctly), and (c) the LIVE D3
// props (lanterns/signs, drawn as the dynamic overlay AFTER the sprite) sit IN FRONT of the vine — correct for a
// fixture mounted over ivy. The one animating piece (ivy_leaf_cluster's gentle leaf flutter) rides the dynamic
// layer / a small shader perturbation, NOT the bake (a baked leaf would freeze) — deferred to the anim step.
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
  buildingChance: 0.15, // per-BUILDING gate: only ~10–20% of buildings EVER carry a vine (user 2026-06-26:
                   // selective, NOT every building). × abandonBoost for the overgrown role. The proof overlay
                   // cranks this (and rootChance) to 1 so vines are visible everywhere for testing.
  rootChance: 0.6, // per clear strip WITHIN a vine-bearing building: chance a vine roots there (× abandonBoost).
  capMin: 0.55, capSpan: 0.45, // climb height = (capMin + capSpan·rand)·stories per root (age honestly absent)
  meanderAmp: 0.3, // base horizontal wander of a stem (tiles), scaled by complexity + bounded by strip width
  maxDepth: 2,     // recursion depth of the branch tree (0=main stem, 1=branch, 2=twig) → fractal complexity
  maxForks: 3,     // forks a branch can spawn at depth 0 (fewer deeper); actual count scales with complexity
};

// PER-BIOME GROWTH FORM (user 2026-06-26): the D2 wall accretion is NOT always a vine — each biome expresses a
// different climbing/accreting thing with a different SHAPE. The placement engine reads the form's shape params;
// the renderer reads the form's per-biome ART (dressing/<biome>/vine_* slots). Keep BIOME_FORM in sync with
// scripts/d2-vine-prompts.mjs (the art manifest). Water biomes (ocean/deep_ocean/shallow_water) are absent.
export const BIOME_FORM = {
  grassland: 'vine', forest: 'vine', dense_forest: 'vine', tropical_forest: 'vine', swamp: 'vine',
  hills: 'vine', lake: 'vine', river: 'vine', savanna: 'vine', steppe: 'vine', taiga: 'vine', beach: 'vine',
  mystic: 'crystal', arctic: 'crystal', tundra: 'crystal',   // crystalline tendrils + crystal clusters crawling up
  volcanic: 'column',                                        // basalt / lava PILLARS rising from the base
  mountains: 'spire',                                        // jagged mineral spires (stalagmite/flowstone), mid-wall
  desert: 'mound',                                           // a sand-drift BUILDUP hugging the wall base (not a climb)
};
// Shape params per form, merged over VINE_RULES for the building's biome. cap{Min,Span} = climb-height fraction
// of the wall; meanderAmp = horizontal wander; maxForks/complexity = branchiness; maxRoots = count per wall;
// segTile = piece draw size (thick pillars vs thin tendrils); basal=true → hug the base (sand mound) not climb.
export const SHAPE_PROFILES = {
  vine:    { capMin: 0.55, capSpan: 0.45, meanderAmp: 0.30, maxForks: 3, maxRoots: 3, segTile: 1.00, basal: false },
  crystal: { capMin: 0.45, capSpan: 0.35, meanderAmp: 0.10, maxForks: 2, maxRoots: 2, segTile: 0.95, basal: false }, // angular, sparse
  column:  { capMin: 0.60, capSpan: 0.30, meanderAmp: 0.05, maxForks: 1, maxRoots: 2, segTile: 1.35, basal: false }, // straight + thick
  spire:   { capMin: 0.30, capSpan: 0.28, meanderAmp: 0.08, maxForks: 1, maxRoots: 3, segTile: 1.15, basal: false }, // mid-wall jagged clusters
  mound:   { capMin: 0.12, capSpan: 0.10, meanderAmp: 0.00, maxForks: 0, maxRoots: 1, segTile: 1.25, basal: true  }, // basal sand drift
};
export function getVineShape(biome) { return SHAPE_PROFILES[BIOME_FORM[biome] || 'vine'] || SHAPE_PROFILES.vine; }

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

/** Climbing-vine splines for a building. Returns
 *    [{ runY, rootX, complexity, branches: [{ pts:[{cxLocal,v}], depth }] }]
 *  in building-local terms. Each vine roots at the wall base inside a BARE strip (clear of door/window
 *  columns) and grows a BRANCH TREE up the wall: a main stem plus 0..N recursive forks. A per-vine
 *  `complexity` (0..1) drives meander amplitude + fork count + (downstream) leaf density, so the field spans
 *  SIMPLE single stems → LUSH fractal vines. Every branch is clamped inside its strip → the whole organism
 *  avoids apertures by construction. opts: { rules?: Partial<VINE_RULES>, abandonBoost?: number }. */
export function buildVineSplines(b, opts = {}) {
  const fp = b && b.footprint; if (!fp) return [];
  const runs = southRuns(fp); if (!runs.length) return [];
  const stories = Math.max(1, buildingFloors(b));
  // Per-biome FORM shape (vine/crystal/column/spire/mound) overrides the vine defaults; opts.rules wins last.
  const R = { ...VINE_RULES, ...getVineShape(b && b.biome), ...(opts.rules || {}) };
  const boost = opts.abandonBoost || 1; // abandoned/overgrown role turns the field up (D7); 1× until that role exists
  // PER-BUILDING gate FIRST — only ~buildingChance of buildings ever carry a vine (selective, not every wall).
  if (rand2(b.x | 0, b.y | 0, 0xD2A0) > Math.min(1, R.buildingChance * boost)) return [];
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
      const sd = (salt) => rand2((b.x + r.x0 + si * 7) | 0, (b.y + r.y) | 0, salt);
      const seed = sd(0xD2A1);
      if (seed > Math.min(1, R.rootChance * boost)) continue;
      const seed2 = sd(0xD2A2);
      const complexity = sd(0xD2A3);          // 0=simple single stem … 1=lush fractal
      const width = c - a;
      const clampX = (x) => Math.max(a + 0.1, Math.min(c - 0.1, x));
      const rootX = clampX((a + c) / 2 + (seed2 - 0.5) * Math.max(0, width - R.minStrip));
      const ampBase = Math.min(R.meanderAmp * (0.45 + complexity), Math.max(0.04, (width - 0.4) / 2));
      const top = (R.capMin + R.capSpan * seed2) * stories;
      const branches = [];

      // Grow one branch from (x0,v0) up to vTop, meandering; then spawn forks (recursive → fractal).
      const grow = (x0, v0, vTop, depth, gseed) => {
        const span = Math.max(0.15, vTop - v0);
        const N = Math.max(4, Math.round(span * 6));               // ~6 samples per storey-band
        const phase = gseed * 6.2832;
        const amp = ampBase * (1 - depth * 0.3);                   // twigs wander less
        const drift = (gseed - 0.5) * ampBase * 1.2;               // a fork leans away from its parent
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const v = v0 + (span * i) / N;
          const x = clampX(x0 + drift * (i / N) + amp * Math.sin(v * 2.1 + phase) + amp * 0.4 * Math.sin(v * 5.3 + phase * 1.7));
          pts.push({ cxLocal: x, v });
        }
        branches.push({ pts, depth });
        if (depth >= R.maxDepth) return;
        const nForks = Math.floor(complexity * (R.maxForks - depth));   // lush → more forks, fewer deeper
        for (let k = 0; k < nForks; k++) {
          const fseed = rand2((b.x + r.x0 + si * 7) | 0, (b.y + r.y + depth * 31 + k * 9 + 1) | 0, 0xD2B0);
          const fv = v0 + span * (0.25 + 0.55 * fseed);                 // fork point along the parent
          const fx = clampX(x0 + drift * ((fv - v0) / span));
          const childTop = Math.min(stories, fv + (vTop - fv) * (0.5 + 0.5 * fseed) + 0.3); // climbs on, maybe past
          grow(fx, fv, childTop, depth + 1, fseed * 7.31 + 0.13);
        }
      };
      if (R.basal) {
        // BASAL form (sand mound): not a climb — a low drift HUGGING the wall base, spread across the strip with
        // a gentle crest in the middle. One horizontal branch; the renderer tiles drift pieces along it.
        const bw = Math.min(width - 0.2, 5);                    // drift half-spread, capped
        const x0b = clampX(rootX - bw / 2), x1b = clampX(rootX + bw / 2);
        const crest = (R.capMin + R.capSpan * seed2) * Math.max(0.6, stories * 0.5);
        const M = Math.max(4, Math.round((x1b - x0b) * 4));
        const pts = [];
        for (let i = 0; i <= M; i++) { const t = i / M; pts.push({ cxLocal: x0b + (x1b - x0b) * t, v: crest * Math.sin(Math.PI * t) }); }
        branches.push({ pts, depth: 0 });
      } else {
        grow(rootX, 0, top, 0, seed);
      }
      splines.push({ runY: r.y, rootX, complexity, branches });
      rooted++;
    }
  }
  return splines;
}
