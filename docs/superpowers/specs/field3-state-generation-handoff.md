# F3 State Generation Handoff

**Date:** 2026-06-08
**Status:** 100% COMPLETE — all base objects + all state variants generated
**Next action:** Download all sprites and wire into game

## What's Done

### Base Objects: 64/64 selected = 4,096 sprites
All 64 base objects generated and selected. The 12 that were stuck at 95% have been resolved and selected with tags.

### State Variants Progress
- **Forest (19/19):** ALL DONE (prior session)
- **Dense Forest (19/19):** ALL DONE (prior session)
- **Tropical Forest (20/20):** ALL DONE (source IDs recovered via tags)
- **Taiga (19/19):** ALL DONE
- **Grassland (19/19):** ALL DONE
- **Savanna (20/20):** ALL DONE
- **Steppe (18/18):** ALL DONE
- **Desert (19/19):** ALL DONE
- **Beach (19/19):** ALL DONE
- **Swamp (19/19):** ALL DONE (frog_eggs regenerated + 5 states queued)
- **Hills (16/16):** ALL DONE
- **Mountains (16/16):** ALL DONE
- **Volcanic (17/17):** ALL DONE
- **Tundra (17/17):** ALL DONE
- **Arctic (17/17):** ALL DONE (frost_stone regenerated + 4 states queued)
- **Mystic (16/16):** ALL DONE

**Total queued: 307 state variants. ALL COMPLETE.**

## Correct Source IDs (verified, use for create_object_state)

### Taiga (remaining: 3 states)
| Object | Source ID | Cat | Remaining States |
|--------|-----------|-----|-----------------|
| ice_pebble | 0515b9a0-b03d-4867-8c4b-20d2059c7f33 | min | frozen, enchanted, cracked |

### Grassland (19 states)
| Object | Source ID | Cat | States |
|--------|-----------|-----|--------|
| field_stone | 084590f1-225f-4711-a44d-41bf833b52b4 | min | destroyed, frozen, enchanted, cracked |
| dried_flower | 02c50f03-50f2-421d-ac2f-79a1f8095661 | org | destroyed, burned, frozen, enchanted, decayed |
| seed_head | 03d93d8a-a1ac-4776-956c-0b63499e30fd | org | destroyed, burned, frozen, enchanted, decayed |
| snail_shell | 038cf6ae-8b53-4539-8296-beb05159c7f5 | b/s | destroyed, burned, frozen, enchanted, cracked |

### Savanna (20 states)
| Object | Source ID | Cat | States |
|--------|-----------|-----|--------|
| dry_bone | 16ace506-b14d-41c0-ba2f-b6d85c43d2e6 | b/s | destroyed, burned, frozen, enchanted, cracked |
| cracked_pod | 07e82398-8743-454f-975b-9646380a04bd | org | destroyed, burned, frozen, enchanted, decayed |
| bleached_stick | 1085efc2-2e22-4abf-bedf-bc6586ed6296 | org | destroyed, burned, frozen, enchanted, decayed |
| termite_chip | 03a6f4bd-28a6-4a42-9a62-ce115768e836 | org | destroyed, burned, frozen, enchanted, decayed |

### Steppe (18 states)
| Object | Source ID | Cat | States |
|--------|-----------|-----|--------|
| wind_pebble | 06c48b19-80a8-4b24-b8a6-9a4e950cb8d4 | min | destroyed, frozen, enchanted, cracked |
| grass_ball | 015daaea-feb1-43b1-8bd9-44a0b94dab07 | org | destroyed, burned, frozen, enchanted, decayed |
| small_skull | 0836bed1-c177-4eed-a889-73a9ffd21939 | b/s | destroyed, burned, frozen, enchanted, cracked |
| dust_clod | 02f88282-91f3-42f9-8589-e5586c65b773 | min | destroyed, frozen, enchanted, cracked |

