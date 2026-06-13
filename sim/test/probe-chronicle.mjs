import { openDb } from '../store/db.js';
import { bootWorld } from '../server/main.js';
import { TierManager } from '../lod/tiers.js';
import { REGION } from '../lod/aggregate.js';
import { MACRO } from '../world/genesis.js';

const db = openDb(':memory:');
const kernel = bootWorld(db, { seed: 42, spawn: { x: 0, y: 0 } });
const tm = new TierManager(kernel);

// Step through known-good land area — genesis is expensive, keep it focused
const positions = [
  { x: 550, y: 50 },    // near spawn (beach/land boundary)
  { x: 850, y: -100 },  // further into land
  { x: 1200, y: 50 },   // known settlement area
];
for (const pos of positions) {
  tm.update([pos], kernel.tick);
}

const settlements = [...kernel.graph.nodes.values()].filter(n => n.type === 'settlement');
const active = settlements.filter(n => n.attrs.state !== 'ruined');
const ruined = settlements.filter(n => n.attrs.state === 'ruined');
const roads = [...kernel.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.archetype === 'road_segment');
const chronicleEvents = kernel.ledger.events.filter(e => e.type.startsWith('chronicle_'));

console.log(`chronicle probe: ${settlements.length} settlements (${active.length} active, ${ruined.length} ruined)`);
console.log(`  ${roads.length} road segments, ${chronicleEvents.length} chronicle events`);

if (settlements.length === 0) { console.error('FAIL: no settlements'); process.exit(1); }
if (chronicleEvents.length === 0) { console.error('FAIL: no chronicle events'); process.exit(1); }

for (const s of settlements.slice(0, 5)) {
  console.log(`  [${s.attrs.state === 'ruined' ? 'RUINED' : 'ACTIVE'}] at ${s.x},${s.y}`);
}
console.log('PASS');
process.exit(0);
