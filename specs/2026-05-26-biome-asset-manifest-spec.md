# Biome Asset Manifest Spec — What to Generate

**Date:** 2026-05-26
**Status:** Draft
**Scope:** Exact content definition for each biome's 5 layers, PixelLab prompts, reuse decisions, and generation order.

## Phase 1 Scope: Pristine State Only

Generate L1-L5 for all 18 biomes in pristine state. State overlays (burning, frozen, cursed, etc.) come in Phase 2+ and reuse biome visual language as defined in the runtime compositor spec.

## Reuse Decisions

### PixelLab Assets to Keep (Quality Approved)

| Biome | PixelLab ID | Use As | Notes |
|-------|------------|--------|-------|
| Volcanic | `81944792` | L1 base | Dark grey rock + glowing lava cracks. Excellent. |
| Crystal/Mystic | `54dc133e` | L1 base | Purple glowing crystal floor. Good mystic feel. |

### PixelLab Assets to Evaluate (Pick Best Variant)

| Biome | Candidates | Action |
|-------|-----------|--------|
| Ocean | `b339478e`, `9501a5de`, `df96a6c9` | Compare all 3, pick best for L1 |
| Grassland | `3d693567`, `8134007e`, `4f4c0026`, `ac280f19` | Compare all 4, pick best for L1 |
| Desert | `55dab894`, `54bdee29`, `ad90a767`, `e6a681c8` | Compare all 4, pick best for L1 |
| Forest | `3a644a3c`, `0454f218`, `70815aff`, `3f7e9b46` | Compare all 4, pick best for L1 |
| Mountains | `e9dee808`, `6e33396d`, `734a512d` | Compare all 3, pick best for L1 |
| Swamp | `3361f1e6`, `c66c5821`, `e41cf7e8` | Compare all 3, pick best for L1 |
| Tundra | `7ad82261`, `5a6a0efb`, `22ac5d04` | Compare all 3, pick best for L1 |

### Generate Fresh

| Biome | Why |
|-------|-----|
| Beach | No self-tileset exists on PixelLab |
| Arctic | Distinct from tundra — needs glacial ice, not just snow |
| Taiga | Dense conifer forest floor, distinct from generic forest |
| Savanna | Dry golden grass, red earth, acacia shade |
| Steppe | Windswept short grass, exposed rock, sparse |
| Tropical Forest | Rich green, broad leaves, vines, humid |
| Dense Forest | Very dark, thick canopy floor, moss-heavy |
| Lake | Still clear water, different from ocean waves |
| River | Flowing water with directional current |

## Per-Biome Layer Definitions

### 1. Ocean
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Deep blue water with gentle wave patterns | "deep blue ocean water with gentle rolling waves, pixel art, top-down view" |
| L5 | White foam, spray, light reflections | "white sea foam and spray particles on transparent background, scattered, pixel art, top-down view" |
| L2-L4 | Not used | — |

### 2. Beach
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Golden sand with subtle grain texture | "golden sandy beach with fine grain texture and subtle color variation, pixel art, top-down view" |
| L2 | Wet sand patches, tide marks | "wet dark sand patches and wave tide marks on transparent background, pixel art" |
| L4 | Shells, driftwood, small stones | "scattered seashells and small pieces of driftwood on transparent background, pixel art" |
| L3, L5 | Not used | — |

### 3. Grassland
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Rich green earth with short grass base | "lush green grass field with individual blade detail and natural color variation, pixel art, top-down view" |
| L2 | Bare dirt patches, subtle root lines | "small bare dirt patches and thin root lines on transparent background, pixel art" |
| L3 | Tall grass blades, wildflowers, clovers | "tall green grass blades with small wildflowers and clovers on transparent background, pixel art" |
| L4 | Pebbles, fallen petals, small sticks | "scattered small pebbles and fallen flower petals on transparent background, pixel art" |
| L5 | Floating pollen, dandelion seeds | "floating pollen particles and dandelion seeds on transparent background, sparse, pixel art" |

