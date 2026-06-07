# Elevation-Aware Wang Tile Transition System

## Overview

The terrain rendering system uses Wang tiles to seamlessly blend biome transitions. Each tile's 4 corners sample the surrounding biomes and elevations, then select the correct wang tile from the appropriate tileset. The system must handle three cases:

1. **Interior fill** — all corners same biome, same elevation → flat fill tile
2. **Biome transition** — adjacent corners have different biomes → transition wang tile, direction and elevation variant selected based on which biome is lower
3. **Same-biome elevation change** — same biome but different elevations → cliff overlay (existing system, unchanged)

## Tileset Inventory

### 21 Biomes
arctic, beach, deep_ocean, dense_forest, desert, forest, grassland, hills, lake, mountains, mystic, ocean, river, savanna, shallow_water, steppe, swamp, taiga, tropical_forest, tundra, volcanic

### 210 Unordered Pairs
Every biome paired with every other: C(21,2) = 210

### 4 Elevation Sizes
| Size | transition_size | Visual | Tiles per set | Symmetric? |
|------|----------------|--------|---------------|------------|
| s0.0 | 0 | Flat blend, no elevation change | 16 | Yes — A_to_B = B_to_A |
| s0.25 | 0.25 | Small step/ledge | 16 | No — direction matters |
| s0.5 | 0.5 | Medium cliff | 16 | No — direction matters |
| s1.0 | 1.0 | Full cliff face | 25 | No — direction matters |

### Complete Tileset Count
| Size | Pairs needed | Direction | Count |
|------|-------------|-----------|-------|
| s0.0 | 210 unordered | A_to_B only (A < B alphabetically) | 210 |
| s0.25 | 210 × 2 directed | A_to_B AND B_to_A | 420 |
| s0.5 | 210 × 2 directed | A_to_B AND B_to_A | 420 |
| s1.0 | 210 × 2 directed | A_to_B AND B_to_A | 420 |
| **Total** | | | **1470** |

### Generation Status
| Size | Forward (A<B) | Inverse (B<A) | Status |
|------|--------------|---------------|--------|
| s0.0 | 210 | N/A (symmetric) | GENERATING NOW |
| s0.25 | 210 | 210 | Forward: GENERATING NOW. Inverse: PENDING |
| s0.5 | 210 | 210 | Forward: GENERATING NOW. Inverse: PENDING |
| s1.0 | 420 | (included above) | COMPLETE ✓ |

Current generation target: 630 (Phase 1) + 420 (Phase 2 inversions) = 1050 new tilesets.
Plus 420 existing s1.0 = 1470 total on disk when done.

## On-Disk File Structure

```
assets/pixelab/landscape_v2/transitions/
├── arctic_to_beach/
│   ├── wang/                 ← s0.0 flat (16 tiles) — arctic=lower, beach=upper
│   ├── wang_25/              ← s0.25 step (16 tiles) — arctic=lower, beach=upper
│   ├── wang_50/              ← s0.5 cliff (16 tiles) — arctic=lower, beach=upper
│   └── wang_100/             ← s1.0 full cliff (25 tiles) — arctic=lower, beach=upper
├── beach_to_arctic/
│   ├── wang_25/              ← s0.25 step (16 tiles) — beach=lower, arctic=upper
│   ├── wang_50/              ← s0.5 cliff (16 tiles) — beach=lower, arctic=upper
│   └── wang_100/             ← s1.0 full cliff (25 tiles) — beach=lower, arctic=upper
│   (NO wang/ — s0.0 is symmetric, use arctic_to_beach/wang/ for both directions)
├── ...
```

### Naming Convention
- Directory: `{lower_biome}_to_{upper_biome}/`
- Subdirectory: `wang/`, `wang_25/`, `wang_50/`, `wang_100/`
- Files: `{lower_biome}_to_{upper_biome}__wang_{0-15}__v000.png` (or 0-24 for s1.0)

### Key Rule
The directory name encodes which biome is the **lower** (fill corners=0) terrain and which is the **upper** (fill corners=1) terrain. For elevation variants, "lower" = physically at lower elevation in the game world.

## Canonical Base Tile IDs

Every tileset is generated with PixelLab using canonical base tile IDs to ensure visual consistency across all tilesets that share a biome:

