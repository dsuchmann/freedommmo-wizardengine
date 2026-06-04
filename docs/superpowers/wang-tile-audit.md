# Wang Tile Base ID Audit

Generated: 2026-06-04
Total tilesets: 327
Completed: 294
Failed: 33

---

## Summary Statistics

- **Unique lower base tile IDs**: ~280+ (most are unique per tileset)
- **Unique upper base tile IDs**: ~280+ (most are unique per tileset)
- **Shared base tile IDs (appearing in 2+ tilesets)**: ~25 key IDs
- **Failed tilesets**: 33 (generation failed, no base tile IDs)
- **Non-chainable tilesets**: 10 (early tilesets with base_tile_id = 0 or 15)

---

## CRITICAL FINDING: Most-Shared Base Tile IDs

These base tile IDs appear across MULTIPLE tilesets, forming the backbone of the chaining network.

### c9ce4900-726d-4b56-bb5c-9aa2fc3d191a — "Lush Green Grass"
**THE most connected base tile ID in the entire system.**
Appears as LOWER in: 42af6def, 2af5471f, 23918e9d, 765a77e2, bdda3c47, 0b45f1bd, 1e1af15b, 4af16ecf, e59e2eae, 109058ce, c046debc, bedc7601, f598746b
Appears as UPPER in: fe3a0b98, ec9485e2, ce2f599c, f425beec, b36d7e93

### 997894f5-3f3c-4d50-839e-2e32fa166a71 — "Dark Forest Floor (fallen leaves/moss)"
**Second most connected.**
Appears as LOWER in: 0985d8f1, fc3994f7, c1169ca6, f8bd896d, 8c4f3e09, 9132bc26, 4675f90b, 4a637d34, 411c7949, 6872ffb0, 948b7154
Appears as UPPER in: 8c7dbe6f, ef7a671b, 87379f10, 9f9aa331, e59e2eae, c046debc, aa48417e

### dc51d808-a3d4-4025-997e-75af468bcac9 — "Rocky Hills (scattered stones/sparse grass)"
Appears as LOWER in: fbf14df9
Appears as UPPER in: bcc5b107, 1e0da838, e1906161, be3af850, 023eb8c9, 21672751, fc3994f7, 427943e1

### 71ed06d0-8c84-453c-a5a4-5c59e4522e54 — "Arid Desert Sand"
Appears as LOWER in: 2dc580dc, 023eb8c9
Appears as UPPER in: 42af6def, a9d51e2f

### 14b79358-c430-43a4-a043-c20fb0e5b904 — "Dry Golden Savanna Grass"
Appears as LOWER in: be3af850, ffaaef83
Appears as UPPER in: 0985d8f1, 765a77e2

### b5d6431c-1397-43f8-8594-7d2b8fb09885 — "Glowing Mystic Purple Ground"
Appears as UPPER in: 1339d6b6, 7f4f7f97, c1169ca6, 23918e9d

### 098c093b-1d5f-4f91-9dfc-cacc9f4cffff — "Taiga Forest Floor (pine needles/frost)"
Appears as LOWER in: 5461c6ec, 21672751
Appears as UPPER in: 2af5471f, 74465425

### 4157436e-8eb7-4cae-b747-f38f0f9def27 — "Grey Mountain Rock (snow patches/gravel)"
Appears as LOWER in: 90d90f8a
Appears as UPPER in: 3ea5dec6, 5461c6ec

### abfe8223-2ffa-45b2-89ca-63308625acc5 — "Dark Volcanic Rock (lava cracks)"
Appears as UPPER in: 90d90f8a, fbf14df9, 2dc580dc

### e6bf01fc-1a4e-40c5-b242-e3bdef4e01e3 — "Flowing River Water"
Appears as LOWER in: 427943e1, ef7a671b, 7dfe8675
Appears as UPPER in: fb451b1d

