# Field 1 Ground Cover Audit Results

**Date:** 2026-06-07
**Source:** Visual inspection of 6 variants per object across all 48 object types (16 biomes)

## Mode Distribution
- LUMINANCE (fills tile, texture blending): 9 objects (19%)
- SPRITE (discrete placed objects): 39 objects (81%)

## Per-Biome Configuration

### Arctic
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| frost_pattern | LUMINANCE | — | 100% | 32px | Continuous icy surface |
| ice_crystals | SPRITE | scattered_even | 15-25% | 12-18px | Individual ice formations |
| snow_crust | SPRITE | patchy_groups | 20-30% | 16-20px | Hardened snow patches |

### Beach
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| wet_sand | LUMINANCE | — | 100% | 32px | Wet sand gradient, directional swirl |
| sea_foam | SPRITE | near_water | 25-35% | 14-18px | Concentrates at water edge |
| tide_line | SPRITE | near_water | 15-25% | 18-24px | Line of debris at tide mark |

### Dense Forest
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| dark_leaf_mat | LUMINANCE | — | 100% | 32px | Thick decomposing leaf carpet |
| dark_wet_moss | SPRITE | patchy_groups | 20-30% | 14-18px | Damp moss in shade |
| fungal_film | SPRITE | scattered_even | 15-25% | 12-16px | Fungi in dark moist areas |

### Desert
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| sand_ripple | LUMINANCE | — | 100% | 32px | Wind-formed ripple pattern |
| cracked_clay | SPRITE | patchy_groups | 15-25% | 16-20px | Dried clay cracks |
| dust_drift | SPRITE | scattered_even | 20-30% | 14-18px | Wind-driven dust |

### Forest
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| fallen_leaves | SPRITE | scattered_even | 20-30% | 14-18px | Seasonal leaf fall |
| moss_patch | SPRITE | patchy_groups | 15-25% | 14-18px | Cool moist areas |
| pine_needles | SPRITE | scattered_even | 25-35% | 12-16px | Needle carpet |

### Grassland
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| grass_mat | SPRITE | scattered_even | 30-40% | 14-18px | Primary ground cover |
| clover_patch | SPRITE | patchy_groups | 15-25% | 14-18px | Clusters naturally |
| golden_thatch | SPRITE | scattered_even | 25-35% | 16-20px | Dried grass tufts |

### Hills
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| hillside_grass | SPRITE | scattered_even | 25-35% | 14-18px | Sparse on slopes |
| flat_stone | SPRITE | scattered_even | 20-30% | 16-20px | Exposed stones |
| brown_moss | SPRITE | patchy_groups | 15-25% | 14-18px | Shaded hillsides |

### Mountains
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| lichen_crust | LUMINANCE | — | 100% | 32px | Rock-covering lichen |
| frost_crystals | SPRITE | scattered_even | 10-20% | 12-16px | Sparse at altitude |
| gravel_scatter | SPRITE | scattered_even | 30-40% | 12-16px | Abundant loose rock |

### Mystic
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| glowing_moss | SPRITE | patchy_groups | 10-20% | 14-18px | Bioluminescent |
| aether_tendril | SPRITE | scattered_even | 15-25% | 14-18px | Magical wisps |
| crystal_dust | SPRITE | scattered_even | 20-30% | 10-14px | Crystalline particles |

### Savanna
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| golden_grass_tuft | SPRITE | patchy_groups | 20-30% | 14-18px | Dry grass clumps |
| cracked_earth | SPRITE | patchy_groups | 15-25% | 16-20px | Drought cracks |
| seed_husks | SPRITE | scattered_even | 15-25% | 10-14px | Dispersed seeds |

### Steppe
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| pale_grass_wisps | SPRITE | scattered_even | 10-20% | 10-14px | Very sparse, filter empty variants |
| dust_patch | SPRITE | patchy_groups | 15-25% | 14-18px | Windblown dust |
| dried_stems | SPRITE | scattered_even | 20-30% | 12-16px | Dead plant stems |

### Swamp
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| algae_film | SPRITE | patchy_groups | 15-25% | 14-18px | Stagnant water areas |
| sphagnum_moss | SPRITE | patchy_groups | 20-30% | 14-18px | Moss hummocks |
| waterlogged_leaf | SPRITE | scattered_even | 20-30% | 12-16px | Decomposing leaves |

### Taiga
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| frost_pine_needles | LUMINANCE | — | 100% | 32px | Frozen needle litter |
| frost_lichen | SPRITE | scattered_even | 15-25% | 14-18px | Hardy lichen |
| bark_chips | SPRITE | patchy_groups | 20-30% | 14-18px | Forest floor bark |

### Tropical Forest
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| tropical_leaves | SPRITE | scattered_even | 20-30% | 14-18px | Constant leaf fall |
| bright_green_moss | SPRITE | patchy_groups | 15-25% | 14-18px | Humid environment |
| fern_fronds | SPRITE | scattered_even | 15-25% | 14-18px | Abundant understory |

### Tundra
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| frozen_moss | SPRITE | patchy_groups | 10-20% | 14-18px | Sparse in harsh conditions |
| ice_crust | SPRITE | scattered_even | 15-25% | 16-20px | Permafrost patches |
| dead_lichen | SPRITE | scattered_even | 15-25% | 12-16px | Dormant lichen |

### Volcanic
| Object | Mode | Pattern | Density | Scale | Notes |
|--------|------|---------|---------|-------|-------|
| ash_film | SPRITE | scattered_even | 20-30% | 12-16px | Settled volcanic ash |
| char_crust | SPRITE | patchy_groups | 15-25% | 12-16px | Charred earth |
| pumice_dust | SPRITE | scattered_even | 10-20% | 8-12px | Light pumice, filter micro-variants |

## Variants Requiring Attention
- steppe/pale_grass_wisps v000, v040, v050: extremely sparse
- volcanic/pumice_dust v012-v018: too small
- tundra/frozen_moss v006: wrong color (warm brown), v011: black anomaly
- tropical_forest/bright_green_moss v040: star-shaped artifact
