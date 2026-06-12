// Sim process entry (spec §3.4): node sim/server/main.js --world=worlds/dev.db --seed=42 --port=8787
import { openDb } from '../store/db.js';
import { checkpoint, loadKernel } from '../store/checkpoint.js';
import { Kernel } from '../kernel/kernel.js';
import { spawnWorld } from '../world/spawn.js';
import { SimServer } from './server.js';

/** Open-or-create: a db with a saved tick resumes; an empty one gets the baseline. */
export function bootWorld(db, { seed, bounds, start = bounds, phi = 4 }) {
  const saved = db.prepare('SELECT value FROM meta WHERE key=?').get('tick');
  if (saved != null) return loadKernel(db);
  const kernel = new Kernel({ seed, phi, bounds });
  spawnWorld(kernel, bounds, start);
  checkpoint(kernel, db);          // birth certificate: baseline is durable immediately
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
  const kernel = bootWorld(db, {
    seed: Number(arg('seed', '42')),
    bounds: { x0: 0, y0: 0, w: 320, h: 320 },
    start: { x0: 0, y0: 0, w: 48, h: 32 },
  });
  const server = new SimServer({ kernel, port: Number(arg('port', '8787')), db });
  await server.listen();
  console.log(`sim: world=${worldPath} tick=${kernel.tick} entities=${kernel.graph.nodes.size} ws://127.0.0.1:${server.port}`);
  process.on('SIGINT', async () => {
    console.log('sim: checkpointing…');
    await server.close();          // close() checkpoints (Task 6)
    process.exit(0);
  });
}
