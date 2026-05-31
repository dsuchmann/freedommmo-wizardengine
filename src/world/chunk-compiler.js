import { WORLD } from '../core/constants.js';
import { BIOMES, classifyBiome } from './biomes.js';
import { createTileStack, addObjectToTile, applyTerrainForm, projectTileForRender } from './tile-stack.js';
import { placeObjectsForTile } from './object-placement.js';
import { classifyTerrainForm } from './terrain-forms.js';

export class ChunkCompiler {
  compile(cx, cy) {
    const tiles = new Array(WORLD.chunkSize * WORLD.chunkSize);
    const renderTiles = new Array(WORLD.chunkSize * WORLD.chunkSize);
    const objects = [];

    for (let y = 0; y < WORLD.chunkSize; y++) {
      for (let x = 0; x < WORLD.chunkSize; x++) {
        const wx = cx * WORLD.chunkSize + x;
        const wy = cy * WORLD.chunkSize + y;
        const biomeSample = classifyBiome(wx, wy);
        const tile = createTileStack({ wx, wy, biomeSample });
        applyTerrainForm(tile, classifyTerrainForm(wx, wy, biomeSample.climate));
        const placed = placeObjectsForTile(tile);
        for (const object of placed) {
          addObjectToTile(tile, object);
          objects.push({ ...object, x, y });
        }
        const index = y * WORLD.chunkSize + x;
        tiles[index] = tile;
        renderTiles[index] = projectTileForRender(tile, BIOMES[tile.biome]);
      }
    }

    return { cx, cy, tiles, renderTiles, objects };
  }
}