### Desert (19 states)
| Object | Source ID | Cat | States |
|--------|-----------|-----|--------|
| bleached_bone | 0697d200-45dd-499e-9612-45c089061f53 | b/s | destroyed, burned, frozen, enchanted, cracked |
| polished_stone | 09d236b2-ba01-47d6-bd00-8e68a2a5649f | min | destroyed, frozen, enchanted, cracked |
| scorpion_shell | 0d5d0f69-9c5a-4a99-8ba4-6ce64ab0d1ca | b/s | destroyed, burned, frozen, enchanted, cracked |
| dried_seed | 01f36807-b0a2-4cde-8bfe-7e2811b4371c | org | destroyed, burned, frozen, enchanted, decayed |

### Beach (19 states)
| Object | Source ID | Cat | States |
|--------|-----------|-----|--------|
| seashell | 0d92657d-0259-4504-8609-10a4a581a89e | b/s | destroyed, burned, frozen, enchanted, cracked |
| sea_glass | 0cd70a4f-070e-4cc1-a037-71ce3fd8a006 | min | destroyed, frozen, enchanted, cracked |
| driftwood_chip | 07e4d11c-5556-4329-826b-873b0712a97c | org | destroyed, burned, frozen, enchanted, decayed |
| coral_fragment | 07c2f532-1ded-44a5-aa8c-62991ef45f83 | b/s | destroyed, burned, frozen, enchanted, cracked |

### Swamp (14 states + frog_eggs TBD)
| Object | Source ID | Cat | States |
|--------|-----------|-----|--------|
| rotting_stick | 0515095e-fe4c-4e40-bd86-4a102ec698c8 | org | destroyed, burned, frozen, enchanted, decayed |
| leech | 00da1b6e-eb3a-4b14-8301-13cd829f932c | org | destroyed, burned, frozen, enchanted, decayed |
| bog_iron | e235bf45-cb17-4e46-b0c0-ba7cf302f90b | min | destroyed, frozen, enchanted, cracked |
| frog_eggs | e1f88b42-625d-4ba7-a777-9ab22be7720d | org | destroyed, burned, frozen, enchanted, decayed |

### Hills (16 states)
| Object | Source ID | Cat | States |
|--------|-----------|-----|--------|
| limestone_chip | 040c6384-35bb-469a-b32c-0c6fca0fd2c9 | min | destroyed, frozen, enchanted, cracked |
| slate_fragment | 067c9097-c04b-4a92-85c0-50551731fa88 | min | destroyed, frozen, enchanted, cracked |
| quartz_pebble | 8d8e6c45-7bc0-4ebe-a133-ccf90261cde7 | min | destroyed, frozen, enchanted, cracked |
| iron_nugget | 6f8bfded-b295-4bd2-8722-bb91fc8a5da3 | min | destroyed, frozen, enchanted, cracked |

### Mountains (16 states)
| Object | Source ID | Cat | States |
|--------|-----------|-----|--------|
| rock_shard | 11f4d7de-57c5-496e-b087-69c50499be57 | min | destroyed, frozen, enchanted, cracked |
| ice_chunk | 5cb04650-8428-4892-ac1f-b7b786a90169 | min | destroyed, frozen, enchanted, cracked |
| crystal_fragment | 4a79a2af-af9a-4acd-9129-3b8a5d509adf | min | destroyed, frozen, enchanted, cracked |
| ore_glint | 58ba9795-1e93-4725-90ed-0be7224145ce | min | destroyed, frozen, enchanted, cracked |

### Volcanic (17 states)
| Object | Source ID | Cat | States |
|--------|-----------|-----|--------|
| obsidian_shard | 0aeeed9e-449d-4595-846b-568acb663ca4 | min | destroyed, frozen, enchanted, cracked |
| sulfur_crystal | 3469fd82-74e7-402b-835f-aad779b3f3c1 | min | destroyed, frozen, enchanted, cracked |
| charred_bone | 103e150d-e71b-416b-b50a-245a8821cb3f | b/s | destroyed, burned, frozen, enchanted, cracked |
| lava_pebble | 69691d4f-e784-4e34-bfdd-20ae62e57d2b | min | destroyed, frozen, enchanted, cracked |