### a267b749-1927-4d39-b73d-06a39301013d — "Wet Brown Swamp Mud"
Appears as LOWER in: 1ec39fec, feac7d2b, d5527906, f598746b, 948b7154, 74465425
Appears as UPPER in: 41874432, 703eb37f

### 0a7ad061-3ecc-4716-9864-2ef4078e59df — "Dry Sandy Beach"
Appears as LOWER in: bcc5b107, 8c7dbe6f, fb451b1d
Appears as UPPER in: fa67668c

### 96bbf35d-517e-40fd-998b-99cc783f90ad — "Grey Layered Stone Rock Surface"
Appears as LOWER in: dedb871f, 50b0915a
Appears as UPPER in: 7966e996, d83666e3, 4675f90b, 5204eafd, d0082347

### e0cd062c-163b-4344-97a7-4d5ed8051b80 — "Blue-White Glacial Ice Surface"
Appears as LOWER in: c303819b
Appears as UPPER in: dedb871f, 74c9aca9

### 76153afd-8cde-4d31-933b-4078a2633463 — "White Snow and Ice Surface"
Appears as UPPER in: c303819b, 50b0915a, 8c30af01, abd51b4e

### f60eac53-8ad5-4652-9ee7-ed4301eb1685 — "Dry Golden-Brown Grass and Dirt"
Appears as LOWER in: 411c7949, 5204eafd
Appears as UPPER in: bedc7601, 1ef800e9, b3ebf4ec

### c83f7b4b-20cf-476b-9fde-88f345d91ae9 — "Dark Frozen Permafrost Earth"
Appears as LOWER in: 6872ffb0, 8c30af01
Appears as UPPER in: 109058ce, f3213083

### d61408d5-f007-4519-a382-0fb95f6dd787 — "Golden Sandy Beach Surface"
Appears as LOWER in: 1ef800e9, f425beec
Appears as UPPER in: 7a0ddd2a, 7a4205af

### 390aaa3d-4d3a-401b-83a1-9c8221d339a1 — "Very Dark Decomposing Earth (mushrooms)"
Appears as UPPER in: 4a637d34, 5a42c10b

### 72d37b69-fd50-49bb-910d-08693949838b — "Grey Craggy Mountain Rock"
Appears as LOWER in: 90690476, 6e33396d, ce72428f
Appears as UPPER in: ec6861e4, 50c7a571, 72c2af13

### 26c7450c-1759-4f9d-aef5-790dc60cf0ad — "Lush Green Grassland (variant)"
Appears as LOWER in: a2dc5484, dc2bb4bb, 47ff7382, 1b81ce26
Appears as UPPER in: 21ffae32, ac280f19

### e7e0c590-42a3-44af-b0db-4e479514813e — "Dark Forest Floor (variant)"
Appears as LOWER in: 72c2af13, 3f7e9b46
Appears as UPPER in: 47ff7382, 07a17a8c

### ff24884a-a9b1-410a-91fd-5030bde4e665 — "Frozen Grey-Brown Tundra Permafrost"
Appears as LOWER in: 627ba760, 0dfd68a8
Appears as UPPER in: a2dc5484, 5a6a0efb

### ea411cc1-26b4-474b-91b8-3458323758fb — "Lush Green Grass Field (lineless style)"
Appears as LOWER in: 5e1bbce9, 4640e741, bbf53f44, bbef15c1
Appears as UPPER in: 390c21bc, ca298435, d518db08

### d6b47bdb-a9bd-473f-b5eb-23121fa5160a — "Dark Volcanic Rock (lava cracks, variant)"
Appears as LOWER in: d83666e3
Appears as UPPER in: 7554c257

### fe402696-ef5a-4b95-a694-c3b39dbe06fe — "Glowing Purple Mystic Crystal Surface"
Appears as LOWER in: 7966e996
Appears as UPPER in: ec1782b7

### c9b2466b-0c35-4a4a-aee5-60ceb417ae2a — "White-Blue Glacial Ice (pressure cracks)"
Appears as LOWER in: 0ac92777, 2ae47592
Appears as UPPER in: ac639b06

