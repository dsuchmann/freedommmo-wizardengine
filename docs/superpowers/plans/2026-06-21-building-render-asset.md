# Lane A — ASSET (PixelLab Building Corpus) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Re-author and re-crop the grassland pilot building wall/door/window/roof PNGs so façades read as believable structures — opaque infill (no literal see-through), a TRUE mirrored east corner post, 32px-multiple horizontally-seamless tile strips with run-bond variants, transparent-surround window overlay objects with a closed + shutter-open state, door leaves whose bbox fits the `south_doorway` cut-out, and a closed 8px corner shoulder on the stone_brick fallback — validated in-game on the grassland (cob/fieldstone/wattle_daub) pilot, THEN burst to all 21 biomes × 4 materials. This lane writes ONLY PNGs under `assets/pixelab/buildings/**` (plus one validation script inside that tree); every filename-scheme change is handed to COORDINATION as a by-name patch request.

**Architecture:** Building walls are spatial-structure sprite PIECES (never whole-building sprites). The live draw engine is `src/render/building-occluder.js` → `drawWalls()` (offscreen 2D canvas → GL scene FBO via `gl-compositor`, so it still inherits GL lighting/CRT/day-night/depth — GL-legal). `wallImgs(b)` (`building-occluder.js:81`) loads a per-(biome,wallSlug) piece via `wallAssetDir`+`wallPieceFile` (`building-material-registry.js:1014,1025`) and sets `isPilot = base.naturalWidth >= 96` (`:93`). The current grassland pieces are 128×128 whole-facade tiles that trigger the `isPilot` 4-bay UV hack (`facadeTile`/`facadeWide` `:144-155`). Re-cropping `south_base` to a 32-wide strip (`naturalWidth=32`) flips `isPilot` false and routes through the legacy 32px-strip path (`:145` else-branch) — so the asset crop is the root fix for "repeats every 4 tiles." The decoupled door system swings a leaf into a `south_doorway__{wear}.png` cut-out (`:89,230`); cob/fieldstone already ship that piece, wattle_daub does not. Window overlay objects mirror `door-leaves.js`: a transparent-surround sprite drawn OVER an unmodified wall tile (RENDER owns the open/close transform; ASSET supplies closed + shutters-open art).

**Tech Stack:** JS (browser canvas/GL + node:test), no build step. Asset re-crop/re-author via Python 3.12 + Pillow (deterministic local post-process) and the PixelLab MCP/`scripts/bulk_generate_buildings.py` pipeline for pieces that need genuinely new geometry. Validation gate is a `node --test` script using the dependency-free PNG decoder already in `scripts/audit-png-alpha.mjs`.

---

## File Structure

All paths created/modified by this lane (STRICTLY inside `assets/pixelab/buildings/**`):

| Path | Responsibility |
|---|---|
| `assets/pixelab/buildings/manifest/validate-wall-assets.mjs` | **NEW** node:test asset gate. Imports the read-only PNG decoder from `scripts/audit-png-alpha.mjs` (no edit). Rejects internal-alpha holes in the solid wall-surface region; asserts left-col == right-col for seamless horizontal tiling; asserts 32px-multiple dims; flags the `south_corner_east == south_base` duplicate. Lives inside the lane glob. |
| `assets/pixelab/buildings/manifest/_recrop_strips.py` | **NEW** deterministic Pillow re-crop helper: slices a 128×128 facade into a 32×128 seamless `south_base` strip (left col forced == right col), 32×64 `north_back`, a real 32×128 `edge_ew` side-cap, and writes run-bond variants by shifting the mortar joint. Used by the pilot and the burst. |
| `assets/pixelab/buildings/manifest/_doorway_meta.py` | **NEW** measures the alpha doorway-hole bbox of each `south_doorway__normal.png` and emits the per-shape `{x0,y0,w,h}` fractions JSON for the COORDINATION metadata patch request. |
| `assets/pixelab/buildings/walls/grassland/wattle_daub/interior_base__{normal,weathered,damaged,mossy}.png` | RE-AUTHOR: opaque plaster infill (currently 57.5% transparent in the inner region → literal see-through). |
| `assets/pixelab/buildings/walls/grassland/wattle_daub/north_back__{normal,weathered,damaged,mossy}.png` | RE-AUTHOR upper infill panels opaque (the daub between timbers). |
| `assets/pixelab/buildings/walls/grassland/wattle_daub/south_corner_east__{normal,weathered,damaged,mossy}.png` | REPLACE the `south_base` pixel-duplicate with a TRUE mirrored east pilaster. |
| `assets/pixelab/buildings/walls/grassland/{cob,fieldstone,wattle_daub}/south_base__{wear}.png` | RE-CROP to 32×128 horizontally-seamless strips (left col == right col). |
| `assets/pixelab/buildings/walls/grassland/{cob,fieldstone,wattle_daub}/south_base__rb{1,2,3}.png` | **NEW** 2-3 run-bond variants (shift the mortar/joint x per tile to break the 4-tile repeat). Filename-scheme addition → COORDINATION patch request. |
| `assets/pixelab/buildings/walls/grassland/{cob,fieldstone,wattle_daub}/north_back__{wear}.png` | RE-CROP to 32×64 strips. |
| `assets/pixelab/buildings/walls/grassland/{cob,fieldstone,wattle_daub}/edge_ew__{wear}.png` | RE-AUTHOR/RE-CROP to a real 32×128 side-face cap (replaces the featureless gray fill in the fallback and the see-through strip here). |
| `assets/pixelab/buildings/walls/grassland/{cob,fieldstone,wattle_daub}/south_corner_{west,east}__{wear}.png` | RE-CROP to a TRUE mirrored 32×128 pair. |
| `assets/pixelab/buildings/walls/grassland/wattle_daub/south_doorway__{wear}.png` | **NEW** for wattle_daub (cob/fieldstone already have it): the wall with a door-shaped alpha cut-out the leaf swings into. |
| `assets/pixelab/buildings/walls/grassland/{cob,fieldstone,wattle_daub}/south_window_panel__{wear}.png` | **NEW** plain-panel wall base (no baked window) for the window-overlay base. Filename-scheme addition → COORDINATION. |
| `assets/pixelab/buildings/walls/grassland/{cob,fieldstone,wattle_daub}/south_window_obj__{shape}__{closed,shutters}.png` | **NEW** transparent-surround window overlay objects, closed + shutters-open states, 64×96 feature footprint. Filename-scheme addition → COORDINATION. |
| `assets/pixelab/buildings/doors/{plank,arched,ledged}__norm.png` | RECUT the leaf bbox to fit the `south_doorway` hole sub-rect. |
| `assets/pixelab/buildings/walls/stone_brick_tiles/south_corner_{west,east}.png` | Close the 8px transparent corner shoulder (fallback only). |
| `assets/pixelab/buildings/roof/grassland/{clay_tile,thatch,turf_sod,wood_shingle}/roof_fascia.png` | CONFIRM eave-trim quality (already present, 64×64); re-author only if a piece fails the trim check. |

**Cross-lane handoffs (NOT edited by this lane — filed as patch requests to COORDINATION, who edits `building-material-registry.js`):**
- new `south_base__rb{1,2,3}` run-bond filenames + a `wallPieceFile` `rbVariant` case,
- new `south_window_panel__{wear}` + `south_window_obj__{shape}__{closed,shutters}` filenames + switch cases,
- the `south_doorway`/door-leaf doorway-hole `{x0,y0,w,h}` per-shape metadata,
- (for wattle_daub) wiring `south_doorway` now that the piece exists.

---

## PHASE 1 — Pure-asset fixes that land FIRST (no renderer change, no API spend where avoidable)

### Task 1 — Asset-validation gate (the safety net that would have caught the see-through daub)

**Files:** create `assets/pixelab/buildings/manifest/validate-wall-assets.mjs`

- [ ] Confirm the dependency-free PNG decoder exists and is importable: read `scripts/audit-png-alpha.mjs` and verify it `export`s `readPngRgba(path)` returning `{ width, height, data }` (RGBA bytes). It does (line ~14). DO NOT edit that file.
- [ ] Write the gate as a `node:test` file that FAILS first against the known-bad current assets. Create `assets/pixelab/buildings/manifest/validate-wall-assets.mjs`:

```js
// assets/pixelab/buildings/manifest/validate-wall-assets.mjs
// Asset gate for building wall PIECES. Rejects the exact bugs from
// docs/superpowers/specs/2026-06-21-building-render-quality-design.md (Lane A):
//   - internal alpha holes in the solid wall-surface region (the see-through daub),
//   - non-seamless horizontal tiling (left column != right column),
//   - non-32px-multiple dimensions,
//   - a south_corner_east that is a pixel-duplicate of south_base (no east post).
// Pure-JS PNG decode reused from scripts/audit-png-alpha.mjs (read-only import).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPngRgba } from '../../../../scripts/audit-png-alpha.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WALLS = path.resolve(HERE, '..', 'walls');

function alphaAt(img, x, y) { return img.data[(y * img.width + x) * 4 + 3]; }

// Fraction of pixels with alpha < 16 inside an inner rect (excludes the top sky band
// and the bottom foundation course, where transparency is legitimate).
function innerTransparentFrac(img, inset) {
  const x0 = inset, x1 = img.width - inset, y0 = 8, y1 = Math.round(img.height * 0.75);
  let trans = 0, total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    total++; if (alphaAt(img, x, y) < 16) trans++;
  }
  return trans / total;
}

// Seamless horizontal tile: the left edge column must equal the right edge column
// (alpha + RGB within tolerance) so abutting copies hide the seam.
function colsMatch(img) {
  let worst = 0;
  for (let y = 8; y < img.height - 8; y++) {
    const li = (y * img.width + 0) * 4, ri = (y * img.width + (img.width - 1)) * 4;
    for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(img.data[li + c] - img.data[ri + c]));
  }
  return worst;
}

function pixelsIdentical(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

// Only the SURFACE pieces must be hole-free + seamless. Corners/doorway/window legitimately
// carry alpha (the post shoulder, the door cut, the window surround).
const SURFACE = ['south_base__normal.png', 'interior_base__normal.png', 'north_back__normal.png'];

function eachMaterialDir(cb) {
  for (const biome of fs.readdirSync(WALLS)) {
    const bdir = path.join(WALLS, biome);
    if (!fs.statSync(bdir).isDirectory()) continue;
    for (const mat of fs.readdirSync(bdir)) {
      const mdir = path.join(bdir, mat);
      if (fs.statSync(mdir).isDirectory()) cb(biome, mat, mdir);
    }
  }
}

test('wall surface pieces have NO internal alpha holes in the solid region (<1%)', () => {
  const bad = [];
  eachMaterialDir((biome, mat, mdir) => {
    for (const f of SURFACE) {
      const p = path.join(mdir, f);
      if (!fs.existsSync(p)) continue;
      const img = readPngRgba(p);
      const frac = innerTransparentFrac(img, Math.max(1, Math.round(img.width * 0.06)));
      if (frac > 0.01) bad.push(`${biome}/${mat}/${f}: ${(frac * 100).toFixed(1)}% transparent in solid region`);
    }
  });
  assert.equal(bad.length, 0, 'see-through wall surface(s):\n' + bad.join('\n'));
});

test('seamless surface strips: left column == right column (32-wide strips only)', () => {
  const bad = [];
  eachMaterialDir((biome, mat, mdir) => {
    for (const f of ['south_base__normal.png']) {
      const p = path.join(mdir, f);
      if (!fs.existsSync(p)) continue;
      const img = readPngRgba(p);
      if (img.width > 64) continue; // whole-facade legacy tiles are not strip-tiled; skip
      const worst = colsMatch(img);
      if (worst > 8) bad.push(`${biome}/${mat}/${f}: left/right column diff ${worst} (>8)`);
    }
  });
  assert.equal(bad.length, 0, 'non-seamless strips:\n' + bad.join('\n'));
});

test('32px-multiple dimensions on strip pieces', () => {
  const bad = [];
  eachMaterialDir((biome, mat, mdir) => {
    for (const f of ['south_base__normal.png', 'north_back__normal.png', 'edge_ew__normal.png',
                     'south_corner_west__normal.png', 'south_corner_east__normal.png']) {
      const p = path.join(mdir, f);
      if (!fs.existsSync(p)) continue;
      const img = readPngRgba(p);
      if (img.width > 64) continue; // legacy whole-facade; not yet re-cropped
      if (img.width % 32 !== 0 || img.height % 32 !== 0) bad.push(`${biome}/${mat}/${f}: ${img.width}x${img.height}`);
    }
  });
  assert.equal(bad.length, 0, 'non-32px strip dims:\n' + bad.join('\n'));
});

test('south_corner_east is NOT a pixel-duplicate of south_base (must have an east post)', () => {
  const bad = [];
  eachMaterialDir((biome, mat, mdir) => {
    const base = path.join(mdir, 'south_base__normal.png');
    const east = path.join(mdir, 'south_corner_east__normal.png');
    if (!fs.existsSync(base) || !fs.existsSync(east)) return;
    if (pixelsIdentical(readPngRgba(base), readPngRgba(east))) bad.push(`${biome}/${mat}`);
  });
  assert.equal(bad.length, 0, 'corner_east duplicates south_base (no east post): ' + bad.join(', '));
});
```

- [ ] Run it to confirm it FAILS on the current corpus: `node --test assets/pixelab/buildings/manifest/validate-wall-assets.mjs`. Expected FAIL: the hole test reports `grassland/wattle_daub/interior_base__normal.png: 57.5% transparent in solid region`, and the duplicate test reports `grassland/wattle_daub`. (This proves the gate catches the real bugs before any re-author.)
- [ ] Stage + commit:
```
git add assets/pixelab/buildings/manifest/validate-wall-assets.mjs
git commit -m "test(buildings): asset gate rejects see-through daub + corner_east dup + non-seam strips

Fails on current grassland/wattle_daub (interior_base 57.5% see-through, corner_east==south_base).
Note: validation gate lands first so every subsequent re-author is verified."
```

---

### Task 2 — Re-author wattle_daub interior_base infill OPAQUE

**Files:** modify `assets/pixelab/buildings/walls/grassland/wattle_daub/interior_base__{normal,weathered,damaged,mossy}.png`

- [ ] Measure the exact see-through to confirm the target before editing: `python -c "from PIL import Image; im=Image.open('assets/pixelab/buildings/walls/grassland/wattle_daub/interior_base__normal.png').convert('RGBA'); a=im.getchannel('A'); px=list(a.crop((8,8,120,96)).getdata()); print('inner trans %:', round(100*sum(1 for p in px if p<16)/len(px),1))"`. Expected: `57.5`.
- [ ] Re-author the interior face as OPAQUE plaster. Preferred deterministic path (no API, no hallucination): fill the interior infill alpha by flood-filling the transparent inner region with the surrounding plaster color, keeping only the legitimate top/bottom trim alpha. Run:
```
python - <<'PY'
from PIL import Image
import glob
for p in glob.glob('assets/pixelab/buildings/walls/grassland/wattle_daub/interior_base__*.png'):
    im = Image.open(p).convert('RGBA'); px = im.load(); w,h = im.size
    # sample a known-opaque plaster pixel near the top trim
    fill = None
    for y in range(8,40):
        for x in range(20,108):
            r,g,b,a = px[x,y]
            if a>240: fill=(r,g,b,255); break
        if fill: break
    fill = fill or (210,196,170,255)
    # make the inner wall-surface region fully opaque: any alpha<200 in rows 8..96 -> plaster
    for y in range(8,96):
        for x in range(2,w-2):
            r,g,b,a = px[x,y]
            if a < 200:
                px[x,y] = fill
    im.save(p)
    print('opaque', p)
PY
```
- [ ] If the flood-fill plaster reads flat/wrong in-game, regenerate the interior face through PixelLab instead (real material, no-mock): `python scripts/bulk_generate_buildings.py --biome grassland --material wattle_daub --phase states` — this re-runs `interior_face_prompt` ("a smooth finished surface (plaster or wood paneling)...") seeded from `south_base`. Disk-first resumability means only missing/invalid pieces regen; delete the bad `interior_base__*.png` first so they re-run.
- [ ] Run the gate on just this material: `node --test assets/pixelab/buildings/manifest/validate-wall-assets.mjs`. Expected: the hole test no longer lists `grassland/wattle_daub/interior_base__normal.png` (now <1% transparent in the solid region).
- [ ] Visually confirm with Read: open `assets/pixelab/buildings/walls/grassland/wattle_daub/interior_base__normal.png` — the gray-checker (transparency) between the timbers must be gone, replaced by solid plaster.
- [ ] Stage + commit:
```
git add assets/pixelab/buildings/walls/grassland/wattle_daub/interior_base__normal.png assets/pixelab/buildings/walls/grassland/wattle_daub/interior_base__weathered.png assets/pixelab/buildings/walls/grassland/wattle_daub/interior_base__damaged.png assets/pixelab/buildings/walls/grassland/wattle_daub/interior_base__mossy.png
git commit -m "fix(buildings): opaque plaster infill on wattle_daub interior_base (kill see-through)

interior_base inner region 57.5%->0% transparent; gate passes.
Note: pure-asset fix, no renderer change."
```

---

### Task 3 — Re-author wattle_daub north_back upper infill OPAQUE

**Files:** modify `assets/pixelab/buildings/walls/grassland/wattle_daub/north_back__{normal,weathered,damaged,mossy}.png`