### Tundra (17 states)
| Object | Source ID | Cat | States |
|--------|-----------|-----|--------|
| frozen_pebble | 0ad422f7-73ee-4184-9a5e-4d50720e968a | min | destroyed, frozen, enchanted, cracked |
| ice_shard | 10c94ab8-3985-4a6d-8725-0bba92053e80 | min | destroyed, frozen, enchanted, cracked |
| lichen_rock | 813d5f2e-f14d-4685-b969-d60bd6de3ea3 | min | destroyed, frozen, enchanted, cracked |
| fossil_fragment | 29bd105c-0e0f-455c-8fe3-eae31bf9bb8c | b/s | destroyed, burned, frozen, enchanted, cracked |

### Arctic (13 states + frost_stone TBD)
| Object | Source ID | Cat | States |
|--------|-----------|-----|--------|
| snow_clump | 012f5dd3-af1a-4eb2-8430-d588f616f989 | min | destroyed, frozen, enchanted, cracked |
| ice_crystal_cluster | 02b8b594-a842-4003-85d7-e30efc3cf6f7 | min | destroyed, frozen, enchanted, cracked |
| frozen_shell | 0886282c-e914-4b35-b94b-834d3f905e27 | b/s | destroyed, burned, frozen, enchanted, cracked |
| frost_stone | b6a61552-3b28-4b76-97db-68f79771a525 | min | destroyed, frozen, enchanted, cracked |

### Mystic (16 states)
| Object | Source ID | Cat | States |
|--------|-----------|-----|--------|
| aether_crystal | 0f91987f-a4c4-4de1-9fba-e874a4929c8d | min | destroyed, frozen, enchanted, cracked |
| rune_shard | 0ebba04b-f03d-4efd-bdb9-ab84308c350b | min | destroyed, frozen, enchanted, cracked |
| glowing_pebble | 02e17ed7-d991-4871-94f8-33a719c6c1cd | min | destroyed, frozen, enchanted, cracked |
| stardust_cluster | 1139326d-fae7-4cf2-a6c8-296271832acd | min | destroyed, frozen, enchanted, cracked |

## Edit Descriptions (copy-paste)
```
destroyed: "smashed into broken fragments and debris scattered on ground, destroyed"
burned:    "charred and blackened by fire, glowing embers, ash residue, burned"
frozen:    "covered in frost and ice crystals, frozen solid, icy blue tint"
enchanted: "glowing with magical purple-blue aura, faint runic shimmer, enchanted"
decayed:   "rotting, decomposing, fungal growth, dark and wilted, decayed"
cracked:   "fractured with visible stress lines, chipped and splitting apart, cracked"
```

### Tropical Forest (20 states — recovered)
| Object | Source ID | Cat | States |
|--------|-----------|-----|--------|
| beetle_shell | 0b5e53d0-702c-4868-aeee-795c08fcb41d | b/s | destroyed, burned, frozen, enchanted, cracked |
| palm_nut | 01ded5c5-3b22-45c6-ad30-a0b8d58d4240 | org | destroyed, burned, frozen, enchanted, decayed |
| vine_cutting | 1191ef11-e619-40e9-8d39-ec380da55e1e | org | destroyed, burned, frozen, enchanted, decayed |
| seed_pod | 02c0949b-6639-4f7f-90a0-4c32b5375f87 | org | destroyed, burned, frozen, enchanted, decayed |

## Notes
- ALL generation complete as of 2026-06-08
- Tropical forest source IDs were recovered via individual tags (f3_tropical_forest_beetle_shell, etc.)
- frog_eggs and frost_stone were regenerated from scratch (old review objects expired)
- Next step: download all sprites and wire into game rendering pipeline
