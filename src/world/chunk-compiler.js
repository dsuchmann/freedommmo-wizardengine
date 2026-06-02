import { WORLD } from '../core/constants.js';
import { BIOMES, classifyBiome } from './biomes.js';
import { createTileStack, addObjectToTile, applyTerrainForm, projectTileForRender } from './tile-stack.js';
import { placeObjectsForTile } from './object-placement.js';
import { classifyTerrainForm } from './terrain-forms.js';

function compileTileInto(result, cx, cy, x, y) {
  const wx = cx * WORLD.chunkSize + x;
  const wy = cy * WORLD.chunkSize + y;
  const biomeSample = classifyBiome(wx, wy);
  const tile = createTileStack({ wx, wy, biomeSample });
  applyTerrainForm(tile, classifyTerrainForm(wx, wy, biomeSample.climate));
  const placed = placeObjectsForTile(tile);
  for (const object of placed) {
    addObjectToTile(tile, object);
    result.objects.push({ ...object, x, y });
  }
  const index = y * WORLD.chunkSize + x;
  result.tiles[index] = tile;
  result.renderTiles[index] = projectTileForRender(tile, BIOMES[tile.biome]);
}

export class ChunkCompiler {
  createJob(cx, cy) {
    return {
      cx,
      cy,
      cursor: 0,
      tiles: new Array(WORLD.chunkSize * WORLD.chunkSize),
      renderTiles: new Array(WORLD.chunkSize * WORLD.chunkSize),
      objects: []
    };
  }

  step(job, budgetTiles = 128) {
    const total = WORLD.chunkSize * WORLD.chunkSize;
    const end = Math.min(total, job.cursor + budgetTiles);
    for (; job.cursor < end; job.cursor++) {
      const x = job.cursor % WORLD.chunkSize;
      const y = Math.floor(job.cursor / WORLD.chunkSize);
      compileTileInto(job, job.cx, job.cy, x, y);
    }
    if (job.cursor >= total) {
      return { cx: job.cx, cy: job.cy, tiles: job.tiles, renderTiles: job.renderTiles, objects: job.objects };
    }
    return null;
  }

  compile(cx, cy) {
    const job = this.createJob(cx, cy);
    let result = null;
    while (!result) result = this.step(job, 512);
    return result;
  }
}
