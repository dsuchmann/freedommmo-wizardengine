import { WORLD } from '../core/constants.js';
import { paintTerrainTile } from './tile-painter.js';
import { paintTerrainFeatures } from './feature-painter.js';

const TERRAIN_RENDER_VERSION = 'wang-lookup-v13';

const TRANSITION_PAIRS = Object.freeze({
  'beach|desert': { from: 'beach', to: 'desert', dir: 'beach_to_desert' },
  'beach|grassland': { from: 'beach', to: 'grassland', dir: 'beach_to_grassland' },
  'deep_ocean|ocean': { from: 'deep_ocean', to: 'ocean', dir: 'deep_ocean_to_ocean' },
  'dense_forest|mystic': { from: 'dense_forest', to: 'mystic', dir: 'dense_forest_to_mystic' },
  'dense_forest|tropical_forest': { from: 'dense_forest', to: 'tropical_forest', dir: 'dense_forest_to_tropical_forest' },
  'desert|hills': { from: 'desert', to: 'hills', dir: 'desert_to_hills' },
  'desert|savanna': { from: 'desert', to: 'savanna', dir: 'desert_to_savanna' },
  'desert|volcanic': { from: 'desert', to: 'volcanic', dir: 'desert_to_volcanic' },
  'forest|dense_forest': { from: 'forest', to: 'dense_forest', dir: 'forest_to_dense_forest' },
  'forest|hills': { from: 'forest', to: 'hills', dir: 'forest_to_hills' },
  'forest|mystic': { from: 'forest', to: 'mystic', dir: 'forest_to_mystic' },
  'forest|taiga': { from: 'forest', to: 'taiga', dir: 'forest_to_taiga' },
  'forest|tropical_forest': { from: 'forest', to: 'tropical_forest', dir: 'forest_to_tropical_forest' },
  'grassland|forest': { from: 'grassland', to: 'forest', dir: 'grassland_to_forest' },
  'grassland|hills': { from: 'grassland', to: 'hills', dir: 'grassland_to_hills' },
  'grassland|mystic': { from: 'grassland', to: 'mystic', dir: 'grassland_to_mystic' },
  'grassland|savanna': { from: 'grassland', to: 'savanna', dir: 'grassland_to_savanna' },
  'grassland|steppe': { from: 'grassland', to: 'steppe', dir: 'grassland_to_steppe' },
  'hills|mountains': { from: 'hills', to: 'mountains', dir: 'hills_to_mountains' },
  'hills|volcanic': { from: 'hills', to: 'volcanic', dir: 'hills_to_volcanic' },
  'lake|forest': { from: 'lake', to: 'forest', dir: 'lake_to_forest' },
  'lake|grassland': { from: 'lake', to: 'grassland', dir: 'lake_to_grassland' },
  'lake|river': { from: 'lake', to: 'river', dir: 'lake_to_river' },
  'lake|shallow_water': { from: 'lake', to: 'shallow_water', dir: 'lake_to_shallow_water' },
  'lake|swamp': { from: 'lake', to: 'swamp', dir: 'lake_to_swamp' },
  'mountains|arctic': { from: 'mountains', to: 'arctic', dir: 'mountains_to_snow' },
  'mountains|volcanic': { from: 'mountains', to: 'volcanic', dir: 'mountains_to_volcanic' },
  'ocean|beach': { from: 'ocean', to: 'beach', dir: 'ocean_to_beach' },
  'ocean|shallow_water': { from: 'ocean', to: 'shallow_water', dir: 'ocean_to_shallow_water' },
  'river|forest': { from: 'river', to: 'forest', dir: 'river_to_forest' },
  'river|grassland': { from: 'river', to: 'grassland', dir: 'river_to_grassland' },
  'river|hills': { from: 'river', to: 'hills', dir: 'river_to_hills' },
  'river|swamp': { from: 'river', to: 'swamp', dir: 'river_to_swamp' },
  'savanna|hills': { from: 'savanna', to: 'hills', dir: 'savanna_to_hills' },
  'savanna|steppe': { from: 'savanna', to: 'steppe', dir: 'savanna_to_steppe' },
  'shallow_water|beach': { from: 'shallow_water', to: 'beach', dir: 'shallow_water_to_beach' },
  'shallow_water|river': { from: 'shallow_water', to: 'river', dir: 'shallow_water_to_river' },
  'shallow_water|swamp': { from: 'shallow_water', to: 'swamp', dir: 'shallow_water_to_swamp' },
  'steppe|desert': { from: 'steppe', to: 'desert', dir: 'steppe_to_desert' },
  'steppe|hills': { from: 'steppe', to: 'hills', dir: 'steppe_to_hills' },
  'swamp|beach': { from: 'swamp', to: 'beach', dir: 'swamp_to_beach' },
  'swamp|dense_forest': { from: 'swamp', to: 'dense_forest', dir: 'swamp_to_dense_forest' },
  'swamp|forest': { from: 'swamp', to: 'forest', dir: 'swamp_to_forest' },
  'swamp|grassland': { from: 'swamp', to: 'grassland', dir: 'swamp_to_grass' },
  'swamp|tropical_forest': { from: 'swamp', to: 'tropical_forest', dir: 'swamp_to_tropical_forest' },
  'taiga|hills': { from: 'taiga', to: 'hills', dir: 'taiga_to_hills' },
  'taiga|mountains': { from: 'taiga', to: 'mountains', dir: 'taiga_to_mountains' },
  'tropical_forest|mystic': { from: 'tropical_forest', to: 'mystic', dir: 'tropical_forest_to_mystic' },
  'tundra|hills': { from: 'tundra', to: 'hills', dir: 'tundra_to_hills' },
  'tundra|mountains': { from: 'tundra', to: 'mountains', dir: 'tundra_to_mountains' },
  'tundra|arctic': { from: 'tundra', to: 'arctic', dir: 'tundra_to_snow' },
  'tundra|steppe': { from: 'tundra', to: 'steppe', dir: 'tundra_to_steppe' },
  'tundra|taiga': { from: 'tundra', to: 'taiga', dir: 'tundra_to_taiga' },
});

