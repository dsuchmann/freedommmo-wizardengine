# Wall Tile System Phase 1: Stone Brick — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tileable 32×128px wall columns with replacement door/window pieces for one material (stone brick). South exterior, interior, east/west edges, north back — all 7 sprites generated, renderer rewritten to place them correctly at footprint positions.

**Architecture:** Plain wall columns (32×128) tile seamlessly along building edges. Doors (64×128) and windows (32×128) REPLACE specific columns at exact footprint positions with ≥2 tile edge margin. Interior walls use a different texture. All dimensions are multiples of 32 for perfect tiling.

**Tech Stack:** PixelLab MCP for asset generation, 2D canvas rendering, building-renderer.js.

---

## File Structure

```
assets/pixelab/buildings/walls/stone_brick_tiles/
  south_base.png           (32×128 — tileable exterior column)
  south_window.png         (32×128 — window replacement column)
  south_door.png           (64×128 — door replacement, 2 tiles wide)
  interior_base.png        (32×128 — interior wall column)
  interior_archway.png     (64×128 — interior passage, 2 tiles wide)
  edge_ew.png              (32×32  — east/west wall cap)
  north_back.png           (32×64  — north wall piece)

src/render/building-renderer.js  — rewritten drawBuildingWalls + wall image loading
```

---

### Task 1: Generate wall tile sprites via PixelLab

- [ ] **Step 1: Generate south exterior base column (128×128)**

PixelLab `create_1_direction_object`:
```
description: "stone brick wall column, south-facing front view, grey stone bricks with mortar lines, wall cap at top, foundation at bottom, seamless left edge matches right edge for horizontal tiling, pixel art, transparent background"
size: 128
view: top-down
```

Wait for completion. Select best candidate. This gives us a 128×128 sprite — we'll crop the leftmost 32px column as our tileable base.

- [ ] **Step 2: Crop to 32×128 tileable column**

Using sharp:
```js
import sharp from 'sharp';
await sharp('source_128.png').extract({ left: 0, top: 0, width: 32, height: 128 }).toFile('south_base.png');
```

Verify the left and right edges match for seamless horizontal tiling.

- [ ] **Step 3: Generate window replacement column**

PixelLab `create_object_state`:
```
object_id: <south_base_128_id>
edit_description: "add an arched window with glass panes and wooden frame in the upper-middle section of the wall"
```

Crop to 32×128 same as base.

- [ ] **Step 4: Generate door replacement piece (64×128)**

PixelLab `create_1_direction_object`:
```
description: "stone brick wall with wooden door, arched stone doorframe, heavy oak planks with iron hinges, door centered, wall cap at top, foundation at bottom, 2 tiles wide, pixel art, transparent background"
size: 128
view: top-down
```

This gives 128×128 — crop to 64×128 (centered door).

- [ ] **Step 5: Generate interior wall column**

PixelLab `create_object_state`:
```
object_id: <south_base_128_id>
edit_description: "change to smooth interior plaster wall, light grey/cream color, no exterior bricks, indoor wall surface"
```

Crop to 32×128.

- [ ] **Step 6: Generate interior archway (64×128)**

PixelLab `create_object_state`:
```
object_id: <door_128_id>
edit_description: "change to open stone archway with no door, just the passage opening, interior wall"
```

Crop to 64×128.

- [ ] **Step 7: Generate east/west edge piece (32×32)**

PixelLab `create_1_direction_object`:
```
description: "top-down view of stone wall edge, thin wall cap seen from directly above, pixel art"
size: 32
view: top-down
```

- [ ] **Step 8: Generate north back piece (64×64)**

PixelLab `create_1_direction_object`:
```
description: "back of stone brick wall seen from behind and above, 3/4 top-down view, wall cap on top, back face of grey bricks, pixel art, transparent background"
size: 64
view: top-down
```

Crop to 32×64.

- [ ] **Step 9: Download all sprites to assets directory**

