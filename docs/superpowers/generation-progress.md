# Wang Tile Transition Generation Progress

## Status
- Total target: 840 tilesets (210 pairs × 4 sizes: 0.0, 0.25, 0.5, 1.0)
- s0.0: 210/210 COMPLETE
- s0.25: 210/210 COMPLETE
- s0.5: 210/210 COMPLETE
- s1.0: 58/210 submitted (arctic 20/20 ✓, beach 20/20, deep_ocean 20/20, dense_forest 18/20)
- s1.0 downloaded: 55/210 (arctic 20, beach 17, deep_ocean 18)
- Currently processing: 20 (2 deep_ocean retries + 18 dense_forest)
- Next up: dense_forest_to_tundra, dense_forest_to_volcanic, then desert_to_* (20 pairs)
- Last update: 2026-06-04 ~18:15 UTC

## s1.0 Generation IDs (for download tracking)

### deep_ocean s1.0 (retries)
| Pair | Tileset ID | Status |
|------|-----------|--------|
| deep_ocean_to_hills | 2a827057-8830-4d05-a590-65072b85531c | processing |
| deep_ocean_to_volcanic | ffd748b9-5232-431d-9429-46d7331b9b00 | processing |

### dense_forest s1.0
| Pair | Tileset ID | Status |
|------|-----------|--------|
| dense_forest_to_arctic | 15d1de46-364f-4635-85ea-1b20f1ac288e | processing |
| dense_forest_to_beach | 72476928-0c4f-4f14-84bb-2e45e39ab35a | processing |
| dense_forest_to_deep_ocean | 4d67e519-a45f-4b16-9a7a-6dfead5492fb | processing |
| dense_forest_to_desert | 8bfa1766-f4f3-4389-bc52-4f971e10f134 | processing |
| dense_forest_to_forest | b75ad820-1c07-48d7-a90b-d40e20964de5 | processing |
| dense_forest_to_grassland | 186e7ae7-e853-495f-ae8e-37d238c295c1 | processing |
| dense_forest_to_hills | ec798475-471b-42c0-9fd5-8f3c0572b35d | processing |
| dense_forest_to_lake | ebe5633e-0834-4bc9-94a4-7ef2fd4c5b23 | processing |
| dense_forest_to_mountains | 6f6c95fb-b40f-47fe-8f59-319d8eefca89 | processing |
| dense_forest_to_mystic | 1d747024-f005-4c60-bfc9-758e2fab053e | processing |
| dense_forest_to_ocean | 1c94366a-4896-4445-a247-d6481eb20b1b | processing |
| dense_forest_to_river | 6bbd7482-e24c-4007-a5c7-39873bb723c7 | processing |
| dense_forest_to_savanna | 50558c02-2b6a-4e75-a2fe-2e76d88ebf79 | processing |
| dense_forest_to_shallow_water | 8f6dbaa3-2721-4bb9-8d23-37febcf9a891 | processing |
| dense_forest_to_steppe | b451cef2-caed-4b7c-88eb-0e210a85150e | processing |
| dense_forest_to_swamp | 109d93d0-3281-4d86-9eaf-e6df6c1df200 | processing |
| dense_forest_to_taiga | 8b62b38f-804f-4c29-86bf-2f19999940fe | processing |
| dense_forest_to_tropical_forest | 9ee81ee6-0105-4a38-a53f-b2adcccf5d24 | processing |
| dense_forest_to_tundra | PENDING | — |
| dense_forest_to_volcanic | PENDING | — |

