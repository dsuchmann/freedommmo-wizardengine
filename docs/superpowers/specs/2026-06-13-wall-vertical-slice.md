# Wall Vertical Slice — One Building End to End

**Date:** 2026-06-13
**Goal:** Prove the hybrid cliff + wall face overlay approach on ONE building (Dawnflame town hall at -3296, 7961). If this works, it works at scale.

## Approach: Hybrid Cliff + South Face Overlay

Building floor tiles get elevation +1. The cliff system auto-renders:
- South face (wall face) with cliff overlay tiles
- East/west side edges (thin dark lines)
- Corners (cliff corner Wang tiles)

Then we overlay the rich wall face sprite (brick + windows + door) on the south cliff face.

## Asset Manifest

### 1. Building Wall Cliff Face Tile (replaces rock cliff at building positions)
- Generate via `create_topdown_tileset`: lower = terrain, upper = stone brick wall top
- This is the Wang tileset that shows the wall CAP from above + cliff edge
- 16 tiles, 32×32px
- Already generated: `3c9bc003-7458-4a3c-b284-e10fb88dd2d1`

### 2. Wall Face Strip (south-facing vertical surface)  
- Already generated: `50e42bf0-4210-4c71-8afc-2404f1c613c0` (256×256 plain wall)
- Window variant: `dff0855f-20dc-4607-96da-dd0d811326c2`
- Door variant: `51415387-421f-46ab-afaa-8d576ac0d007`
- Downloaded to: `assets/pixelab/buildings/walls/stone_brick/`

### 3. Window Overlay Sprite (alpha, composited on cliff face)
- Generate via `create_1_direction_object`: arched window with glass, alpha background
- Size: 64×64 (spans ~2 cliff face tile heights)
- Needs: transparent background, correct 3/4 angle

### 4. Door Overlay Sprite (alpha, composited on cliff face)
- Generate via `create_1_direction_object`: wooden door with stone arch, alpha background
- Size: 64×96 (taller than window)
- Needs: transparent background, correct 3/4 angle

### 5. Roof (covers building from above)
- Generate via `create_topdown_tileset`: lower = building interior, upper = thatched/tiled roof
- Wang tileset for roof connectivity (edges, corners)
- Alpha-fades when player enters

## Code Changes

### Step 1: Elevate building tiles
In `worker-chunk-renderer.js`, after `queryBuildingTile(wx, wy)`:
- If building tile: set `tile.climate.elevation += 0.15` (bumps cliff level by +1)
- This triggers the cliff system to draw south face, side edges, corners automatically

### Step 2: Swap cliff face texture at building positions
In `worker-tile-painter.js` `paintCliffOverlay()`:
- Check if this tile is a building tile (via `isBuildingClaimed` or elevation flag)
- If yes: use the wall cliff Wang tile instead of the biome's cliff tile
- The wall cliff tileset is already generated (floor-to-wall-cap transition)

### Step 3: Composite wall face sprite on south cliff face
After cliff overlay renders, draw the wall face sprite ON TOP of the cliff face.
Position: aligned to the cliff face area (below the elevated floor tile).
Use the same per-building logic as the current `drawBuildingWalls` but 
integrated into the chunk pipeline for correct lighting.

### Step 4: Window/door overlays (if assets ready)
Composite window sprites at window positions, door sprites at door positions.
These are alpha sprites drawn on top of the wall face.

### Step 5: Roof overlay
Draw roof Wang tiles on top of building floor tiles.
When player is inside: lerp roof alpha to 0 over 0.3s.

## Verification
- Navigate to Dawnflame (-3296, 7961)
- Building should show: stone floor, south wall face with cliff system, 
  side edges, corners, correct lighting, correct z-order
- Player walks behind south wall (cliff face occludes player)
- Player walks on floor (correct elevation)
