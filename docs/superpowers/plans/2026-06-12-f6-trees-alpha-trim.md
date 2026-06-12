# F6 Trees + Alpha-Trim Claims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire F6 large flora (192px trees from the W2 burst) into placements, the y-sorted draw pool, and the field tuner — claiming space from each sprite's alpha bounding box instead of the PNG file edge (F5 gets trims too).

**Architecture:** A pure PNG alpha-bbox reader (`scripts/lib/png-alpha-bbox.mjs`) feeds per-variant `trims` into the catalogs at generation time. `decoration-claims.js` gains `f6Placements()` (mirroring f5) and a shared trim-footprint helper used by F5 and F6. One registry entry gives the tuner an F6 tab with zero tuner-UI edits. `field2-animator.js` pushes F6 placements into the existing y-sorted pool.

**Tech Stack:** Vanilla ESM + node:zlib (no new deps), node:test, playwright-core headless probe.

**Spec:** `docs/superpowers/specs/2026-06-12-f6-trees-alpha-trim-design.md` (user-approved).

**Shared-tree rules (non-negotiable):** stay on the current branch; `git add` exact paths only; NEVER touch `sim/`, `scripts/bulk_generate*.py`, or running bursts. Other agents edit `field2-animator.js`/`field-registry.js` surroundings — RE-READ before editing; keep diffs minimal.

**On-disk reality (verified 2026-06-12):** W2 writes `assets/pixelab/landscape_v2/micro/large_flora/<biome>/<archetype>/v000.png` (plain `v###.png` — NOT the `mf__`/`mo__` prefix convention), states to `_states/<state>/v###.png`, anims to `anim/wind_sway/v###/frame_###.png` (8 frames). `forest/oak` and `dense_forest/ancient_oak` already have variants; more land continuously — catalog gen must be rerunnable and order-stable.

---

### Task 1: PNG alpha-bbox reader (pure, tested)

**Files:**
- Create: `scripts/lib/png-alpha-bbox.mjs`
- Test: `test/png-alpha-bbox.test.mjs`

- [ ] **Step 1: Write the failing test** — `test/png-alpha-bbox.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { alphaBBoxFromBuffer } from '../scripts/lib/png-alpha-bbox.mjs';

// Minimal PNG encoder (RGBA8, filter 0 per scanline) for synthetic fixtures.
function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])), 8 + data.length);
  return out;
}
function makePng(w, h, rgbaAt) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4); // raw[row] = 0 (filter None)
    for (let x = 0; x < w; x++) rgbaAt(x, y).copy(raw, row + 1 + x * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const CLEAR = Buffer.from([0, 0, 0, 0]), SOLID = Buffer.from([10, 200, 30, 255]);

test('bbox of an opaque rect inside transparent padding', () => {
  // 16x12 image, opaque pixels x in [3,9], y in [2,7]
  const png = makePng(16, 12, (x, y) => (x >= 3 && x <= 9 && y >= 2 && y <= 7) ? SOLID : CLEAR);
  assert.deepEqual(alphaBBoxFromBuffer(png), { x: 3, y: 2, w: 7, h: 6 });
});

test('fully transparent image yields null', () => {
  assert.equal(alphaBBoxFromBuffer(makePng(8, 8, () => CLEAR)), null);
});

test('fully opaque image yields full extent', () => {
  assert.deepEqual(alphaBBoxFromBuffer(makePng(5, 4, () => SOLID)), { x: 0, y: 0, w: 5, h: 4 });
});

test('single opaque pixel', () => {
  const png = makePng(6, 6, (x, y) => (x === 4 && y === 1) ? SOLID : CLEAR);
  assert.deepEqual(alphaBBoxFromBuffer(png), { x: 4, y: 1, w: 1, h: 1 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/png-alpha-bbox.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scripts/lib/png-alpha-bbox.mjs`:**