```bash
mkdir -p assets/pixelab/buildings/walls/stone_brick_tiles
# Download and save each: south_base.png, south_window.png, south_door.png,
# interior_base.png, interior_archway.png, edge_ew.png, north_back.png
```

- [ ] **Step 10: Commit**

```bash
git add assets/pixelab/buildings/walls/stone_brick_tiles/
git commit -m "assets: stone brick wall tile sprites — 7 pieces at 32px multiples"
```

---

### Task 2: Rewrite wall image loading

**Files:**
- Modify: `src/render/building-renderer.js`

- [ ] **Step 1: Replace wall image loading in ensureFloorImages()**

```js
// Wall tile sprites (all multiples of 32px)
const WALL_BASE = '/assets/pixelab/buildings/walls/stone_brick_tiles/';
const wallPieces = {
  south_base:       'south_base.png',        // 32×128
  south_window:     'south_window.png',       // 32×128
  south_door:       'south_door.png',         // 64×128
  interior_base:    'interior_base.png',      // 32×128
  interior_archway: 'interior_archway.png',   // 64×128
  edge_ew:          'edge_ew.png',            // 32×32
  north_back:       'north_back.png',         // 32×64
};
for (const [key, file] of Object.entries(wallPieces)) {
  const img = new Image();
  img.src = WALL_BASE + file;
  img.onload = () => { _wallImgs[key] = img; };
}
```

- [ ] **Step 2: Update _wallImgs initialization**

Change from `{ plain: null, window: null, door: null }` to `{}`.

- [ ] **Step 3: Commit**

```bash
git add src/render/building-renderer.js
git commit -m "refactor: load 7 wall tile pieces instead of old 160px sprites"
```

---

### Task 3: Rewrite drawBuildingWalls — complete replacement

**Files:**
- Modify: `src/render/building-renderer.js`

- [ ] **Step 1: Replace entire drawBuildingWalls function**

