# Wang Tile Canonical Base ID Plan

## Goal

Collapse all biome tile fragmentation into ONE canonical base tile ID per biome. Every transition tileset that involves a biome must use that biome's canonical ID, ensuring seamless blending across all transitions.

## Canonical Base Tile IDs

Selected based on connectivity (most tilesets already chaining to it) from the audit:

| Biome | Canonical Base Tile ID | Description | Connections |
|-------|----------------------|-------------|-------------|
| grassland | `c9ce4900-726d-4b56-bb5c-9aa2fc3d191a` | lush green grass meadow | ~18 tilesets |
| forest | `997894f5-3f3c-4d50-839e-2e32fa166a71` | dark forest floor (fallen leaves/moss) | ~18 tilesets |
| hills | `dc51d808-a3d4-4025-997e-75af468bcac9` | rocky hills (scattered stones/sparse grass) | ~9 tilesets |
| desert | `71ed06d0-8c84-453c-a5a4-5c59e4522e54` | arid desert sand | ~4 tilesets |
| savanna | `14b79358-c430-43a4-a043-c20fb0e5b904` | dry golden savanna grass | ~4 tilesets |
| mystic | `b5d6431c-1397-43f8-8594-7d2b8fb09885` | glowing mystic purple ground | ~4 tilesets |
| taiga | `098c093b-1d5f-4f91-9dfc-cacc9f4cffff` | taiga forest floor (pine needles/frost) | ~4 tilesets |
| mountains | `4157436e-8eb7-4cae-b747-f38f0f9def27` | grey mountain rock (snow patches/gravel) | ~3 tilesets |
| volcanic | `abfe8223-2ffa-45b2-89ca-63308625acc5` | dark volcanic rock (lava cracks) | ~3 tilesets |
| river | `e6bf01fc-1a4e-40c5-b242-e3bdef4e01e3` | flowing river water | ~4 tilesets |
| swamp | `a267b749-1927-4d39-b73d-06a39301013d` | wet brown swamp mud | ~8 tilesets |
| beach | `0a7ad061-3ecc-4716-9864-2ef4078e59df` | dry sandy beach | ~4 tilesets |
| arctic/snow | `76153afd-8cde-4d31-933b-4078a2633463` | white snow and ice surface | ~4 tilesets |
| tundra | `c83f7b4b-20cf-476b-9fde-88f345d91ae9` | dark frozen permafrost earth | ~4 tilesets |
| steppe | `f60eac53-8ad5-4652-9ee7-ed4301eb1685` | dry golden-brown grass and dirt | ~5 tilesets |
| stone/cliff | `96bbf35d-517e-40fd-998b-99cc783f90ad` | grey layered stone rock surface | ~7 tilesets |

### Biomes needing canonical ID selection (not enough data from audit)

These biomes had few or no clearly dominant base tile IDs. We need to either:
- Use one of the existing IDs, or
- Generate a fresh canonical base tile and chain everything from it

| Biome | Status | Notes |
|-------|--------|-------|
| dense_forest | Needs review | May share `997894f5` (forest) or need a distinct darker variant |
| tropical_forest | Needs review | Distinct biome, likely needs its own canonical ID |
| ocean | Needs review | Water surface — check if a shared water base exists |
| deep_ocean | Needs review | Darker water — may need its own |
| shallow_water | Needs review | Lighter water — may need its own |
| lake | Needs review | Still water — may share with shallow_water or be distinct |

---

## Transition Matrix

### Existing transitions (61) — need canonical ID verification

For each transition, both the "from" and "to" biome tiles must use canonical IDs. If either side uses a non-canonical ID, the tileset must be regenerated.

Format: `from_biome -> to_biome : STATUS`
- **OK** = both sides use canonical IDs (verified via chaining)
- **REGEN** = one or both sides use non-canonical IDs
- **CHECK** = needs manual verification (tileset exists but connectivity unknown)