```js
// Pure PNG alpha-bbox reader: tight bounding box of pixels with alpha > 0.
// Supports 8-bit non-interlaced color types 6 (RGBA), 4 (gray+alpha),
// 2/0 (no alpha -> full extent). node:zlib only; no deps.
import zlib from 'node:zlib';

export function alphaBBoxFromBuffer(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const bitDepth = buf[24], colorType = buf[25], interlace = buf[28];
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');
  if (colorType === 2 || colorType === 0) return { x: 0, y: 0, w, h }; // no alpha channel
  if (colorType !== 6 && colorType !== 4) throw new Error(`unsupported color type ${colorType}`);
  const bpp = colorType === 6 ? 4 : 2; // bytes/pixel; alpha is the last byte

  // concat IDAT chunks
  let off = 8, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));

  // unfilter scanlines (filters 0-4) and scan alpha in one pass
  const stride = w * bpp;
  let prev = Buffer.alloc(stride);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const fOff = y * (stride + 1), filter = raw[fOff];
    const line = raw.subarray(fOff + 1, fOff + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      line[i] = v;
    }
    for (let x = 0; x < w; x++) {
      if (line[x * bpp + bpp - 1] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    prev = line;
  }
  if (maxX < 0) return null; // fully transparent
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function alphaBBoxFromFile(fs, file) {
  return alphaBBoxFromBuffer(fs.readFileSync(file));
}
```

- [ ] **Step 4: Run tests** — `node --test test/png-alpha-bbox.test.mjs` → 4/4 PASS.

- [ ] **Step 5: Sanity-check against a real burst PNG:**

Run: `node -e "import('./scripts/lib/png-alpha-bbox.mjs').then(async m => { const fs = await import('node:fs'); console.log(m.alphaBBoxFromBuffer(fs.readFileSync('assets/pixelab/landscape_v2/micro/large_flora/forest/oak/v000.png'))); })"`
Expected: a JSON bbox strictly inside 192x192 (e.g. w < 192 or h < 192). If it throws "unsupported color type", inspect the byte and extend the reader for that type (likely 3/palette — add a tRNS-based path) — do not skip.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/png-alpha-bbox.mjs test/png-alpha-bbox.test.mjs
git commit -m "feat(assets): pure PNG alpha-bbox reader — trim foundation for F5/F6 claims"
```

---

### Task 2: Catalog generation — LG catalog + trims for LG and MO

**Files:**
- Modify: `scripts/gen-mf-catalog.mjs` (append LG section; add trims to MO section)
- Generated: `src/world/lg-catalog.js`, `src/world/mo-catalog.js` (regen)

- [ ] **Step 1: Add the import** at the top of `scripts/gen-mf-catalog.mjs` (next to existing imports):

```js
import { alphaBBoxFromBuffer } from './lib/png-alpha-bbox.mjs';
```

and a helper below `pngWidth`:

```js
// Per-variant alpha trims [x,y,w,h]; null entry = fully transparent variant.
function trimsFor(odir, bases) {
  return bases.map(f => {
    const b = alphaBBoxFromBuffer(fs.readFileSync(path.join(odir, f)));
    return b ? [b.x, b.y, b.w, b.h] : null;
  });
}
```

- [ ] **Step 2: Add trims to the MO record** — in the F5 section (~line 124), change the push to:

```js
    (moCatalog[biome] = moCatalog[biome] || []).push({
      name: obj, size,
      variants: bases.length,
      trims: trimsFor(odir, bases),
      states,
      anims: anims.sort((a, b) => a - b),
    });
```

- [ ] **Step 3: Append the F6 section** at the end of the script (mirrors the F5 section; differences: plain `v###.png` naming, ≥8 anim frames, `LG_CATALOG`):

