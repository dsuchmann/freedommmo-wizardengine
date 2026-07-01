# Unified Object Loading + Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Field Studio curation take effect in-game for every decoration field through one engine and one field-agnostic denylist curation layer.

**Architecture:** Adopt the working curation toolchain from the `worktree-field-curation` branch onto the game branch (`building-facade-blocks`); fold the `large_objects` corpus into F6 and retire the separate `large-object-renderer.js`; then extend the same cull to F4/F5/F2 and building dressing. Curation is a per-field omit-set (denylist); the catalog generator emits a `vmap` (surviving variant indices) per species and states/anims cascade automatically.

**Tech Stack:** Node ESM scripts (`@napi-rs/canvas` for PNG sizing), browser-side JS render modules, `node --test`.

**Spec:** `docs/superpowers/specs/2026-06-29-unified-object-curation-design.md`

**Key reference (proven template):** the interim large_objects cull — `scripts/gen-lg-objects-catalog.mjs` → `src/world/lg-objects-catalog.js` → `src/render/large-object-renderer.js` (124 species, 0-failure verification). Phase 1 supersedes it.

---

## Branch reconciliation note (read before Phase 0)

The curation files already exist and work on `worktree-field-curation`. The whole-file diff vs the game branch is small (+305/−34 across 6 files), but `decoration-claims.js` and `field2-animator.js` may have **non-curation** divergence between branches. For the two MODIFIED render files, apply only the curation hunks (verified by diff) — do NOT blind-checkout the whole file. The three NEW script files and `lib/` copy clean.

Assets caveat: `large_objects/` is gitignored and lives only in the MAIN checkout. The lib already supports `FIELD_ASSET_ROOT` to resolve sidecars against the main checkout. All catalog generation in this plan runs from the MAIN checkout (`building-facade-blocks`), so no env override is needed.

---

## Phase 0 — Adopt the curation toolchain onto the game branch

### Task 0.1: Bring the three new script files + the lib

**Files:**
- Create: `scripts/lib/field-curation.mjs` (copy from `worktree-field-curation`)
- Create: `scripts/apply-field-picks.mjs` (copy from `worktree-field-curation`)
- Create: `scripts/gen-field-manifest.mjs` (copy from `worktree-field-curation`)

- [ ] **Step 1: Copy the files from the worktree branch**

```bash
git show worktree-field-curation:scripts/lib/field-curation.mjs > scripts/lib/field-curation.mjs
git show worktree-field-curation:scripts/apply-field-picks.mjs > scripts/apply-field-picks.mjs
git show worktree-field-curation:scripts/gen-field-manifest.mjs > scripts/gen-field-manifest.mjs
```

- [ ] **Step 2: Verify they parse**

Run: `node --check scripts/lib/field-curation.mjs && node --check scripts/apply-field-picks.mjs && node --check scripts/gen-field-manifest.mjs`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/field-curation.mjs scripts/apply-field-picks.mjs scripts/gen-field-manifest.mjs
git commit -m "feat(curation): adopt field-curation lib + apply-field-picks + gen-field-manifest from worktree"
```

### Task 0.2: Generator unit test (lock the cull contract before adopting the generator)

**Files:**
- Test: `test/field-curation.test.mjs`

- [ ] **Step 1: Write the failing test** — proves omitSetMap + the allowed-list contract (allowed = disk indices minus omits; a fully-omitted species yields an empty set).

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { omitSetMap, mergePicks } from '../scripts/lib/field-curation.mjs';

test('omitSetMap maps species -> Set of omitted indices', () => {
  const m = omitSetMap({ omits: { 'hills/scots_pine': [21, 24], 'hills/rowan': [0, 1] } });
  assert.equal(m.get('hills/scots_pine').has(21), true);
  assert.equal(m.get('hills/scots_pine').has(22), false);
  assert.equal(m.get('hills/rowan').size, 2);
});

test('allowed = present minus omitted (the cull contract)', () => {
  const present = [0, 1, 2, 3, 4];
  const omit = omitSetMap({ omits: { 'b/s': [1, 3] } }).get('b/s');
  const allowed = present.filter((v) => !omit.has(v));
  assert.deepEqual(allowed, [0, 2, 4]);
});

test('mergePicks overwrites a species omit list from a dashboard export', () => {
  const cur = { omits: { 'b/s': [9] }, history: [], regenWorklist: [] };
  const next = mergePicks(cur, { decisions: { 'b/s': { omit: [1, 2] } } }, '2026-06-29T00:00:00Z');
  assert.deepEqual(next.omits['b/s'], [1, 2]);
});
```

