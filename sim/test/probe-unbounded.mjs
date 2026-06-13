// sim/test/probe-unbounded.mjs — P1 verification probe.
import { openDb } from '../store/db.js';
import { bootWorld } from '../server/main.js';
import { TierManager } from '../lod/tiers.js';
import { REGION } from '../lod/aggregate.js';

const db = openDb(':memory:');
const kernel = bootWorld(db, { seed: 42, spawn: { x: 0, y: 0 } });
const tm = new TierManager(kernel);
const stops = [{ x: 50_000, y: 50_000 }, { x: -48_123, y: 31_337 }, { x: 7_712, y: -224 }];
let ok = true;
for (const c of stops) {
  tm.update([c], kernel.tick);
  const living = kernel.graph.nodesNear(c.x, c.y, REGION * 3).filter(n => n.R != null);
  const aggs = [...kernel.graph.nodes.values()].filter(n => n.type === 'aggregate').length;
  console.log(`probe ${c.x},${c.y}: living near=${living.length} aggregates(world)=${aggs} touched=${kernel.touched.size}`);
  if (living.length === 0) { console.error(`  FAIL: no world at ${c.x},${c.y}`); ok = false; }
}
process.exit(ok ? 0 : 1);