```js
// ---- F6 large flora -> src/world/lg-catalog.js ----
const LARGE = path.join(ROOT, 'assets/pixelab/landscape_v2/micro/large_flora');
const LG_OUT = path.join(ROOT, 'src/world/lg-catalog.js');

const lgCatalog = {};
if (fs.existsSync(LARGE)) {
  for (const biome of fs.readdirSync(LARGE).sort()) {
    const bdir = path.join(LARGE, biome);
    if (!fs.statSync(bdir).isDirectory()) continue;
    for (const obj of fs.readdirSync(bdir).sort()) {
      const odir = path.join(bdir, obj);
      if (!fs.statSync(odir).isDirectory()) continue;
      // W2 burst naming: plain v###.png (no lg__ prefix)
      const bases = fs.readdirSync(odir).filter(f => /^v\d{3}\.png$/.test(f)).sort();
      if (!bases.length) continue;
      const size = pngWidth(path.join(odir, bases[0]));
      const states = {};
      const sroot = path.join(odir, '_states');
      if (fs.existsSync(sroot)) {
        for (const st of fs.readdirSync(sroot).sort()) {
          const sdir = path.join(sroot, st);
          if (!fs.statSync(sdir).isDirectory()) continue;
          const vs = fs.readdirSync(sdir)
            .map(f => f.match(/^v(\d{3})\.png$/)).filter(Boolean)
            .map(m => parseInt(m[1], 10)).sort((a, b) => a - b);
          if (vs.length) states[st] = vs;
        }
      }
      const anims = [];
      const adir = path.join(odir, 'anim', 'wind_sway');
      if (fs.existsSync(adir)) {
        for (const vd of fs.readdirSync(adir)) {
          const m = vd.match(/^v(\d{3})$/);
          if (!m) continue;
          const frames = fs.readdirSync(path.join(adir, vd)).filter(f => /^frame_\d{3}\.png$/.test(f));
          if (frames.length >= 8) anims.push(parseInt(m[1], 10)); // W2 generates 8 frames
        }
      }
      (lgCatalog[biome] = lgCatalog[biome] || []).push({
        name: obj, size,
        variants: bases.length,
        trims: trimsFor(odir, bases),
        states,
        anims: anims.sort((a, b) => a - b),
      });
    }
  }
}
let lgTypes = 0;
for (const b in lgCatalog) lgTypes += lgCatalog[b].length;
fs.writeFileSync(LG_OUT, '// AUTO-GENERATED by scripts/gen-mf-catalog.mjs — do not edit.\n' +
  '// Regenerate as the W2 tree burst lands variants/states/anims on disk.\n' +
  'export var LG_CATALOG = ' + JSON.stringify(lgCatalog, null, 1) + ';\n');
console.log(`wrote ${LG_OUT}: ${lgTypes} types`);
```

- [ ] **Step 4: Regenerate and verify**

Run: `node scripts/gen-mf-catalog.mjs`
Expected: writes mf-catalog (unchanged content), mo-catalog (now with `trims`), lg-catalog (≥2 types: forest/oak, dense_forest/ancient_oak).
Then: `git diff --stat src/world/mo-catalog.js` shows additions only in record bodies (trims), and `node -e "import('./src/world/lg-catalog.js').then(m => console.log(Object.keys(m.LG_CATALOG), m.LG_CATALOG.forest?.[0]?.trims?.length))"` prints biomes + a trim count.
Verify superset: `node -e "Promise.all([import('./src/world/mo-catalog.js')]).then(([m]) => { for (const b in m.MO_CATALOG) for (const o of m.MO_CATALOG[b]) { if (!o.trims || o.trims.length !== o.variants) throw new Error(b + '/' + o.name); } console.log('mo trims complete'); })"`

- [ ] **Step 5: Run existing suites** — `node --test "test/**/*.test.mjs" "test/**/*.test.js"` → all green (catalog shape is additive).

- [ ] **Step 6: Commit**

```bash
git add scripts/gen-mf-catalog.mjs src/world/lg-catalog.js src/world/mo-catalog.js
git commit -m "feat(assets): LG catalog for F6 trees + per-variant alpha trims in LG/MO catalogs"
```

---

### Task 3: F6 state order + defaults in field-tuning.js

**Files:**
- Modify: `src/world/field-tuning.js` (append after the f5StateDefaults block, ~line 138)

- [ ] **Step 1: Append** (taxonomy order from `src/world/asset-state-taxonomy.js:54-56`; 'base' = normal/no state sprite, F4/F5 convention):

