// sim/test/probe-intent-replay.test.js — probe 4 extended with player intents (spec §5.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';
import { createPlayer, pick, chop } from '../world/actions.js';
import { openDb, canonicalDump } from '../store/db.js';
import { checkpoint } from '../store/checkpoint.js';
import { DAY } from '../time/metabolism.js';

function run() {
  const bounds = { x0: 0, y0: 0, w: 16, h: 16 };
  const k = new Kernel({ seed: 1234, bounds });
  spawnMeadow(k, bounds);
  const player = createPlayer(k, 0);
  // a scripted intent log: (tick, verb, species-of-first-match)
  const script = [
    [10 * DAY, 'pick', 'berry_bush'],
    [11 * DAY, 'chop', 'tree'],
    [40 * DAY, 'pick', 'berry_bush'],
  ];
  for (const [t, verb, species] of script) {
    k.runTo(t);
    const target = [...k.graph.nodes.values()]
      .filter(n => n.attrs.species === species).sort((a, b) => a.id - b.id)[0];
    if (target) (verb === 'pick' ? pick : chop)(k, player.id, target.id, t);
  }
  k.runTo(90 * DAY);
  const db = openDb(':memory:');
  checkpoint(k, db);
  return canonicalDump(db);
}

test('probe 4+: same seed + same intent log, twice → bit-identical dumps', () => {
  assert.equal(run(), run());
});