### 4. Forest
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Dark brown earth with leaf litter base | "dark forest floor with brown dirt and scattered fallen leaves, pixel art, top-down view" |
| L2 | Exposed roots, moss patches, fungus | "tree root networks and green moss patches on transparent background, pixel art" |
| L3 | Ferns, small saplings, forest herbs | "small green ferns and forest undergrowth plants on transparent background, pixel art" |
| L4 | Fallen acorns, twigs, pinecones | "scattered fallen acorns, small twigs, and pinecones on transparent background, pixel art" |
| L5 | Dappled light spots, floating dust motes | "dappled golden light spots and floating dust particles on transparent background, pixel art" |

### 5. Dense Forest
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Very dark soil, thick leaf carpet | "very dark forest floor with thick layer of decomposing leaves and rich dark soil, pixel art, top-down view" |
| L2 | Heavy moss coverage, bracket fungus | "thick green moss carpet and shelf mushrooms growing on transparent background, pixel art" |
| L3 | Dense ferns, large mushrooms, vines | "dense fern fronds and large spotted mushrooms on transparent background, pixel art" |
| L4 | Rotting logs, large fallen branches | "scattered rotting wood pieces and fallen branches on transparent background, pixel art" |
| L5 | Deep shadow, occasional firefly | "deep green shadow overlay with tiny yellow-green firefly lights on transparent background, pixel art" |

### 6. Desert
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Golden sand with wind ripple patterns | "golden desert sand with wind-blown ripple wave patterns, pixel art, top-down view" |
| L2 | Cracked dry earth patches, dark stone | "cracked dry earth patches and exposed dark rock on transparent background, pixel art" |
| L4 | Small rocks, sun-bleached bones, dry twigs | "scattered small desert rocks and sun-bleached bone fragments on transparent background, pixel art" |
| L5 | Heat shimmer, blowing sand particles | "blowing sand dust particles and heat distortion on transparent background, sparse, pixel art" |
| L3 | Not used (desert has no vegetation base) | — |

### 7. Savanna
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Dry golden-brown grass on red earth | "dry golden savanna grass on reddish-brown earth with natural variation, pixel art, top-down view" |
| L2 | Red clay patches, animal tracks | "red clay dirt patches and subtle animal hoof prints on transparent background, pixel art" |
| L3 | Tall dry grass tufts, thorny scrub | "tall dry yellow-brown grass tufts and small thorny bushes on transparent background, pixel art" |
| L4 | Scattered dry seeds, small rocks | "scattered dry seed pods and small reddish rocks on transparent background, pixel art" |
| L5 | Dust, dry grass particles | "floating dust and dry grass particles on transparent background, sparse, pixel art" |

### 8. Steppe
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Short windswept grass on rocky soil | "short windswept grass on grey-brown rocky soil, sparse, pixel art, top-down view" |
| L2 | Exposed bedrock, erosion patterns | "exposed grey bedrock patches and wind erosion patterns on transparent background, pixel art" |
| L3 | Very sparse tough grass, lichen | "very sparse tough grass clumps and grey lichen on transparent background, pixel art" |
| L4 | Loose gravel, wind-polished stones | "scattered loose gravel and smooth wind-polished stones on transparent background, pixel art" |
| L5 | Wind-blown dust streaks | "horizontal wind-blown dust streaks on transparent background, directional, pixel art" |

### 9. Tundra
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Frozen grey-brown earth with permafrost | "frozen grey-brown tundra earth with subtle permafrost texture, pixel art, top-down view" |
| L2 | Frost heave cracks, ice crystals | "white frost patterns and small ice crystal formations on transparent background, pixel art" |
| L3 | Arctic moss, lichen, tiny flowers | "low arctic moss and tiny colorful tundra flowers on transparent background, pixel art" |
| L4 | Frozen pebbles, ice shards | "scattered frost-covered pebbles and small ice shard fragments on transparent background, pixel art" |
| L5 | Blowing snow particles, ice sparkle | "blowing snow particles and ice sparkle reflections on transparent background, pixel art" |

