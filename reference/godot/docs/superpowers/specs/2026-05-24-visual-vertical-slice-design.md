# Visual Vertical Slice — Reference-Quality Village Clearing

## Goal
Make ONE small area (the spawn village) look like the reference pixel art games. All visual layers working together: ground terrain, paths, structures, objects, decorations, lighting, characters.

## Target Quality
- Forest path reference: lush trees with visible trunks/canopy as large sprites, mushrooms, rocks, grass variation, dirt path with texture
- Town square reference: stone/wood buildings with roofs/walls/doors as composed sprites, cobblestone streets, fountains, market stalls, trees, decorative objects

## Architecture: 5 Rendering Layers

### L1: Ground (TileMapLayer, z_index=-1)
- Single TileMapLayer with pro tiles (grass, water, forest floor, etc.)
- Per-tile biome selection from grain type
- Scale 0.25 (32px tiles rendered at 8px to match coordinate system)

### L2: Paths (TileMapLayer, z_index=0) 
- Separate TileMapLayer for paths using dirt_path and stone_path pro tiles
- Placed from village path data (WorldManager.village_gen.all_path_tiles)

### L3: Structures (Sprite2D compositions, z_index=1-3)
- Each building = grid of tile sprites (wall, roof, floor, door)
- SpriteStructureRenderer already built — needs pro tile textures wired in
- Roof tiles at z_index=3, walls at z_index=2

### L4: Objects & Decorations (Sprite2D, z_index=2-4)  
- PixelLab nature sprites (9 trees/rocks/bushes) as world objects
- PixelLab furniture sprites (15) placed inside/near structures
- Decoration tiles (fence, well, campfire, fountain) near structures
- SpriteObjectRenderer already built — loads from assets/objects/nature/

### L5: Lighting & Atmosphere (PointLight2D + CanvasModulate + particles)
- Player warm glow (already built)
- Structure lights — campfire/forge orange, house window warm (already built)
- Ambient particles — pollen day, fireflies night (already built)
- Day/night CanvasModulate (already built)

## Asset Pipeline
1. PixelLab create_tiles_pro for terrain tiles (DONE — 12 tiles)
2. PixelLab create_tiles_pro for building tiles (IN PROGRESS — 8 tiles)
3. PixelLab objects for nature/furniture/architecture (DONE — 89 sprites)
4. PixelLab characters for NPCs (DONE — 21 characters, 10 pro bodies)

## Implementation Order
1. Wire pro tiles into TileMapRenderer (replace old clean tilesets)
2. Add path TileMapLayer using dirt_path tile
3. Wire PixelLab nature sprites into SpriteObjectRenderer 
4. Wire building pro tiles into SpriteStructureRenderer
5. Add decoration placement around structures
6. Verify all 5 layers compose correctly in the village area