| Biome | Lower Base Tile ID | Upper Base Tile ID |
|-------|-------------------|-------------------|
| arctic | 2c8a9b01-73c4-4313-b3b3-f239f254dbca | b6b93226-d449-4e72-a77c-7adc1efc634c |
| beach | 1e408a41-65af-4a42-a719-616b764b2bdd | 9119dfca-32e0-48e7-bafb-3b4894ae531b |
| deep_ocean | 09e824f3-86b5-45b8-9e6f-2f54b8d17ce1 | 14ee3566-c439-4049-b95b-04419b5c5cee |
| dense_forest | 7a43bd9f-a0a3-4cb1-82f2-0fa56237682c | 1f8e1133-9f18-4874-830b-088a5c050a8e |
| desert | f51c6f4a-354e-4dff-a4b1-1ea8b0c66573 | 93dc0f1e-bba3-4e12-b741-6f3b03e2a41a |
| forest | 87973039-3faa-448b-9123-4e64a7c6e932 | 04e519e2-5c78-45c0-be6e-b63c8df16eaa |
| grassland | 3d09d189-81b3-4b62-9799-4827bb0495b5 | 949429fa-32a3-4ca1-ade9-fb424ee2641f |
| hills | 7296ae72-e61b-4f0c-bc89-d34f07c3266d | b9919459-c795-42e3-9e10-a5faa00d1f51 |
| lake | b3c7768c-4611-43d2-92d9-c9dcb35f7fa4 | ec6cc367-df58-468d-8370-8e9b354ef050 |
| mountains | 1439e310-3505-47d1-b32d-79fe9391870b | 714d2999-848a-4b28-8b3c-ba5e879c61ac |
| mystic | 4bb937fe-e73f-403f-a06c-3a0d9a801daf | 8f7e34e1-a09f-4b05-8620-38b8a59d68a9 |
| ocean | cb04ad78-c894-4595-be7c-c5e847cd0e1b | 49f34c08-cee0-413b-b05b-5601812f198c |
| river | 818260d3-6de2-4db1-88f2-8839b44d22c9 | 0627c024-7bf6-4371-bd04-4232858c3269 |
| savanna | 7fd08ff7-17c4-4139-a6fb-7d014acccca3 | 5e728d11-ba37-4935-9128-1760659a3ba9 |
| shallow_water | b76c4461-725a-4468-9631-e28b50b76f25 | 7ef8b363-bfc5-48e3-ab70-f4d12a5ac1f7 |
| steppe | fe211bb1-4b99-4e95-a025-a04ce8883d5e | a8aede8f-f06e-46be-8161-af9b7aa4160d |
| swamp | ebad6623-d862-49e8-9124-8a90f53e1229 | b65f815c-33eb-467d-9440-53369e6649fa |
| taiga | aadf3e49-0212-4f21-b853-fde4cbf905f6 | f69fd602-1bcc-42a1-872b-95ee1b267015 |
| tropical_forest | 130e304b-a9e8-47b5-bf1d-a1cf43efd9fd | 8b0f1193-c9b8-45c8-b1e5-4b8f8d134e84 |
| tundra | 4d46ed0d-426d-4325-a5d6-33464ee26297 | 625ca67b-3217-4a0a-824b-0dcf848051f4 |
| volcanic | 2958e295-1974-4936-aedf-39ceb8b52517 | e14095c3-0980-4e7f-8093-44a656dac7b3 |

**Rule:** When generating A_to_B tileset:
- `lower_base_tile_id` = A's Lower Base Tile ID
- `upper_base_tile_id` = B's Upper Base Tile ID

## Code Architecture

### Files Modified

| File | Change |
|------|--------|
| `src/render/wang-image-list.js` | Remove hardcoded TRANSITION_PAIRS, add dynamic dir construction |
| `src/render/worker-tile-painter.js` | Update getWangSrc() for direction-aware pair + variant |
| `src/render/worker-chunk-renderer.js` | Update transitionPairFor() to use elevation for direction, compute variant |

### 1. Direction-Aware Transition Pair Selection

**Current:** `transitionPairFor(biomeA, biomeB)` returns a hardcoded pair from `TRANSITION_PAIRS` table, ignoring elevation.

**New:** `transitionPairFor(biomeA, biomeB, elevA, elevB)` determines direction dynamically:

```javascript
function transitionPairFor(biomeA, biomeB, elevA, elevB) {
  if (biomeA === biomeB) return null;
  // Lower-elevation biome becomes 'from', higher becomes 'to'
  var lower, upper;
  if (elevA <= elevB) {
    lower = biomeA;
    upper = biomeB;
  } else {
    lower = biomeB;
    upper = biomeA;
  }
  return {
    from: lower,
    to: upper,
    dir: lower + '_to_' + upper
  };
}
```

This eliminates the need for the hardcoded `TRANSITION_PAIRS` table entirely. The directory name is always `{lower}_to_{upper}` where lower is the biome at lower elevation.