```js
// F6 large flora (trees). Taxonomy: seedling/growing/normal/wilting/dead/
// stump/snag/burned/budding/fruiting/harvested. 'base' = normal.
export var F6_STATE_ORDER = ['seedling', 'growing', 'base', 'wilting', 'dead',
  'stump', 'snag', 'burned', 'budding', 'fruiting', 'harvested'];
export var F6_STATE_DEFAULTS = { seedling: 8, growing: 10, base: 55, wilting: 10,
  dead: 5, stump: 4, snag: 3, burned: 1, budding: 2, fruiting: 1, harvested: 1 };
```

- [ ] **Step 2: Verify import-clean** — `node -e "import('./src/world/field-tuning.js').then(m => console.log(m.F6_STATE_ORDER.length, Object.values(m.F6_STATE_DEFAULTS).reduce((a,b)=>a+b,0)))"` → `11 100`.

- [ ] **Step 3: Commit**

```bash
git add src/world/field-tuning.js
git commit -m "feat(world): F6 tree state order + default weights (taxonomy-complete, base 55%)"
```

---

### Task 4: f6Placements + trim-based claim footprints (TDD)

**Files:**
- Modify: `src/world/decoration-claims.js`
- Test: `test/f6-placements.test.mjs`

- [ ] **Step 1: Write the failing tests** — `test/f6-placements.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { f6Placements, f5Placements, f4Placements, clearClaimCaches,
  F6_BIOME_SCALE } from '../src/world/decoration-claims.js';
import { LG_CATALOG } from '../src/world/lg-catalog.js';

// tileInfo stub: everything is forest, no transitions (forest has oak on disk).
const forest = () => ({ biome: 'forest', transition: false });

function findTreeTile() { // deterministic scan for a tile that hosts an F6 tree
  for (let wy = 0; wy < 400; wy++) for (let wx = 0; wx < 400; wx++) {
    if (f6Placements(wx, wy, forest).length) return [wx, wy];
  }
  return null;
}

test('f6 placements exist in forest, are deterministic, and carry trim data', () => {
  clearClaimCaches();
  assert.ok(LG_CATALOG.forest?.length, 'oak must be in the catalog (run gen-mf-catalog first)');
  const at = findTreeTile();
  assert.ok(at, 'no tree in 400x400 forest — F6_TILE_CHANCE broken');
  const [wx, wy] = at;
  const a = f6Placements(wx, wy, forest)[0];
  clearClaimCaches();
  const b = f6Placements(wx, wy, forest)[0];
  assert.deepEqual(a, b); // deterministic across cache clears
  assert.ok(a.trim === null || (Array.isArray(a.trim) && a.trim.length === 4));
  assert.ok(a.fw > 0 && a.fh > 0 && a.sizeTiles > 0);
});

test('claim footprint uses the alpha trim, not the file edge', () => {
  clearClaimCaches();
  const [wx, wy] = findTreeTile();
  const p = f6Placements(wx, wy, forest)[0];
  if (!p.trim) return; // fully-opaque art: nothing to assert
  const drawPx = p.size * (p.sizeTiles * 32 / p.size); // = sizeTiles * TILE_ART_PX
  const visW = p.trim[2] * (drawPx / p.size);
  assert.ok(p.fw <= visW * 0.5 + 1e-6, `fw ${p.fw} must fit inside trimmed half-width ${visW * 0.5}`);
  assert.ok(p.fw < drawPx * 0.5, 'fw must be smaller than the file half-width');
});

test('bigger fields claim first: a tree tile hosts no F5/F4', () => {
  clearClaimCaches();
  const [wx, wy] = findTreeTile();
  assert.equal(f5Placements(wx, wy, forest).length, 0);
  assert.equal(f4Placements(wx, wy, forest).length, 0);
});

test('F6_BIOME_SCALE exports all 16 biomes at 1.0', () => {
  assert.equal(Object.keys(F6_BIOME_SCALE).length, 16);
  for (const v of Object.values(F6_BIOME_SCALE)) assert.equal(v, 1.0);
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/f6-placements.test.mjs` → FAIL (no f6Placements export).

- [ ] **Step 3: Implement in `src/world/decoration-claims.js`** (RE-READ current line numbers first; anchors below are from 2026-06-12):

3a. Imports (top, line ~7-10): add `LG_CATALOG` from `./lg-catalog.js`; add `F6_STATE_ORDER, F6_STATE_DEFAULTS` to the field-tuning import.