### 5ccd5c36-88e3-4cd6-990e-70a3135f4068 — "Calm Blue Lake/Ocean Water (lineless)"
Appears as LOWER in: 28461bd8, 390c21bc, 934fb234

### be7bc5cb-3433-4a13-a0ff-24e70b924e61 — "Dark Boreal Taiga Floor"
Appears as LOWER in: 4fc59d6e
Appears as UPPER in: 0dfd68a8

### 1a6c5646-e2e8-4934-b203-cc24b8760cce — "Dark Forest Floor (dense variant)"
Appears as LOWER in: 28df4cfc
Appears as UPPER in: 3f7e9b46

### c3f64243-156e-4bc1-9e98-13ca463a2d29 — "Dry Golden Savanna Grass (red earth)"
Appears as LOWER in: 1f330b67
Appears as UPPER in: 6e1a58d2, a684e2c0

### 868e5018-a6de-4008-bb79-2267dc1fc3d2 — "Short Windswept Steppe Grass"
Appears as LOWER in: ce72428f
Appears as UPPER in: 445aba55

### 10e7d7c2-191e-4a04-a4a6-dec773c43e61 — "Short Windswept Steppe Grass (variant)"
Appears as LOWER in: 445aba55
Appears as UPPER in: 1b81ce26

---

## Biome Cluster Analysis

### GRASSLAND Biome — FRAGMENTED (Multiple IDs)
| Base Tile ID | Description | Style |
|---|---|---|
| c9ce4900 | lush green grass meadow with individual blades | lineless, medium detail |
| 26c7450c | lush green grassland with individual blades | detailed shading |
| ea411cc1 | lush green grass field | lineless, medium shading |
| 4e8b7a63 | lush green grass with small blades | detailed shading |
| 66edb624 | rich green grass meadow | highly detailed |
| b3ca73f1 | green grassland with lush short grass | selective outline |
| 0dd5c8c7 | green grassland with short grass blades | selective outline |
| 665bb8ea | CrossCode-quality lush green grass | lineless, highly detailed |
| 93f550b9 | lush green grass with clovers/wildflowers | detailed shading |
| 1058f92a | lush green grass with wildflowers | selective outline |
| 777d60d9 | lush green grassland with short grass | detailed shading |
| 821f1020 | lush green grass with dandelions | detailed shading |
| 9f789131 | lush vibrant green grass with wildflowers | detailed shading |

**INCONSISTENCY: 13+ different base tile IDs for the "green grass" concept.** The most connected one is `c9ce4900` (appears in ~18 tilesets). But many newer tilesets use unique grass IDs that don't chain to anything.

### DARK FOREST FLOOR Biome — MODERATE FRAGMENTATION
| Base Tile ID | Description |
|---|---|
| 997894f5 | dark forest floor with fallen leaves and moss |
| e7e0c590 | dark forest floor with fallen leaves and moss (variant) |
| 1a6c5646 | dark forest floor (dense variant) |
| 6fbbe395 | dark forest floor with moss, fallen leaves, dark soil |
| b2072452 | dark forest floor with brown dirt, fallen leaves, moss patches |
| 9e24ece1 | dark forest floor with rich brown dirt, moss, fallen leaves |
| 8de633b6 | dense dark forest floor with fallen leaves and twigs |
| aba06b68 | dark forest floor with moss and roots |

**INCONSISTENCY: 8+ different base tile IDs.** The most connected is `997894f5` (11+ tilesets lower, 7+ upper). But at least 7 other IDs represent essentially the same biome concept.

### DESERT/SAND Biome — FRAGMENTED
| Base Tile ID | Description |
|---|---|
| 71ed06d0 | arid desert sand |
| 51164b1a | dry golden desert sand |
| c1d8d8db | golden desert sand with wind ripples |
| e4e92cdd | dry sandy desert with slightly darker sand |
| 65aff98f | dry sandy desert with golden sand |
| ee6160f4 | golden sand desert with fine grain texture |
| e4ffbd3b | CrossCode sandy desert |