**For s0.0 (flat, no elevation difference):** When elevA === elevB, use alphabetical order (A < B) since s0.0 is symmetric and we only store one direction.

### 2. Elevation Variant Selection

**Current:** `elevationVariant(tile)` computes max cliffLevel delta across 4 corners.

**Updated mapping** (using cliffLevel delta 0-9):

```javascript
function elevationVariant(tile) {
  // ... compute maxDelta from 4 corners ...
  if (maxDelta <= 0) return 'wang';      // flat
  if (maxDelta === 1) return 'wang_25';  // small step
  if (maxDelta === 2) return 'wang_50';  // medium cliff
  return 'wang_100';                      // full cliff
}
```

### 3. Wang Source Path Construction

**Current:** `getWangSrc(tile, variant)` uses hardcoded pair dirs from `TRANSITION_PAIRS`.

**New:** Receives pair object with dynamically constructed dir:

```javascript
function getWangSrc(tile, variant, pair) {
  if (!variant) variant = 'wang';
  
  // For s0.0, use alphabetical direction (symmetric)
  var dir = pair.dir;
  if (variant === 'wang') {
    // s0.0 files only exist in alphabetical-order directory
    var sorted = [pair.from, pair.to].sort();
    dir = sorted[0] + '_to_' + sorted[1];
  }
  
  var mask = tile.wangEdgeMask;
  return TRANSITIONS_BASE + dir + '/' + variant + '/' + dir + '__wang_' + mask + WANG_SUFFIX;
}
```

### 4. Interior Tiles

Interior tiles (all 4 corners = same biome) always use `wang/` (s0.0 flat fill).

The `BIOME_INTERIOR` table maps each biome to a specific transition pair's full-fill tile:
- For biome X, use any transition pair that includes X
- Mask 6 = all corners are lower terrain (fill with X when X is 'from')
- Mask 12 = all corners are upper terrain (fill with X when X is 'to')

This stays unchanged. Interior tiles never use elevation variants.

### 5. Corner Mask Calculation

The wang corner mask uses the **biome** of the 4 corners (self, E, S, SE) to determine which are "from" and which are "to":

```
Corner layout:
  NW(self)  NE(east)
  SW(south) SE(southeast)

cornerMask bits:
  bit 3 = NW is 'from' biome
  bit 2 = NE is 'from' biome
  bit 1 = SW is 'from' biome
  bit 0 = SE is 'from' biome
```

The 'from' biome is whichever biome is at lower elevation in the transition pair. This means the same two biomes at the same location might produce different corner masks depending on their relative elevations.

### 6. Complete Render Pipeline Per Tile

```
For each tile (wx, wy):
  1. Get 4 corner biomes: self, E, S, SE
  2. Get 4 corner elevations: self._el, _elE, _elS, _elSE
  3. Determine if this is a biome transition (any corners differ)
  
  IF biome transition:
    4a. Identify the two biomes involved
    4b. Determine which is at lower elevation (average of its corners)
    4c. Call transitionPairFor(biomeA, biomeB, elevA, elevB) → pair with dir
    4d. Compute elevationVariant from max cliffLevel delta → variant
    4e. Compute corner mask (which corners are 'from' vs 'to')
    4f. Build path: {pair.dir}/{variant}/{pair.dir}__wang_{mask}__v000.png
        (For variant='wang', force alphabetical dir since s0.0 is symmetric)
    4g. Draw the wang tile. Fallback to 'wang' if variant not on disk.
  
  IF interior (all corners same biome):
    4a. Use BIOME_INTERIOR[biome] → { dir, mask }
    4b. Build path: {dir}/wang/{dir}__wang_{mask}__v000.png
    4c. Draw the fill tile.
  
  5. paintCliffOverlay (existing system, unchanged)
```

## Verification

After all tilesets are generated and downloaded:

1. **Count check:** Every `{A}_to_{B}/` directory (A < B) has `wang/` (16 files), `wang_25/` (16), `wang_50/` (16), `wang_100/` (25) = 73 files
2. **Inverse check:** Every `{B}_to_{A}/` directory (B > A, i.e. inverse) has `wang_25/` (16), `wang_50/` (16), `wang_100/` (25) = 57 files. NO `wang/` (s0.0 is symmetric, stored in forward dir only)
3. **Base tile ID check:** Spot-check tilesets on PixelLab to verify canonical IDs match
4. **Visual check:** Open game, navigate to biome transitions, verify:
   - Interior tiles blend with edge tiles (same fill texture)
   - Cliff direction matches elevation (higher terrain sits above lower)
   - No mismatched seams at tile boundaries