- [ ] Measure the north_back infill alpha in the wall-surface band (rows 8..96, excluding the legitimate top-sky band): `python -c "from PIL import Image; im=Image.open('assets/pixelab/buildings/walls/grassland/wattle_daub/north_back__normal.png').convert('RGBA'); a=im.getchannel('A'); px=list(a.crop((8,40,120,96)).getdata()); print('lower-inner trans %:', round(100*sum(1 for p in px if p<16)/len(px),1))"`. Record the result; the north back panel between timbers must not be see-through where the wall surface is.
- [ ] Make the inner wall-surface region opaque with the same flood-fill as Task 2, but only below the cap band (north_back is the back wall = top cap + upper wall; rows < ~8 are legitimately the sky):
```
python - <<'PY'
from PIL import Image
import glob
for p in glob.glob('assets/pixelab/buildings/walls/grassland/wattle_daub/north_back__*.png'):
    im = Image.open(p).convert('RGBA'); px = im.load(); w,h = im.size
    fill = None
    for y in range(10,40):
        for x in range(20,108):
            r,g,b,a = px[x,y]
            if a>240: fill=(r,g,b,255); break
        if fill: break
    fill = fill or (205,190,160,255)
    for y in range(10,96):
        for x in range(2,w-2):
            r,g,b,a = px[x,y]
            if a < 200:
                px[x,y] = fill
    im.save(p)
    print('opaque', p)
PY
```
- [ ] Run the gate: `node --test assets/pixelab/buildings/manifest/validate-wall-assets.mjs`. Expected: `grassland/wattle_daub/north_back__normal.png` is NOT in the hole-test failure list.
- [ ] Visually confirm with Read: `assets/pixelab/buildings/walls/grassland/wattle_daub/north_back__normal.png` — the infill panels between the timber lattice are solid.
- [ ] Stage + commit:
```
git add assets/pixelab/buildings/walls/grassland/wattle_daub/north_back__normal.png assets/pixelab/buildings/walls/grassland/wattle_daub/north_back__weathered.png assets/pixelab/buildings/walls/grassland/wattle_daub/north_back__damaged.png assets/pixelab/buildings/walls/grassland/wattle_daub/north_back__mossy.png
git commit -m "fix(buildings): opaque infill on wattle_daub north_back upper panels

Note: back wall no longer reveals terrain through the daub lattice."
```

---

### Task 4 — TRUE mirrored east pilaster for wattle_daub south_corner_east

**Files:** modify `assets/pixelab/buildings/walls/grassland/wattle_daub/south_corner_east__{normal,weathered,damaged,mossy}.png`