**INCONSISTENCY: 7+ different IDs for desert sand.**

### SNOW/ICE Biome — FRAGMENTED
| Base Tile ID | Description |
|---|---|
| 76153afd | white snow and ice surface |
| 00d94b20 | white snow field with subtle blue shadows |
| 27ff1470 | white snow field with subtle blue shadows (variant) |
| a33ba899 | white snow cover with wind-swept drifts |
| 677a46eb | white snow cover with wind-swept drifts (variant) |
| 4b321284 | white snow cover with wind-swept drifts (variant 2) |
| 62a7cb5f | white snow covered ground |
| 64f25cce | snowy tundra with white snow cover |
| 00749a1b | white snow with footprints |
| 90bffe09 | white snow with ice crystals |
| 02655816 | white snow covering with footprint impressions |

**INCONSISTENCY: 11+ different IDs for snow.**

### MOUNTAIN ROCK Biome — FRAGMENTED
| Base Tile ID | Description |
|---|---|
| 72d37b69 | grey craggy mountain rock with moss/mineral veins |
| 96bbf35d | grey layered stone rock surface |
| 8b05c227 | grey mountain rock surface |
| e866fe74 | gray rocky mountain terrain |
| 6423dc1d | rocky mountain terrain |
| 055166c8 | grey mountain rock with cracks/lichen |
| 65be45b6 | grey mountain rock variant |
| 996313cb | grey stone and rocky terrain with moss |

**INCONSISTENCY: 8+ different IDs for mountain rock.**

### SWAMP/MUD Biome — MODERATE FRAGMENTATION
| Base Tile ID | Description |
|---|---|
| a267b749 | wet brown swamp mud with puddles/peat (MOST CONNECTED - 8 tilesets) |
| a77f6274 | murky dark swamp |
| 641d4fc7 | dark murky swamp water with lily pads |
| 8676f6eb | dark murky swamp water |
| 977b38a2 | murky green swamp water |
| b97bcefa | dark murky swamp water with algae |

### VOLCANIC Biome — MODERATE FRAGMENTATION
| Base Tile ID | Description |
|---|---|
| abfe8223 | dark volcanic rock with glowing orange lava cracks (3 tilesets) |
| d6b47bdb | dark volcanic rock variant (2 tilesets) |
| 9d5c96a5 | dark grey volcanic rock |
| 14de9e21 | dark volcanic rock (detailed) |

### BEACH Biome — FRAGMENTED
| Base Tile ID | Description |
|---|---|
| 0a7ad061 | dry sandy beach (4 tilesets) |
| d61408d5 | golden sandy beach surface (4 tilesets) |
| 75ba5709 | golden sandy beach with fine grain texture |
| 3396105f | golden sandy beach with fine grain texture (variant) |
| d04e1ef8 | golden sandy beach (variant) |
| 721d581c | golden sandy beach (lineless) |
| 37cad6e7 | sandy beach with shells |
| ecf2c75c | sandy beach with shells, driftwood |
| a1b9bc76 | dry sandy beach (variant) |

**INCONSISTENCY: 9+ different IDs for beach.**

---

## Orphan Base Tile IDs

Base tile IDs that appear in ONLY ONE tileset (not connected to anything else through chaining). This is the vast majority -- approximately **240+ base tile IDs are orphans**.

