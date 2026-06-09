# Revert Guide: Rolling back to d9288d29e (5:03 PM ET, June 8)

## What happened

Between 5:03 PM and 7:19 PM, 15 commits were made attempting to optimize Field 2 rendering performance. These optimizations progressively broke the game:

- Field 0 (soil pixel interpolation) stopped rendering
- Field 1 (ground cover sprites) stopped rendering
- Field 2 sprites regressed to showing only one variant (yellow flower)
- FPS dropped to 20 instead of improving
- Thousands of 404 errors flood the console
- Worker preload order was changed multiple times, breaking chunk rendering

## The revert target

**Commit:** `d9288d29e` — "fix: declare drawBuffer variable"  
**Time:** 5:03 PM ET, June 8, 2026  
**State at this commit:**
- Wang tiles (terrain) rendering correctly
- Field 0 (soil) rendering correctly  
- Field 1 (ground cover) rendering correctly
- Field 2 (small flora) rendering with dense carpet (7-10 blades/tile)
- Wind sway animation working (trigger-based with settle)
- Player walk interaction working
- Per-variant sprites loading correctly
- FPS was ~20 (Canvas 2D bottleneck — the problem we were trying to fix)

## Files affected by the 15 commits being reverted

| File | What changed after 5:03 PM | What to keep | What to discard |
|------|---------------------------|--------------|-----------------|
| `src/render/field2-animator.js` | Animation loading logic changed 6+ times, broke sprite loading | NONE — revert entirely to d9288d29e | All 15 commits |
| `src/render/field2-gpu.js` | NEW FILE — WebGL2 instanced renderer (never wired in properly) | KEEP the file — it's the foundation for GPU rendering | N/A (new file) |
| `src/render/canvas-renderer.js` | Player draw ordering changed, drawLighting refactored | KEEP — other agents added drawLighting, field 3 scatter, shadow system | Only revert the setField2PlayerDraw ordering change |
| `src/render/worker-chunk-renderer.js` | Worker baking toggled on/off multiple times, Field 3 scatter added | KEEP — other agents added Field 3 (small scatter) system | Only revert the applySmallFloraToChunk toggling |
| `src/world/chunk-worker.js` | Preload phase 1 URLs changed 4 times | REVERT to d9288d29e — preload order was broken | All changes after 5:03 PM |
| `src/render/sprite-denoise.js` | Dark speck threshold tweaked | KEEP current — minor threshold change | N/A |

## What other agents added (MUST KEEP)

### Agent work in canvas-renderer.js (after 5:03 PM):
- `drawLighting()` method — full lighting system with directional sun, golden hour, moonlight
- Shadow projection for field 2 sprites
- drawField2Animations now receives `sun` parameter
- Field 3 integration references

### Agent work in worker-chunk-renderer.js (after 5:03 PM):
- **Field 3: Small Scatter system** — `SS_BIOME_OBJECTS` config for all 21 biomes
- `applySmallScatterToChunk()` function
- `getSmallScatterImageURLs` import and preload wiring
- Additional small scatter objects added to existing biome configs

### Agent work in chunk-worker.js (after 5:03 PM):
- `getSmallScatterImageURLs` import added
- Small scatter URLs added to preload

## Recommended revert procedure

### Step 1: Revert field2-animator.js
```bash
git checkout d9288d29e -- src/render/field2-animator.js
```
This restores:
- Correct per-variant animation loading (v000-v063, each with own frames)
- Working wind trigger system
- Working player walk interaction
- Dense carpet placement logic
- Proper static sprite fallback

### Step 2: Revert chunk-worker.js
```bash
git checkout d9288d29e -- src/world/chunk-worker.js
```
Then manually re-add the small scatter imports/URLs that other agents added:
```js
// Line 4: add getSmallScatterImageURLs to the import
import { ..., getSmallScatterImageURLs } from '../render/wang-image-list.js';

// In preloadBiomes: add scatter URLs to phase 1 or phase 2
```

### Step 3: Do NOT revert these files
- `src/render/canvas-renderer.js` — has drawLighting and field 3 work from other agents
- `src/render/worker-chunk-renderer.js` — has field 3 scatter system from other agents
- `src/render/field2-gpu.js` — keep as foundation for future GPU work
- `src/render/sprite-denoise.js` — minor threshold tweak, harmless

### Step 4: Verify after revert
- [ ] Wang tiles render (terrain visible)
- [ ] Field 0 (soil) renders (pixel interpolation over wang tiles)
- [ ] Field 1 (ground cover) renders (sprite overlays)
- [ ] Field 2 (small flora) renders with diverse variants
- [ ] Wind triggers animation on field 2 sprites
- [ ] Player walk bends nearby sprites
- [ ] Field 3 (small scatter) renders (if wired in by other agent)
- [ ] No 404 flood in console
- [ ] Lighting/day-night cycle works

## The unsolved problem: FPS

The game is at ~20 FPS because Field 2 draws 7-10 sprites per tile × ~1200 visible tiles = ~9000 Canvas 2D drawImage calls per frame. This is a CPU bottleneck.

**The solution is GPU instanced rendering** using the WebGL2 renderer in `field2-gpu.js`. This was built but never properly integrated. The integration needs to:

1. Build a texture atlas from all loaded sprite images
2. Collect sprite instance data (position, rotation, frame, scale) into a Float32Array
3. Upload instance data to GPU each frame
4. One `drawArraysInstanced` call renders all sprites
5. Composite the WebGL output onto the main 2D canvas with a single `drawImage`

This should bring FPS from 20 to 144+. But it needs to be done carefully without breaking the existing field rendering pipeline.
