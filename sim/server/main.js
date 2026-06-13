// Sim process entry (spec §3.4): node sim/server/main.js --world=worlds/dev.db --seed=42 --port=8787
import { openDb } from '../store/db.js';
import { checkpoint, loadKernel } from '../store/checkpoint.js';
import { Kernel } from '../kernel/kernel.js';
import { spawnStart, findLandStart } from '../world/spawn.js';
import { materializeRect } from '../world/wire.js';
import { SimServer } from './server.js';
import { initItemIdFromKernel } from '../world/actions.js';

/** Open-or-create: a db with a saved tick resumes; an empty one is a blank canvas.
 *  The world has always existed everywhere — there is no special "start area."
 *  findLandStart picks WHERE the player enters, but the world at that location
 *  is identical to every other location: lazily materialized via the attention
 *  bubble (TierManager → ensureRegionBaseline → ensureGenesisSettlements).
 *  The player discovers a world that was always there, not one that bootstraps. */
export function bootWorld(db, { seed, spawn = { x: 0, y: 0 }, phi = 4 }) {
  const saved = db.prepare('SELECT value FROM meta WHERE key=?').get('tick');
  let kernel;
  if (saved != null) {
    kernel = loadKernel(db);
  } else {
    kernel = new Kernel({ seed, phi });
    const start = findLandStart(spawn);
    if (!start) throw new Error(`no land within ${256 * 16} tiles of spawn ${spawn.x},${spawn.y}`);
    // No spawnStart — the world materializes uniformly through attention.
    // The start rect is just WHERE the player appears, not a special bootstrap.
    console.log('sim: player enters at ' + start.x0 + ',' + start.y0);
    checkpoint(kernel, db);          // birth certificate: empty canvas, world materializes on attention
  }
  initItemIdFromKernel(kernel);
  return kernel;
}

// Only run the process when invoked directly (so tests can import bootWorld).
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, dflt) => {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.split('=')[1] : dflt;
  };
  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const worldPath = arg('world', 'worlds/dev.db');
  mkdirSync(dirname(worldPath), { recursive: true });
  const db = openDb(worldPath);
  const [sx, sy] = arg('spawn', '0,0').split(',').map(Number);
  const kernel = bootWorld(db, { seed: Number(arg('seed', '42')), spawn: { x: sx, y: sy } });
  const server = new SimServer({ kernel, port: Number(arg('port', '8787')), db });
  await server.listen();
  console.log(`sim: world=${worldPath} tick=${kernel.tick} entities=${kernel.graph.nodes.size} ws://127.0.0.1:${server.port}`);
  process.on('SIGINT', async () => {
    console.log('sim: checkpointing…');
    await server.close();          // close() checkpoints (Task 6)
    process.exit(0);
  });
}