Notable categories of orphans:
1. **All overlay/decoration tilesets** (offsets 200-270): Each has unique lower and upper IDs for transparent-background overlays (lily pads, snow particles, embers, etc.). These are EXPECTED orphans since they layer over terrain.
2. **Self-referencing tilesets** (same terrain for upper and lower): ~15 tilesets reference themselves for variation within a biome. Examples: 7ece5e4b (grey stone), 0e58bc15 (forest floor), c597a484 (glacial ice), 6e8444f1 (snow), etc.
3. **Cliff face tilesets**: All cliff cross-section tilesets have unique IDs.
4. **"Style 4" tilesets** (offsets 280-327): Recent tilesets with selective-outline and lineless styles that created entirely new ID chains.
5. **Early non-chainable tilesets** (offsets 0-9): Use simple integer IDs (0, 15) instead of UUIDs.

---

## Failed Tilesets (33 total)

These need to be deleted and recreated:

| Tileset ID | Description |
|---|---|
| 0700877d | brown forest floor -> ? |
| 2f51ba8b | forest floor -> ? |
| 6f95a842 | flowing river water -> ? |
| 35614bf0 | shallow clear water -> ? |
| 7ac92165 | purple glowing mystic crystal ground -> ? |
| 4406a25e | frozen brown permafrost earth -> ? |
| 12bf900f | murky green-brown swamp mud -> ? |
| 6bf4437d | dark brown rich humus soil -> ? |
| b923d5e9 | golden sandy desert ground -> ? |
| 6e6c2bd1 | dark charred volcanic rock -> ? |
| b3a97d0b | frozen brown permafrost earth -> ? |
| 64b6fa60 | white snow field -> ? |
| 7aaebd00 | dry yellowed grass and earth -> ? |
| 430e55bf | deep blue ocean water -> ? |
| ac2beaf1 | dark brown forest floor -> ? |
| 07d1d05f | grey mountain rock -> ? |
| c488683e | lush green grass meadow -> ? |
| c36c5daf | lush green grass meadow -> ? |
| 9f0edb75 | golden sandy beach ground -> ? |
| 580c423d | white snow cover -> ? |
| f558e06a | submerged smooth river rocks -> ? |
| 36cc9ede | water lily pads -> ? |
| 401da2f7 | jagged ice crystal formations -> ? |
| 03179a8c | thick green moss carpet -> ? |

---

## Chaining Network Analysis

### Well-Connected Hub IDs (appear in 5+ tilesets)

1. **c9ce4900** (grass) - ~18 connections - THE hub
2. **997894f5** (forest floor) - ~18 connections
3. **a267b749** (swamp mud) - ~8 connections
4. **dc51d808** (rocky hills) - ~9 connections
5. **96bbf35d** (layered stone) - ~7 connections
6. **76153afd** (snow/ice) - ~4 connections
7. **e6bf01fc** (river water) - ~4 connections
8. **0a7ad061** (sandy beach) - ~4 connections
9. **72d37b69** (mountain rock) - ~6 connections
10. **ea411cc1** (grass field lineless) - ~7 connections
11. **f60eac53** (dry grass/dirt) - ~5 connections
12. **d61408d5** (sandy beach surface) - ~4 connections

### Style-Isolated Chains

Several art style families create their OWN chaining networks that don't connect to the main network:

1. **"Selective outline" chain** (offsets ~300-327): Uses entirely new base IDs
2. **"Lineless medium" chain** (offsets ~280-300): Uses ea411cc1, 5ccd5c36, 8b05c227 etc.
3. **"Low top-down" chain** (offsets ~112-116): Uses cf610e9d, ad146b41 etc.
4. **"Highly detailed" solo chain** (offsets ~128-148): Uses unique IDs per tileset

### Key Recommendation

The primary chainable network centers on these hub IDs:
- **c9ce4900** (green grass) as the universal "ground truth" terrain
- **997894f5** (dark forest floor) as the forest hub
- **dc51d808** (rocky hills) as the transition terrain
- **a267b749** (swamp mud) as the wetland hub
- **96bbf35d** (grey stone) as the mountain/cave hub

Any new tilesets should reference these IDs to maintain chain connectivity. The fragmentation across 13+ grass IDs means most grass tilesets can NOT chain to each other -- only those sharing c9ce4900 or 26c7450c can interconnect.
