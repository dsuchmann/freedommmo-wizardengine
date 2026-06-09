# Full Revert to 5:03 PM (d9288d29e) — Remediation Plan

## Current commit to return to
After investigation, save this as: the current HEAD (checkpoint before revert).

## Target revert commit
**d9288d29e** — "fix: declare drawBuffer variable" — 5:03 PM ET June 8

## The mystery
The soil pixel interpolation code (f0) is identical between 5:03 PM and now.
The soil images ARE in the worker's imageCache (1,344 entries confirmed).
The `applySoilFieldToChunk` function IS running (getImageData warnings confirm).
Yet f0/f1 are NOT visually appearing.

### Possible root cause theories
1. **worker-chunk-renderer.js was modified by another agent** — Field 3 scatter
   was added (~180 lines of new code). Even though it's appended after f0/f1
   functions, something in the scatter code or its data structures could be
   interfering. Maybe a variable name collision or a side effect.

2. **The `getSoilPixels` function is failing silently** — It creates an
   OffscreenCanvas, draws the bitmap, reads pixels. If the bitmap is somehow
   invalid (wrong type, corrupted by denoise), `drawImage` fails silently
   and returns empty pixel data.

3. **The linter/user modified worker-chunk-renderer.js** — The system reminders
   show this file was modified "by the user or by a linter." Those changes
   might have altered something subtle in the soil function that the diff
   didn't catch (whitespace, variable scope, etc.).

## What exists at 5:03 PM that we lose by reverting

### Files that changed between 5:03 PM and now:
| File | Changes after 5:03 PM | Impact of losing |
|------|----------------------|------------------|
| `worker-chunk-renderer.js` | Field 3 scatter system added, debug logging added | Lose Field 3 scatter |
| `chunk-worker.js` | Scatter import, denoise change, batch size change | Lose scatter preload |
| `canvas-renderer.js` | drawLighting method added, player draw reordered, field2 gets sun param | Lose advanced lighting |
| `chunk-provider.js` | decorationsReady handler added | Lose (unused) |
| `field2-gpu.js` | NEW FILE — WebGL2 renderer | Keep on disk (not imported) |
| `sprite-denoise.js` | Dark speck threshold tweaked | Minor |
| `field2-animator.js` | Reverted to 3 PM then modified | Already at 3 PM state |

### What we WANT to bring back after revert:
1. **Field 3 scatter** (worker-chunk-renderer.js) — the SS_BIOME_OBJECTS config + applySmallScatterToChunk function
2. **drawLighting method** (canvas-renderer.js) — the 8-phase lighting with directional sun/moon
3. **Scatter preload** (chunk-worker.js) — getSmallScatterImageURLs import
4. **field2-gpu.js** — keep the file, wire it in later

### What we DO NOT want to bring back:
1. My debug logging in worker-chunk-renderer.js
2. The denoise exclusion change
3. The decorationsReady handler in chunk-provider.js
4. The batch size changes (200 vs 40)

## Revert procedure

```bash
# 1. Commit current state as checkpoint
git add -A && git commit -m "checkpoint: before full revert to 5:03 PM"

# 2. Full checkout to 5:03 PM
git checkout d9288d29e -- .

# 3. Verify f0/f1 work (hard refresh, wait for load, check visuals)

# 4. If f0/f1 work, commit as "verified working state"
git add -A && git commit -m "verified: full revert to 5:03 PM, f0/f1 working"
```

## Rebuild sequence (after verification)
Add back features ONE AT A TIME, testing f0/f1 after each:

1. Add Field 3 scatter to worker-chunk-renderer.js
   - Copy SS_BIOME_OBJECTS config + applySmallScatterToChunk function
   - Add call in render pipeline after ground cover
   - TEST: f0/f1 still working?

2. Add scatter preload to chunk-worker.js
   - Import getSmallScatterImageURLs
   - Add to phase 1 URLs
   - TEST: f0/f1 still working?

3. Add drawLighting to canvas-renderer.js
   - Copy the drawLighting method
   - Replace inline atmospheric overlay with this.drawLighting call
   - TEST: f0/f1 still working?

4. Add image smoothing to field2-animator.js
   - Change imageSmoothingEnabled to true
   - TEST: f0/f1 still working?

5. Add edge skip, dense carpet, etc. to field2-animator.js
   - One feature at a time
   - TEST after each

## If f0/f1 DON'T work even at the full 5:03 PM revert
Then the issue is NOT in the code at all. It could be:
- Browser caching an old worker bundle
- A corrupted asset file
- A change in the file server
- The wizardgenie runtime changed something

In that case, try:
- Different browser
- Incognito mode
- Clear all site data (not just cache)
- Check if the wizardgenie app updated
