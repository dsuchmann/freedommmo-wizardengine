// sim/test/probe-genesis.mjs — P2 verification: settlements and roads exist far from origin.
// NOTE: positions are spread > MAX_NEIGHBOR_DIST (96) apart so road building A*
// doesn't dominate runtime. Road connectivity is tested in genesis.test.js with
// closer settlements.
import { openDb } from '../store/db.js';
import { bootWorld } from '../server/main.js';
import { TierManager } from '../lod/tiers.js';
import { REGION } from '../lod/aggregate.js';
import { MACRO } from '../world/genesis.js';

const db = openDb(':memory:');
const kernel = bootWorld(db, { seed: 42, spawn: { x: 0, y: 0 } });
const tm = new TierManager(kernel, { fullR: 0, ringR: 1, demoteR: 2 });

// Each position is in a different macro-cell and spread > 200 tiles apart
// so that settlements (if placed) are beyond MAX_NEIGHBOR_DIST and
// connectToNeighbors finds nobody to route to.
const positions = [
  { x: 550, y: 50 },
  { x: 1200, y: 50 },
  { x: 1800, y: 50 },
  { x: 550, y: 600 },
  { x: 1200, y: 600 },
  { x: 1800, y: 600 },
  { x: 550, y: 1200 },
  { x: 1200, y: 1200 },
];

for (let i = 0; i < positions.length; i++) {
  const t0 = Date.now();
  tm.update([positions[i]], kernel.tick);
  const ms = Date.now() - t0;
  const sCount = [...kernel.graph.nodes.values()].filter(n => n.type === 'settlement').length;
  console.log(`  step ${i} (${positions[i].x},${positions[i].y}): ${ms}ms, ${sCount} settlements`);
}

const settlements = [...kernel.graph.nodes.values()].filter(n => n.type === 'settlement');
const roads = [...kernel.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.archetype === 'road_segment');
const groups = [...kernel.graph.nodes.values()].filter(n => n.type === 'group' && n.attrs.genesis);

console.log(`genesis probe: ${settlements.length} settlements, ${roads.length} road segments, ${groups.length} genesis groups`);
console.log(`  macro-cells evaluated: ${kernel.genesisSettlements.size}`);
console.log(`  regions touched: ${kernel.touched.size}`);

if (settlements.length === 0) { console.error('FAIL: no settlements'); process.exit(1); }
for (const s of settlements.slice(0, 10)) {
  console.log(`  settlement at ${s.x},${s.y}`);
}
console.log('PASS');
process.exit(0);
