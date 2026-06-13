# Floor Asset Manifest — Complete Enumeration

**Date:** 2026-06-13
**Format:** Wang tilesets, 16 tiles each, 32×32 px, high top-down
**States:** Each material × each state = one Wang tileset
**Total:** ~64 materials × ~8 states = ~512 Wang tilesets = ~8,192 individual tiles

## Floor Materials (64 types)

### Common (any race, any biome)
1. wood_plank_light — light pine/birch planks
2. wood_plank_dark — dark oak/walnut planks
3. wood_plank_old — aged grey weathered planks
4. wood_plank_painted — painted color planks
5. wood_parquet — herringbone pattern
6. wood_log_cabin — round log cross-sections
7. stone_slab_grey — standard grey stone slabs
8. stone_slab_brown — brown/tan stone slabs
9. stone_slab_dark — dark basalt slabs
10. stone_flagstone — large irregular flagstones
11. stone_cobble — small rounded cobblestones
12. stone_brick — rectangular stone bricks
13. stone_mosaic — decorative stone mosaic pattern
14. marble_white — polished white marble
15. marble_black — polished black marble
16. marble_veined — grey with white veins
17. marble_checkered — black and white alternating
18. tile_ceramic_terracotta — warm terracotta tiles
19. tile_ceramic_blue — blue glazed tiles
20. tile_ceramic_green — green glazed tiles
21. tile_ceramic_mosaic — multicolor mosaic
22. packed_dirt — hard-packed brown dirt
23. packed_clay — reddish clay floor
24. gravel — loose small stones
25. sand — sandy floor
26. hay_straw — straw-covered floor (barn/stable)
27. rush_mat — woven rush matting
28. reed_mat — dried reed mat
29. carpet_wool_red — red wool carpet
30. carpet_wool_blue — blue wool carpet
31. carpet_wool_green — green wool carpet
32. carpet_wool_patterned — geometric pattern wool
33. carpet_silk_gold — golden silk carpet
34. carpet_silk_purple — royal purple silk carpet
35. carpet_runner — narrow carpet strip on stone
36. hide_leather — animal hide floor covering
37. metal_grate — iron grating (industrial/dungeon)
38. metal_plate — solid iron plates
39. metal_riveted — riveted steel plates
40. glass_panel — transparent glass floor (rare)
41. brick_red — red clay bricks
42. brick_herringbone — herringbone brick pattern
43. thatch — woven thatch floor
44. bamboo — bamboo slat floor

### Race-specific
45. crystal_clear — transparent crystal (Veylith)
46. crystal_purple — amethyst crystal (Veylith)
47. crystal_resonant — glowing crystal with veins (Veylith)
48. volcanic_obsidian — black obsidian glass (Ignaar)
49. volcanic_basalt — dark rough basalt (Ignaar)
50. volcanic_ember — cracked stone with ember glow (Ignaar)
51. moss_thick — thick green moss carpet (Grotharn)
52. moss_bioluminescent — glowing moss (Grotharn)
53. living_root — interwoven tree roots (Sylvari)
54. living_bark — living bark platform (Sylvari)
55. living_leaf — layered leaves (Sylvari)
56. carved_granite — precision-carved granite (Kaldreth)
57. carved_rune — stone with carved runes (Kaldreth)
58. carved_relief — stone relief carvings (Kaldreth)
59. sand_packed — hard-packed desert sand (Ashren)
60. sand_mosaic — sand-stone tile mosaic (Ashren)
61. ice_smooth — polished ice (Frostwyn)
62. ice_frosted — frosted ice with patterns (Frostwyn)
63. driftwood_bleached — sun-bleached driftwood (Thalori)
64. coral_tile — coral and shell composite (Thalori)

## Floor States (8 per material)

Each material can exist in these states. Each state is a separate Wang tileset.

1. **normal** — pristine/standard condition
2. **worn** — visible wear, scratches, faded areas
3. **dirty** — stained, muddy footprints, grime
4. **damaged** — cracked, broken tiles, missing planks
5. **burned** — charred, blackened, ember marks
6. **frozen** — ice crystals, frost coating, frozen over
7. **flooded** — shallow water puddles, wet surface
8. **overgrown** — moss/grass/vines growing through cracks

## PixelLab Generation Parameters

```
tile_size: { width: 32, height: 32 }
view: "high top-down"
detail: "highly detailed"
shading: "detailed shading"
outline: "lineless"
transition_size: 0   (uniform floor, no terrain transitions)
```

Lower and upper descriptions should be identical (same material everywhere).
Describe the state explicitly in the prompt for non-normal states.

Example prompts:
- normal: "dark oak wood plank floor, aged boards with visible grain, warm brown tones, interior building floor, pixel art RPG"
- burned: "dark oak wood plank floor, charred and blackened by fire, ember marks, scorched boards, pixel art RPG"
- frozen: "dark oak wood plank floor covered in frost and ice crystals, frozen surface, pixel art RPG"

## Priority Order

Generate in this order (most common first):
1. wood_plank_dark (normal) — DONE (pilot)
2. stone_slab_grey (normal)
3. packed_dirt (normal)
4. cobblestone (normal)
5. marble_white (normal)
6. tile_ceramic_terracotta (normal)
7. carpet_wool_red (normal)
8. hay_straw (normal)
Then: all race-specific normals, then worn/damaged states for common materials.
