# Field Asset Curation Dashboard — Implementation Plan (Phase A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A localhost dashboard + headless tooling to curate decoration-field sprites (F6 first) by omitting bad
variants, where omits non-destructively cull variants from the in-game pool and queue them for regen, and the human's
omit decisions become the training signal for later auto-QA.

**Architecture:** Disk stays the source of truth. A sidecar omit-set (`_f6_curation.json`) is the only record of
what's culled; a sidecar-aware `gen-mf-catalog.mjs` emits a per-species `vmap` (pool-position → real filename number)
so the renderer never depends on contiguous filenames. A separate factual scanner feeds a static HTML dashboard; an
apply script merges dashboard exports into the sidecar and rescans. No PixelLab in Phase A.

**Tech Stack:** Node ≥20 (ESM), `@napi-rs/canvas` (PNG pixel reads), `node:test`, vanilla HTML/JS dashboard served by
the existing static dev server (`:8000`/`:8123`), `playwright-core` for the dashboard smoke.

**Spec:** `docs/superpowers/specs/2026-06-25-field-asset-curation-dashboard-design.md`

---

## Prerequisite: isolated worktree (execution time)

Before Task 1, create an isolated worktree off the trunk so this work never lands on another agent's branch (the
current shared tree is `building-facade-blocks` with another agent's uncommitted assets). Use the
`superpowers:using-git-worktrees` skill. Branch name: `field-curation`. Copy the spec + this plan into the worktree
and commit them as the first commit. All task commits below happen inside that worktree.

## File Structure

| File | Responsibility | New/Mod |
|---|---|---|
| `scripts/lib/field-curation.mjs` | Sidecar load/merge + omit-set + `FIELD_ROOTS` (shared by scanner+apply) | **new** |
| `test/field-curation.test.mjs` | Unit tests for the helper (merge/replace/worklist) | **new** |
| `scripts/gen-mf-catalog.mjs` | F6 block: read omit-set, emit `vmap` + survivor `trims/sil`, `variants=vmap.length` | mod |
| `src/world/decoration-claims.js` | `pickF6Variant()` + `f6Placements` maps pool-position→`vmap` | mod |
| `test/f6-placements.test.mjs` | Add `pickF6Variant` vmap/omit tests; keep existing green | mod |
| `scripts/gen-field-manifest.mjs` | Scan ALL variants → factual metadata + omit-state → `tools/field-manifest.f6.json` | **new** |
| `tools/field-studio.html` | The curation dashboard | **new** |
| `scripts/apply-field-picks.mjs` | Merge a dashboard export into the sidecar, then rescan | **new** |
| `scripts/probe-field-studio.mjs` | Playwright smoke for the dashboard | **new** |
| `src/dev/field-registry.js` | F6 preview enumerates `vmap` not `range(variants)` | mod |

---

## Task 1: Curation sidecar helper

**Files:**
- Create: `scripts/lib/field-curation.mjs`
- Test: `test/field-curation.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/field-curation.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePicks, omitSetMap } from '../scripts/lib/field-curation.mjs';

const empty = { field: 'f6', omits: {}, history: [], regenWorklist: [] };

test('mergePicks records omits, reasons, notes, and a regen worklist', () => {
  const picks = { field: 'f6', decisions: {
    'forest/oak': { omit: [3, 17], tags: { '3': 'perspective' }, notes: { '3': 'top-down', '12': 'keep — best' } },
  } };
  const next = mergePicks(empty, picks, '2026-06-25T00:00:00Z');
  assert.deepEqual(next.omits['forest/oak'], [3, 17]);
  assert.equal(next.history.length, 1);
  const w = next.regenWorklist.find(e => e.replaces === 3);
  assert.equal(w.reason, 'perspective');
  assert.equal(w.note, 'top-down');
  const w17 = next.regenWorklist.find(e => e.replaces === 17);
  assert.equal(w17.reason, 'unspecified'); // omitted but untagged
});

test('mergePicks REPLACES a species omit-set (un-omit is reversible)', () => {
  const once = mergePicks(empty, { field: 'f6', decisions: { 'forest/oak': { omit: [3, 17] } } }, 't1');
  const twice = mergePicks(once, { field: 'f6', decisions: { 'forest/oak': { omit: [3] } } }, 't2'); // un-omit 17
  assert.deepEqual(twice.omits['forest/oak'], [3]);
  assert.equal(twice.regenWorklist.filter(e => e.replaces === 17).length, 0);
  assert.equal(twice.history.length, 2);
});

test('mergePicks drops a species when its omit-set clears to empty', () => {
  const once = mergePicks(empty, { field: 'f6', decisions: { 'forest/oak': { omit: [3] } } }, 't1');
  const cleared = mergePicks(once, { field: 'f6', decisions: { 'forest/oak': { omit: [] } } }, 't2');
  assert.ok(!('forest/oak' in cleared.omits));
});

test('mergePicks preserves prior reasons for species not in the new picks', () => {
  const a = mergePicks(empty, { field: 'f6', decisions: { 'forest/oak': { omit: [3], tags: { '3': 'scale' } } } }, 't1');
  const b = mergePicks(a, { field: 'f6', decisions: { 'desert/date_palm': { omit: [1] } } }, 't2');
  assert.equal(b.regenWorklist.find(e => e.species === 'oak' && e.replaces === 3).reason, 'scale');
});

test('omitSetMap returns per-species Sets from the effective omits', () => {
  const cur = mergePicks(empty, { field: 'f6', decisions: { 'forest/oak': { omit: [3, 17] } } }, 't1');
  const m = omitSetMap(cur);
  assert.ok(m.get('forest/oak').has(3) && m.get('forest/oak').has(17));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/field-curation.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/lib/field-curation.mjs'`.