function transitionPairFor(a, b) {
  return TRANSITION_PAIRS[a + '|' + b] || TRANSITION_PAIRS[b + '|' + a] || null;
}

export class ChunkRenderCache {
  constructor(compositor = null, atlas = null) {
    this.compositor = compositor;
    this.atlas = atlas;
    this.cache = new Map();
    this.lastCanvasByChunk = new Map();
    this.maxEntries = 160;
    this.renderedThisFrame = 0;
    this.fallbackThisFrame = 0;
    this.missThisFrame = 0;
  }

  beginFrame(maxJobs = 1) {
    this._frameBudget = maxJobs;
    this.renderedThisFrame = 0;
    this.fallbackThisFrame = 0;
    this.missThisFrame = 0;
  }

  key(chunk, lightBucket, neighborMask = '') {
    return `${TERRAIN_RENDER_VERSION},${chunk.cx},${chunk.cy},${lightBucket},${neighborMask}`;
  }

  lightBucket(sun) {
    return 'static';
  }

  get(chunk, sun, chunkStore = null) {
    var bucket = this.lightBucket(sun);
    var neighborMask = this.neighborReadyMask(chunk, chunkStore);
    var key = this.key(chunk, bucket, neighborMask);
    var hit = this.cache.get(key);
    if (hit) { hit.lastUsed = performance.now(); return hit.canvas; }
    const stableKey = `${chunk.cx},${chunk.cy}`;
    if ((this._frameBudget ?? 0) <= 0) {
      const fallback = this.lastCanvasByChunk.get(stableKey) ?? null;
      if (fallback) this.fallbackThisFrame++;
      else this.missThisFrame++;
      return fallback;
    }
    this._frameBudget--;
    this.renderedThisFrame++;
    var canvas = document.createElement('canvas');
    canvas.width = WORLD.chunkSize * WORLD.tileSize;
    canvas.height = WORLD.chunkSize * WORLD.tileSize;
    var ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false });
    this.renderChunk(ctx, chunk, sun, chunkStore);
    this.cache.set(key, { canvas, lastUsed: performance.now() });
    this.lastCanvasByChunk.set(stableKey, canvas);
    this.evict();
    return canvas;
  }

  neighborReadyMask(chunk, chunkStore) {
    if (!chunkStore) return 'none';
    let mask = 0;
    if (chunkStore.getIfReady(chunk.cx, chunk.cy)) mask |= 1;
    if (chunkStore.getIfReady(chunk.cx - 1, chunk.cy)) mask |= 2;
    if (chunkStore.getIfReady(chunk.cx + 1, chunk.cy)) mask |= 4;
    if (chunkStore.getIfReady(chunk.cx, chunk.cy - 1)) mask |= 8;
    if (chunkStore.getIfReady(chunk.cx, chunk.cy + 1)) mask |= 16;
    return mask;
  }

  renderChunk(ctx, chunk, sun, chunkStore) {
    var tileAt = function(wx, wy) {
      var cx = Math.floor(wx / WORLD.chunkSize);
      var cy = Math.floor(wy / WORLD.chunkSize);
      var tx = ((wx % WORLD.chunkSize) + WORLD.chunkSize) % WORLD.chunkSize;
      var ty = ((wy % WORLD.chunkSize) + WORLD.chunkSize) % WORLD.chunkSize;
      if (cx === chunk.cx && cy === chunk.cy) {
        return chunk.tiles[ty * WORLD.chunkSize + tx];
      }
      if (chunkStore) {
        var nbChunk = chunkStore.getIfReady(cx, cy);
        if (nbChunk && nbChunk.tiles) return nbChunk.tiles[ty * WORLD.chunkSize + tx];
      }
      return null;
    };
    for (var y = 0; y < WORLD.chunkSize; y++) {
      for (var x = 0; x < WORLD.chunkSize; x++) {
        var index = y * WORLD.chunkSize + x;
        var tile = chunk.tiles[index];
        var sx = x * WORLD.tileSize;
        var sy = y * WORLD.tileSize;
        // Compute all 8 neighbor biomes for this tile
        var wx = chunk.cx * WORLD.chunkSize + x;
        var wy = chunk.cy * WORLD.chunkSize + y;
        tile.neighborN  = (tileAt(wx, wy - 1) || tile).biome;
        tile.neighborNE = (tileAt(wx + 1, wy - 1) || tile).biome;
        tile.neighborE  = (tileAt(wx + 1, wy) || tile).biome;
        tile.neighborSE = (tileAt(wx + 1, wy + 1) || tile).biome;
        tile.neighborS  = (tileAt(wx, wy + 1) || tile).biome;
        tile.neighborSW = (tileAt(wx - 1, wy + 1) || tile).biome;
        tile.neighborW  = (tileAt(wx - 1, wy) || tile).biome;
        tile.neighborNW = (tileAt(wx - 1, wy - 1) || tile).biome;

        // Generic transition context: if a transition folder exists for any
        // nearby biome pair, use that transition set for both edges and filler.
        tile.transitionPair = null;
        tile.transitionSide = '';
        const immediate = [tile.neighborN, tile.neighborNE, tile.neighborE, tile.neighborSE, tile.neighborS, tile.neighborSW, tile.neighborW, tile.neighborNW];
        for (const nb of immediate) {
          if (nb && nb !== tile.biome) {
            const pair = transitionPairFor(tile.biome, nb);
            if (pair) {
              tile.transitionPair = pair;
              tile.transitionSide = tile.biome === pair.from ? 'from' : 'to';
              break;
            }
          }
        }
        if (!tile.transitionPair) {
          // Find any transition pair involving this biome (for interior filler)
          for (const other of immediate) {
            if (!other || other === tile.biome) continue;
            const pair = transitionPairFor(tile.biome, other);
            if (pair) {
              tile.transitionPair = pair;
              tile.transitionSide = tile.biome === pair.from ? 'from' : 'to';
              break;
            }
          }
          if (!tile.transitionPair) {
            // Still no immediate neighbor pair — find any available transition for this biome
            const TRANSITION_KEYS = Object.keys(TRANSITION_PAIRS);
            for (const key of TRANSITION_KEYS) {
              const pair = TRANSITION_PAIRS[key];
              if (pair.from === tile.biome || pair.to === tile.biome) {
                tile.transitionPair = pair;
                tile.transitionSide = tile.biome === pair.from ? 'from' : 'to';
                break;
              }
            }
          }
        }
        // Wang edge mask — pattern-based from tileset layout
        // Use neighbor diff pattern to select mask
        var nw = tile.neighborNW !== tile.biome ? 1 : 0;
        var nn = tile.neighborN  !== tile.biome ? 1 : 0;
        var ne = tile.neighborNE !== tile.biome ? 1 : 0;
        var ww = tile.neighborW  !== tile.biome ? 1 : 0;
        var ee = tile.neighborE  !== tile.biome ? 1 : 0;
        var sw = tile.neighborSW !== tile.biome ? 1 : 0;
        var ss = tile.neighborS  !== tile.biome ? 1 : 0;
        var se = tile.neighborSE !== tile.biome ? 1 : 0;
        // Pattern key: 8-bit diff concat
        var key = '' + nw + nn + ne + ww + ee + sw + ss + se;
        // Lookup table from user-provided examples (1=diff, 0=same)
        var lookup = {
          '00010110': 8,  // W,S,SW diff
          '00000010': 10, // SW only
          '00010100': 1,  // W,SW diff (S same)
          '00010010': 10, // W,S diff (SW same)
          '10010110': 8,  // NW,W,S,SW all diff
          '00000000': 6,  // all same interior near transition
          '00000100': 10, // SW-only according to tileset layout
          '00101000': 12, // beach tile with NE/E swamp
          '00000100': 10, // exact: only SW differs
          '01100000': 12, // beach: NE/E swamp
          '01101000': 12, // beach: N/NE/E swamp
          '11100000': 12, // beach alternate N/NE/E swamp
          '11110000': 12, // beach: N/NE/E/SE swamp alternate key
          '01101001': 12, // beach: N/NE/E/SE swamp exact key
        };
        var mask = lookup[key];
        if (mask === undefined) {
          // Fallback: edge diff + corner overrides
          mask = 0;
          if (ww) mask |= 2;
          if (ss) mask |= 8;
          if (sw) mask |= 8;
          if (nw && !nn) mask &= ~2;
        }
        tile.wangEdgeMask = mask;
        tile.wangEdgeMask = mask;
        paintTerrainTile(ctx, tile, sx, sy, WORLD.tileSize, sun, tile.climate.elevation, this.compositor, 0, this.atlas);
        paintTerrainFeatures(ctx, tile, sx, sy, WORLD.tileSize, sun);
      }
    }
  }

  evict() {
    if (this.cache.size <= this.maxEntries) return;
    const entries = [...this.cache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (entries.length && this.cache.size > this.maxEntries) this.cache.delete(entries.shift()[0]);
  }

  clear() {
    this.cache.clear();
    this.lastCanvasByChunk.clear();
  }

  stats() {
    return { cachedTerrainChunks: this.cache.size, maxTerrainChunks: this.maxEntries, renderedTerrainChunks: this.renderedThisFrame, fallbackTerrainChunks: this.fallbackThisFrame, missedTerrainChunks: this.missThisFrame };
  }
}

function elevationLift(elevation) {
  return Math.max(0, elevation - 0.35) * 18;
}