```js
/** Draw building walls at perimeters. Call AFTER F2/player.
 *
 *  Rendering approach:
 *  - Plain wall columns (32×128) tile seamlessly along edges
 *  - Doors (64×128) and windows (32×128) REPLACE specific columns
 *  - Interior walls use different texture at room junctions
 *  - Draw order: north → east/west → interior → south (front to back)
 */
export function drawBuildingWalls(ctx, camX, camY, tilePx, w, h) {
  const buildings = _cache.buildings;
  if (!buildings || buildings.length === 0) return;
  if (!_wallImgs.south_base) return;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  const t = Math.round(tilePx);       // 1 tile in screen px
  const WALL_H = 4;                   // wall is 4 tiles tall (128px source)
  const wallH = Math.round(tilePx * WALL_H);
  const EDGE_H = 1;                   // east/west edge = 1 tile
  const NORTH_H = 2;                  // north back = 2 tiles tall

  for (const b of buildings) {
    const fp = b.footprint;

    // Build floor set for interior/exterior detection
    const floorSet = new Set();
    for (const sec of fp.sections) {
      for (let dy = 0; dy < sec.h; dy++)
        for (let dx = 0; dx < sec.w; dx++)
          floorSet.add((sec.x0 + dx) + ',' + (sec.y0 + dy));
    }

    // Door positions (local coords relative to building origin)
    const doorSet = new Set((fp.doors || []).map(d => d.x + ',' + d.y));

    // Window positions: exterior south edges, every 3rd tile, ≥2 from edges, not adjacent to doors
    const windowPositions = new Set();
    for (const sec of fp.sections) {
      const lastRow = sec.y0 + sec.h - 1;
      let interval = 0;
      for (let dx = 0; dx < sec.w; dx++) {
        const lx = sec.x0 + dx, ly = lastRow;
        const southOutside = !floorSet.has(lx + ',' + (ly + 1));
        if (!southOutside) continue;
        if (doorSet.has(lx + ',' + ly)) { interval = 0; continue; }
        // ≥2 tiles from section edges
        if (dx < 2 || dx >= sec.w - 2) { interval++; continue; }
        // Not adjacent to a door
        if (doorSet.has((lx - 1) + ',' + ly) || doorSet.has((lx + 1) + ',' + ly)) { interval++; continue; }
        interval++;
        if (interval % 3 === 0) windowPositions.add(lx + ',' + ly);
      }
    }

    // ── Pass 1: North walls (behind building, drawn first) ──────
    for (const sec of fp.sections) {
      const northRow = sec.y0;
      for (let dx = 0; dx < sec.w; dx++) {
        const lx = sec.x0 + dx;
        // Only if north neighbor is outside building
        if (floorSet.has(lx + ',' + (northRow - 1))) continue;
        const wx = b.x + lx;
        const wy = b.y + northRow;
        const sx = Math.round(wx * tilePx - camX);
        const sy = Math.round(wy * tilePx - camY) - Math.round(tilePx * NORTH_H);
        if (sx + t < 0 || sx > w || sy + Math.round(tilePx * NORTH_H) < 0 || sy > h) continue;
        if (_wallImgs.north_back) {
          ctx.drawImage(_wallImgs.north_back, 0, 0, 32, 64, sx, sy, t, Math.round(tilePx * NORTH_H));
        }
      }
    }

    // ── Pass 2: East/West edge pieces ───────────────────────────
    for (const sec of fp.sections) {
      // East edge
      const eastX = sec.x0 + sec.w;
      for (let dy = 0; dy < sec.h; dy++) {
        const ly = sec.y0 + dy;
        if (floorSet.has(eastX + ',' + ly)) continue;
        const wx = b.x + eastX;
        const wy = b.y + ly;
        const sx = Math.round(wx * tilePx - camX);
        const sy = Math.round(wy * tilePx - camY);
        if (sx + t < 0 || sx > w || sy + t < 0 || sy > h) continue;
        if (_wallImgs.edge_ew) {
          ctx.drawImage(_wallImgs.edge_ew, 0, 0, 32, 32, sx, sy, t, t);
        }
      }
      // West edge
      const westX = sec.x0 - 1;
      for (let dy = 0; dy < sec.h; dy++) {
        const ly = sec.y0 + dy;
        if (floorSet.has(westX + ',' + ly)) continue;
        const wx = b.x + westX;
        const wy = b.y + ly;
        const sx = Math.round(wx * tilePx - camX);
        const sy = Math.round(wy * tilePx - camY);
        if (sx + t < 0 || sx > w || sy + t < 0 || sy > h) continue;
        if (_wallImgs.edge_ew) {
          ctx.drawImage(_wallImgs.edge_ew, 0, 0, 32, 32, sx, sy, t, t);
        }
      }
    }

    // ── Pass 3: Interior south walls (room junctions) ───────────
    for (const sec of fp.sections) {
      const lastRow = sec.y0 + sec.h - 1;
      for (let dx = 0; dx < sec.w; dx++) {
        const lx = sec.x0 + dx, ly = lastRow;
        // Interior: south neighbor is INSIDE building (another section)
        const southInside = floorSet.has(lx + ',' + (ly + 1));
        if (!southInside) continue;
        // Check it's actually a different section (not same section)
        const inSameSection = ly + 1 < sec.y0 + sec.h;
        if (inSameSection) continue;

        const wx = b.x + lx;
        const wy = b.y + ly + 1;
        const sx = Math.round(wx * tilePx - camX);
        const sy = Math.round(wy * tilePx - camY) - wallH;
        if (sx + t < 0 || sx > w || sy + wallH < 0 || sy > h) continue;

        // Interior door/archway?
        const key = lx + ',' + ly;
        if (doorSet.has(key) && _wallImgs.interior_archway) {
          ctx.drawImage(_wallImgs.interior_archway, 0, 0, 64, 128, sx, sy, t * 2, wallH);
          dx++; // skip next tile (archway is 2 wide)
        } else if (_wallImgs.interior_base) {
          ctx.drawImage(_wallImgs.interior_base, 0, 0, 32, 128, sx, sy, t, wallH);
        }
      }
    }

    // ── Pass 4: South exterior walls (most visible, drawn last) ──
    for (const sec of fp.sections) {
      const lastRow = sec.y0 + sec.h - 1;
      const skipSet = new Set(); // tiles consumed by 2-wide doors

      for (let dx = 0; dx < sec.w; dx++) {
        if (skipSet.has(dx)) continue;
        const lx = sec.x0 + dx, ly = lastRow;
        // Only exterior (south neighbor outside building)
        if (floorSet.has(lx + ',' + (ly + 1))) continue;

        const wx = b.x + lx;
        const wy = b.y + ly + 1; // wall sits one row below the last floor tile
        const sx = Math.round(wx * tilePx - camX);
        const sy = Math.round(wy * tilePx - camY) - wallH;
        if (sx + t < 0 || sx > w || sy + wallH < 0 || sy > h) continue;

        const key = lx + ',' + ly;

        if (doorSet.has(key) && dx >= 2 && dx < sec.w - 2 && _wallImgs.south_door) {
          // Door: 2 tiles wide, centered on this tile
          ctx.drawImage(_wallImgs.south_door, 0, 0, 64, 128, sx, sy, t * 2, wallH);
          skipSet.add(dx + 1); // next tile consumed by door
        } else if (windowPositions.has(key) && _wallImgs.south_window) {
          // Window: 1 tile wide replacement
          ctx.drawImage(_wallImgs.south_window, 0, 0, 32, 128, sx, sy, t, wallH);
        } else if (_wallImgs.south_base) {
          // Plain wall column
          ctx.drawImage(_wallImgs.south_base, 0, 0, 32, 128, sx, sy, t, wallH);
        }
      }
    }
  }

  ctx.restore();
}
```