### 10. Taiga
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Dark earth with pine needle carpet | "dark boreal forest floor covered in brown pine needles, pixel art, top-down view" |
| L2 | Snow patches between trees, frozen puddles | "scattered white snow patches and small frozen puddles on transparent background, pixel art" |
| L3 | Low evergreen shrubs, winterberry | "low dark green evergreen shrubs and red winterberry clusters on transparent background, pixel art" |
| L4 | Pinecones, fallen bark, frozen twigs | "scattered pinecones and pieces of birch bark on transparent background, pixel art" |
| L5 | Gentle snowfall particles | "gentle falling snow particles on transparent background, sparse, pixel art" |

### 11. Mountains
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Grey craggy stone with natural fractures | "grey mountain rock surface with natural cracks and lichen patches, pixel art, top-down view" |
| L2 | Deep cracks, mineral veins, water seepage | "deep rock cracks with mineral veins and water seepage marks on transparent background, pixel art" |
| L3 | Hardy mountain plants, cliff flowers | "small hardy mountain plants and colorful cliff flowers in rock crevices on transparent background, pixel art" |
| L4 | Loose scree, fallen rocks, gravel | "scattered loose rock scree and fallen stone fragments on transparent background, pixel art" |
| L5 | Mountain mist, wind-blown particles | "thin mountain mist wisps and wind-blown particles on transparent background, pixel art" |

### 12. Swamp
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Dark murky mud with standing water | "dark murky swamp mud with patches of standing brown-green water, pixel art, top-down view" |
| L2 | Algae film, submerged roots | "green algae film and dark submerged root networks on transparent background, pixel art" |
| L3 | Reeds, cattails, moss hanging | "tall green swamp reeds and cattail plants on transparent background, pixel art" |
| L4 | Lily pads, fallen branches, debris | "scattered lily pads and waterlogged branch debris on transparent background, pixel art" |
| L5 | Swamp gas, mist, insect clouds | "green swamp mist and tiny insect swarm particles on transparent background, pixel art" |

### 13. Tropical Forest
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Rich dark soil with broad leaf litter | "rich dark tropical soil with large colorful fallen leaves, pixel art, top-down view" |
| L2 | Vine networks, puddles, mud | "sprawling vine networks and small tropical puddles on transparent background, pixel art" |
| L3 | Broad-leaf plants, orchids, ferns | "large tropical broad-leaf plants and colorful orchid flowers on transparent background, pixel art" |
| L4 | Fallen fruit, colorful beetles, seeds | "scattered fallen tropical fruits and colorful seeds on transparent background, pixel art" |
| L5 | Humid mist, floating butterflies | "humid tropical mist with colorful butterfly silhouettes on transparent background, pixel art" |

### 14. Volcanic
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Dark grey volcanic rock with lava cracks | REUSE: PixelLab `81944792` — already excellent |
| L2 | Glowing fissures, sulfur deposits | "glowing orange-red lava fissures and yellow sulfur crystal deposits on transparent background, pixel art" |
| L3 | Heat-resistant scrub, fire flowers | "small heat-resistant dark plants and glowing ember flowers on transparent background, pixel art" |
| L4 | Obsidian shards, pumice, ash clumps | "scattered black obsidian shards and grey pumice stones on transparent background, pixel art" |
| L5 | Rising embers, volcanic ash, heat haze | "rising orange ember particles and grey volcanic ash on transparent background, pixel art" |

### 15. Arctic
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | White-blue glacial ice with pressure cracks | "white-blue glacial ice surface with deep pressure cracks and blue shadows, pixel art, top-down view" |
| L2 | Deep crevasses, frozen bubbles | "deep blue ice crevasses and frozen air bubbles visible in ice on transparent background, pixel art" |
| L3 | Ice formations, frost crystals | "jagged ice crystal formations and hoarfrost structures on transparent background, pixel art" |
| L4 | Icicle fragments, snow clumps | "scattered broken icicle fragments and hard-packed snow clumps on transparent background, pixel art" |
| L5 | Diamond dust, aurora reflection | "sparkling diamond dust ice particles and faint aurora color reflections on transparent background, pixel art" |

