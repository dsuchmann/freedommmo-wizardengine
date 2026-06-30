// src/world/field-tuning-defaults.js
// Source = user in-game calibration 2026-06-12
// (docs/superpowers/specs/2026-06-12-field-calibration.json)
// The tuner's live tree deep-merges OVER these defaults.
// Re-export from the tuner and re-bake here to update.
// Empty objects (f3, most f4 biomes) are pruned — they are all 1.0 / enabled.
// Note: f5 `anims:{wind_sway:false}` entries implement the F5 no-wind-anims policy.

export var DEFAULT_FIELD_TUNING = {
  f2: {
    biomes: {
      dense_forest: {
        objects: {
          shade_fern: { density: 1.35 },
          dark_herb: { density: 1.45, size: 0.95 },
          bracket_fungus: { size: 0.65, density: 0.85 }
        }
      },
      beach: {
        objects: {
          beach_weed: { density: 0.2 },
          dune_grass: { density: 0.6 },
          sea_oat: { density: 0.5 }
        }
      }
    }
  },
  f3: { size: 2.0 }, // small_scatter base scales (~0.32) are too small at 1.0; 2.0 → ~20px, visible ground scatter
  f4: {
    biomes: {
      arctic: {
        objects: {
          crystal_rose: { size: 0.65 },
          frost_bloom: { size: 0.3 },
          ice_flower: { density: 1, size: 0.75 }
        }
      },
      dense_forest: {
        objects: {
          ghost_orchid: { density: 1.3, size: 0.95 },
          giant_mushroom: { size: 0.65, density: 1 },
          shelf_fungus: { size: 0.95, density: 0.55 }
        }
      },
      beach: {
        objects: {
          dune_daisy: { size: 1 }
        }
      }
    }
  },
  f5: {
    biomes: {
      taiga: {
        objects: {
          frost_stump: { size: 1.5, density: 0.2 },
          ice_log: { size: 0.55, density: 0.95 },
          snow_rock: { size: 1.15, density: 0.8 }
        }
      },
      arctic: {
        objects: {
          frozen_ruin: { size: 1.75, density: 0.15, anims: { wind_sway: false } },
          ice_formation: { size: 0.95, density: 1.4, anims: { wind_sway: false } },
          snow_drift_mound: { size: 0.55, anims: { wind_sway: false }, density: 0.3 }
        }
      },
      beach: {
        objects: {
          anchor_relic: { size: 0.3, anims: { wind_sway: false } },
          beached_log: { anims: { wind_sway: false } },
          tide_pool_rock: { size: 0.85, anims: { wind_sway: false } }
        }
      },
      dense_forest: {
        objects: {
          hollow_stump: { size: 1.05, density: 0.75, anims: { wind_sway: false } },
          root_mound: { size: 0.55 },
          rotting_log: { size: 0.5 }
        }
      },
      desert: {
        objects: {
          bleached_skull: { size: 0.9, density: 0.05, anims: { wind_sway: false } },
          clay_pot_shard: { size: 0.25, density: 0.4, anims: { wind_sway: false } },
          sandstone_formation: { size: 0.7, anims: { wind_sway: false } }
        }
      },
      forest: {
        objects: {
          fallen_log: { size: 0.75, density: 0.2, anims: { wind_sway: false } },
          mossy_boulder: { size: 0.75, density: 0.75, anims: { wind_sway: false } },
          tree_stump: { size: 1.05, density: 0.2, anims: { wind_sway: false } }
        }
      },
      grassland: {
        objects: {
          fence_post: { anims: { wind_sway: false }, size: 1.05, density: 0.15 },
          field_boulder: { anims: { wind_sway: false }, size: 0.85, density: 0.45 },
          hay_bale: { anims: { wind_sway: false }, density: 0.55, size: 0.35 }
        }
      },
      hills: {
        objects: {
          granite_outcrop: { size: 1.05, density: 0.05, anims: { wind_sway: false } },
          old_milestone: { size: 1.2, anims: { wind_sway: false }, density: 0.05 },
          stone_pile: { anims: { wind_sway: false }, size: 1.15, density: 0.1 }
        }
      },
      mountains: {
        objects: {
          cliff_fragment: { size: 0.7, density: 0.25, anims: { wind_sway: false } },
          frozen_cairn: { size: 1.15, density: 0.6, anims: { wind_sway: false } },
          ice_boulder: { anims: { wind_sway: false }, size: 0.85, density: 0.2 }
        }
      },
      mystic: {
        objects: {
          ancient_altar: { size: 1.05, density: 0.05, anims: { wind_sway: false } },
          crystal_cluster: { density: 0.65, size: 0.75, anims: { wind_sway: false } },
          rune_stone: { density: 0.05, size: 1.15, anims: { wind_sway: false } }
        }
      },
      savanna: {
        objects: {
          bone_pile: { density: 0.5, size: 0.75 },
          dry_well: { size: 0.75, density: 0.05 },
          termite_mound: { size: 0.9, density: 0.15 }
        }
      },
      steppe: {
        objects: {
          buried_post: { size: 1.1, density: 0.45, anims: { wind_sway: false } },
          stone_cairn: { size: 1.15, density: 0.35, anims: { wind_sway: false } },
          wind_rock: { anims: { wind_sway: false }, size: 1.05, density: 0.05 }
        }
      },
      swamp: {
        objects: {
          bog_log: { anims: { wind_sway: false }, size: 0.5, density: 0.35 },
          mud_mound: { anims: { wind_sway: false }, size: 0.95 },
          rotting_dock: { anims: { wind_sway: false }, density: 0.1, size: 0.7 }
        }
      },
      tropical_forest: {
        objects: {
          buttress_root: { anims: { wind_sway: false }, size: 0.75, density: 0.2 },
          jungle_rock: { anims: { wind_sway: false }, size: 1.25, density: 0.2 },
          vine_log: { size: 0.75, anims: { wind_sway: false }, density: 0.45 }
        }
      },
      tundra: {
        objects: {
          frozen_bones: { density: 0.35, anims: { wind_sway: false }, size: 1.2 },
          ice_boulder: { size: 1.2, density: 0.35 },
          permafrost_mound: { size: 1.05, density: 1.55 }
        }
      },
      volcanic: {
        objects: {
          basalt_column: { size: 1.5, anims: { wind_sway: false }, density: 0.25 },
          lava_rock: { size: 1.3, density: 0.65 },
          obsidian_pillar: { size: 1.45, density: 0.35 }
        }
      }
    }
  }
};