- [ ] Confirm the duplicate: `python -c "from PIL import Image,ImageChops; b=Image.open('assets/pixelab/buildings/walls/grassland/wattle_daub/south_base__normal.png').convert('RGBA'); e=Image.open('assets/pixelab/buildings/walls/grassland/wattle_daub/south_corner_east__normal.png').convert('RGBA'); print('diff bbox:', ImageChops.difference(b,e).getbbox())"`. Expected: `(127, 127, 128, 128)` — i.e. effectively identical (only a single corner pixel differs), confirming no east post.
- [ ] Build the east corner as a horizontal mirror of the WEST corner (which DOES have a real pilaster), preserving the wear set:
```
python - <<'PY'
from PIL import Image
for w in ['normal','weathered','damaged','mossy']:
    wp = f'assets/pixelab/buildings/walls/grassland/wattle_daub/south_corner_west__{w}.png'
    ep = f'assets/pixelab/buildings/walls/grassland/wattle_daub/south_corner_east__{w}.png'
    import os
    if not os.path.exists(wp):
        print('skip (no west)', w); continue
    west = Image.open(wp).convert('RGBA')
    east = west.transpose(Image.FLIP_LEFT_RIGHT)
    east.save(ep)
    print('mirrored east <- west', w)
PY
```
- [ ] Run the gate: `node --test assets/pixelab/buildings/manifest/validate-wall-assets.mjs`. Expected: the duplicate test no longer lists `grassland/wattle_daub` (east is now the mirror of west, not a copy of south_base).
- [ ] Visually confirm with Read: `assets/pixelab/buildings/walls/grassland/wattle_daub/south_corner_east__normal.png` — a vertical corner post on the RIGHT edge (mirror of the west file's left post).
- [ ] Stage + commit:
```
git add assets/pixelab/buildings/walls/grassland/wattle_daub/south_corner_east__normal.png assets/pixelab/buildings/walls/grassland/wattle_daub/south_corner_east__weathered.png assets/pixelab/buildings/walls/grassland/wattle_daub/south_corner_east__damaged.png assets/pixelab/buildings/walls/grassland/wattle_daub/south_corner_east__mossy.png
git commit -m "fix(buildings): true mirrored east pilaster on wattle_daub south_corner_east

Was a pixel-dup of south_base (no east post); now mirror of south_corner_west.
Note: pure-asset fix, no renderer change."
```

---

### Task 5 — Close the 8px corner see-through on the stone_brick FALLBACK corners

**Files:** modify `assets/pixelab/buildings/walls/stone_brick_tiles/south_corner_{west,east}.png`

- [ ] Confirm the top shoulder transparency: `python -c "from PIL import Image; im=Image.open('assets/pixelab/buildings/walls/stone_brick_tiles/south_corner_west.png').convert('RGBA'); a=im.getchannel('A'); w,h=im.size; print([sum(1 for x in range(w) if a.getpixel((x,y))<16) for y in range(12)])"`. Expected: `[32,32,32,32,32,32,32,32,1,0,0,...]` — rows 0-7 fully transparent (the buttress shoulder reveals terrain).
- [ ] Fill the top 8 transparent rows with the corner's own stone (sample the first opaque row below the shoulder and extend it up), so the shoulder no longer reveals terrain. The corner silhouette stays (the buttress) but its top band becomes opaque stone:
```
python - <<'PY'
from PIL import Image
for f in ['south_corner_west.png','south_corner_east.png']:
    p = 'assets/pixelab/buildings/walls/stone_brick_tiles/'+f
    im = Image.open(p).convert('RGBA'); px = im.load(); w,h = im.size
    # first fully-opaque source row
    src = None
    for y in range(h):
        if all(px[x,y][3] > 200 for x in range(w)):
            src = y; break
    src = src if src is not None else 8
    for y in range(0, src):
        for x in range(w):
            if px[x,y][3] < 200:
                px[x,y] = px[x, src]
    im.save(p)
    print('closed shoulder', f, 'src row', src)
PY
```
- [ ] Verify no top see-through remains: `python -c "from PIL import Image; im=Image.open('assets/pixelab/buildings/walls/stone_brick_tiles/south_corner_west.png').convert('RGBA'); a=im.getchannel('A'); w,h=im.size; print('top-12 trans:', [sum(1 for x in range(w) if a.getpixel((x,y))<16) for y in range(12)])"`. Expected: all zeros (or near-zero) in the top rows.
- [ ] Visually confirm with Read: `assets/pixelab/buildings/walls/stone_brick_tiles/south_corner_west.png` — the previously-empty top shoulder is now stone.
- [ ] Stage + commit:
```
git add assets/pixelab/buildings/walls/stone_brick_tiles/south_corner_west.png assets/pixelab/buildings/walls/stone_brick_tiles/south_corner_east.png
git commit -m "fix(buildings): close 8px corner shoulder see-through on stone_brick fallback

Rows 0-7 were fully transparent (revealed terrain); now filled with corner stone.
Note: fallback-only, pure-asset."
```

---

## PHASE 2 — 32px tileable re-crop (pilot: cob + fieldstone + wattle_daub) — pixel fix that gates RENDER

### Task 6 — Deterministic re-crop helper (strips + run-bond) + measurement

**Files:** create `assets/pixelab/buildings/manifest/_recrop_strips.py`

- [ ] Measure current pilot dims to confirm they are 128×128 whole-facades (which trigger the `isPilot` 4-bay hack via `building-occluder.js:93`): `python -c "from PIL import Image; [print(m, Image.open(f'assets/pixelab/buildings/walls/grassland/{m}/south_base__normal.png').size) for m in ['cob','fieldstone','wattle_daub']]"`. Expected: all `(128,128)`.
- [ ] Write the re-crop helper. It slices a 128-wide facade into a single representative 32-wide bay, forces left col == right col (averaging the two edge columns) for seamlessness, and emits run-bond variants by horizontally rolling the strip so the mortar joint lands at a different x:
```python
# assets/pixelab/buildings/manifest/_recrop_strips.py
# Deterministic local re-crop of 128x128 whole-facade wall pieces into 32px-multiple
# horizontally-seamless tile strips + run-bond variants. NO API spend; reproducible.
import sys, os
from PIL import Image

def seamless_strip(src, x0, w=32, h=128):
    """Crop a w-wide bay and force left col == right col so copies abut seamlessly."""
    bay = src.crop((x0, 0, x0 + w, h)).convert('RGBA')
    px = bay.load()
    for y in range(h):
        l = px[0, y]; r = px[w - 1, y]
        avg = tuple((l[c] + r[c]) // 2 for c in range(4))
        px[0, y] = avg; px[w - 1, y] = avg
    return bay

def runbond(strip, shift):
    """Horizontal roll to move the mortar joint, breaking the 4-tile repeat."""
    import numpy as np
    arr = np.array(strip)
    return Image.fromarray(np.roll(arr, shift, axis=1), 'RGBA')

def recrop_material(mdir):
    base_p = os.path.join(mdir, 'south_base__normal.png')
    src = Image.open(base_p).convert('RGBA')
    if src.width <= 64:
        print('already strip', mdir); return
    # pick the cleanest interior bay (avoid the corner posts): center-left bay at x=48
    strip = seamless_strip(src, 48, 32, 128)
    strip.save(base_p); print('south_base -> 32x128', base_p)
    # run-bond variants (filename-scheme addition -> COORDINATION patch request)
    for i, sh in enumerate([8, 16, 24], start=1):
        runbond(strip, sh).save(os.path.join(mdir, f'south_base__rb{i}.png'))
    # north_back -> 32x64 (top cap + upper wall band only)
    nb_p = os.path.join(mdir, 'north_back__normal.png')
    if os.path.exists(nb_p):
        nb = Image.open(nb_p).convert('RGBA')
        if nb.width > 64:
            seamless_strip(nb, 48, 32, 128).crop((0, 0, 32, 64)).save(nb_p)
            print('north_back -> 32x64', nb_p)
    # edge_ew -> real 32x128 side-face cap: sample the x=0 quoin column band of south_base
    ew_p = os.path.join(mdir, 'edge_ew__normal.png')
    cap = src.crop((0, 0, 32, 128)).convert('RGBA')  # the building's own corner stone as a side face
    cap.save(ew_p); print('edge_ew -> 32x128 side cap', ew_p)

if __name__ == '__main__':
    for mdir in sys.argv[1:]:
        recrop_material(mdir)
```
- [ ] Dry-run on a COPY (do not overwrite yet): copy cob into a temp dir and run the helper there, then inspect dims: `python -c "import shutil,os; os.makedirs('/tmp/recrop_cob',exist_ok=True); shutil.copy('assets/pixelab/buildings/walls/grassland/cob/south_base__normal.png','/tmp/recrop_cob/south_base__normal.png'); shutil.copy('assets/pixelab/buildings/walls/grassland/cob/north_back__normal.png','/tmp/recrop_cob/north_back__normal.png')" && python assets/pixelab/buildings/manifest/_recrop_strips.py /tmp/recrop_cob && python -c "from PIL import Image; import glob; [print(os.path.basename(p), Image.open(p).size) for p in __import__('glob').glob('/tmp/recrop_cob/*.png')]" 2>/dev/null; python -c "import os,glob; from PIL import Image; [print(os.path.basename(p), Image.open(p).size) for p in glob.glob('/tmp/recrop_cob/*.png')]"`. Expected: `south_base__normal.png (32, 128)`, `north_back__normal.png (32, 64)`, plus `south_base__rb1/2/3.png (32,128)`.
- [ ] Stage + commit the helper only (no asset changes yet):
```
git add assets/pixelab/buildings/manifest/_recrop_strips.py
git commit -m "tooling(buildings): deterministic 32px strip re-crop + run-bond helper

Slices 128 facades into seamless 32x128 strips, left col==right col, +3 run-bond rolls.
Note: pilot tooling; lives inside the asset tree, writes only PNGs."
```

---

### Task 7 — Re-crop cob + fieldstone south_base/north_back/edge_ew to 32px strips (PILOT)

**Files:** modify `assets/pixelab/buildings/walls/grassland/{cob,fieldstone}/south_base__normal.png`, `.../north_back__normal.png`, `.../edge_ew__normal.png`; create `.../south_base__rb{1,2,3}.png`

- [ ] Apply the helper to the two pilot materials (cob, fieldstone — fully opaque infill, lowest-risk):
```
python assets/pixelab/buildings/manifest/_recrop_strips.py assets/pixelab/buildings/walls/grassland/cob assets/pixelab/buildings/walls/grassland/fieldstone
```
- [ ] Verify dims + 32px-multiple + seam: `python -c "from PIL import Image; import glob,os; [print(os.path.relpath(p), Image.open(p).size) for m in ['cob','fieldstone'] for p in glob.glob(f'assets/pixelab/buildings/walls/grassland/{m}/south_base*.png')+[f'assets/pixelab/buildings/walls/grassland/{m}/north_back__normal.png', f'assets/pixelab/buildings/walls/grassland/{m}/edge_ew__normal.png']]"`. Expected: `south_base__normal.png (32, 128)`, three `rb` strips `(32,128)`, `north_back__normal.png (32, 64)`, `edge_ew__normal.png (32, 128)`.
- [ ] Run the gate: `node --test assets/pixelab/buildings/manifest/validate-wall-assets.mjs`. Expected: the seamless-strips test and 32px-dims test PASS for cob/fieldstone (now strip-sized, left col == right col).
- [ ] Visually confirm with Read: `assets/pixelab/buildings/walls/grassland/cob/south_base__normal.png` is now a single 32×128 vertical bay, and `edge_ew__normal.png` shows a real stone side-cap (not a featureless gray fill).
- [ ] **PATCH REQUEST to COORDINATION** (write this into the handoff note in the commit body, since ASSET never edits the registry): add `south_base__rb{1,2,3}.png` support — a `wallPieceFile('south_base', {wear, rbVariant})` case returning `south_base__rb${rbVariant}.png` for `rbVariant ∈ {1,2,3}` (else `south_base__${wear}.png`), so RENDER can select a run-bond variant per tile to break the repeat. No new dir, same `wallAssetDir`.
- [ ] Stage + commit:
```
git add assets/pixelab/buildings/walls/grassland/cob/south_base__normal.png assets/pixelab/buildings/walls/grassland/cob/south_base__rb1.png assets/pixelab/buildings/walls/grassland/cob/south_base__rb2.png assets/pixelab/buildings/walls/grassland/cob/south_base__rb3.png assets/pixelab/buildings/walls/grassland/cob/north_back__normal.png assets/pixelab/buildings/walls/grassland/cob/edge_ew__normal.png assets/pixelab/buildings/walls/grassland/fieldstone/south_base__normal.png assets/pixelab/buildings/walls/grassland/fieldstone/south_base__rb1.png assets/pixelab/buildings/walls/grassland/fieldstone/south_base__rb2.png assets/pixelab/buildings/walls/grassland/fieldstone/south_base__rb3.png assets/pixelab/buildings/walls/grassland/fieldstone/north_back__normal.png assets/pixelab/buildings/walls/grassland/fieldstone/edge_ew__normal.png
git commit -m "feat(buildings): 32px seamless strips + run-bond for cob/fieldstone (pilot)

south_base 32x128 seamless, north_back 32x64, edge_ew real side-cap, +3 run-bond rolls.
PATCH REQUEST -> COORDINATION: add wallPieceFile rbVariant case south_base__rb{1,2,3}.png.
Note: re-crop flips isPilot false -> RENDER routes legacy 32px-strip path."
```

---

### Task 8 — Re-crop cob + fieldstone corners to a TRUE mirrored 32×128 pair (PILOT)

**Files:** modify `assets/pixelab/buildings/walls/grassland/{cob,fieldstone}/south_corner_{west,east}__normal.png`

- [ ] Build the corners as a mirrored pair from the 128-facade's corner columns: west = leftmost 32 columns of the facade (carries the left quoin), east = its horizontal mirror — so they read as matching returns:
```
python - <<'PY'
from PIL import Image
for m in ['cob','fieldstone']:
    d = f'assets/pixelab/buildings/walls/grassland/{m}/'
    # If west is still 128 wide, crop the left quoin band; else keep.
    wsrc = Image.open(d+'south_corner_west__normal.png').convert('RGBA')
    if wsrc.width > 64:
        west = wsrc.crop((0,0,32,128))
    else:
        west = wsrc
    west.save(d+'south_corner_west__normal.png')
    east = west.transpose(Image.FLIP_LEFT_RIGHT)
    east.save(d+'south_corner_east__normal.png')
    print('mirrored corner pair', m, west.size)
PY
```
- [ ] Verify the pair is a true mirror and 32-wide: `python -c "from PIL import Image,ImageChops; import os; [print(m, Image.open(f'assets/pixelab/buildings/walls/grassland/{m}/south_corner_west__normal.png').size, 'mirror-ok:', ImageChops.difference(Image.open(f'assets/pixelab/buildings/walls/grassland/{m}/south_corner_east__normal.png').convert('RGBA'), Image.open(f'assets/pixelab/buildings/walls/grassland/{m}/south_corner_west__normal.png').convert('RGBA').transpose(Image.FLIP_LEFT_RIGHT)).getbbox() is None) for m in ['cob','fieldstone']]"`. Expected: size `(32,128)`, `mirror-ok: True`.
- [ ] Run the gate: `node --test assets/pixelab/buildings/manifest/validate-wall-assets.mjs`. Expected: duplicate test PASSES (east != south_base for cob/fieldstone), dims test PASSES.
- [ ] Visually confirm with Read: `assets/pixelab/buildings/walls/grassland/cob/south_corner_west__normal.png` (left quoin) and `south_corner_east__normal.png` (right quoin) form a symmetric pair.
- [ ] Stage + commit:
```
git add assets/pixelab/buildings/walls/grassland/cob/south_corner_west__normal.png assets/pixelab/buildings/walls/grassland/cob/south_corner_east__normal.png assets/pixelab/buildings/walls/grassland/fieldstone/south_corner_west__normal.png assets/pixelab/buildings/walls/grassland/fieldstone/south_corner_east__normal.png
git commit -m "feat(buildings): true mirrored 32x128 corner pair for cob/fieldstone (pilot)

Note: corners now 32-wide quoin returns, mirrored W<->E."
```

---

### Task 9 — Re-crop wattle_daub strips (south_base + run-bond + north_back + edge_ew + corners)

**Files:** modify `assets/pixelab/buildings/walls/grassland/wattle_daub/{south_base__normal,north_back__normal,edge_ew__normal,south_corner_west__normal,south_corner_east__normal}.png`; create `.../south_base__rb{1,2,3}.png`

- [ ] wattle_daub has a TIMBER lattice, so a naive 32-bay crop can cut a diagonal brace mid-stroke. Choose the bay whose left/right columns are vertical timber (a stud), so seams land on a post. Inspect the facade columns to find a stud x: `python -c "from PIL import Image; im=Image.open('assets/pixelab/buildings/walls/grassland/wattle_daub/south_base__normal.png').convert('RGBA'); px=im.load(); print([x for x in range(0,128,4) if 0.3*px[x,60][0]+0.59*px[x,60][1]+0.11*px[x,60][2] < 110])"`. Pick a dark-timber x near a panel boundary as the crop start.
- [ ] Re-crop using the helper but with the stud-aligned x0 (replace 48 with the chosen stud x; default to 48 if uncertain since infill is now opaque from Task 2/3): run the helper, then ALSO mirror-build the corners:
```
python - <<'PY'
from PIL import Image
import numpy as np, os
d='assets/pixelab/buildings/walls/grassland/wattle_daub/'
src=Image.open(d+'south_base__normal.png').convert('RGBA')
X0=48  # stud-aligned bay; infill already opaque
def seam(b):
    px=b.load(); w,h=b.size
    for y in range(h):
        l=px[0,y]; r=px[w-1,y]; a=tuple((l[c]+r[c])//2 for c in range(4)); px[0,y]=a; px[w-1,y]=a
    return b
strip=seam(src.crop((X0,0,X0+32,128)))
strip.save(d+'south_base__normal.png')
for i,sh in enumerate([8,16,24],1):
    Image.fromarray(np.roll(np.array(strip),sh,axis=1),'RGBA').save(d+f'south_base__rb{i}.png')
nb=Image.open(d+'north_back__normal.png').convert('RGBA')
if nb.width>64: seam(nb.crop((X0,0,X0+32,128))).crop((0,0,32,64)).save(d+'north_back__normal.png')
src.crop((0,0,32,128)).save(d+'edge_ew__normal.png')  # corner timber as side cap
west=Image.open(d+'south_corner_west__normal.png').convert('RGBA')
if west.width>64: west=west.crop((0,0,32,128))
west.save(d+'south_corner_west__normal.png')
west.transpose(Image.FLIP_LEFT_RIGHT).save(d+'south_corner_east__normal.png')
print('wattle_daub strips done')
PY
```
- [ ] Verify dims + seam + mirror: `python -c "from PIL import Image; import glob,os; [print(os.path.basename(p),Image.open(p).size) for p in glob.glob('assets/pixelab/buildings/walls/grassland/wattle_daub/south_base*.png')+[f'assets/pixelab/buildings/walls/grassland/wattle_daub/{x}.png' for x in ['north_back__normal','edge_ew__normal','south_corner_west__normal','south_corner_east__normal']]]"`. Expected: south_base + rb1/2/3 `(32,128)`, north_back `(32,64)`, edge_ew `(32,128)`, corners `(32,128)`.
- [ ] Run the FULL gate: `node --test assets/pixelab/buildings/manifest/validate-wall-assets.mjs`. Expected: ALL four tests PASS for grassland (no see-through, seamless, 32px, no corner dup) — the pilot is gate-clean.
- [ ] Visually confirm with Read: `assets/pixelab/buildings/walls/grassland/wattle_daub/south_base__normal.png` is a 32×128 stud-aligned bay with opaque infill; the run-bond variants show the timber/joint shifted.
- [ ] Stage + commit:
```
git add assets/pixelab/buildings/walls/grassland/wattle_daub/south_base__normal.png assets/pixelab/buildings/walls/grassland/wattle_daub/south_base__rb1.png assets/pixelab/buildings/walls/grassland/wattle_daub/south_base__rb2.png assets/pixelab/buildings/walls/grassland/wattle_daub/south_base__rb3.png assets/pixelab/buildings/walls/grassland/wattle_daub/north_back__normal.png assets/pixelab/buildings/walls/grassland/wattle_daub/edge_ew__normal.png assets/pixelab/buildings/walls/grassland/wattle_daub/south_corner_west__normal.png assets/pixelab/buildings/walls/grassland/wattle_daub/south_corner_east__normal.png
git commit -m "feat(buildings): 32px stud-aligned seamless strips for wattle_daub (pilot complete)

Whole grassland pilot now gate-clean: opaque, seamless, 32px, mirrored corners.
Note: bay cropped on a vertical stud so seams land on a post, not a brace."
```

---

## PHASE 3 — Doorway-hole metadata + door-leaf fit

### Task 10 — Add wattle_daub south_doorway + measure per-material doorway-hole bbox

**Files:** create `assets/pixelab/buildings/manifest/_doorway_meta.py`, `assets/pixelab/buildings/walls/grassland/wattle_daub/south_doorway__normal.png`

- [ ] Confirm cob/fieldstone already have `south_doorway__normal.png` and wattle_daub does NOT: `python -c "import os; [print(m, os.path.exists(f'assets/pixelab/buildings/walls/grassland/{m}/south_doorway__normal.png')) for m in ['cob','fieldstone','wattle_daub']]"`. Expected: cob True, fieldstone True, wattle_daub False.
- [ ] Generate the missing wattle_daub `south_doorway` (the wall with a door-shaped ALPHA cut-out the leaf swings into). Regenerate through the pipeline so the cut is a real alpha hole, not dark paint — add a `south_doorway` task by reusing the pipeline's door-closed seed, then alpha-cut the opening locally from the closed door's leaf bbox:
```
python - <<'PY'
from PIL import Image
d='assets/pixelab/buildings/walls/grassland/wattle_daub/'
# Seed from south_door__plank (closed) and cut the leaf region to transparent, leaving the frame.
door=Image.open(d+'south_door__plank.png').convert('RGBA'); px=door.load(); w,h=door.size
# leaf = central dark column band; find it
cols=[]
for x in range(w):
    c=sum(1 for y in range(40,110) if (lambda p:0.3*p[0]+0.59*p[1]+0.11*p[2])(px[x,y])<70 and px[x,y][3]>120)
    cols.append(c)
door_x=[x for x,c in enumerate(cols) if c>30]
if door_x:
    x0,x1=min(door_x),max(door_x)
    # top of opening: first dark row in the center column
    cx=(x0+x1)//2; ytop=next((y for y in range(h) if (lambda p:0.3*p[0]+0.59*p[1]+0.11*p[2])(px[cx,y])<70 and px[cx,y][3]>120), 32)
    for y in range(ytop, h):
        for x in range(x0, x1+1):
            px[x,y]=(0,0,0,0)  # alpha cut
    door.save(d+'south_doorway__normal.png')
    print('wattle_daub south_doorway cut x[%d,%d] ytop=%d'%(x0,x1,ytop))
else:
    print('ERROR: could not locate leaf band')
PY
```
- [ ] Write the metadata extractor (emits per-material/per-shape doorway-hole fractions for COORDINATION):
```python
# assets/pixelab/buildings/manifest/_doorway_meta.py
# Emit the doorway-hole bbox (as fractions of the 128 facade) for each south_doorway,
# for the COORDINATION registry metadata so door-leaves.js swings the leaf into the hole.
import json, glob, os
from PIL import Image

def hole_bbox(p):
    im = Image.open(p).convert('RGBA'); px = im.load(); w, h = im.size
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            if px[x, y][3] < 16:            # alpha hole
                xs.append(x); ys.append(y)
    if not xs:
        return None
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    return {'x0': round(x0 / w, 4), 'y0': round(y0 / h, 4),
            'w': round((x1 - x0 + 1) / w, 4), 'h': round((y1 - y0 + 1) / h, 4),
            'px': [x0, y0, x1 - x0 + 1, y1 - y0 + 1, w, h]}

if __name__ == '__main__':
    out = {}
    for p in glob.glob('assets/pixelab/buildings/walls/grassland/*/south_doorway__normal.png'):
        mat = os.path.basename(os.path.dirname(p))
        out[mat] = hole_bbox(p)
    print(json.dumps(out, indent=2))
```
- [ ] Run it and record the fractions: `python assets/pixelab/buildings/manifest/_doorway_meta.py`. Capture the JSON (e.g. `{"cob": {"x0":..,"y0":..,"w":..,"h":..}, ...}`) — this is the COORDINATION handoff payload.
- [ ] Visually confirm with Read: `assets/pixelab/buildings/walls/grassland/wattle_daub/south_doorway__normal.png` shows a clean transparent doorway opening framed by the wall.
- [ ] **PATCH REQUEST to COORDINATION** (in commit body): (a) the per-material doorway-hole `{x0,y0,w,h}` JSON above, to expose as registry metadata `doorwayHole(biome, slug)` so `door-leaves.js:58-62` draws+swings the leaf into that sub-rect; (b) wattle_daub now HAS `south_doorway__normal.png`, so its `wallImgs(b).south_doorway` will resolve (no registry change needed beyond the existing `south_doorway` case at `wallPieceFile` line ~1035, already present).
- [ ] Stage + commit:
```
git add assets/pixelab/buildings/manifest/_doorway_meta.py assets/pixelab/buildings/walls/grassland/wattle_daub/south_doorway__normal.png
git commit -m "feat(buildings): wattle_daub south_doorway cut-out + doorway-hole metadata extractor

PATCH REQUEST -> COORDINATION: doorwayHole(biome,slug) {x0,y0,w,h} metadata for door-leaves.js leaf sub-rect.
Note: alpha-cut opening (not dark paint) so the leaf swings into a real hole."
```

---

### Task 11 — Recut the door LEAF art to fit the doorway hole

**Files:** modify `assets/pixelab/buildings/doors/{plank,arched,ledged}__norm.png`

- [ ] Confirm the leaf sources are 64×128 transparent-surround leaves: `python -c "from PIL import Image; [print(f, Image.open(f'assets/pixelab/buildings/doors/{f}__norm.png').size) for f in ['plank','arched','ledged']]"`. Expected: all `(64, 128)`.
- [ ] Measure each leaf's opaque bbox and the target doorway-hole px (from Task 10's metadata for the pilot material the leaf is paired with — use cob as the reference hole). Trim/recanvas each leaf so its opaque bbox EXACTLY fills the doorway-hole sub-rect (so the swung leaf doesn't float or get clipped):
```
python - <<'PY'
from PIL import Image
import json, subprocess
meta = json.loads(subprocess.check_output(['python','assets/pixelab/buildings/manifest/_doorway_meta.py']).decode())
hole = meta.get('cob') or meta.get('fieldstone')
hx,hy,hw,hh,W,H = hole['px']
for f in ['plank','arched','ledged']:
    p=f'assets/pixelab/buildings/doors/{f}__norm.png'
    im=Image.open(p).convert('RGBA')
    bb=im.getbbox()  # opaque bbox
    leaf=im.crop(bb)
    # scale the leaf to the hole size, paste onto a 64x128 transparent canvas at the hole origin
    leaf=leaf.resize((max(1,hw), max(1,hh)), Image.NEAREST)
    canvas=Image.new('RGBA',(64,128),(0,0,0,0))
    # door-leaves draws the leaf in a 2t x 4t (64x128) feature cell; place at the hole offset
    canvas.paste(leaf,(min(hx,64-hw),min(hy,128-hh)),leaf)
    canvas.save(p)
    print(f, 'leaf fit to hole', (hw,hh), 'at', (hx,hy))
PY
```
- [ ] Verify each leaf's opaque bbox now matches the hole within a few px: `python -c "from PIL import Image; [print(f, Image.open(f'assets/pixelab/buildings/doors/{f}__norm.png').getbbox()) for f in ['plank','arched','ledged']]"`.
- [ ] Visually confirm with Read: `assets/pixelab/buildings/doors/plank__norm.png` — the leaf sits in the doorway position (not centered on the full 64×128 canvas).
- [ ] **PATCH REQUEST to COORDINATION** (in commit body): door leaves are now pre-positioned to the cob/fieldstone doorway-hole; `door-leaves.js:58-62` should draw the leaf at the doorway-hole origin from `doorwayHole(biome,slug)` (Task 10 metadata) and swing about its hinge edge, not the full `2t×4t` cell. RENDER (Lane B) owns the door-leaves.js edit; ASSET supplies the fitted leaf + the hole rect.
- [ ] Stage + commit:
```
git add assets/pixelab/buildings/doors/plank__norm.png assets/pixelab/buildings/doors/arched__norm.png assets/pixelab/buildings/doors/ledged__norm.png
git commit -m "fix(buildings): recut door leaves to fit the south_doorway hole bbox

PATCH REQUEST -> COORDINATION/RENDER: draw+swing leaf at doorwayHole origin, not full 2t*4t cell.
Note: leaf opaque bbox now matches the cob/fieldstone doorway opening."
```

---

## PHASE 4 — Window-as-object (decision #3)

### Task 12 — Plain-panel window-base tiles (no baked window)

**Files:** create `assets/pixelab/buildings/walls/grassland/{cob,fieldstone,wattle_daub}/south_window_panel__normal.png`

- [ ] The current `south_window__{shape}.png` are full facade tiles with the window BAKED in (tone/pattern seam). The overlay approach needs a plain wall panel under the overlay. For the pilot, the plain panel == the re-cropped `south_base` strip widened to the 2-tile feature cell (64×128). Build it from the seamless `south_base` strip so the base tone matches exactly (no seam):
```
python - <<'PY'
from PIL import Image
for m in ['cob','fieldstone','wattle_daub']:
    d=f'assets/pixelab/buildings/walls/grassland/{m}/'
    strip=Image.open(d+'south_base__normal.png').convert('RGBA')  # 32x128 seamless
    panel=Image.new('RGBA',(64,128),(0,0,0,0))
    panel.paste(strip,(0,0)); panel.paste(strip,(32,0))  # two seamless bays = a clean 2-tile panel
    panel.save(d+'south_window_panel__normal.png')
    print('panel', m, panel.size)
PY
```
- [ ] Verify: `python -c "from PIL import Image; [print(m, Image.open(f'assets/pixelab/buildings/walls/grassland/{m}/south_window_panel__normal.png').size) for m in ['cob','fieldstone','wattle_daub']]"`. Expected: all `(64,128)`.
- [ ] Visually confirm with Read: `assets/pixelab/buildings/walls/grassland/cob/south_window_panel__normal.png` — a clean 2-bay wall panel with no baked window and no center seam.
- [ ] **PATCH REQUEST to COORDINATION** (commit body): add `wallPieceFile('south_window_panel', {wear})` → `south_window_panel__${wear}.png` so RENDER draws the panel as the window-overlay BASE.
- [ ] Stage + commit:
```
git add assets/pixelab/buildings/walls/grassland/cob/south_window_panel__normal.png assets/pixelab/buildings/walls/grassland/fieldstone/south_window_panel__normal.png assets/pixelab/buildings/walls/grassland/wattle_daub/south_window_panel__normal.png
git commit -m "feat(buildings): plain 2-bay window-base panels (window-overlay base)

PATCH REQUEST -> COORDINATION: add wallPieceFile south_window_panel__{wear} case.
Note: built from the seamless south_base strip so base tone matches (no seam)."
```

---

### Task 13 — Transparent-surround window overlay objects (closed + shutters-open)

**Files:** create `assets/pixelab/buildings/walls/grassland/{cob,fieldstone,wattle_daub}/south_window_obj__{arched,shuttered,bay}__{closed,shutters}.png`

- [ ] Source the overlay art from the orphaned 64×64 window objects (`windows/window_{arch,shutters,balcony}.png`) — they already have a transparent surround. Map: `window_arch → arched`, `window_shutters → shuttered`, `window_balcony → bay`. Retarget each to the 64×96 feature footprint (2 tiles wide × 3 tiles tall, upper-middle of the feature cell) and split into a CLOSED state (panel/glass visible) and a SHUTTERS-open state (shutters swung — for `shuttered`, the open state = shutters folded back; for non-shutter shapes, the open state = the same panel, RENDER applies the procedural transform):
```
python - <<'PY'
from PIL import Image
SRC={'arched':'window_arch','shuttered':'window_shutters','bay':'window_balcony'}
for m in ['cob','fieldstone','wattle_daub']:
    d=f'assets/pixelab/buildings/walls/grassland/{m}/'
    for shape,src in SRC.items():
        obj=Image.open(f'assets/pixelab/buildings/windows/{src}.png').convert('RGBA')  # 64x64
        # closed: place the 64x64 object in the upper-middle of a 64x96 transparent feature cell
        cell=Image.new('RGBA',(64,96),(0,0,0,0))
        cell.paste(obj,(0,8),obj)  # 8px head-room above so it sits above head height
        cell.save(d+f'south_window_obj__{shape}__closed.png')
        # shutters-open candidate: for the shuttered shape, split the leftmost/rightmost shutter
        # columns out so RENDER can swing them; ship the panel-without-shutters as the open base.
        op=cell.copy()
        if shape=='shuttered':
            px=op.load(); w,h=op.size
            # clear the outer 12px shutter bands -> leaves the glazing; RENDER draws swung shutters
            for y in range(h):
                for x in list(range(0,12))+list(range(w-12,w)):
                    px[x,y]=(0,0,0,0)
        op.save(d+f'south_window_obj__{shape}__shutters.png')
        print('window obj', m, shape)
PY
```
- [ ] Verify dims + transparency surround: `python -c "from PIL import Image; im=Image.open('assets/pixelab/buildings/walls/grassland/cob/south_window_obj__arched__closed.png').convert('RGBA'); a=im.getchannel('A'); px=list(a.getdata()); print(im.size,'surround-trans%:', round(100*sum(1 for p in px if p<16)/len(px),1))"`. Expected: `(64,96)`, surround transparency well above 30% (it is an overlay object, not a full tile).
- [ ] Visually confirm with Read: `assets/pixelab/buildings/walls/grassland/cob/south_window_obj__shuttered__closed.png` (shutters present) vs `south_window_obj__shuttered__shutters.png` (shutter bands cleared → glazing visible, RENDER swings the leaves).
- [ ] **PATCH REQUEST to COORDINATION** (commit body): add `wallPieceFile('south_window_obj', {shape, open})` → `south_window_obj__${shape}__${open ? 'shutters' : 'closed'}.png`; RENDER's NEW `window-overlay.js` draws `south_window_panel` then this object OVER it and applies the open/close transform (mirroring `door-leaves.js`), blitting via `glc.drawSceneOverlayBitmap` (GL-only, never a 2D top-pass).
- [ ] Stage + commit:
```
git add assets/pixelab/buildings/walls/grassland/cob/south_window_obj__arched__closed.png assets/pixelab/buildings/walls/grassland/cob/south_window_obj__arched__shutters.png assets/pixelab/buildings/walls/grassland/cob/south_window_obj__shuttered__closed.png assets/pixelab/buildings/walls/grassland/cob/south_window_obj__shuttered__shutters.png assets/pixelab/buildings/walls/grassland/cob/south_window_obj__bay__closed.png assets/pixelab/buildings/walls/grassland/cob/south_window_obj__bay__shutters.png assets/pixelab/buildings/walls/grassland/fieldstone/south_window_obj__arched__closed.png assets/pixelab/buildings/walls/grassland/fieldstone/south_window_obj__arched__shutters.png assets/pixelab/buildings/walls/grassland/fieldstone/south_window_obj__shuttered__closed.png assets/pixelab/buildings/walls/grassland/fieldstone/south_window_obj__shuttered__shutters.png assets/pixelab/buildings/walls/grassland/fieldstone/south_window_obj__bay__closed.png assets/pixelab/buildings/walls/grassland/fieldstone/south_window_obj__bay__shutters.png assets/pixelab/buildings/walls/grassland/wattle_daub/south_window_obj__arched__closed.png assets/pixelab/buildings/walls/grassland/wattle_daub/south_window_obj__arched__shutters.png assets/pixelab/buildings/walls/grassland/wattle_daub/south_window_obj__shuttered__closed.png assets/pixelab/buildings/walls/grassland/wattle_daub/south_window_obj__shuttered__shutters.png assets/pixelab/buildings/walls/grassland/wattle_daub/south_window_obj__bay__closed.png assets/pixelab/buildings/walls/grassland/wattle_daub/south_window_obj__bay__shutters.png
git commit -m "feat(buildings): transparent-surround window overlay objects (closed + shutters)

PATCH REQUEST -> COORDINATION: add wallPieceFile south_window_obj__{shape}__{closed,shutters}.
Note: from orphaned windows/window_{arch,shutters,balcony}.png; RENDER swings shutters (no generated frames)."
```

---

## PHASE 5 — Roof fascia confirm + in-game pilot validation

### Task 14 — Confirm grassland roof_fascia is eave-trim quality

**Files:** (read-only check; modify a `roof_fascia.png` only if it fails)

- [ ] Read each grassland fascia and assert it is a horizontal eave band (wide, short opaque band, tileable horizontally): `python -c "from PIL import Image; import glob; [print(p, Image.open(p).size, 'opaque%:', round(100*sum(1 for v in Image.open(p).convert('RGBA').getchannel('A').getdata() if v>200)/(64*64),1)) for p in glob.glob('assets/pixelab/buildings/roof/grassland/*/roof_fascia.png')]"`. Expected: each `(64,64)` with a high opaque fraction concentrated in a horizontal band.
- [ ] Visually confirm with Read all four: `assets/pixelab/buildings/roof/grassland/{thatch,clay_tile,turf_sod,wood_shingle}/roof_fascia.png` each reads as the vertical eave/drop face (a horizontal trim band), not a full roof texture. (thatch confirmed clean during inspection.)
- [ ] If any fascia is a full-bleed roof texture instead of a trim band, regenerate just that one: `python scripts/bulk_generate_buildings.py --biome grassland --material <slug> --phase roof` (the `roof_fascia_prompt` produces the edge band) after deleting the bad file. Otherwise, no asset change.
- [ ] Commit ONLY if a fascia was regenerated:
```
git add assets/pixelab/buildings/roof/grassland/<slug>/roof_fascia.png
git commit -m "fix(buildings): regenerate <slug> roof_fascia as eave-trim band

Note: ROOF (Lane C) wires roof_fascia.png via roofTexFor; confirmed trim quality here."
```
- [ ] If nothing changed, record "all four grassland roof_fascia confirmed eave-trim quality, no edit" in the handoff (no commit).

---

### Task 15 — In-game pilot validation (tileability + zero see-through + window/door)

**Files:** none (verification only)

- [ ] Serve the game from the NODE server on :8123 (NOT python :8000, which starves sprite loads): `HOST=localhost:8123 node server.js` (or the project's node static server) in the background.
- [ ] Spawn at a grassland building and open the overlay: navigate to `http://localhost:8123/?x=<bx>&y=<by>` for a known grassland building, hard-reload (incognito — workers cache), press `9` for the building overlay, click a building for the occupancy panel. Find a `cob`, `fieldstone`, and `wattle_daub` building (the three pilot materials).
- [ ] Capture BEFORE/AFTER via raw CDP `Page.captureScreenshot` (Playwright `page.screenshot` hangs on the rAF loop). Verify in the captured frame:
  - the south wall no longer "repeats every 4 tiles" (the `isPilot` 4-bay hack is bypassed now that `south_base` is 32-wide → `building-occluder.js:93` `isPilot=false`),
  - NO terrain visible through any wall panel (opaque infill from Tasks 2-5),
  - the east corner shows a real post (Task 4/8),
  - adjacent `south_base` tiles abut seamlessly (Task 7/9 seam fix; left col == right col).
- [ ] Walk the player NORTH behind a building and confirm the occluder spotlight see-through still reveals the player (the offscreen→FBO path is unchanged; we only changed pixels).
- [ ] If RENDER (Lane B) has landed the window-overlay + door-leaf fit, confirm window open/close and the door leaf swinging into the doorway hole. If RENDER has not landed yet, record "asset pieces present and gate-clean; window/door open-close pending RENDER" and proceed.
- [ ] Record the BEFORE/AFTER observation in the handoff note (no commit — this is verification). If a pixel regression appears (e.g. a seam at a specific zoom), file it against the specific PNG and loop back to the relevant re-crop task.

---

## PHASE 6 — 21-biome × 4-material BURST (only after the pilot is gate-clean + in-game validated)

### Task 16 — Batch opaque-infill + mirrored-east + corner-seam fixes across all biomes

**Files:** modify `assets/pixelab/buildings/walls/*/*/{interior_base,north_back,south_corner_east}__*.png` across all biomes/materials that exist on disk

- [ ] Enumerate every existing wall material dir and run the SAME deterministic fixes (opaque infill flood-fill + mirror-east-from-west) used in Tasks 2-4, gated by the validator. Generalize the Task 2/3/4 scripts to loop over `assets/pixelab/buildings/walls/*/*/`:
```
python - <<'PY'
from PIL import Image
import glob, os
for mdir in sorted(glob.glob('assets/pixelab/buildings/walls/*/*')):
    if not os.path.isdir(mdir): continue
    # opaque infill for interior_base + north_back
    for stem in ['interior_base','north_back']:
        for p in glob.glob(os.path.join(mdir, f'{stem}__*.png')):
            im=Image.open(p).convert('RGBA'); px=im.load(); w,h=im.size
            fill=None
            for y in range(10,40):
                for x in range(int(w*0.2),int(w*0.85)):
                    if px[x,y][3]>240: fill=px[x,y][:3]+(255,); break
                if fill: break
            if not fill: continue
            for y in range(10, int(h*0.75)):
                for x in range(2,w-2):
                    if px[x,y][3]<200: px[x,y]=fill
            im.save(p)
    # mirror east<-west when east duplicates south_base
    for w_ in ['normal','weathered','damaged','mossy']:
        bp=os.path.join(mdir,'south_base__normal.png'); wp=os.path.join(mdir,f'south_corner_west__{w_}.png'); ep=os.path.join(mdir,f'south_corner_east__{w_}.png')
        if not (os.path.exists(wp) and os.path.exists(ep) and os.path.exists(bp)): continue
        from PIL import ImageChops
        if ImageChops.difference(Image.open(bp).convert('RGBA'), Image.open(ep).convert('RGBA')).getbbox() in (None,(127,127,128,128)):
            Image.open(wp).convert('RGBA').transpose(Image.FLIP_LEFT_RIGHT).save(ep)
print('burst opaque+mirror complete')
PY
```
- [ ] Run the FULL gate over the whole tree: `node --test assets/pixelab/buildings/manifest/validate-wall-assets.mjs`. Expected: hole test and duplicate test PASS for ALL biomes (or list the exact remaining offenders to fix individually — do NOT bulk-suppress).
- [ ] Spot-check 3 random non-grassland materials with Read (e.g. a forest, a desert, a mystic material's `interior_base__normal.png` + `south_corner_east__normal.png`) to confirm the fix generalized without artifacts.
- [ ] Stage by NAME the touched files (use `git status --porcelain` to list, then `git add` each path — never `git add -A`). Because the burst touches many files, stage them via an explicit pathspec restricted to this lane's glob and re-verify the staged set is only `assets/pixelab/buildings/walls/`:
```
git add $(git status --porcelain assets/pixelab/buildings/walls | awk '{print $2}')
git status --porcelain --untracked-files=no   # ASSERT every staged path is under assets/pixelab/buildings/
git commit -m "fix(buildings): burst opaque infill + mirrored-east across all biome materials

Gate-clean across 21 biomes; no see-through interiors, no corner_east dups.
Note: deterministic local fix (no API), same logic as the grassland pilot."
```

---

### Task 17 — Batch 32px re-crop + run-bond + window-base/object across all biomes

**Files:** modify/create `assets/pixelab/buildings/walls/*/*/{south_base,north_back,edge_ew,south_corner_west,south_corner_east}__normal.png`, `.../south_base__rb{1,2,3}.png`, `.../south_window_panel__normal.png`, `.../south_window_obj__{arched,shuttered,bay}__{closed,shutters}.png`

- [ ] Run the strip re-crop helper across every material dir (it skips anything already ≤64 wide, so it is idempotent and safe to re-run):
```
python assets/pixelab/buildings/manifest/_recrop_strips.py $(ls -d assets/pixelab/buildings/walls/*/*/)
```
- [ ] Generate the mirrored corner pair + window-base panel + window overlay objects for every material using the generalized Task 8/12/13 logic in one pass:
```
python - <<'PY'
from PIL import Image
import glob, os, numpy as np
SRC={'arched':'window_arch','shuttered':'window_shutters','bay':'window_balcony'}
for mdir in sorted(glob.glob('assets/pixelab/buildings/walls/*/*')):
    if not os.path.isdir(mdir): continue
    bp=os.path.join(mdir,'south_base__normal.png')
    if not os.path.exists(bp): continue
    strip=Image.open(bp).convert('RGBA')
    if strip.width!=32: continue  # only finalized 32-wide strips
    # mirrored corner pair from west
    wp=os.path.join(mdir,'south_corner_west__normal.png')
    if os.path.exists(wp):
        west=Image.open(wp).convert('RGBA')
        if west.width>32: west=west.crop((0,0,32,128)); west.save(wp)
        west.transpose(Image.FLIP_LEFT_RIGHT).save(os.path.join(mdir,'south_corner_east__normal.png'))
    # window-base panel
    panel=Image.new('RGBA',(64,128),(0,0,0,0)); panel.paste(strip,(0,0)); panel.paste(strip,(32,0))
    panel.save(os.path.join(mdir,'south_window_panel__normal.png'))
    # window overlay objects
    for shape,src in SRC.items():
        sp=f'assets/pixelab/buildings/windows/{src}.png'
        if not os.path.exists(sp): continue
        obj=Image.open(sp).convert('RGBA')
        cell=Image.new('RGBA',(64,96),(0,0,0,0)); cell.paste(obj,(0,8),obj)
        cell.save(os.path.join(mdir,f'south_window_obj__{shape}__closed.png'))
        op=cell.copy()
        if shape=='shuttered':
            px=op.load()
            for y in range(96):
                for x in list(range(0,12))+list(range(52,64)): px[x,y]=(0,0,0,0)
        op.save(os.path.join(mdir,f'south_window_obj__{shape}__shutters.png'))
print('burst strips+corners+windows complete')
PY
```
- [ ] Run the FULL gate: `node --test assets/pixelab/buildings/manifest/validate-wall-assets.mjs`. Expected: ALL four tests PASS tree-wide.
- [ ] Run `_doorway_meta.py` tree-wide to refresh the doorway-hole metadata for every material that has a `south_doorway`, and capture the JSON for the COORDINATION patch: `python assets/pixelab/buildings/manifest/_doorway_meta.py`.
- [ ] Spot-check 3 non-grassland materials with Read for seam/strip correctness.
- [ ] **PATCH REQUEST to COORDINATION** (commit body): the burst introduces, tree-wide, the same new filename schemes already requested for grassland — `south_base__rb{1,2,3}`, `south_window_panel__{wear}`, `south_window_obj__{shape}__{closed,shutters}`, plus the refreshed `doorwayHole` metadata for all materials. No per-biome registry change beyond the generic switch cases already requested.
- [ ] Stage by name (restricted to the lane glob), assert, commit:
```
git add $(git status --porcelain assets/pixelab/buildings/walls | awk '{print $2}')
git status --porcelain --untracked-files=no   # ASSERT only assets/pixelab/buildings/ staged
git commit -m "feat(buildings): burst 32px strips + run-bond + window-base/objects across all biomes

Whole wall corpus gate-clean: seamless 32px strips, mirrored corners, window overlay objects.
PATCH REQUEST -> COORDINATION: generic wallPieceFile cases (rb, window_panel, window_obj) + doorwayHole metadata tree-wide.
Note: idempotent local re-crop; burst only after pilot in-game validation."
```

---

## Self-Review — spec coverage for Lane A

- **Fix 1 (opaque daub):** Tasks 2 (interior_base) + 3 (north_back). NOTE: measured `south_base__normal` is ALREADY 0% transparent in the solid region (the 6.8% overall is the legitimate top sky band); the real 57.5%-transparent see-through is `interior_base` (and any north_back upper infill). The plan re-authors the actually-broken pieces and the gate (Task 1) asserts <1% in-region for all three surface pieces — flagged in Open Concerns.
- **Fix 2 (east-corner duplicate):** Task 4 — confirmed `south_corner_east == south_base` (diff bbox `(127,127,128,128)`); replaced with a true mirror of the west pilaster; gate asserts non-duplication.
- **Fix 3 (32px tileable strips + run-bond + edge_ew + corners + opaque interior):** Tasks 6-9 (pilot) + 17 (burst). `south_base` 32×128 seamless (left col == right col, enforced + gate-asserted), `north_back` 32×64, `edge_ew` a real 32×128 side-cap (replacing the featureless 32×32 fill), a true mirrored corner pair, 3 run-bond variants. The 32-wide `south_base` flips `building-occluder.js:93` `isPilot=false`, retiring the 4-bay hack at the asset level (RENDER then removes the branch).
- **Fix 4 (window-as-object):** Tasks 12 (plain panel base) + 13 (transparent-surround overlay objects, closed + shutters-open, from the orphaned `windows/window_{arch,shutters,balcony}.png`). Open/close transform is RENDER's (`window-overlay.js`, GL-only blit) — ASSET supplies both state PNGs; no mass-generated window animation (figure-hallucination avoided).
- **Fix 5 (door-leaf fit + doorway-hole metadata):** Tasks 10 (add wattle_daub `south_doorway` alpha cut + `_doorway_meta.py` emitting `{x0,y0,w,h}` fractions) + 11 (recut `doors/{plank,arched,ledged}__norm.png` to the hole). Metadata is filed as a COORDINATION patch request (registry `doorwayHole(biome,slug)`); ASSET never edits the registry.
- **Fix 6 (stone_brick corner see-through):** Task 5 — confirmed rows 0-7 fully transparent; filled with corner stone (fallback-only).
- **Fix 7 (roof_fascia quality):** Task 14 — confirmed all four grassland fasciae are 64×64 eave-trim bands; regenerate only on failure. ROOF (Lane C) wires it.
- **Process (pilot → burst):** Phases 1-5 land the pilot (cob/fieldstone/wattle_daub) and validate in-game; Phase 6 (Tasks 16-17) runs the 21-biome × 4-material burst ONLY after the pilot is gate-clean. The three pure-asset fixes (opaque infill, east corner, run-bond strips) lead and land with no renderer change.
- **Validation gate:** Task 1 — `node:test` gate inside the lane glob (`assets/pixelab/buildings/manifest/validate-wall-assets.mjs`) rejects internal-alpha holes in the solid region AND asserts left/right column match for seamless tiling AND 32px-multiple dims AND the corner-duplicate. It imports the read-only PNG decoder from `scripts/audit-png-alpha.mjs` without editing it.
- **Constraints honored:** ZERO `.js` engine edits (only PNGs + one validator + two Python helpers, all inside `assets/pixelab/buildings/**`); every filename-scheme change is a by-name COORDINATION patch request; buildings stay 32px-multiple sprite PIECES; window/door open-close stays GL-only via RENDER's `drawSceneOverlayBitmap` path (no 2D top-pass); no faked systems (real materials, real geometry; honest fallback unchanged); staging is by name only with an explicit only-my-paths assertion before every commit.