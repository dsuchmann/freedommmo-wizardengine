import { openDb } from '../store/db.js';
import { bootWorld } from '../server/main.js';
import { TierManager } from '../lod/tiers.js';
import { REGION } from '../lod/aggregate.js';
import { MACRO } from '../world/genesis.js';
import { narrate, traceHistory } from '../story/narrator.js';

const db = openDb(':memory:');
const kernel = bootWorld(db, { seed: 42, spawn: { x: 0, y: 0 } });
const tm = new TierManager(kernel);

// Step through known-good land area (same positions as probe-chronicle.mjs
// plus a few further out to reach more macro-cells)
const positions = [
  { x: 550, y: 50 },
  { x: 850, y: -100 },
  { x: 1200, y: 50 },
  { x: 1500, y: -50 },
  { x: 1800, y: 100 },
];
for (const pos of positions) {
  tm.update([pos], kernel.tick);
}

const settlements = [...kernel.graph.nodes.values()].filter(n => n.type === 'settlement');
let ok = true;
console.log(`story probe: ${settlements.length} settlements to narrate`);
for (const s of settlements.slice(0, 5)) {
  const result = narrate(kernel, s.id);
  const state = s.attrs.state === 'ruined' ? 'RUINED' : 'ACTIVE';
  console.log(`\n  [${state}] #${s.id} at ${s.x},${s.y}:`);
  console.log(`    ${result?.summary ?? 'NO HISTORY'}`);
  if (result?.events) console.log(`    events: ${result.events.map(e => e.type).join(' → ')}`);
  if (!result?.events?.length) { console.error(`    FAIL: no causal chain`); ok = false; }
}
const ruin = settlements.find(n => n.attrs.state === 'ruined');
if (ruin) {
  const chain = traceHistory(kernel, ruin.id);
  console.log(`\n  ruin "why" chain (${chain.length} events):`);
  for (const ev of chain) console.log(`    [${ev.id}] ${ev.type}`);
}
if (settlements.length === 0) { console.error('FAIL: no settlements'); ok = false; }
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