## Batch Progress (size=0 transitions)
| Batch | Pairs | Downloaded | Status |
|-------|-------|-----------|--------|
| arctic_to_* | 20/20 | 20/20 | COMPLETE |
| beach_to_* | 19/20 | 19/20 | Missing: beach_to_arctic |
| deep_ocean_to_* | 16/20 | 16/20 | Missing: arctic, beach, swamp, tropical_forest |
| dense_forest_to_* | 11/20 | 11/20 | Missing: arctic, beach, deep_ocean, hills, savanna, steppe, taiga, tundra, volcanic |
| desert_to_* | 3/20 | 3/20 | Have: hills, savanna, volcanic |
| forest_to_* | 7/20 | 7/20 | Have: dense_forest, hills, mountains, mystic, savanna, taiga, tropical_forest |
| grassland_to_* | 8/20 | 8/20 | Have: desert, forest, hills, mountains, mystic, savanna, steppe, taiga, tundra |
| hills_to_* | 2/20 | 2/20 | Have: mountains, volcanic |
| lake_to_* | 6/20 | 6/20 | Have: desert, forest, grassland, river, shallow_water, swamp |
| mountains_to_* | 2/20 | 2/20 | Have: snow(arctic), volcanic |
| mystic_to_* | 1/20 | 1/20 | Have: mountains |
| ocean_to_* | 2/20 | 2/20 | Have: beach, shallow_water |
| river_to_* | 4/20 | 4/20 | Have: forest, grassland, hills, swamp |
| savanna_to_* | 3/20 | 3/20 | Have: hills, steppe, tropical_forest |
| shallow_water_to_* | 3/20 | 3/20 | Have: beach, river, swamp |
| steppe_to_* | 4/20 | 4/20 | Have: desert, forest, hills, mountains |
| swamp_to_* | 6/20 | 6/20 | Have: beach, dense_forest, forest, grass, taiga, tropical_forest |
| taiga_to_* | 2/20 | 2/20 | Have: hills, mountains |
| tropical_forest_to_* | 1/20 | 1/20 | Have: mystic |
| tundra_to_* | 6/20 | 6/20 | Have: forest, hills, mountains, snow(arctic), steppe, taiga |
| volcanic_to_* | 1/20 | 1/20 | Have: mountains |

