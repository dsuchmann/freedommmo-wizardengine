# Field 2 Object Inventory

Base path: `assets/pixelab/landscape_v2/micro/small_flora/`

Config: `src/render/wang-image-list.js` → `SF_BIOME_OBJECTS_LIST`

## Arctic
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| frost_flower | 64 | 58 | ✅ | |
| frozen_grass | 0 | 1 | ✅ | No static sprites — only v000 animation |
| ice_needle | 64 | 1 | ✅ | Rigid (in RIGID_OBJECTS list) |

## Beach
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| beach_weed | 64 | 64 | ✅ | Full variant coverage |
| dune_grass | 64 | 64 | ✅ | Full variant coverage |
| sea_oat | 64 | 61 | ✅ | |

## Dense Forest
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| shade_fern | 64 | 1 | ✅ | |
| dark_herb | 64 | 59 | ✅ | |
| bracket_fungus | 64 | 1 | ✅ | Rigid (in RIGID_OBJECTS list) |

## Desert
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| sand_grass | 64 | 1 | ✅ | |
| desert_thorn | 64 | 1 | ✅ | ⚠️ Tile-shaped (solid bg, no alpha) — was removed from SF_BIOME_OBJECTS earlier |

## Forest
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| grass_blade_cluster | 64 | 62 | ✅ | |
| small_fern | 64 | 61 | ✅ | |
| clover_bloom | 64 | 63 | ✅ | |

## Grassland
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| tall_grass_blade | 64 | 54 | ✅ | Primary carpet grass |
| dandelion_stem | 64 | 62 | ✅ | Accent flower |
| wild_herb | 64 | 63 | ✅ | Accent herb |

## Hills
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| hillside_grass | 64 | 62 | ✅ | ⚠️ Tile-shaped (solid bg) — was removed from config earlier |
| rock_flower_bud | 64 | 64 | ✅ | ⚠️ Tile-shaped (solid bg) — was removed from config earlier |
| heather_sprig | 64 | 64 | ✅ | |

## Mountains
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| alpine_tuft | 64 | 1 | ✅ | |
| rock_cress | 64 | 1 | ✅ | Rigid (in RIGID_OBJECTS list) |
| hardy_lichen | 64 | 1 | ✅ | Rigid (in RIGID_OBJECTS list) |
| alpine_grass | 0 | 1 | ❌ | On disk but not in config |
| mountain_lichen | 0 | 1 | ❌ | On disk but not in config |

## Mystic
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| glow_grass_blade | 64 | 1 | ✅ | |
| aether_fern | 64 | 1 | ✅ | |
| crystal_sprout | 64 | 0 | ✅ | Rigid, no animation at all |

## Savanna
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| dry_grass_spike | 64 | 1 | ✅ | |
| thorn_sprout | 64 | 1 | ✅ | |
| acacia_seedling | 64 | 1 | ✅ | |

## Steppe
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| wind_grass | 64 | 1 | ✅ | |
| sparse_weed | 64 | 1 | ✅ | |
| dry_tuft | 64 | 1 | ✅ | Rigid (in RIGID_OBJECTS list) |
| dry_weed | 0 | 1 | ❌ | On disk but not in config |
| grass_wisp | 0 | 1 | ❌ | On disk but not in config |

## Swamp
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| bog_grass | 64 | 1 | ✅ | ⚠️ Tile-shaped (solid bg) — was removed from SF_BIOME_OBJECTS earlier |
| cattail_base | 64 | 1 | ✅ | ⚠️ Tile-shaped (dark bg) — was removed from SF_BIOME_OBJECTS earlier |
| swamp_herb | 64 | 1 | ✅ | |

## Taiga
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| frost_grass | 64 | 1 | ✅ | |
| low_juniper | 64 | 1 | ✅ | |
| cold_moss_tuft | 64 | 1 | ✅ | Rigid (in RIGID_OBJECTS list) |

## Tropical Forest
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| broad_fern | 64 | 1 | ✅ | |
| orchid_sprout | 64 | 1 | ✅ | |
| vine_tendril | 64 | 1 | ✅ | |

## Tundra
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| tundra_grass | 64 | 1 | ✅ | |
| low_berry_bush | 64 | 0 | ✅ | Rigid, no animation |
| ice_moss | 64 | 1 | ✅ | Rigid (in RIGID_OBJECTS list) |
| arctic_berry | 0 | 1 | ❌ | On disk but not in config |

## Volcanic
| Object | Static Sprites | Anim Variants | In Config | Notes |
|--------|---------------|---------------|-----------|-------|
| ash_grass | 64 | 1 | ✅ | ⚠️ Tile-shaped (solid bg) — was removed from SF_BIOME_OBJECTS earlier |
| heat_sprout | 64 | 1 | ✅ | |
| lava_fern | 0 | 1 | ✅ | No static sprites — only v000 animation |

## Summary of Issues

### Tile-shaped objects (solid background, no alpha) — still in config:
- `desert/desert_thorn` — in config but tile-shaped
- `hills/hillside_grass` — in config but tile-shaped
- `hills/rock_flower_bud` — in config but tile-shaped
- `swamp/bog_grass` — in config but tile-shaped
- `swamp/cattail_base` — in config but tile-shaped
- `volcanic/ash_grass` — in config but tile-shaped

### Objects with no static sprites (animation only):
- `arctic/frozen_grass` — 0 static, 1 anim variant
- `volcanic/lava_fern` — 0 static, 1 anim variant

### Objects on disk but not in config:
- `mountains/alpine_grass`
- `mountains/mountain_lichen`
- `steppe/dry_weed`
- `steppe/grass_wisp`
- `tundra/arctic_berry`

### Rigid objects (should NOT sway):
Currently in RIGID_OBJECTS: ice_needle, crystal_sprout, hardy_lichen, rock_cress, low_berry_bush, bracket_fungus, dry_tuft, cold_moss_tuft, ice_moss