3b. Constants (after the F5 block, ~line 49):

```js
var LG_BASE_PATH = '/assets/pixelab/landscape_v2/micro/large_flora/';
// Per-tile chance of one tree — F6 is the rarest field (192px sprites).
var F6_TILE_CHANCE = {
  grassland: 0.006, forest: 0.030, dense_forest: 0.050, tropical_forest: 0.035,
  taiga: 0.025, swamp: 0.018, mystic: 0.020, savanna: 0.008, hills: 0.010,
  steppe: 0.004, beach: 0.003, tundra: 0.003, desert: 0.002, arctic: 0.001,
  mountains: 0.008, volcanic: 0.004,
};
var _f6Cache = new Map();   // 'wx,wy,biome' -> placements
export var F6_BIOME_SCALE = {
  grassland: 1.0, forest: 1.0, dense_forest: 1.0, tropical_forest: 1.0,
  taiga: 1.0, swamp: 1.0, mystic: 1.0, savanna: 1.0, hills: 1.0,
  steppe: 1.0, beach: 1.0, tundra: 1.0, desert: 1.0, arctic: 1.0,
  mountains: 1.0, volcanic: 1.0,
};
```

3c. Trim-footprint helper (near pad3, ~line 494). Footprint ellipse anchored at the **visible** (alpha-trimmed) bottom of the sprite; falls back to the legacy file-based formula when no trim exists:

```js
// Claim footprint from the alpha trim: ellipse hugging the visible base of
// the sprite. cx/cy = sprite draw centre in world art px; size = file px;
// drawPx = size*scale; trim = [x,y,w,h] in file px or null.
// wFrac/hFrac shape the ellipse relative to the visible extents.
function trimFoot(cx, cy, size, drawPx, trim, wFrac, hFrac, legacyW, legacyH) {
  if (!trim) {           // no trim data -> legacy file-edge footprint
    return { bx: cx, by: cy + drawPx * 0.30, fw: drawPx * legacyW, fh: drawPx * legacyH };
  }
  var s = drawPx / size; // file px -> world art px
  var visW = trim[2] * s, visH = trim[3] * s;
  var bottom = cy + (trim[1] + trim[3] - size / 2) * s; // visible bottom edge
  var fh = Math.max(2, visH * hFrac);
  return { bx: cx + (trim[0] + trim[2] / 2 - size / 2) * s, // visible centre x
           by: bottom - fh, fw: Math.max(2, visW * wFrac), fh: fh };
}
```

3d. Switch F5 to trims — in `f5Placements` (~line 594-604) replace the hardcoded bx/by/fw/fh with:

```js
  var cx = (wx + ux) * TILE_ART_PX, cy = (wy + uy) * TILE_ART_PX;
  var foot = trimFoot(cx, cy, obj.size, drawPx,
    (obj.trims && obj.trims[variant]) || null, 0.42, 0.22, 0.42, 0.22);
  var p = {
    name: obj.name, biome: t.biome, size: obj.size, variant: variant,
    state: st, stateOnDisk: stateOnDisk,
    ux: ux, uy: uy, sizeTiles: sizeTiles,
    hasAnim: obj.anims.indexOf(variant) !== -1,
    trim: (obj.trims && obj.trims[variant]) || null,
    bx: foot.bx, by: foot.by, fw: foot.fw, fh: foot.fh,
  };
```

