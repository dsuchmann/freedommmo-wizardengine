# Canonical Base Tile IDs

Generated 2026-06-04. These are the ONE true base tile ID per biome.
All transitions must reference these IDs for seamless chaining.

Use the **lower** ID when this biome is the lower/first terrain in a transition.
Use the **upper** ID when this biome is the upper/second terrain in a transition.

## Land Biomes

| Biome | Tileset ID | Lower Base Tile ID | Upper Base Tile ID |
|-------|-----------|-------------------|-------------------|
| grassland | b3f22618-fa92-4eaa-92d8-ee252436199b | 3d09d189-81b3-4b62-9799-4827bb0495b5 | 949429fa-32a3-4ca1-ade9-fb424ee2641f |
| forest | b89515b6-79d1-4bfd-98a4-31707be7734d | 87973039-3faa-448b-9123-4e64a7c6e932 | 04e519e2-5c78-45c0-be6e-b63c8df16eaa |
| dense_forest | 3052d934-dd65-4c95-bf8b-544d5981b2b2 | 7a43bd9f-a0a3-4cb1-82f2-0fa56237682c | 1f8e1133-9f18-4874-830b-088a5c050a8e |
| tropical_forest | 98e4e658-f985-4652-8e5d-f2c9ef191817 | 130e304b-a9e8-47b5-bf1d-a1cf43efd9fd | 8b0f1193-c9b8-45c8-b1e5-4b8f8d134e84 |
| taiga | d7f224ed-7102-4934-851f-97d8c8b89e5b | aadf3e49-0212-4f21-b853-fde4cbf905f6 | f69fd602-1bcc-42a1-872b-95ee1b267015 |
| beach | 6d4a7ebb-9a4e-4f00-bb02-0870d01d87e7 | 1e408a41-65af-4a42-a719-616b764b2bdd | 9119dfca-32e0-48e7-bafb-3b4894ae531b |
| desert | 7def3a17-3030-456d-8151-bea29df80431 | f51c6f4a-354e-4dff-a4b1-1ea8b0c66573 | 93dc0f1e-bba3-4e12-b741-6f3b03e2a41a |
| savanna | 318f8c7a-199d-40d6-ade7-2c0130a2dd1d | 7fd08ff7-17c4-4139-a6fb-7d014acccca3 | 5e728d11-ba37-4935-9128-1760659a3ba9 |
| steppe | 53bcfb4d-cbf7-430c-a5b3-be8cd2f8a216 | fe211bb1-4b99-4e95-a025-a04ce8883d5e | a8aede8f-f06e-46be-8161-af9b7aa4160d |
| swamp | 534de295-410a-458c-9881-d8141c209de9 | ebad6623-d862-49e8-9124-8a90f53e1229 | b65f815c-33eb-467d-9440-53369e6649fa |
| tundra | 72d417d4-d110-49a6-b6f5-b9b03e38c880 | 4d46ed0d-426d-4325-a5d6-33464ee26297 | 625ca67b-3217-4a0a-824b-0dcf848051f4 |
| arctic | e9bf313e-bc01-4ee3-a02b-dbcbd0caad99 | 2c8a9b01-73c4-4313-b3b3-f239f254dbca | b6b93226-d449-4e72-a77c-7adc1efc634c |
| hills | 59afdcb2-9acc-4589-bd19-f4dc401f5a5a | 7296ae72-e61b-4f0c-bc89-d34f07c3266d | b9919459-c795-42e3-9e10-a5faa00d1f51 |
| mountains | 4d560eb1-9d95-4d6f-afa2-27c99e3612a9 | 1439e310-3505-47d1-b32d-79fe9391870b | 714d2999-848a-4b28-8b3c-ba5e879c61ac |
| volcanic | fb29e778-29b8-46d1-96a0-5f8e5e5b5b96 | 2958e295-1974-4936-aedf-39ceb8b52517 | e14095c3-0980-4e7f-8093-44a656dac7b3 |
| mystic | 04783bcb-5ea6-4471-9ebd-6d39610389a3 | 4bb937fe-e73f-403f-a06c-3a0d9a801daf | 8f7e34e1-a09f-4b05-8620-38b8a59d68a9 |

## Water Biomes

| Biome | Tileset ID | Lower Base Tile ID | Upper Base Tile ID |
|-------|-----------|-------------------|-------------------|
| ocean | 3c128273-702d-47a9-8767-cca9e526a505 | cb04ad78-c894-4595-be7c-c5e847cd0e1b | 49f34c08-cee0-413b-b05b-5601812f198c |
| deep_ocean | fbfa2b84-1701-4cad-a7c1-4d7f19321626 | 09e824f3-86b5-45b8-9e6f-2f54b8d17ce1 | 14ee3566-c439-4049-b95b-04419b5c5cee |
| shallow_water | 3bcc59a8-5d49-47e3-a4c5-3c30ab8e05d3 | b76c4461-725a-4468-9631-e28b50b76f25 | 7ef8b363-bfc5-48e3-ab70-f4d12a5ac1f7 |
| lake | 89c98c89-7d65-458b-8774-fc6c2a85e390 | b3c7768c-4611-43d2-92d9-c9dcb35f7fa4 | ec6cc367-df58-468d-8370-8e9b354ef050 |
| river | 160d9a82-cb5b-4a84-8b04-9ce93b39540c | 818260d3-6de2-4db1-88f2-8839b44d22c9 | 0627c024-7bf6-4371-bd04-4232858c3269 |

## Usage

When creating a transition tileset (e.g., grassland -> forest):
```
create_topdown_tileset(
  lower_description: "lush green grass meadow...",
  upper_description: "dark forest floor...",
  lower_base_tile_id: "3d09d189-81b3-4b62-9799-4827bb0495b5",  // grassland lower
  upper_base_tile_id: "04e519e2-5c78-45c0-be6e-b63c8df16eaa",  // forest upper
  ...
)
```

## Notes

- For self-referencing base tilesets (biome A -> A with transition_size=0), both lower and upper IDs are minted. They may differ — use the one appropriate for the role in each transition.
- When biome X is the LOWER terrain in transition X->Y, use X's lower base tile ID
- When biome X is the UPPER terrain in transition Y->X, use X's upper base tile ID
