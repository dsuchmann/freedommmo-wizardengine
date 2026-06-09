# Revert to 3 PM Checkpoint (3544364e3) — Recovery Guide

## What we're reverting to
**Commit:** `3544364e3` — "checkpoint: field 2 animation system with player walk, temporal denoise"  
**Time:** 11:59 AM ET (the "this looks fantastic" checkpoint)  
**Files to revert:** `field2-animator.js`, `canvas-renderer.js`  
**Files NOT to revert:** `worker-chunk-renderer.js`, `chunk-worker.js`, `wang-image-list.js`, `lighting.js`, `weather.js`

## What was added between 3 PM and 5 PM that we need to bring back

### 1. Image smoothing (BRING BACK)
Change `ctx.imageSmoothingEnabled = false` to `true` in field2-animator.js.
Makes sprites softer with nicer edges.

### 2. Biome + elevation edge skip (BRING BACK)
Skip field 2 objects within 2 tiles of biome edges OR elevation changes.
Prevents sprites from being drawn on top of wang transition tiles.
```js
// Skip tiles near any edge — biome transitions OR elevation changes
var myElev = tile.climate ? tile.climate.elevation : 0.5;
var isNearEdge = false;
for (var edy = -2; edy <= 2 && !isNearEdge; edy++) {
  for (var edx = -2; edx <= 2 && !isNearEdge; edx++) {
    if (edx === 0 && edy === 0) continue;
    var nbTile = chunkStore.tileAt(wx + edx, wy + edy);
    if (!nbTile) continue;
    if (nbTile.biome !== tile.biome) { isNearEdge = true; break; }
    var nbElev = nbTile.climate ? nbTile.climate.elevation : 0.5;
    if (Math.abs(Math.floor(myElev * 10) - Math.floor(nbElev * 10)) >= 1) { isNearEdge = true; break; }
  }
}
if (isNearEdge) continue;
```

### 3. Dense grass carpet density (BRING BACK)
Per-biome base density (grassland=7, forest=6, etc.) instead of flat 2-4.
Primary grass species dominates carpet, accent slots for flowers.

### 4. Rigid objects list (BRING BACK)
Objects like ice_needle, crystal_sprout that shouldn't sway.

### 5. Lifecycle states (BRING BACK)
seedling/normal/wilting/dead states with scale/angle modifiers.

### 6. Y-sorted depth buffer with player interleaving (BRING BACK)
drawBuffer array sorted by world Y. Player inserted at correct depth.
Requires `setField2PlayerDraw` export and import in canvas-renderer.

### 7. v000 animation fallback (BRING BACK)
Use v000 animation frames, fall back to static sprite.

## What was added between 3 PM and 5 PM that caused problems

### Player draw moved from standalone to field2 buffer (SUSPECT)
canvas-renderer.js changed from:
```js
this.drawPlayerAt(w / 2, h / 2 - ..., camera.zoom, player);
```
to:
```js
setField2PlayerDraw(function(drawCtx) {
  _self.drawPlayerAt(w / 2, _playerScreenY, camera.zoom, player);
});
```
This moved the player draw INTO the field2 buffer. If field2 has issues, the player disappears too. Also the setField2PlayerDraw is called AFTER drawField2Animations in the 5 PM version, meaning it's always one frame behind.

## What other agents added (MUST KEEP regardless of revert)

### In canvas-renderer.js (added by other agents, NOT by the optimization commits):
- `drawLighting()` method with directional sun, golden hour, moonlight
- Shadow projection for field 2 sprites  
- `drawField2Animations` receives `sun` parameter
- Atmospheric vignette improvements

### In worker-chunk-renderer.js:
- Field 3: Small Scatter system (SS_BIOME_OBJECTS + applySmallScatterToChunk)
- Additional scatter objects for all biomes

### In chunk-worker.js:
- getSmallScatterImageURLs import and preload

### In lighting.js:
- 8-phase day/night cycle with authored palettes
- Directional sun (east→west) and moon (west→east)

### In weather.js:
- Full weather system (wind, precipitation, clouds, seasons, atmosphere)

## Revert procedure

```bash
# Step 1: Revert field2-animator.js to 3 PM checkpoint
git checkout 3544364e3 -- src/render/field2-animator.js

# Step 2: Revert canvas-renderer.js to 3 PM checkpoint  
git checkout 3544364e3 -- src/render/canvas-renderer.js

# Step 3: Do NOT revert these (other agent work):
# - src/render/worker-chunk-renderer.js (has Field 3)
# - src/world/chunk-worker.js (has scatter preload)
# - src/world/lighting.js (has 8-phase lighting)
# - src/world/weather.js (has weather system)
```

## After revert: add back features one at a time
1. Image smoothing
2. Edge skip (biome + elevation)  
3. Dense carpet density
4. Rigid objects
5. Lifecycle states
6. Depth buffer (carefully — test f0/f1 after)
7. v000 animation fallback

Test f0/f1 after EACH step to find which one breaks them.