- [ ] **Step 3: Write the helper**

```js
// scripts/lib/field-curation.mjs
// Durable per-field curation sidecar: the single source of truth for which variants are OMITTED.
// Read by the sidecar-aware gen-mf-catalog (to build vmap) and written by apply-field-picks.
import fs from 'fs';
import path from 'path';
import url from 'url';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');

// field id -> disk root holding <biome>/<species>/ dirs. F6 only for now; F2-F5 plug in here later.
export const FIELD_ROOTS = {
  f6: 'assets/pixelab/landscape_v2/micro/large_flora',
};

export function curationPath(field) {
  const root = FIELD_ROOTS[field];
  if (!root) throw new Error(`field-curation: unknown field "${field}"`);
  return path.join(ROOT, root, `_${field}_curation.json`);
}

export function loadCuration(field) {
  const p = curationPath(field);
  if (!fs.existsSync(p)) return { field, omits: {}, history: [], regenWorklist: [] };
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { field, omits: c.omits || {}, history: c.history || [], regenWorklist: c.regenWorklist || [] };
}

export function saveCuration(field, curation) {
  fs.writeFileSync(curationPath(field), JSON.stringify(curation, null, 1) + '\n');
}

// "biome/species" -> Set of omitted variant indices (the effective current omit-set).
export function omitSetMap(curation) {
  const m = new Map();
  for (const [key, vs] of Object.entries(curation.omits || {})) m.set(key, new Set(vs));
  return m;
}

// Merge a dashboard export (authoritative per touched species) into a curation object. Returns a new object.
// picks = { field, savedAt, decisions: { "biome/species": { omit:[v], tags:{v:tag}, notes:{v:str} } } }
export function mergePicks(curation, picks, isoNow) {
  const omits = { ...(curation.omits || {}) };
  // seed reason/note memory from the prior worklist so untouched species keep their reasons
  const meta = {};
  for (const w of curation.regenWorklist || []) {
    meta[`${w.biome}/${w.species}:${w.replaces}`] = { reason: w.reason || 'unspecified', note: w.note || '' };
  }
  for (const [key, d] of Object.entries(picks.decisions || {})) {
    omits[key] = [...(d.omit || [])].sort((a, b) => a - b);
    for (const v of d.omit || []) {
      meta[`${key}:${v}`] = { reason: (d.tags || {})[v] || 'unspecified', note: (d.notes || {})[v] || '' };
    }
  }
  for (const k of Object.keys(omits)) if (!omits[k].length) delete omits[k];
  const regenWorklist = [];
  for (const [key, vs] of Object.entries(omits)) {
    const [biome, species] = key.split('/');
    for (const v of vs) {
      const mm = meta[`${key}:${v}`] || {};
      regenWorklist.push({ biome, species, replaces: v, reason: mm.reason || 'unspecified', note: mm.note || '' });
    }
  }
  return {
    field: curation.field,
    omits,
    history: [...(curation.history || []), { appliedAt: isoNow, decisions: picks.decisions || {} }],
    regenWorklist,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/field-curation.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/field-curation.mjs test/field-curation.test.mjs
git commit -m "feat(curation): field-curation sidecar helper (omit-set + regen worklist)"
```

---

## Task 2: `gen-mf-catalog.mjs` emits `vmap`, honors the omit-set (F6)

**Files:**
- Modify: `scripts/gen-mf-catalog.mjs` (the F6 block, lines ~161-216)

- [ ] **Step 1: Import the helper and load the omit-set once**

At the top of `scripts/gen-mf-catalog.mjs`, after the existing imports, add:

```js
import { loadCuration, omitSetMap } from './lib/field-curation.mjs';
```

Just before the F6 loop (`const lgCatalog = {};`), add:

```js
const F6_OMIT = omitSetMap(loadCuration('f6')); // "biome/species" -> Set(omitted variant indices)
```

- [ ] **Step 2: Filter survivors + emit `vmap` in the F6 species entry**

In the F6 `for (const obj of ...)` body, AFTER `const bases = fs.readdirSync(odir).filter(f => /^v\d{3}\.png$/.test(f)).sort();` and the `if (!bases.length) continue;`, replace the trims/sil/push tail so survivors drive everything:

```js
      // Curation: drop omitted variants from the in-game pool (non-destructive — files stay on disk).
      const omit = F6_OMIT.get(biome + '/' + obj) || new Set();
      const survBases = bases.filter(f => !omit.has(parseInt(f.match(/^v(\d{3})\.png$/)[1], 10)));
      if (!survBases.length) continue;
      const vmap = survBases.map(f => parseInt(f.match(/^v(\d{3})\.png$/)[1], 10));
      const size = pngWidth(path.join(odir, survBases[0]));
      // states/anims keep ORIGINAL filename indices (membership tested vs realV at runtime; omitted indices
      // can never be selected because vmap excludes them).
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
          if (frames.length >= 8) anims.push(parseInt(m[1], 10));
        }
      }
      const trims = trimsFor(odir, survBases);
      (lgCatalog[biome] = lgCatalog[biome] || []).push({
        name: obj, size,
        variants: survBases.length,
        vmap,
        trims,
        sil: silsFor(odir, survBases, trims),
        states,
        anims: anims.sort((a, b) => a - b),
      });
```