### 16. Lake
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Clear still water with subtle depth | "clear calm lake water with subtle blue-green depth coloring, pixel art, top-down view" |
| L2 | Submerged rocks visible through water | "submerged rocks and pebbles visible through clear water on transparent background, pixel art" |
| L3 | Water lilies, floating algae | "water lily pads and small floating algae patches on transparent background, pixel art" |
| L5 | Light reflections, water striders | "white light reflections on water surface and tiny water strider insects on transparent background, pixel art" |
| L4 | Not used | — |

### 17. River
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Flowing water with directional current lines | "flowing river water with visible current lines and white rapids, pixel art, top-down view" |
| L2 | Submerged river rocks, sandy bottom | "submerged smooth river rocks on sandy bottom visible through water on transparent background, pixel art" |
| L5 | Splashing water droplets, mist | "water splash droplets and thin river mist on transparent background, pixel art" |
| L3, L4 | Not used | — |

### 18. Mystic
| Layer | Content | PixelLab Prompt |
|-------|---------|-----------------|
| L1 | Purple crystalline ground with glow | REUSE: PixelLab `54dc133e` — purple glowing crystal cave floor |
| L2 | Arcane rune patterns, energy veins | "glowing purple arcane rune patterns and energy vein lines on transparent background, pixel art" |
| L3 | Crystal growths, magical mushrooms | "growing purple and blue crystal formations and glowing magical mushrooms on transparent background, pixel art" |
| L4 | Scattered gemstones, enchanted fragments | "scattered glowing gemstones and broken enchanted crystal fragments on transparent background, pixel art" |
| L5 | Magical particles, floating runes | "floating purple magical energy particles and faint glowing rune symbols on transparent background, pixel art" |

## Generation Order

Priority order based on visual impact and biome frequency:

### Batch 1: Core Biomes (most land coverage)
1. Grassland (L1-L5)
2. Forest (L1-L5)
3. Desert (L1-L5)
4. Mountains (L1-L5)
5. Ocean (L1, L5)

### Batch 2: Climate Biomes
6. Tundra (L1-L5)
7. Taiga (L1-L5)
8. Arctic (L1-L5)
9. Savanna (L1-L5)
10. Tropical Forest (L1-L5)

### Batch 3: Special Biomes
11. Volcanic (L2-L5, L1 reused)
12. Mystic (L2-L5, L1 reused)
13. Swamp (L1-L5)
14. Steppe (L1-L5)
15. Dense Forest (L1-L5)

### Batch 4: Water Biomes
16. Lake (L1-L3, L5)
17. River (L1-L2, L5)
18. Beach (L1, L2, L4)

### Batch 5: Transitions (L1 only)
Key adjacency pairs from the biome adjacency graph:
- Ocean ↔ Beach
- Beach ↔ Grassland
- Grassland ↔ Forest
- Grassland ↔ Desert
- Grassland ↔ Steppe
- Grassland ↔ Tundra
- Forest ↔ Dense Forest
- Forest ↔ Swamp
- Desert ↔ Savanna
- Savanna ↔ Tropical Forest
- Steppe ↔ Mountains
- Mountains ↔ Arctic
- Mountains ↔ Volcanic
- Tundra ↔ Taiga
- Swamp ↔ Volcanic
- Lake ↔ Grassland (shore)
- River ↔ Grassland (bank)

## Total Generation Count (Phase 1)

| Category | Items | Tiles Each | Total Tiles |
|----------|-------|-----------|-------------|
| L1 base (16 fresh + 2 reuse) | 16 | 16 | 256 |
| L2-L5 overlays (~65 layers) | 65 | 16 | 1,040 |
| Transitions (~17 pairs) | 17 | 16 | 272 |
| **Total** | | | **1,568 tiles** |

At ~100 seconds per PixelLab generation (16 tiles each), that's ~98 generation jobs = ~2.7 hours of PixelLab processing time. Jobs can run in parallel.

## Non-Terrain Assets (Preserved)

Existing PixelLab objects (fences, windows, doors, characters) are NOT part of this spec. They remain in their current catalog locations and will be used by the object/building/character systems in separate specs. Nothing is deleted.