## Completed & Downloaded (size=0)
| # | Pair | Tileset ID | Status |
|---|------|-----------|--------|
| 1 | arctic_to_beach | 735278fd-1161-4c61-8d29-4c19841376ed | DOWNLOADED |
| 2 | arctic_to_deep_ocean | 944d1757-bc3b-4608-908e-1a3c1e4e0b22 | DOWNLOADED |
| 3 | arctic_to_dense_forest | 3111acfa-8f13-42fd-849c-1863213bac6a | DOWNLOADED |
| 4 | arctic_to_desert | bc3faade-a9a7-47c6-987e-808afd7aafcf | DOWNLOADED |
| 5 | arctic_to_forest | a8abc059-c405-455a-b447-a8e737906c46 | DOWNLOADED |
| 6 | arctic_to_grassland | e5fa7998-2d79-430a-8b52-abdbeaa671e0 | DOWNLOADED |
| 7 | arctic_to_hills | fcbcb180-3c66-4634-ae64-53d284e7138c | DOWNLOADED |
| 8 | arctic_to_lake | d626c94d-de90-4053-9f3f-5fb7c1b90b2b | DOWNLOADED |
| 9 | arctic_to_mountains | 88e002ad-bcb0-4154-bfc5-ce055f8bd5e2 | DOWNLOADED |
| 10 | arctic_to_mystic | 31f53e18-c14a-4277-adb9-e506dd72c690 | DOWNLOADED |
| 11 | arctic_to_ocean | b304b9bf-5e9d-4717-b2ad-41ec007c6181 | DOWNLOADED |
| 12 | arctic_to_river | cc7f9f55-7510-4e1c-9f49-018e60f0e848 | DOWNLOADED |
| 13 | arctic_to_savanna | 02722562-96e6-4c33-a920-6f99ca9fe1c7 | DOWNLOADED |
| 14 | arctic_to_shallow_water | 42616688-57c2-4472-9561-6077f7d134eb | DOWNLOADED |
| 15 | arctic_to_steppe | 8b417f79-8cc5-4fab-938d-19e688429faa | DOWNLOADED |
| 16 | arctic_to_swamp | 42039d76-93ae-4aff-9580-4b06e58d168e | DOWNLOADED |
| 17 | arctic_to_taiga | 3091b2c5-f58e-484e-bc4b-ccda671ae8a5 | DOWNLOADED |
| 18 | arctic_to_tropical_forest | cbb02018-b14d-4fb6-aa83-3928f5719890 | DOWNLOADED |
| 19 | arctic_to_tundra | 15a57943-d5db-4dc4-b3bc-619702c4b15f | DOWNLOADED |
| 20 | arctic_to_volcanic | 5b25faaa-b805-4b5e-a5a3-0b03b95b1b02 | DOWNLOADED |
| 21 | beach_to_deep_ocean | fd2fed16-9a17-47a5-a5cc-436cb17fae47 | DOWNLOADED |
| 22 | beach_to_dense_forest | 74d70f29-65a8-4698-8928-a9058efc689c | DOWNLOADED |
| 23 | beach_to_desert | f655af4c-3655-48a4-8272-0084cca043c6 | DOWNLOADED |
| 24 | beach_to_forest | cbda8167-a976-449b-938e-a6b8a3d1c973 | DOWNLOADED |
| 25 | beach_to_grassland | f7b085e3-022a-4540-94e5-0bfa3fb634a0 | DOWNLOADED |
| 26 | beach_to_hills | 13ccbf1b-ff39-4f1d-93d3-ec183b2b24ea | DOWNLOADED |
| 27 | beach_to_lake | 4c77a565-e68e-4308-b67a-808b4e911f3e | DOWNLOADED |
| 28 | beach_to_mountains | 30fcfc8e-fc2a-4fe5-b8e2-5e16413e89d7 | DOWNLOADED |
| 29 | beach_to_mystic | 4b670f6e-e0a2-4c22-b588-a8a05ca2f94d | DOWNLOADED |
| 30 | beach_to_ocean | c6fc8f17-c1d6-4142-9393-38b05d95e002 | DOWNLOADED |
| 31 | beach_to_river | 352b6c35-29ef-4e6b-b60a-40753f6681f8 | DOWNLOADED |
| 32 | beach_to_savanna | b668b3d4-92e7-49f9-9736-a2ebac9abedd | DOWNLOADED |
| 33 | beach_to_shallow_water | 090a5a17-d137-41d6-b273-8c0ac2cad09a | DOWNLOADED |
| 34 | beach_to_steppe | eacaf56b-e643-4f28-819a-4cd404230a3a | DOWNLOADED |
| 35 | beach_to_swamp | 70f03369-30dd-4fad-adbb-23dc24fc4f64 | DOWNLOADED |
| 36 | beach_to_taiga | c90686de-2419-4da9-9cbf-59c3913a2044 | DOWNLOADED |
| 37 | beach_to_tropical_forest | 75d51e6a-472e-4db9-a7d5-f10496989c04 | DOWNLOADED |
| 38 | beach_to_tundra | f0a4605c-6889-4688-9b42-88b78a23373e | DOWNLOADED |
| 39 | beach_to_volcanic | abdf894e-d8ba-4f7f-ba69-0c8c72ca5635 | DOWNLOADED |
| 40 | deep_ocean_to_dense_forest | 15253e91-afb1-42dd-b1bf-92730755a9b8 | DOWNLOADED |
| 41 | deep_ocean_to_desert | 8eb378ee-79fd-4a16-b912-7e347a63ac50 | DOWNLOADED |
| 42 | deep_ocean_to_forest | e8322fd2-05bb-44e6-8cfb-e77c01c6e84a | DOWNLOADED |
| 43 | deep_ocean_to_grassland | d7f8829c-58d9-4a91-b5d4-cc2d5efbdf49 | DOWNLOADED |
| 44 | deep_ocean_to_hills | d3bdce5e-05a0-41ab-9ebf-801ce84c6365 | DOWNLOADED |
| 45 | deep_ocean_to_lake | ccfd4f09-526a-4b1a-9eb1-ea0b3c2ee202 | DOWNLOADED |
| 46 | deep_ocean_to_mountains | 6e60354c-ab14-46c1-9200-ea2ed53d846d | DOWNLOADED |
| 47 | deep_ocean_to_mystic | c1e1442d-575c-4a0a-9eed-43e652633c48 | DOWNLOADED |
| 48 | deep_ocean_to_ocean | cec94a80-02ea-4dda-b115-8902a84590c6 | DOWNLOADED |
| 49 | deep_ocean_to_river | d0043c03-9509-40bc-8c5c-df74dcce7936 | DOWNLOADED |
| 50 | deep_ocean_to_savanna | b735c410-6c8c-4322-8767-cfb20e4fd508 | DOWNLOADED |
| 51 | deep_ocean_to_shallow_water | 3f0daab1-cdc8-4363-aecd-5d104f78443a | DOWNLOADED |
| 52 | deep_ocean_to_steppe | cd726cd1-e5e9-4fef-aa1f-a4dbc6e2138b | DOWNLOADED |
| 53 | deep_ocean_to_taiga | 2d10c80e-f6d0-4f86-8e3e-c38ff997c93f | DOWNLOADED |
| 54 | deep_ocean_to_tundra | f94ff3b2-2e96-4a04-a0f9-f9273d6fd140 | DOWNLOADED |
| 55 | deep_ocean_to_volcanic | 2cf6e2fb-fa55-469e-9c6e-d9c4911a7d4a | DOWNLOADED |
| 56 | dense_forest_to_desert | deedf452-3ef3-4b68-83f9-4ba6afbf45e9 | DOWNLOADED |
| 57-66 | (legacy systematic batch - see disk) | various | DOWNLOADED |
| 67 | forest_to_mountains | 4675f90b-bdf2-4abb-85cd-72d26b071a69 | DOWNLOADED |
| 68 | grassland_to_mountains | bbf53f44-f878-4fe5-b87c-a11090e60283 | DOWNLOADED |
| 69 | grassland_to_tundra | 109058ce-353a-414d-8c11-abf58247adc1 | DOWNLOADED |
| 70 | lake_to_desert | 28461bd8-7a20-48f4-ba46-b6dd02985044 | DOWNLOADED |
| 71 | mystic_to_mountains | 7966e996-698b-43d2-a55c-f941a5a787f4 | DOWNLOADED |
| 72 | savanna_to_tropical_forest | 6e1a58d2-a672-4346-aae4-4c51564bb0a5 | DOWNLOADED |
| 73 | steppe_to_forest | 411c7949-8cd7-4194-839e-61e65bcfe832 | DOWNLOADED |
| 74 | steppe_to_mountains | ce72428f-569b-4134-9077-088c5237da33 | DOWNLOADED |
| 75 | tundra_to_forest | 6872ffb0-61ed-40ec-adc9-7ec69a723c11 | DOWNLOADED |
| 76 | volcanic_to_mountains | d83666e3-5e55-45fb-bd44-e1c7bd0bde1a | DOWNLOADED |