Delete the old F6 `const size = ...`, `const states = {}` … `push({...})` block this replaces (everything from the
old `const size = pngWidth(...)` through the old `push` for F6). Leave the F4 and F5 blocks untouched.

- [ ] **Step 3: Run the generator + verify vmap landed**

Run: `node scripts/gen-mf-catalog.mjs`
Expected: prints `wrote …/lg-catalog.js: 40 types`.

Run: `node -e "const{LG_CATALOG}=await import('./src/world/lg-catalog.js'); const o=LG_CATALOG.forest.find(x=>x.name==='oak'); console.log('variants',o.variants,'vmap0..4',o.vmap.slice(0,5),'len',o.vmap.length); console.log('identity?', o.vmap.every((v,i)=>v===i));"`
Expected: `variants 64 vmap0..4 [0,1,2,3,4] len 64` and `identity? true` (no omits yet → vmap is identity, runtime unchanged).

- [ ] **Step 4: Syntax-check**

Run: `node --check scripts/gen-mf-catalog.mjs`
Expected: no output (valid).

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-mf-catalog.mjs src/world/lg-catalog.js
git commit -m "feat(catalog): F6 vmap (pool-position decoupled from filename) + omit-set aware"
```

---

## Task 3: `f6Placements` maps pool-position through `vmap`

**Files:**
- Modify: `src/world/decoration-claims.js` (`f6Placements`, ~lines 815-856)
- Test: `test/f6-placements.test.mjs`

- [ ] **Step 1: Write the failing test (append to `test/f6-placements.test.mjs`)**

```js
import { pickF6Variant } from '../src/world/decoration-claims.js';

test('pickF6Variant maps pool position through vmap and never returns an omitted index', () => {
  const obj = { variants: 4, vmap: [0, 1, 3, 4] }; // v2 omitted from the pool
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(pickF6Variant(obj, i / 1000).variant);
  assert.ok(!seen.has(2), 'omitted variant 2 must never be selected');
  for (const v of seen) assert.ok([0, 1, 3, 4].includes(v), `unexpected variant ${v}`);
});

test('pickF6Variant is identity when no vmap (back-compat)', () => {
  const obj = { variants: 3 };
  assert.equal(pickF6Variant(obj, 0).variant, 0);
  assert.equal(pickF6Variant(obj, 0).pos, 0);
  assert.equal(pickF6Variant(obj, 0.999).variant, 2);
});