(wFrac/hFrac keep F5's 0.42/0.22 proportions but now measured against the visible extents — trimmed footprints shrink, returning padding to F2/F4. legacyW/legacyH preserve old behavior if a catalog without trims is ever loaded.)

3e. `f6Placements` + URL helpers (after `f5SpriteUrl`, ~line 615). Fresh salt block 9830+; one tree per tile max; F6 claims narrow at the trunk (trees should NOT sterilize the ground under their canopy — wFrac 0.30 of visible width, hFrac 0.10 of visible height):

```js
// One tree per tile max. Deterministic (seed roots 9830-9840). Same contract
// as f4/f5 placements, plus `trim` ([x,y,w,h] file px) for claims + the
// future traversal system (Plan B). Claim = trunk base, not canopy: F2/F4
// may grow under the canopy, just not through the trunk.
export function f6Placements(wx, wy, tileInfo) {
  var t = tileInfo(wx, wy);
  if (!t || t.transition) return EMPTY;
  var key = wx + ',' + wy + ',' + t.biome;
  var hit = _f6Cache.get(key);
  if (hit) return hit;
  var objs = LG_CATALOG[t.biome];
  var chance = (F6_TILE_CHANCE[t.biome] || 0) * tuneBiomeDensity('f6', t.biome);
  if (!objs || !objs.length || chance === 0) return cachePut(_f6Cache, key, EMPTY);
  if (rand2(wx, wy, 9830) > chance) return cachePut(_f6Cache, key, EMPTY);

  var obj = objs[Math.floor(rand2(wx, wy, 9831) * objs.length)];
  var objD = tuneObjDensity('f6', t.biome, obj.name);
  if (objD < 1 && rand2(wx, wy, 9834) > objD) return cachePut(_f6Cache, key, EMPTY);

  var st = rollWeighted(
    tuneStateWeights('f6', t.biome, obj.name, F6_STATE_DEFAULTS),
    F6_STATE_ORDER, rand2(wx, wy, 9835));
  if (st === 'base') st = null;
  var variant = Math.floor(rand2(wx, wy, 9832) * obj.variants);
  var stateOnDisk = !!(st && obj.states[st] && obj.states[st].indexOf(variant) !== -1);

  var ux = 0.5 + (rand2(wx, wy, 9833) - 0.5) * 0.5;
  var uy = 0.5 + (rand2(wx, wy, 9836) - 0.5) * 0.5;
  var scale = (F6_BIOME_SCALE[t.biome] || 1.0) *
    tuneSize('f6', t.biome, obj.name, variant, wx, wy, 9840);
  var sizeTiles = obj.size * scale / TILE_ART_PX; // 192px @ 1.0 -> 6 tiles
  var drawPx = obj.size * scale;
  var trim = (obj.trims && obj.trims[variant]) || null;
  var cx = (wx + ux) * TILE_ART_PX, cy = (wy + uy) * TILE_ART_PX;
  var foot = trimFoot(cx, cy, obj.size, drawPx, trim, 0.30, 0.10, 0.30, 0.16);
  var p = {
    name: obj.name, biome: t.biome, size: obj.size, variant: variant,
    state: st, stateOnDisk: stateOnDisk, trim: trim,
    ux: ux, uy: uy, sizeTiles: sizeTiles,
    hasAnim: obj.anims.indexOf(variant) !== -1,
    bx: foot.bx, by: foot.by, fw: foot.fw, fh: foot.fh,
  };
  return cachePut(_f6Cache, key, [p]);
}

export function f6SpriteUrl(p) {
  if (p.state && p.stateOnDisk) {
    return LG_BASE_PATH + p.biome + '/' + p.name + '/_states/' + p.state +
      '/v' + pad3(p.variant) + '.png';
  }
  return LG_BASE_PATH + p.biome + '/' + p.name + '/v' + pad3(p.variant) + '.png';
}

export function f6AnimUrlBase(p) {
  return LG_BASE_PATH + p.biome + '/' + p.name + '/anim/wind_sway/v' + pad3(p.variant) + '/';
}
```

3f. Yields — in `f4Placements` (~line 511) extend the bigger-first check:

```js
  if (f6Placements(wx, wy, tileInfo).length) return cachePut(_f4Cache, key, EMPTY);
  if (f5Placements(wx, wy, tileInfo).length) return cachePut(_f4Cache, key, EMPTY);
```

and in `f5Placements` right after its chance roll (~line 576):

```js
  if (f6Placements(wx, wy, tileInfo).length) return cachePut(_f5Cache, key, EMPTY);
```

3g. `getClaimMask` (~line 448): add `f6Placements` to the concat and widen the scan to ±6 (192px = 6 tiles reach; update the comment):

```js
  for (var ny = -6; ny <= 6; ny++) {
    for (var nx = -6; nx <= 6; nx++) {
      ...
      var pls = f3Placements(...).concat(f4Placements(...), f5Placements(...), f6Placements(...));
```

3h. `clearClaimCaches` (~line 492): add `_f6Cache.clear();`.

- [ ] **Step 4: Run tests** — `node --test test/f6-placements.test.mjs` → 4/4 PASS. Then the full suite: `node --test "test/**/*.test.mjs" "test/**/*.test.js"` → all green (F5 footprint change may break an existing F5 test that asserts exact fw/fh — if so, update that test's expectation to the trim-based value and note it in the commit message; the visual contract is reviewed by probe + user, not frozen numbers).

- [ ] **Step 5: Commit**

```bash
git add src/world/decoration-claims.js test/f6-placements.test.mjs
git commit -m "feat(world): f6 tree placements + alpha-trim claim footprints for F5/F6"
```

---

### Task 5: Field-registry entry (tuner tab for free)

**Files:**
- Modify: `src/dev/field-registry.js` (RE-READ first — other agents edit it)

- [ ] **Step 1: Add imports** (top): `LG_CATALOG` from `../world/lg-catalog.js`; add `F6_STATE_ORDER, F6_STATE_DEFAULTS` to the field-tuning import (line ~10-11).

- [ ] **Step 2: Append the f6 entry** after the f5 entry (~line 61), before the closing `];`:

```js
  {
    id: 'f6', label: 'F6 large flora', path: 'micro/large_flora', applyKind: 'live',
    animCategories: [['wind_sway', 'wind']],
    objectsFor: function (biome) {
      return (LG_CATALOG[biome] || []).map(function (o) {
        return { name: o.name, variants: range(o.variants) };
      });
    },
    stateNames: function () { return F6_STATE_ORDER; },
    stateDefaults: function () { return F6_STATE_DEFAULTS; },
  },
```

- [ ] **Step 3: Verify** — `node -e "import('./src/dev/field-registry.js').then(m => { const r = m.regFor('f6'); console.log(r.label, r.objectsFor('forest').length, m.emptyTree().f6 ? 'tree-ok' : 'FAIL'); })"` → `F6 large flora <n> tree-ok` with n ≥ 1.

- [ ] **Step 4: Commit**

```bash
git add src/dev/field-registry.js
git commit -m "feat(tuner): F6 large-flora registry entry — tab, sliders, state weights for free"
```

---

### Task 6: Draw-pool hookup in field2-animator.js

**Files:**
- Modify: `src/render/field2-animator.js` (RE-READ ~lines 600-660 first — other agents edit this file; the F5 block may have moved)

- [ ] **Step 1: Extend the imports** from decoration-claims (top of file) with `f6Placements, f6SpriteUrl, f6AnimUrlBase`.

- [ ] **Step 2: Append the F6 block** immediately after the F5 block (~line 658), same pool, distinct `bi` space (F2 uses 0-19, F5 80+, F4 90+ → F6 uses 60+):

```js
  // ---- Field 6 large flora (trees; y-sorted with F2/F4/F5/player) ----
  var f6pls = f6Placements(wx, wy, _claimTileInfo(chunkStore));
  for (var hi = 0; hi < f6pls.length; hi++) {
    var hp = f6pls[hi];
    f4Blades.push({
      bi: 60 + hi, // distinct trigger-key space (F2 0-19, F5 80+, F4 90+)
      stateUrl: null,
      animUrlBase: (hp.hasAnim && !hp.state
        && tuneAnimEnabled('f6', hp.biome, hp.name, 'wind_sway'))
        ? f6AnimUrlBase(hp) : null,
      staticUrl: f6SpriteUrl(hp),
      isRigid: true,                        // trunk never sway-rotates; wind lives in the frames
      lifeScale: hp.sizeTiles,              // 192px @ 1.0 -> 6 tiles
      lifeSway: 0,
      baseAngle: 0,
      offUX: hp.ux - 0.5,
      offUY: hp.uy - 0.5,
      sortYOff: hp.uy + hp.sizeTiles * 0.30, // sort by sprite base (F4/F5 rule)
      ambientPeriod: 0,
      ambientPhase: 0,
      startDelay: 0,
      loopCount: 0,
      restFrame: 0
    });
  }
```

- [ ] **Step 3: Per-blade frame count.** `FRAME_COUNT = 9` is hardcoded (line ~18) and used in the loader (~lines 375, 442) and playback (~lines 972, 977) — F6 anims have 8 frames, so the last frame would 404/misindex. Add `frameCount: 8` to the F6 blade record above, and at each of those four sites replace the bare `FRAME_COUNT` with `(bl.frameCount || FRAME_COUNT)` (in the loader, the blade/anim-set being loaded is in scope — thread the count into `_temporalSets` via its `total` field, which line 378 already stores; reuse that stored total in the frame loops instead of re-reading the global where possible). RE-READ those regions first — line numbers drift in this shared file. Keep the diff minimal: only blades that declare `frameCount` change behavior; F2/F4/F5 paths (no `frameCount`) are untouched.

- [ ] **Step 4: Verify headlessly** — full test suite green; `node -e "import('./src/render/field2-animator.js').then(()=>console.log('import OK'))"` → `import OK` (if the module touches DOM at top level and fails in node, skip this check — match whatever F5's merge verified).

- [ ] **Step 5: Commit**

```bash
git add src/render/field2-animator.js
git commit -m "feat(render): F6 trees join the y-sorted draw pool — wind frames when on disk, static otherwise"
```

---

### Task 7: Headless visual probe

**Files:**
- Create: `scripts/probe-f6-visual.mjs`

Model: `scripts/probe-f2-visual.mjs` (READ it first: chromium-1217 + swiftshader, port 8741, `_dbgRenderer.useGL = false`, lighting freeze, `_fieldTuning` manipulation). Forest coordinates: find a forest tile near spawn by checking the probe's existing coordinate or use the same `?x=&y=` the F2 probe uses if that area is forest — otherwise locate forest via `window._dbgRenderer`/chunk data in-page and navigate there.

- [ ] **Step 1: Write the probe** — assertions:
1. With F6 biome density cranked (`_fieldTuning` tree: `{ f6: { master: { density: 30 } } }` — read field-tuner.js for the exact tree shape `set()` expects, mirroring how the F2 probe sets density) and lighting/wind frozen, the canvas at a forest location differs from F6 density 0 by ≥ 2000 pixels (192px trees are huge; a single tree clears this).
2. F6 master size at 0.5 vs 1.0 changes the canvas (size slider is live).
3. Restore defaults at the end.

Follow the F2 probe's structure verbatim (launch, goto, waitForFunction, evaluate with pixel grabs, JSON result line, explicit FAIL messages, `browser.close()` before nonzero exits).

- [ ] **Step 2: Run** — `node scripts/probe-f6-visual.mjs` → `PROBE PASS` with both diffs reported. If no tree appears: the probe location may not be forest — pick coordinates over a forest chunk (check `tileInfo` via the page console) rather than raising densities beyond 30.

- [ ] **Step 3: Commit**

```bash
git add scripts/probe-f6-visual.mjs
git commit -m "test(render): headless F6 probe — trees render, density and size sliders live"
```

---

## Verification (whole plan)

1. `node --test "test/**/*.test.mjs" "test/**/*.test.js"` — all green (incl. 4 png-bbox + 4 f6-placement tests).
2. `node scripts/probe-f6-visual.mjs` — PROBE PASS.
3. `node scripts/gen-mf-catalog.mjs` twice — second run produces zero git diff (order-stable).
4. `git diff master --stat` for this work touches only: png-alpha-bbox lib+test, gen-mf-catalog.mjs, lg/mo catalogs, field-tuning.js, decoration-claims.js, f6 test, field-registry.js, field2-animator.js, probe. Nothing under `sim/`.
5. Manual: run game, walk to forest, see trees; `` ` `` → F6 tab → drag size/density per biome; F2/F4 decoration visibly grows closer to F5 objects than before (trim payoff).

## Out of scope

- Traversal (blocks/jumpable/standable + jump verb) — Plan B, consumes the `trim` field placements now carry.
- Canopy fade behind trees — follow-up draw tweak.
- F7 canopies; F5 wind anims (user: F5 needs none — states only).