## Processing / Stuck
| Pair | Tileset ID | Status |
|------|-----------|--------|
| deep_ocean_to_swamp | 4148e7f6-2672-44c9-a488-07722c6587f9 | STUCK at 95% |
| deep_ocean_to_tropical_forest | 24de4dfb-e0d1-48ca-84cf-6ead3069b420 | STUCK at 95% |
| deep_ocean_to_forest (dup) | 6a2b576d-0d18-464d-ba6b-668f12166a43 | processing |
| deep_ocean_to_grassland (dup) | 97ef5b8c-3581-4615-b1ea-3cea73a5a356 | processing |
| dense_forest_to_* (various) | ~7 jobs | processing |
| desert_to_* (various) | ~8 jobs | processing |

## Still Missing (not yet submitted, size=0)
### beach_to_*
- beach_to_arctic

### deep_ocean_to_*
- deep_ocean_to_arctic
- deep_ocean_to_beach
- deep_ocean_to_swamp (stuck, may need resubmit)
- deep_ocean_to_tropical_forest (stuck, may need resubmit)

### dense_forest_to_*
Processing: ~7 jobs for remaining pairs (arctic, beach, deep_ocean, hills, savanna, steppe, taiga, tundra, volcanic)

### desert_to_*
Processing: ~8 jobs. Already have: hills, savanna, volcanic (legacy)