- [ ] **Step 2: Run it — expect FAIL** (lib not yet importable in test context / mergePicks signature)

Run: `node --test test/field-curation.test.mjs`
Expected: FAIL if anything is off; this pins the contract.

- [ ] **Step 3: Make it pass** — the lib from Task 0.1 already implements `omitSetMap`/`mergePicks`. If `mergePicks` arity differs, fix the test to match the real signature (`mergePicks(curation, picks, isoNow)`). Do not change the lib.

- [ ] **Step 4: Run — expect PASS**

Run: `node --test test/field-curation.test.mjs`
Expected: `# pass 3  # fail 0`

- [ ] **Step 5: Commit**

```bash
git add test/field-curation.test.mjs
git commit -m "test(curation): lock the denylist cull contract (allowed = disk minus omits)"
```

### Task 0.3: Adopt the omit-aware generator + the engine vmap deltas

**Files:**
- Modify: `scripts/gen-mf-catalog.mjs` (apply the worktree curation hunks: `import { loadCuration, omitSetMap }`, `F6_OMIT`, `survEntries`/`vmap` emission)
- Modify: `src/world/decoration-claims.js:811-819` (pool-position → `obj.vmap[pos]` mapping in the shared variant picker)
- Modify: `src/render/field2-animator.js` (the curation hunk — URL building uses the real vmap'd index)

- [ ] **Step 1: Show the worktree diffs for the three files**

```bash
git diff building-facade-blocks worktree-field-curation -- scripts/gen-mf-catalog.mjs src/world/decoration-claims.js src/render/field2-animator.js
```

- [ ] **Step 2: Apply the curation hunks.** For `gen-mf-catalog.mjs` the change is additive (no pre-existing curation), so adopt the worktree version of the F4/F5/F6 catalog sections wholesale IF the surrounding scan logic is identical; otherwise hand-apply the `loadCuration`/`omitSetMap`/`survEntries`/`vmap` hunks. For `decoration-claims.js` apply only the vmap picker hunk (lines ~811-819: `var variant = obj.vmap ? obj.vmap[pos] : pos;`). For `field2-animator.js` apply only the curation hunk. Verify no unrelated lines change:

```bash
git diff -- src/world/decoration-claims.js src/render/field2-animator.js scripts/gen-mf-catalog.mjs
```

- [ ] **Step 3: Regenerate the catalogs from the MAIN checkout**

Run: `node scripts/gen-mf-catalog.mjs`
Expected: writes `src/world/mf-catalog.js`, `mo-catalog.js`, `lg-catalog.js`; prints type counts. `lg-catalog.js` entries now carry a `vmap` array.

- [ ] **Step 4: Verify the F6 cull is real** — an omitted hills variant is absent from `vmap`.

```bash
node -e 'import("./src/world/lg-catalog.js").then(({LG_CATALOG})=>{const sp=(LG_CATALOG.hills||[]).find(o=>o.name==="scots_pine"); console.log("scots_pine vmap len", sp&&sp.vmap&&sp.vmap.length, "excludes 21?", sp?!sp.vmap.includes(21):"n/a");})'
```
Expected: vmap length < raw disk count, and `excludes 21? true` (21 is in the hills/scots_pine omit-set).

- [ ] **Step 5: Parse-check the engine files**

Run: `node --check src/world/decoration-claims.js && node --check src/render/field2-animator.js`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/gen-mf-catalog.mjs src/world/decoration-claims.js src/render/field2-animator.js src/world/mf-catalog.js src/world/mo-catalog.js src/world/lg-catalog.js
git commit -m "feat(curation): omit-aware catalog gen (vmap) + decoration-claims/field2-animator wiring"
```

---

## Phase 1 — Fold large_objects into F6; retire the bolt-on

### Task 1.1: Extend the F6 catalog generator to read large_objects (union + source metadata)

**Files:**
- Modify: `scripts/gen-mf-catalog.mjs` (the F6 / `lg-catalog` section)

The F6 section currently scans only `large_flora` and emits entries `{ name, size, variants, vmap, states, anims, trims, sil, ... }`. Add a second pass over `large_objects/<biome>/<species>/` and emit additional entries that carry a `source` descriptor so the renderer can build the right URL and skip states/anims.

- [ ] **Step 1: Add the `source` descriptor to existing large_flora entries.** Where each `lgCatalog[biome].push({...})` happens, add:
  `source: { dir: 'large_flora', file: 'plain' }` (meaning `<root>/large_flora/<biome>/<species>/v###.png`, has `_states/` + `anim/`).

- [ ] **Step 2: Add the large_objects pass.** After the large_flora loop, before writing `LG_OUT`:

```js
// ---- large_objects folded into F6 (source-tagged; static, no states/anims yet) ----
const LOBJ = path.join(ROOT, 'assets/pixelab/landscape_v2/micro/large_objects');
const LOBJ_OMIT = omitSetMap(loadCuration('large_objects'));
if (fs.existsSync(LOBJ)) {
  for (const biome of fs.readdirSync(LOBJ).sort()) {
    const bdir = path.join(LOBJ, biome);
    let st; try { st = fs.statSync(bdir); } catch { continue; }
    if (!st.isDirectory() || biome.startsWith('_')) continue;
    const existing = new Set((lgCatalog[biome] || []).map((e) => e.name)); // 8 overlaps prefer large_flora
    for (const obj of fs.readdirSync(bdir).sort()) {
      const odir = path.join(bdir, obj);
      let os; try { os = fs.statSync(odir); } catch { continue; }
      if (!os.isDirectory() || existing.has(obj)) continue;
      const re = /^lg__.*__v(\d+)\.png$/;
      const present = fs.readdirSync(odir)
        .map((f) => { const m = f.match(re); return m ? parseInt(m[1], 10) : null; })
        .filter((v) => v !== null).sort((a, b) => a - b);
      if (!present.length) continue;
      const omit = LOBJ_OMIT.get(biome + '/' + obj) || new Set();
      const vmap = present.filter((v) => !omit.has(v));
      if (!vmap.length) continue; // fully omitted -> dropped
      const size = pngWidth(path.join(odir, `lg__${biome}__${obj}__v${String(vmap[0]).padStart(3, '0')}.png`));
      (lgCatalog[biome] = lgCatalog[biome] || []).push({
        name: obj, size, variants: vmap.length, vmap,
        states: {}, anims: [], trims: null, sil: null,
        source: { dir: 'large_objects', file: 'lg_prefixed', biome },
      });
    }
  }
}
```

- [ ] **Step 3: Regenerate + verify both corpora present in F6**

Run: `node scripts/gen-mf-catalog.mjs`
Then:
```bash
node -e 'import("./src/world/lg-catalog.js").then(({LG_CATALOG})=>{const h=LG_CATALOG.hills||[]; console.log("hills F6 species:", h.map(o=>o.name+"["+o.source.dir+"]").join(", "));})'
```
Expected: hills lists BOTH `large_flora` species (`field_oak`, `hawthorn`) and `large_objects` species (`scots_pine[large_objects]`, `standing_stone[large_objects]`, etc.); omitted species (`rowan`) absent.

- [ ] **Step 4: Commit**

```bash
git add scripts/gen-mf-catalog.mjs src/world/lg-catalog.js
git commit -m "feat(curation): fold large_objects into F6 catalog with source metadata"
```

### Task 1.2: Teach the F6 URL builders to honor `source`

**Files:**
- Modify: `src/world/decoration-claims.js` (`f6SpriteUrl`, `f6AnimUrlBase`, and the `LG_BASE_PATH` usage)

Currently `f6SpriteUrl` builds `large_flora/<name>/v###.png`. It must branch on `p`'s catalog `source`.

- [ ] **Step 1: Thread `source` onto the placement.** In `f6Placements`, after selecting `obj`, add `source: obj.source` to the returned placement object `p`.

- [ ] **Step 2: Branch the URL builder.** Replace the body of `f6SpriteUrl(p)` so it builds:
  - `large_flora`: `'/assets/pixelab/landscape_v2/micro/large_flora/' + p.name + '/v' + idx + '.png'` (existing behavior, plus state subpath when `p.state`).
  - `large_objects`: `'/assets/pixelab/landscape_v2/micro/large_objects/' + p.biome + '/' + p.name + '/lg__' + p.biome + '__' + p.name + '__v' + idx + '.png'`.

```js
export function f6SpriteUrl(p) {
  var v = p.variant, idx = v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
  if (p.source && p.source.dir === 'large_objects') {
    return '/assets/pixelab/landscape_v2/micro/large_objects/' + p.biome + '/' + p.name +
      '/lg__' + p.biome + '__' + p.name + '__v' + idx + '.png';
  }
  if (p.state && p.stateOnDisk) {
    return LG_BASE_PATH + p.name + '/_states/' + p.state + '/v' + idx + '.png';
  }
  return LG_BASE_PATH + p.name + '/v' + idx + '.png';
}
```

- [ ] **Step 3: Guard anims for source.** In `f6AnimUrlBase(p)` (and the animator's anim gate), return null when `p.source && p.source.dir === 'large_objects'` (no anims yet), so the static sprite path is used.

- [ ] **Step 4: Parse-check + spot-verify URL**

Run: `node --check src/world/decoration-claims.js`
Then verify by constructing a fake placement in a one-off node check that `f6SpriteUrl` for a `large_objects` source yields the `lg__` path and for `large_flora` yields the plain `v###` path.

- [ ] **Step 5: Commit**

```bash
git add src/world/decoration-claims.js
git commit -m "feat(curation): F6 URL builders honor per-species source (large_flora vs large_objects)"
```

### Task 1.3: Retire large-object-renderer.js

**Files:**
- Modify: `src/render/canvas-renderer.js` (remove the `drawLargeObjects` import + call)
- Delete: `src/render/large-object-renderer.js`, `src/world/lg-objects-catalog.js`, `scripts/gen-lg-objects-catalog.mjs` (interim cull, superseded)

- [ ] **Step 1: Remove the call + import in canvas-renderer.js.** Delete the `import { drawLargeObjects, preloadLargeObjectSprites, setPlayerDrawFn } from './large-object-renderer.js';` line and every call site (`drawLargeObjects(...)`, `preloadLargeObjectSprites(...)`, `setPlayerDrawFn(...)`). If `setPlayerDrawFn` is needed by the player draw, re-point it to the field2-animator equivalent (`setField2PlayerDraw`).

- [ ] **Step 2: Delete the superseded files**

```bash
git rm src/render/large-object-renderer.js src/world/lg-objects-catalog.js scripts/gen-lg-objects-catalog.mjs
```

- [ ] **Step 3: Verify no dangling imports**

Run: `git grep -nE "large-object-renderer|lg-objects-catalog|drawLargeObjects|preloadLargeObjectSprites" -- src/ scripts/`
Expected: no matches.

- [ ] **Step 4: Parse-check the renderer**

Run: `node --check src/render/canvas-renderer.js`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(curation): retire large-object-renderer (large_objects now renders via unified F6)"
```

### Task 1.4: In-game verification (hills)

- [ ] **Step 1:** Ensure the dev server serves the rebuilt catalogs (restart the `:8123` server or hard-reload with cache bypass — the dev server caches JS for an hour).
- [ ] **Step 2:** Walk to a hills area with `window._lighting.paused=true; window._lighting.time=0.5` (frozen noon).
- [ ] **Step 3:** Confirm: (a) excluded hills variants/species (e.g. `rowan`, omitted `scots_pine` variants) are gone; (b) no doubled tree density (only ONE F6 system now places); (c) large_objects species (standing stones) render static, large_flora species animate.
- [ ] **Step 4:** Record the result in the plan; if a sprite is misplaced, fix `OBJECT_SIZE`/`source` and regenerate.

---

## Phase 2 — Extend the cull to F4 / F5 / F2 + migrate SS_VARIANT_EXCLUDE

### Task 2.1: Make mf/mo/sf catalogs omit-aware (same vmap pattern as F6)

**Files:**
- Modify: `scripts/gen-mf-catalog.mjs` (F4 `medium_flora`→mf-catalog, F5 `medium_objects`→mo-catalog, F2 `small_flora`→a new/existing catalog)

- [ ] **Step 1:** In each field section, add `const X_OMIT = omitSetMap(loadCuration('<field>'));` and apply the SAME `survEntries`/`vmap` derivation already used for F6 (filter base files by `!omit.has(idx)`; emit `vmap`; keep states/anims keyed by original index). Use each field's `fileRegex` from the `SOURCES` registry (`mf__…__v###`, `mo__…__v###`, `sf__…__v###`).
- [ ] **Step 2:** Regenerate: `node scripts/gen-mf-catalog.mjs`; verify an omitted F4 variant is absent from its `vmap` (use a species present in `_medium_flora_curation.json` once one exists; until then the omit-sets are empty and vmap == full set — still correct).
- [ ] **Step 3:** Commit `feat(curation): F4/F5/F2 catalogs omit-aware (vmap)`.

### Task 2.2: Wire f4/f5/f2 placements to vmap

**Files:**
- Modify: `src/world/decoration-claims.js` (`f4Placements`, `f5Placements`, and the F2 placement path)

- [ ] **Step 1:** Each of these picks `variant` from a count/`obj.variants` or a hardcoded `_ssAllowed`. Replace with the shared `obj.vmap ? obj.vmap[pos] : pos` mapping (the F6 picker pattern). Remove the `_ssAllowed`/`SS_VARIANT_EXCLUDE` lookups from the selection path.
- [ ] **Step 2:** Parse-check; spot-verify a placement can only return a vmap index.
- [ ] **Step 3:** Commit `feat(curation): f4/f5/f2 placements pick from vmap`.

### Task 2.3: Migrate the hardcoded SS_VARIANT_EXCLUDE into real omit-sets

**Files:**
- Create: `scripts/migrate-ss-exclude.mjs` (one-shot)
- Modify: remove `SS_VARIANT_EXCLUDE` + `_ssAllowed` from `src/world/decoration-claims.js`

- [ ] **Step 1:** Write a one-shot that reads the existing `SS_VARIANT_EXCLUDE` map (`"biome/object" → [excluded indices]`) and, for the correct field (F4), writes those indices into `_medium_flora_curation.json` via `mergePicks`/`saveCuration` so they become curatable in Field Studio.
- [ ] **Step 2:** Run it; regenerate catalogs; confirm the previously-hardcoded exclusions still hold via the omit-set (vmap excludes them).
- [ ] **Step 3:** Delete `SS_VARIANT_EXCLUDE` + `_ssAllowed` from decoration-claims; parse-check.
- [ ] **Step 4:** Commit `refactor(curation): migrate SS_VARIANT_EXCLUDE into the F4 omit-set (one source of truth)`.

### Task 2.4: In-game verify F4/F5/F2 (one biome each, frozen noon). Record results.

---

## Phase 3 — Building dressing curation

### Task 3.1: Read the dressing omit-set in prop selection

**Files:**
- Modify: `src/render/dressing/d3-props.js` (prop variant selection) and/or `src/render/building-occluder.js`

- [ ] **Step 1:** Load the `dressing` omit-set (`assets/pixelab/buildings/dressing/_dressing_curation.json`) into the prop renderer (a generated `src/world/dressing-vmap.js` produced by a small generator mirroring the F6 catalog pass, OR a fetch of the sidecar at runtime — match how d3-props already loads `_pixellab_ids.json`).
- [ ] **Step 2:** Where a prop variant is chosen, pick from `allowed = present − omit`; skip the prop if fully omitted.
- [ ] **Step 3:** Regenerate (if generator) + parse-check; in-game verify a curated-out prop disappears.
- [ ] **Step 4:** Commit `feat(curation): building dressing props honor the dressing omit-set`.

---

## Phase 4 (optional) — Physically normalize large_objects → large_flora layout

Deferred. Only do this if large_objects species should animate + upscale like large_flora.

### Task 4.1: Migration script
- [ ] Write `scripts/normalize-large-objects.mjs` to copy/rename `large_objects/<biome>/<sp>/lg__..._v###.png` → `large_flora/<sp>/v###.png` layout (resolving the 8 name overlaps), preserving the omit-set keys.
- [ ] Regenerate F6 catalog; remove the `source: large_objects` branch (everything is `large_flora` now); retire the `source` special-casing in `f6SpriteUrl`.
- [ ] Generate states/anims/@384 for the migrated species via the existing F6 pipelines (`bulk_generate_f6`, `tree-upscale`).
- [ ] In-game verify; commit per step.

---

## Self-review notes

- **Spec coverage:** Phase 0 = curation layer + generator (spec A/B); Phase 1 = F6 fold + retire bolt-on (spec C/D); Phase 2 = F4/F5/F2 + SS_VARIANT_EXCLUDE (spec D + Phase 2); Phase 3 = dressing (spec D); Phase 4 = optional normalization (spec Phase 4). Apply flow (spec E) is delivered by Task 0.1 (`apply-field-picks.mjs`).
- **Cascade:** handled structurally — states/anims are keyed by original variant index and a culled index can never be selected (it's absent from `vmap`); no separate cascade code (spec B).
- **Denylist default-show:** empty omit-set ⇒ `vmap` == full disk set ⇒ everything shows; exclusions are subtractive (spec Goals).