All 61 require CHECK since we need to match each on-disk transition directory to its PixelLab tileset UUID and verify its base tile IDs. This mapping step is needed first.

### Missing transitions (likely adjacencies that should exist)

These biome pairs are geographically likely to be adjacent but have no transition tileset:

**High priority (common adjacencies):**
- arctic <-> desert
- arctic <-> tundra (exists as tundra_to_snow but arctic != snow in our biome system)
- arctic <-> mountains
- beach <-> forest (exists on disk)
- beach <-> hills (exists on disk)
- forest <-> savanna (exists on disk)
- grassland <-> desert (exists on disk)
- grassland <-> taiga (exists on disk)
- dense_forest <-> forest (exists on disk, but is it using canonical IDs?)
- dense_forest <-> river
- dense_forest <-> lake

**Medium priority:**
- forest <-> ocean
- forest <-> shallow_water
- grassland <-> mountains
- grassland <-> swamp
- grassland <-> tropical_forest
- river <-> savanna
- river <-> steppe
- river <-> taiga
- savanna <-> volcanic
- steppe <-> swamp
- steppe <-> taiga

---

## Execution Strategy

### Phase 1: Map on-disk assets to PixelLab tileset UUIDs

For each of our 61 on-disk transition directories, find which PixelLab tileset UUID produced it. This can be done by:
1. Checking if the tileset download was stored with metadata
2. Matching descriptions and terrain names
3. Manual inspection if needed

### Phase 2: Verify canonical compliance

For each mapped tileset:
1. Get its base tile IDs via `get_topdown_tileset`
2. Check if lower_base_tile_id matches the canonical ID for the "from" biome
3. Check if upper_base_tile_id matches the canonical ID for the "to" biome
4. Mark as OK or REGEN

### Phase 3: Regenerate non-canonical tilesets

For each REGEN tileset:
1. Call `create_topdown_tileset` with:
   - `lower_base_tile_id` = canonical ID for the "from" biome
   - `upper_base_tile_id` = canonical ID for the "to" biome
   - Same descriptions and style settings as the original
2. Wait for completion
3. Download and replace the on-disk wang tiles
4. Verify visual quality

### Phase 4: Generate missing transitions

For each missing transition:
1. Call `create_topdown_tileset` with canonical base tile IDs for both biomes
2. Download and add to the transitions directory
3. Add to TRANSITION_PAIRS in the code
4. Add to wang-image-list.js EXTRA_TRANSITION_DIRS

### Phase 5: Resolve undetermined biomes

For dense_forest, tropical_forest, ocean, deep_ocean, shallow_water, lake:
1. Decide if they share an existing canonical ID or need their own
2. Generate canonical base tiles if needed
3. Chain all related transitions to the new canonical IDs

---

## Dense Forest Vertical Slice (Priority)

Since the user wants to start with dense_forest as the first vertical slice:

1. **Determine dense_forest canonical ID**: Is `997894f5` (forest floor) appropriate, or does dense_forest need a darker, denser ground tile? The audit shows `1a6c5646` and others as "dense" variants.

2. **Required transitions for dense_forest:**
   - dense_forest <-> forest (exists)
   - dense_forest <-> mystic (exists)
   - dense_forest <-> tropical_forest (exists)
   - dense_forest <-> swamp (exists as swamp_to_dense_forest)
   - dense_forest <-> river (MISSING)
   - dense_forest <-> lake (MISSING)
   - dense_forest <-> grassland (MISSING — but may transition through forest)

3. **Verify all existing dense_forest transitions use the same ground tile**

4. **Layer progression for dense_forest vertical slice:**
   - Layer 0: Wang tiles (ground texture) — THIS PLAN
   - Layer 1: Substrate (dirt, roots, fallen leaves)
   - Layer 2: Ground cover (moss, ferns, mushrooms)
   - Layer 3: Detail objects (flowers, stones, deadwood)
   - Layer 4: Trees (canopy, trunks, shadows)