### Remaining batches (not started)
- forest_to_* (20 pairs)
- grassland_to_* (20 pairs)
- hills_to_* (20 pairs)
- lake_to_* (20 pairs)
- mountains_to_* (20 pairs)
- mystic_to_* (20 pairs)
- ocean_to_* (20 pairs)
- river_to_* (20 pairs)
- savanna_to_* (20 pairs)
- shallow_water_to_* (20 pairs)
- steppe_to_* (20 pairs)
- swamp_to_* (20 pairs)
- taiga_to_* (20 pairs)
- tropical_forest_to_* (20 pairs)
- tundra_to_* (20 pairs)
- volcanic_to_* (20 pairs)

## River Base Tile
- ID: 160d9a82-cb5b-4a84-8b04-9ce93b39540c
- Lower: 818260d3-6de2-4db1-88f2-8839b44d22c9
- Upper: 0627c024-7bf6-4371-bd04-4232858c3269
- Status: DONE - downloaded

## Canonical Base Tile IDs
```
arctic: lower=2c8a9b01-73c4-4313-b3b3-f239f254dbca upper=b6b93226-d449-4e72-a77c-7adc1efc634c
beach: lower=1e408a41-65af-4a42-a719-616b764b2bdd upper=9119dfca-32e0-48e7-bafb-3b4894ae531b
deep_ocean: lower=09e824f3-86b5-45b8-9e6f-2f54b8d17ce1 upper=14ee3566-c439-4049-b95b-04419b5c5cee
dense_forest: lower=7a43bd9f-a0a3-4cb1-82f2-0fa56237682c upper=1f8e1133-9f18-4874-830b-088a5c050a8e
desert: lower=f51c6f4a-354e-4dff-a4b1-1ea8b0c66573 upper=93dc0f1e-bba3-4e12-b741-6f3b03e2a41a
forest: lower=87973039-3faa-448b-9123-4e64a7c6e932 upper=04e519e2-5c78-45c0-be6e-b63c8df16eaa
grassland: lower=3d09d189-81b3-4b62-9799-4827bb0495b5 upper=949429fa-32a3-4ca1-ade9-fb424ee2641f
hills: lower=7296ae72-e61b-4f0c-bc89-d34f07c3266d upper=b9919459-c795-42e3-9e10-a5faa00d1f51
lake: lower=b3c7768c-4611-43d2-92d9-c9dcb35f7fa4 upper=ec6cc367-df58-468d-8370-8e9b354ef050
mountains: lower=1439e310-3505-47d1-b32d-79fe9391870b upper=714d2999-848a-4b28-8b3c-ba5e879c61ac
mystic: lower=4bb937fe-e73f-403f-a06c-3a0d9a801daf upper=8f7e34e1-a09f-4b05-8620-38b8a59d68a9
ocean: lower=cb04ad78-c894-4595-be7c-c5e847cd0e1b upper=49f34c08-cee0-413b-b05b-5601812f198c
river: lower=818260d3-6de2-4db1-88f2-8839b44d22c9 upper=0627c024-7bf6-4371-bd04-4232858c3269
savanna: lower=7fd08ff7-17c4-4139-a6fb-7d014acccca3 upper=5e728d11-ba37-4935-9128-1760659a3ba9
shallow_water: lower=b76c4461-725a-4468-9631-e28b50b76f25 upper=7ef8b363-bfc5-48e3-ab70-f4d12a5ac1f7
steppe: lower=fe211bb1-4b99-4e95-a025-a04ce8883d5e upper=a8aede8f-f06e-46be-8161-af9b7aa4160d
swamp: lower=ebad6623-d862-49e8-9124-8a90f53e1229 upper=b65f815c-33eb-467d-9440-53369e6649fa
taiga: lower=aadf3e49-0212-4f21-b853-fde4cbf905f6 upper=f69fd602-1bcc-42a1-872b-95ee1b267015
tropical_forest: lower=130e304b-a9e8-47b5-bf1d-a1cf43efd9fd upper=8b0f1193-c9b8-45c8-b1e5-4b8f8d134e84
tundra: lower=4d46ed0d-426d-4325-a5d6-33464ee26297 upper=625ca67b-3217-4a0a-824b-0dcf848051f4
volcanic: lower=2958e295-1974-4936-aedf-39ceb8b52517 upper=e14095c3-0980-4e7f-8093-44a656dac7b3
```