Key changes from previous version:
- **4 render passes** (north → east/west → interior → south) for correct z-order
- **32×128 columns** drawn per-tile, no column slicing from larger sprites
- **Doors are 2 tiles wide**, skip the next tile after drawing
- **Windows have ≥2 tile edge margin** and are never adjacent to doors
- **Interior detection:** south neighbor inside building = interior wall texture
- **Consistent Math.round** on all positions (no jitter)
- **No overlays** — doors/windows REPLACE the plain column (not drawn on top)

- [ ] **Step 2: Commit**

```bash
git add src/render/building-renderer.js
git commit -m "feat: complete wall renderer — tileable columns, replacement doors/windows, 4-pass z-order"
```

---

### Task 4: Visual verification

- [ ] **Step 1: Navigate to Dawnflame (-3296, 7961)**

Verify:
- South wall: seamless brick columns, no gaps, no stretching
- Doors: 2 tiles wide, not clipped by edges, ≥2 tiles from section edges
- Windows: 1 tile wide, spaced regularly, ≥2 tiles from edges
- Interior wall: different texture at L-shape junction
- East/West: edge pieces along sides
- North: back pieces along top
- No jitter when walking
- Wall height proportional to player (~1.6× player height)

- [ ] **Step 2: Test at different zoom levels**

Zoom in and out — walls should scale cleanly with no seam artifacts.

- [ ] **Step 3: Commit any fixes**

```bash
git commit -m "fix: wall visual adjustments from testing"
```

---

## Self-Review

**Spec coverage:**
- South exterior wall ✓ (Pass 4, tileable 32×128 columns)
- Window replacement ✓ (32×128, ≥2 tile margin, not adjacent to doors)
- Door replacement ✓ (64×128, 2 tiles wide, ≥2 tile margin)
- East/West edges ✓ (Pass 2, 32×32 cap pieces)
- North back ✓ (Pass 1, 32×64 pieces)
- Interior walls ✓ (Pass 3, different texture, archways)
- Proportions ✓ (4 tiles tall = 128px, taller than player)
- 32px multiples ✓ (all dimensions)
- Interior/exterior detection ✓ (floorSet neighbor check)
- Draw order ✓ (north → edges → interior → south)

**Not covered (Phase 2-3):**
- 64 variants per piece
- Additional materials (wood, marble, etc.)
- Door/window animations
- Roof
