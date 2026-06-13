// sim/test/probe-layout.mjs -- Phase B+C verification.
// Generates settlement layouts and territory, prints ASCII maps.
import { layoutSettlement, clearLayoutCache } from '../world/buildings/layout.js';
import { computeTerritory, clearTerritoryCache } from '../world/territory.js';

let ok = true;

for (const tier of ['village', 'town', 'city']) {
  clearLayoutCache();
  clearTerritoryCache();

  const site = { x: 64, y: 64 };
  const layout = layoutSettlement(42, site, tier, 'human', 'grassland');
  const territory = computeTerritory(42, site, tier);

  console.log(`\n=== ${tier.toUpperCase()} ===`);
  console.log(`  ${layout.districts.length} districts, ${layout.buildings.length} buildings, ${layout.spines.length} spines`);
  console.log(`  territory: ${territory.tiles.size} tiles, ${territory.boundary.size} boundary tiles`);

  // Verify no overlapping buildings
  const occupied = new Set();
  let overlaps = 0;
  for (const b of layout.buildings) {
    const bb = b.footprint.boundingBox;
    for (let dy = 0; dy < bb.h; dy++) {
      for (let dx = 0; dx < bb.w; dx++) {
        const key = `${b.x + dx},${b.y + dy}`;
        if (occupied.has(key)) overlaps++;
        occupied.add(key);
      }
    }
  }
  if (overlaps > 0) {
    console.error(`  FAIL: ${overlaps} overlapping tiles`);
    ok = false;
  }

  // Print ASCII minimap (60x40 window around site)
  const W = 60, H = 40;
  const ox = site.x - W / 2, oy = site.y - H / 2;
  const lines = [];
  for (let row = 0; row < H; row++) {
    let line = '';
    for (let col = 0; col < W; col++) {
      const wx = ox + col, wy = oy + row;
      const key = `${wx},${wy}`;
      const q = layout.queryTile(wx, wy);
      if (q && q.type === 'building') {
        line += q.tileKind === 'door' ? 'D' : q.tileKind === 'wall' ? '#' : '.';
      } else if (q && q.type === 'road') {
        line += '=';
      } else if (territory.boundary.has(key)) {
        line += '*';
      } else if (territory.tiles.has(key)) {
        line += ':';
      } else {
        line += ' ';
      }
    }
    lines.push(line);
  }
  console.log(lines.join('\n'));

  // Determinism check
  clearLayoutCache();
  clearTerritoryCache();
  const layout2 = layoutSettlement(42, site, tier, 'human', 'grassland');
  if (layout2.buildings.length !== layout.buildings.length) {
    console.error(`  FAIL: non-deterministic building count`);
    ok = false;
  }
}

// Multi-settlement territory overlap test
console.log('\n=== TERRITORY OVERLAP ===');
const t1 = computeTerritory(42, { x: 64, y: 64 }, 'town');
const t2 = computeTerritory(42, { x: 150, y: 64 }, 'town');
let overlap = 0;
for (const key of t1.tiles.keys()) {
  if (t2.tiles.has(key)) overlap++;
}
console.log(`  town1: ${t1.tiles.size} tiles, town2: ${t2.tiles.size} tiles, overlap: ${overlap}`);

console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