test('f6 placement variant resolves to a real on-disk vmap entry', () => {
  clearClaimCaches();
  const at = findTreeTile();
  const o = LG_CATALOG.forest.find(x => x.name === (f6Placements(at[0], at[1], forest)[0].name));
  const p = f6Placements(at[0], at[1], forest)[0];
  assert.ok((o.vmap || []).includes(p.variant) || !o.vmap, 'p.variant must be a vmap member');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/f6-placements.test.mjs`
Expected: FAIL — `pickF6Variant is not a function` (import undefined).

- [ ] **Step 3: Add `pickF6Variant` and use it in `f6Placements`**

In `src/world/decoration-claims.js`, add this exported helper just above `export function f6Placements`:

```js
// Map a [0,1) roll to a pool POSITION, then through the species vmap to the real on-disk filename index.
// vmap decouples pool position from filename so omitted (culled) variants are simply absent from vmap.
export function pickF6Variant(obj, r) {
  var n = obj.variants;
  var pos = Math.floor(r * n);
  if (pos >= n) pos = n - 1;
  if (pos < 0) pos = 0;
  var variant = obj.vmap ? obj.vmap[pos] : pos;
  return { pos: pos, variant: variant };
}
```

In `f6Placements`, replace:

```js
  var variant = Math.floor(rand2(wx, wy, 9832) * obj.variants);
```

with:

```js
  var pick = pickF6Variant(obj, rand2(wx, wy, 9832));
  var variant = pick.variant;
```

Then change the two POSITIONAL array reads from `[variant]` to `[pick.pos]`:

```js
  var trim = (obj.trims && obj.trims[pick.pos]) || null;
```

and in the placement object literal:

```js
    sil: (obj.sil && obj.sil[pick.pos]) || null,
```

Leave `stateOnDisk` (`obj.states[st].indexOf(variant)`) and `hasAnim` (`obj.anims.indexOf(variant)`) keyed on
`variant` (the real filename index) — that is correct, because states/anims store original filename indices.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/f6-placements.test.mjs`
Expected: PASS (existing 5 + 3 new). Determinism test still green (same roll → same pick).

- [ ] **Step 5: Commit**

```bash
git add src/world/decoration-claims.js test/f6-placements.test.mjs
git commit -m "feat(f6): pickF6Variant resolves pool position through vmap"
```

---

## Task 4: `gen-field-manifest.mjs` — factual scanner for the dashboard

**Files:**
- Create: `scripts/gen-field-manifest.mjs` → writes `tools/field-manifest.f6.json`

- [ ] **Step 1: Write the scanner**

```js
// scripts/gen-field-manifest.mjs [field]   (default f6)
// Scans ALL on-disk variants for a field and emits factual per-variant metadata for tools/field-studio.html.
// Factual only — NO judgment. Marks current omit-state from the curation sidecar so the dashboard resumes.
import fs from 'fs';
import path from 'path';
import url from 'url';
import { loadImage } from '@napi-rs/canvas';
import { FIELD_ROOTS, loadCuration, omitSetMap } from './lib/field-curation.mjs';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const field = process.argv[2] || 'f6';
const rel = FIELD_ROOTS[field];
const ABS = path.join(ROOT, rel);
const OUT = path.join(ROOT, 'tools', `field-manifest.${field}.json`);
const omit = omitSetMap(loadCuration(field));

// Read a PNG's opaque bbox + fill + magenta-key count via canvas pixels.
async function measure(file) {
  const img = await loadImage(file);
  const W = img.width, H = img.height;
  const { createCanvas } = await import('@napi-rs/canvas');
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H).data;
  let minX = W, minY = H, maxX = -1, maxY = -1, opaque = 0, magenta = 0;
  for (let p = 0, i = 0; i < d.length; i += 4, p++) {
    const a = d[i + 3];
    if (a < 16) continue;
    const px = p % W, py = (p / W) | 0;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
    opaque++;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 220 && g < 60 && b > 220) magenta++; // ~PixelLab key RGB(246,4,252) + halo
  }
  if (maxX < 0) return { size: W, bbox: [0, 0, 0, 0], fill: 0, area: 0, magenta };
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  return { size: W, bbox: [minX, minY, bw, bh], fill: +(opaque / (bw * bh)).toFixed(3), area: bw * bh, magenta };
}

const biomes = {};
let count = 0;
for (const biome of fs.readdirSync(ABS).sort()) {
  const bdir = path.join(ABS, biome);
  if (!fs.statSync(bdir).isDirectory()) continue;
  for (const species of fs.readdirSync(bdir).sort()) {
    const odir = path.join(bdir, species);
    if (!fs.statSync(odir).isDirectory()) continue;
    const files = fs.readdirSync(odir).filter(f => /^v\d{3}\.png$/.test(f)).sort();
    if (!files.length) continue;
    const omitSet = omit.get(biome + '/' + species) || new Set();
    const variants = [];
    for (const f of files) {
      const v = parseInt(f.match(/^v(\d{3})\.png$/)[1], 10);
      const m = await measure(path.join(odir, f));
      variants.push({ v, file: `/${rel}/${biome}/${species}/${f}`, bbox: m.bbox, fill: m.fill,
        area: m.area, magenta: m.magenta, omit: omitSet.has(v) });
      count++;
    }
    const areas = variants.map(x => x.area).filter(a => a > 0).sort((a, b) => a - b);
    const median = areas.length ? areas[areas.length >> 1] : 1;
    for (const x of variants) x.scaleVsMedian = +(x.area / median).toFixed(2);
    (biomes[biome] = biomes[biome] || {})[species] = { size: variants[0].size, variants };
    process.stdout.write(`\r${biome}/${species} (${count})        `);
  }
}
fs.writeFileSync(OUT, JSON.stringify({ field, generatedAt: new Date().toISOString(), root: rel, biomes }));
console.log(`\nwrote ${OUT}: ${count} variants across ${Object.keys(biomes).length} biomes`);
```

- [ ] **Step 2: Run it + verify structure**

Run: `node scripts/gen-field-manifest.mjs f6`
Expected: ends `wrote …/tools/field-manifest.f6.json: ~1300 variants across 16 biomes`.

Run: `node -e "const m=require('./tools/field-manifest.f6.json'); const o=m.biomes.forest.oak; console.log('oak n', o.variants.length, 'v0', JSON.stringify(o.variants[0]));"`
Expected: `oak n 64 v0 {"v":0,"file":"/assets/.../forest/oak/v000.png","bbox":[..],"fill":..,"area":..,"magenta":..,"omit":false,"scaleVsMedian":..}`.

- [ ] **Step 3: Commit**

```bash
git add scripts/gen-field-manifest.mjs tools/field-manifest.f6.json
git commit -m "feat(curation): factual field-manifest scanner for the dashboard"
```

---

## Task 5: `tools/field-studio.html` — dashboard core (grid, omit, export/import, resume)

**Files:**
- Create: `tools/field-studio.html`

- [ ] **Step 1: Write the dashboard**

```html
<!doctype html><html><head><meta charset="utf8"><title>Field Studio — curate decoration sprites</title>
<style>
 :root{--bg:#0c0e13;--panel:#161a22;--line:#262b37;--ink:#e8eaf0;--dim:#9aa3b4;--accent:#7cc4ff;--omit:#e0556b}
 body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.4 ui-sans-serif,system-ui,sans-serif}
 header{position:sticky;top:0;z-index:10;background:#0c0e13f2;border-bottom:1px solid var(--line);padding:9px 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
 h1{font-size:14px;margin:0;color:#fc8}
 button,select{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:7px;padding:5px 9px;font-size:12px;cursor:pointer}
 .tab{padding:4px 10px} .tab.on{border-color:var(--accent);color:var(--accent)}
 h2{font-size:13px;color:var(--accent);text-transform:uppercase;letter-spacing:.04em;margin:16px 16px 2px;cursor:pointer}
 .sp{margin:6px 16px 2px;color:var(--dim);font-size:12px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;padding:4px 16px 10px}
 .cell{position:relative;border:2px solid var(--line);border-radius:6px;background:#000;overflow:hidden;cursor:pointer}
 .cell img{display:block;width:100%;height:96px;object-fit:contain;image-rendering:pixelated;background:#0a0c10}
 .cell.omit{border-color:var(--omit)} .cell.omit img{opacity:.30}
 .cell.cursor{box-shadow:0 0 0 2px var(--accent)}
 .cell .x{position:absolute;inset:0;display:none;align-items:center;justify-content:center;font-size:30px;color:var(--omit);font-weight:800}
 .cell.omit .x{display:flex}
 .cell .meta{position:absolute;left:0;right:0;bottom:0;font-size:9px;color:#cdd;background:#000a;padding:1px 3px;display:flex;justify-content:space-between}
 .cell.out{outline:2px dashed #e6b450;outline-offset:-2px}
 .cell .tag{position:absolute;top:1px;left:3px;font-size:9px;color:#ffd27c}
 .cell .note{position:absolute;top:1px;right:3px;font-size:11px}
 #notebox{position:fixed;display:none;z-index:30;background:var(--panel);border:1px solid var(--accent);border-radius:8px;padding:8px;width:260px}
 #notebox textarea{width:100%;height:64px;background:#000;color:#cfe;border:1px solid var(--line);font:11px monospace}
 .hint{color:var(--dim);font-size:11px;margin:0 16px}
</style></head>
<body>
<header>
 <h1>Field Studio</h1>
 <span id="tabs"></span>
 <label><input type="checkbox" id="outliers"> outlier hints</label>
 <button id="exp">⬇ Export picks</button>
 <button id="imp">⬆ Import</button>
 <input type="file" id="impFile" accept="application/json" style="display:none">
 <span id="status" style="color:#6f6"></span>
</header>
<p class="hint">Click a tile to OMIT (red). Keys: <b>←↑↓→</b> move · <b>space</b> omit · <b>1-6</b> tag
 (perspective/painted/cropped/scale/halo/other) · <b>n</b> note. Everything autosaves; Export when done.</p>
<div id="body"></div>
<div id="notebox"><div id="noteFor" style="color:#8ad;font-size:11px;margin-bottom:4px"></div>
 <textarea id="noteText" placeholder="why? (optional — applies to keep OR omit)"></textarea>
 <div style="margin-top:4px"><button id="noteSave">Save</button> <button id="noteCancel">Close</button></div></div>

<script type="module">
const REASONS = ['perspective','painted','cropped','scale','halo','other'];
const field = 'f6';
const manifest = await (await fetch(`field-manifest.${field}.json`)).json();
const LSKEY = `field-studio:${field}`;
// decisions: { "biome/species": { omit:Set, tags:{v:tag}, notes:{v:str} } }
const dec = load();
function load(){
  const seed = {};
  for (const [b,sp] of Object.entries(manifest.biomes)) for (const [s,o] of Object.entries(sp)){
    const om = new Set(o.variants.filter(v=>v.omit).map(v=>v.v));
    if (om.size) seed[`${b}/${s}`] = { omit: om, tags:{}, notes:{} };
  }
  try{
    const saved = JSON.parse(localStorage.getItem(LSKEY)||'null');
    if (saved) for (const [k,d] of Object.entries(saved)) seed[k] = { omit:new Set(d.omit||[]), tags:d.tags||{}, notes:d.notes||{} };
  }catch(e){}
  return seed;
}
function save(){
  const out={}; for (const [k,d] of Object.entries(dec)) out[k]={omit:[...d.omit],tags:d.tags,notes:d.notes};
  localStorage.setItem(LSKEY, JSON.stringify(out));
  status(`${countOmit()} omitted`);
}
function status(t){ document.getElementById('status').textContent=t; }
function countOmit(){ let n=0; for (const d of Object.values(dec)) n+=d.omit.size; return n; }
function rec(key){ return dec[key] || (dec[key]={omit:new Set(),tags:{},notes:{}}); }

let cursor = null; // {key, v}
const cells = new Map(); // `${key}#${v}` -> element

function render(){
  const body=document.getElementById('body'); body.innerHTML=''; cells.clear();
  for (const [biome, sp] of Object.entries(manifest.biomes)){
    const h=document.createElement('h2'); h.textContent=biome; body.appendChild(h);
    const wrap=document.createElement('div'); body.appendChild(wrap);
    h.onclick=()=>wrap.style.display = wrap.style.display==='none'?'':'none';
    for (const [species,o] of Object.entries(sp)){
      const key=`${biome}/${species}`;
      const lab=document.createElement('div'); lab.className='sp'; lab.textContent=`${species} · ${o.variants.length} variants`; wrap.appendChild(lab);
      const g=document.createElement('div'); g.className='grid'; wrap.appendChild(g);
      for (const vd of o.variants){
        const c=document.createElement('div'); c.className='cell'; c.dataset.key=key; c.dataset.v=vd.v;
        c.innerHTML=`<img loading="lazy" src="${vd.file}"><div class="x">✕</div>`
          +`<div class="tag"></div><div class="note"></div>`
          +`<div class="meta"><span>v${String(vd.v).padStart(3,'0')}</span><span>${vd.scaleVsMedian}×</span></div>`;
        c.title=`fill ${vd.fill} · scale ${vd.scaleVsMedian}× · magenta ${vd.magenta}`;
        if (vd.scaleVsMedian<0.45||vd.scaleVsMedian>2.2||(vd.bbox[1]===0&&vd.fill>0.5)) c.classList.add('outlierCand');
        c.onclick=(e)=>{ e.preventDefault(); setCursor(key,vd.v); toggle(key,vd.v); };
        g.appendChild(c); cells.set(`${key}#${vd.v}`, c);
      }
    }
  }
  paintAll(); applyOutliers();
}
function cell(key,v){ return cells.get(`${key}#${v}`); }
function paint(key,v){
  const c=cell(key,v); if(!c) return; const d=dec[key];
  const om = d&&d.omit.has(v); c.classList.toggle('omit', !!om);
  c.querySelector('.tag').textContent = d&&d.tags[v] ? d.tags[v][0].toUpperCase() : '';
  c.querySelector('.note').textContent = d&&d.notes[v] ? '📝' : '';
}
function paintAll(){ for (const k of cells.keys()){ const [key,v]=k.split('#'); paint(key,+v); } }
function toggle(key,v){ const d=rec(key); if(d.omit.has(v)) d.omit.delete(v); else d.omit.add(v); paint(key,v); save(); }
function setCursor(key,v){ if(cursor) cell(cursor.key,cursor.v)?.classList.remove('cursor'); cursor={key,v}; const c=cell(key,v); if(c){c.classList.add('cursor'); c.scrollIntoView({block:'nearest'});} }

document.getElementById('outliers').onchange=applyOutliers;
function applyOutliers(){ const on=document.getElementById('outliers').checked;
  for (const c of cells.values()) c.classList.toggle('out', on && c.classList.contains('outlierCand')); }

// ---- keyboard ----
const order=[]; // flat [{key,v}] in DOM order, filled on render
function rebuildOrder(){ order.length=0; for (const k of cells.keys()){ const [key,v]=k.split('#'); order.push({key,v:+v}); } }
addEventListener('keydown',(e)=>{
  if (document.getElementById('notebox').style.display==='block') return;
  if (!cursor && order.length){ setCursor(order[0].key,order[0].v); return; }
  const idx=order.findIndex(o=>o.key===cursor.key&&o.v===cursor.v);
  const cols=Math.max(1,Math.floor(document.querySelector('.grid').clientWidth/104));
  let ni=idx;
  if (e.key==='ArrowRight') ni=idx+1; else if (e.key==='ArrowLeft') ni=idx-1;
  else if (e.key==='ArrowDown') ni=idx+cols; else if (e.key==='ArrowUp') ni=idx-cols;
  else if (e.key===' '){ e.preventDefault(); toggle(cursor.key,cursor.v); return; }
  else if (/^[1-6]$/.test(e.key)){ rec(cursor.key).tags[cursor.v]=REASONS[+e.key-1]; paint(cursor.key,cursor.v); save(); return; }
  else if (e.key==='n'){ openNote(cursor.key,cursor.v); return; }
  else return;
  e.preventDefault(); if (ni>=0&&ni<order.length) setCursor(order[ni].key,order[ni].v);
});

// ---- notes ----
let noteCur=null;
function openNote(key,v){ noteCur={key,v}; const nb=document.getElementById('notebox');
  document.getElementById('noteFor').textContent=`${key} v${String(v).padStart(3,'0')}`;
  document.getElementById('noteText').value=(dec[key]&&dec[key].notes[v])||'';
  const c=cell(key,v).getBoundingClientRect(); nb.style.left=Math.min(c.right+6,innerWidth-280)+'px'; nb.style.top=c.top+'px'; nb.style.display='block';
  document.getElementById('noteText').focus(); }
document.getElementById('noteSave').onclick=()=>{ const t=document.getElementById('noteText').value.trim();
  const d=rec(noteCur.key); if(t) d.notes[noteCur.v]=t; else delete d.notes[noteCur.v]; paint(noteCur.key,noteCur.v); save(); closeNote(); };
document.getElementById('noteCancel').onclick=closeNote;
function closeNote(){ document.getElementById('notebox').style.display='none'; }

// ---- export / import ----
function exportPicks(){
  const decisions={};
  for (const [k,d] of Object.entries(dec)){
    if (!d.omit.size && !Object.keys(d.notes).length) continue;
    decisions[k]={ omit:[...d.omit].sort((a,b)=>a-b), tags:d.tags, notes:d.notes };
  }
  return { field, savedAt:new Date().toISOString(), decisions };
}
window.__exportPicks = exportPicks; // probe hook
document.getElementById('exp').onclick=()=>{
  const blob=new Blob([JSON.stringify(exportPicks(),null,1)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`field-picks.${field}.json`; a.click();
};
document.getElementById('imp').onclick=()=>document.getElementById('impFile').click();
document.getElementById('impFile').onchange=async(e)=>{
  const j=JSON.parse(await e.target.files[0].text());
  for (const [k,d] of Object.entries(j.decisions||{})) dec[k]={omit:new Set(d.omit||[]),tags:d.tags||{},notes:d.notes||{}};
  save(); paintAll();
};

// ---- tabs (F6 only today; structured for more) ----
const tabs=document.getElementById('tabs');
for (const f of ['f6']){ const b=document.createElement('button'); b.className='tab'+(f===field?' on':''); b.textContent=f.toUpperCase(); tabs.appendChild(b); }

render(); rebuildOrder(); save();
</script></body></html>
```

- [ ] **Step 2: Serve + open**

Ensure the static dev server is running (working tree live). Open `http://127.0.0.1:8000/tools/field-studio.html`
(or `:8123`). Expected: biome sections with thumbnail grids; tiles clickable → turn red; refresh keeps state.

- [ ] **Step 3: Commit**

```bash
git add tools/field-studio.html
git commit -m "feat(curation): field-studio dashboard — grid, omit, tags, notes, outliers, keyboard, resume"
```

---

## Task 6: `scripts/probe-field-studio.mjs` — dashboard smoke

**Files:**
- Create: `scripts/probe-field-studio.mjs`

- [ ] **Step 1: Write the probe**

```js
// scripts/probe-field-studio.mjs  — headless smoke for tools/field-studio.html
// Requires the static dev server live on :8000 (falls back to :8123).
import { chromium } from 'playwright-core';
const BASES = ['http://127.0.0.1:8000', 'http://127.0.0.1:8123'];
const browser = await chromium.launch();
const page = await browser.newPage();
let ok = false, base;
for (base of BASES) { try { await page.goto(`${base}/tools/field-studio.html`, { timeout: 8000, waitUntil: 'domcontentloaded' }); ok = true; break; } catch (e) {} }
if (!ok) { console.error('no dev server on :8000/:8123'); process.exit(2); }
await page.waitForSelector('.cell', { timeout: 20000 });
const nCells = await page.$$eval('.cell', els => els.length);
if (nCells < 100) { console.error(`too few cells: ${nCells}`); process.exit(1); }
// toggle the first tile, confirm omit class + export reflects it
await page.click('.cell');
const omitted = await page.$eval('.cell', el => el.classList.contains('omit'));
const picks = await page.evaluate(() => window.__exportPicks());
const total = Object.values(picks.decisions).reduce((n, d) => n + d.omit.length, 0);
console.log(`cells=${nCells} firstOmit=${omitted} exportOmits=${total} field=${picks.field}`);
if (!omitted || total < 1) { console.error('omit toggle/export failed'); process.exit(1); }
await browser.close();
console.log('PASS');
```

- [ ] **Step 2: Run the probe**

Run: `node scripts/probe-field-studio.mjs`
Expected: `cells=… firstOmit=true exportOmits=1 field=f6` then `PASS`.

- [ ] **Step 3: Commit**

```bash
git add scripts/probe-field-studio.mjs
git commit -m "test(curation): playwright smoke for field-studio dashboard"
```

---

## Task 7: `scripts/apply-field-picks.mjs` — merge an export into the sidecar + rescan

**Files:**
- Create: `scripts/apply-field-picks.mjs`

- [ ] **Step 1: Write the apply script**

```js
// scripts/apply-field-picks.mjs <field-picks.json>
// Merges a dashboard export into the durable curation sidecar (the omit-set), then re-runs gen-mf-catalog so the
// in-game catalog excludes the omitted variants via vmap. Non-destructive: no PNGs are moved or deleted.
import fs from 'fs';
import { execFileSync } from 'child_process';
import { loadCuration, mergePicks, saveCuration } from './lib/field-curation.mjs';

const p = process.argv[2];
if (!p) { console.error('usage: node scripts/apply-field-picks.mjs <field-picks.json>'); process.exit(2); }
const picks = JSON.parse(fs.readFileSync(p, 'utf8'));
const field = picks.field || 'f6';
const next = mergePicks(loadCuration(field), picks, new Date().toISOString());
saveCuration(field, next);
const summary = Object.fromEntries(Object.entries(next.omits).map(([k, v]) => [k, v.length]));
console.log(`omits now:`, JSON.stringify(summary));
console.log(`regen worklist: ${next.regenWorklist.length} variants`);
execFileSync('node', ['scripts/gen-mf-catalog.mjs'], { stdio: 'inherit' });
```

- [ ] **Step 2: Verify end-to-end with a throwaway omit, then revert (leave repo clean)**

Run:
```bash
printf '{"field":"f6","decisions":{"forest/oak":{"omit":[5],"tags":{"5":"scale"},"notes":{"5":"smoke test"}}}}' > /tmp/picks-smoke.json
node scripts/apply-field-picks.mjs /tmp/picks-smoke.json
node -e "const{LG_CATALOG}=await import('./src/world/lg-catalog.js?'+Date.now()); const o=LG_CATALOG.forest.find(x=>x.name==='oak'); console.log('has5', o.vmap.includes(5), 'variants', o.variants);"
```
Expected: `has5 false variants 63` (oak dropped from 64 to 63; index 5 absent from vmap).

Run the runtime test to prove no desync:
```bash
node --test test/f6-placements.test.mjs
```
Expected: PASS.

Revert the smoke omit:
```bash
printf '{"field":"f6","decisions":{"forest/oak":{"omit":[]}}}' > /tmp/picks-clear.json
node scripts/apply-field-picks.mjs /tmp/picks-clear.json
node -e "const{LG_CATALOG}=await import('./src/world/lg-catalog.js?'+Date.now()); const o=LG_CATALOG.forest.find(x=>x.name==='oak'); console.log('restored', o.variants, o.vmap.every((v,i)=>v===i));"
```
Expected: `restored 64 true`. Confirm the sidecar dropped `forest/oak`:
```bash
node -e "console.log(require('fs').existsSync('assets/pixelab/landscape_v2/micro/large_flora/_f6_curation.json'))"
```
(The sidecar exists and records history; `omits` is `{}` — that's the clean reversible state.)

- [ ] **Step 3: Commit**

```bash
git add scripts/apply-field-picks.mjs assets/pixelab/landscape_v2/micro/large_flora/_f6_curation.json src/world/lg-catalog.js
git commit -m "feat(curation): apply-field-picks — merge omit-set into sidecar + rescan"
```

---

## Task 8: `src/dev/field-registry.js` — F6 preview enumerates `vmap`

**Files:**
- Modify: `src/dev/field-registry.js` (F6 `objectsFor`, ~lines 66-69)

- [ ] **Step 1: Map preview variants through vmap**

Replace the F6 `objectsFor`:

```js
    objectsFor: function (biome) {
      return (LG_CATALOG[biome] || []).map(function (o) {
        return { name: o.name, variants: o.vmap || range(o.variants) };
      });
    },
```

(The dev field-tuner builds preview URLs from these numbers as filename indices — `o.vmap` already IS the list of
real on-disk filename numbers, so this keeps the tuner pointing at files that exist after a cull.)

- [ ] **Step 2: Syntax-check + smoke the registry**

Run: `node --check src/dev/field-registry.js`
Run: `node -e "import('./src/dev/field-registry.js').then(m=>{const r=m.regFor('f6'); console.log(r.objectsFor('forest').find(o=>o.name==='oak').variants.length)})"`
Expected: `64` (matches oak's vmap length).

- [ ] **Step 3: Commit**

```bash
git add src/dev/field-registry.js
git commit -m "fix(dev): F6 field-tuner preview enumerates vmap (real filenames after cull)"
```

---

## Task 9: Full verification + memory note

- [ ] **Step 1: Run the whole field/runtime test surface**

Run: `node --test test/field-curation.test.mjs test/f6-placements.test.mjs`
Expected: all PASS.

- [ ] **Step 2: Confirm the game still renders F6 (no omits) — regression check**

Run: `node scripts/gen-mf-catalog.mjs` (clean rescan), then `node --test test/f6-placements.test.mjs`.
Expected: catalog `40 types`, tests PASS, `lg-catalog.js` git-diff shows only the additive `vmap` arrays (identity).

- [ ] **Step 3: Update the field-wiring memory (via the Write tool — memory lives outside this repo)**

Update the `project_field_wiring_state` memory file (and its MEMORY.md pointer): the curation system exists —
`tools/field-studio.html` + `gen-field-manifest.mjs` + `apply-field-picks.mjs` + the `_f6_curation.json` sidecar +
the `vmap` catalog field; omit = cull-from-pool + regen-worklist; rescan via `gen-mf-catalog.mjs` (now sidecar-aware).
Link `[[project_building_tile_corpus]]`. This is a Write-tool edit, NOT a git commit (the memory dir is not part of
this repository).

- [ ] **Step 4: Final commit (code only — the `vmap` rescan + any remaining staged files)**

```bash
git status --short   # verify nothing stray is staged (shared-index discipline)
git commit -m "chore(curation): Phase A field-curation dashboard complete"
```

---

## Self-Review

**Spec coverage:** scanner (Task 4) ✓, dashboard with tags+notes+outliers+keyboard+resume (Tasks 5) ✓, omit=cull+regen
via sidecar (Tasks 1,7) ✓, vmap catalog integration (Tasks 2,3,8) ✓, omit→eval loop is Phase-B (out of Phase A scope,
`qa-field.mjs` deferred until real omit data exists — noted in spec) ✓, honest-absence (non-destructive, files stay
on disk) ✓. Phase B remains a separate spec.

**Placeholder scan:** every code step has complete code; commands have expected output. No TBDs.

**Type consistency:** `mergePicks/omitSetMap/loadCuration/saveCuration/curationPath/FIELD_ROOTS` are defined in Task 1
and consumed unchanged in Tasks 2,4,7. `pickF6Variant(obj,r)→{pos,variant}` defined in Task 3 and used in Task 3.
Catalog entry gains `vmap` in Task 2, consumed in Tasks 3,8. Manifest/picks/sidecar JSON schemas match across Tasks
1,4,5,7. Dashboard `window.__exportPicks()` hook defined in Task 5, used by the probe in Task 6.

**Open verification item (carried from spec):** Task 8 step 2 confirms the dev field-tuner consumes the `objectsFor`
variant numbers as real filenames; if it instead expects positional indices, leave it returning `range(o.variants)`
and skip Task 8 (the tuner is dev-only and unaffected by the runtime path).
