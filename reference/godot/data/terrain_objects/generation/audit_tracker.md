# PixelLab Object Audit Tracker
## Date: 2026-05-28

## Inventory Summary
- Total objects: 3,056
- Completed: 2,717
- Failed: 315 (DELETE ALL)
- Review: 23 (SELECT FRAMES)
- Processing: 1 (wildflower batch)

## Completed Object Categories (2,717 total)

### Category A: Script Garbage - Duplicate Prompts (~2,000+)
Pattern: Same prompt repeated dozens/hundreds of times by broken pixellab_runner.py
- "white snow patch on ground" x33+ (offsets 0-32)
- "top-down pixel art brown ..." x33+ (offsets ~1000-1033) — likely toadstool/mushroom
- "top-down pixel art wooden ..." x36+ (offsets ~2001-2036) — likely wooden objects
- ACTION: DELETE ALL DUPLICATES, keep 1-4 best of each unique prompt

### Category B: Script Lifecycle Phases (~400-600)
Pattern: "Top-down pixel art [phase] [object]..." with lifecycle/durability stages
- Various bushes (rose, blueberry, desert_shrub) lifecycle phases
- Various trees (cactus, coconut palm) lifecycle phases  
- Rock/mineral durability stages (intact, cracked, fractured, shattered)
- Ground covers (mud, leaves, ash, permafrost, stone dust)
- Spider webs, cocoons, nests
- Mixed success rate (~50% FAILED, ~50% completed)
- ACTION: REVIEW EACH, keep good ones, organize by object_id + phase

### Category C: MCP-Generated Named Objects (~50-80)
Pattern: Proper descriptive names like "Spruce tree, dark blue-green...", "Maple tree, red and orange..."
- Located around offsets 1034-1050
- Good quality, correct prompts, proper descriptions
- Already partially downloaded (~145 on disk)
- ACTION: DOWNLOAD ALL, organize, verify perspective/shadows/proportions

### Category D: Curated Variants (~100-200)
Pattern: "[Object] variant, [description]..." from create_1_direction_object pipeline
- Oak tree variants x3, spruce x1, granite boulder x2-3
- Grass patches, wildflowers, sand drift, packed snow, ice patches
- Jungle tree, pine cone scatter, etc.
- ACTION: REVIEW EACH, download good ones

### Category E: Tagged 42x42 Objects (~500+)
Pattern: Category set objects at 42x42 with tags
- "Fantasy armor and clothing..." (tags: armor)
- "Nature terrain details set..." (tags: nature)  
- "Building architecture tile..." (tags: architecture)
- "Fantasy weapons set..." (tags: weapons)
- "Medieval fantasy furniture..." (tags: furniture)
- "Food and consumables set..." (tags: food)
- "Crafting materials set..." 
- "Treasure and valuables set..."
- ACTION: These are NON-TERRAIN objects (items, equipment, building tiles). Keep for future use. Different pipeline. Review separately.

## Review Objects (23 total)

### Terrain Object Batch Candidates (10)
| # | ID | Description | Size | Status |
|---|-----|-------------|------|--------|
| 1 | 5997fff1 | mossy grey boulder | 64x64 | review:awaiting-selection |
| 2 | 5c9ee155 | oak tree, green deciduous | 64x64 | review:awaiting-selection |
| 3 | 6d434ec3 | pine tree, dark green conifer | 64x64 | review:awaiting-selection |
| 4 | b61c9600 | red mushroom with white spots | 32x32 | review:awaiting-selection |
| 5 | 619c57ce | white snow patch on ground | 32x32 | review:awaiting-selection |
| 6 | ac766f26 | small green bush, round shape | 32x32 | review:awaiting-selection |
| 7 | 04dfa464 | green fern plant, forest | 32x32 | review:awaiting-selection |
| 8 | deca415d | small grey pebble stone | 32x32 | review:awaiting-selection |
| 9 | daaa186f | green grass tuft, meadow | 32x32 | review:awaiting-selection |
| 10 | 70a96c78 | small wildflower, colorful | 32x32 | was creating 75% |

### 42x42 Set Review Candidates (13)
| # | ID | Description | Tags |
|---|-----|-------------|------|
| 11 | f018d891 | Crafting materials set | - |
| 12 | 09956943 | Treasure and valuables set | - |
| 13 | 75b41f75 | Food and consumables set | - |
| 14 | 39417925 | Building architecture tile | - |
| 15 | 3ce7b2b8 | Nature terrain details set | - |
| 16 | 970ce77d | Fantasy armor and clothing | - |
| + 7 more tagged 42x42 sets | | |

## Processing Queue
- [ ] Delete 315 FAILED objects
- [ ] Review 10 terrain batch candidates, select best 4 frames each
- [ ] Page through ALL 2,717 completed objects, categorize each
- [ ] Download all Category C + D objects
- [ ] Delete all Category A duplicates (keep 1-4 of each unique prompt)
- [ ] Organize Category B lifecycle phases by object_id
- [ ] Catalog Category E tagged objects for future use
- [ ] Cross-reference against biome affinity list for gaps
- [ ] Generate missing objects

## Size Reference (Proportional Rules)
- Flowers, grass, pebbles, ground cover: 32x32
- Bushes, small objects: 32x32 to 32x48
- Boulders, large bushes: 64x64
- Trees: 64x96
- Furniture, items, equipment: 42x42 (separate pipeline)
