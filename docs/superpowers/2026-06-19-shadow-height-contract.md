# Contract — make grass (F2) shadows respect building height

**For:** the F2 sprite owner (`field2-animator.js`) and the GL compositor owner (`gl-compositor.js`).
**From:** the building-shadow work (`src/render/building-shadow.js`).
**Date:** 2026-06-19 · **Branch:** `motion-eval-system`

## The problem
Grass shadows draw over the rooftops of tall buildings. A blade spawned just outside the
architecture-claim edge casts a shadow that shears along the sun vector (`gl-compositor.js:98`,
`px = pivotPx + hgt*sizePx*uShadowVec`) so its FAR end lands many tiles away — onto a tall roof —
even though its root tile is fine. The claim only suppresses generation keyed to the blade's OWN
tile; it can never catch a shadow whose *landing* tile is a building elsewhere.

## What I now provide (already shipped, no action needed from you to produce it)
`building-shadow.js` builds and publishes a per-frame **height mask** every frame, BEFORE F2 draws
(it runs in `drawBuildingShadows`, called at `canvas-renderer.js:367`; F2 draws at `:452`). Read it
either way:

```js
import { getBuildingHeightMask, sampleHeight } from './building-shadow.js';
const mask = getBuildingHeightMask();      // or window._buildingHeightMask (loosest coupling)
```

Shape:
```
mask = {
  w, h,                 // viewport CSS px the mask was built for
  cols, rows, cell,     // grid dims; cell = 8 px
  camX, camY, tilePx,   // the transform it was built under (stale-guard — see below)
  data: Uint8Array(cols*rows)  // tallest building height in STOREYS over each cell; 0 = open ground
}
sampleHeight(mask, screenX, screenY) -> storeys  // 0 if mask null / out of bounds
```

## The one rule (the height analogue of draw order)
A shadow texel survives only if **casterStoreys ≥ sampleHeight(landingPoint)**; otherwise the
building there is taller and occludes it. **Grass = 0 storeys**, so for grass the rule reduces to:

> if `sampleHeight(mask, landingX, landingY) > 0` → set that blade's shadow alpha to 0.

### F2 (CPU pool) — the primary fix, no shader change
Sample at the shadow's **landing point**, not the blade root:
```
const shVec = { x: sun.shadowX * sun.shadowLength * 0.9, y: sun.shadowLength * 0.35 }; // same as draw (field2-animator.js:1683)
const landingX = rootPivotXpx + shVec.x * drawSizePx;   // blade's drawn size = reach
const landingY = rootPivotYpx + shVec.y * drawSizePx;
if (sampleHeight(mask, landingX, landingY) > 0) shadowAlpha = 0;
```
Apply where shadow alpha is written: the pool rebuild (`field2-animator.js:~1265-1269`) and the
per-frame shadow update (`~1633-1639`, the `sm[so+4]` alpha write). One `Uint8Array` index per
blade — cheap.

**Null/stale guard (required):** if `mask` is null, or `mask.camX/camY/tilePx` ≠ this frame's
transform, treat as all-zero (no suppression) so flora degrades to today's look, never hard-fails.

### GL (optional backstop)
For any shadow path you can't pre-cull on CPU (e.g. `drawAnimShadows`), upload `mask.data` as an
R8 texture (`cols×rows`) once per frame + uniforms `uHeightMaskXform` (screen px → mask UV from
`camX,camY,cell`) and `uCasterStoreys` (0 for grass, the building's storeys for buildings). In
`SHADOW_FRAG_SRC`, discard the texel where `maskStoreys > uCasterStoreys`. No-op when unbound
(keep a `uHeightMaskOn` flag) so nothing changes until wired. You own the texture lifecycle; I
expose the raw `Uint8Array` + grid metadata.

## What stays the single source of truth
The mask's silhouette north-band = `8 + (storeys-1)*4` tiles, matching the height-aware north claim
(`resolved-buildings.js`) and the worker wall stack (`stories * WALL_CONFIG.wallHeight`). Keep
`WALL_CONFIG.wallHeight = 4` and the `aboveGroundFloors → stories (cap 12)` mapping as the shared
constants so the mask stays pixel-aligned with the baked walls/roof. If that mapping changes, tell me.

## Already done on my side (building-shadow.js)
- Build + publish the mask.
- My own ground shadows clip off any taller building's silhouette.
- The façade drape climbs only `min(caster, neighbour)` storeys.

## Verify together
Place a 1-storey building beside a 5-storey one with grass between them, at dusk (long shadows):
grass shadow alpha must be 0 over both roofs; toggle `window._buildingHeightMaskDebug=true` to see
the mask heat overlay the grass is sampling.
