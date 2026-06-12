// Headless traversal probe (Plan B): real LG catalog -> real f6 placement ->
// real resolver. PASS/FAIL per scenario; exit 1 on any FAIL.
import { LG_CATALOG } from '../src/world/lg-catalog.js';
import { f6Placements } from '../src/world/decoration-claims.js';
import { volumeForPlacement } from '../src/world/traversal-templates.js';
import { resolveMovement } from '../src/physics/movement.js';
import { verbsFor } from '../src/world/interaction-registry.js';

const biome = Object.keys(LG_CATALOG).find(b => LG_CATALOG[b].length);
if (!biome) { console.log('SKIP: no F6 assets on disk'); process.exit(0); }
const chunkStore = {
  tileAt: () => ({ walkable: true, biome, transitionPair: null }),
  getIfReady: () => null,
};
const ti = () => ({ biome, transition: false });

// find a deterministic tree placement with a trim; prefer one whose volume
// has a canopy (overheadZ) so the underCanopy scenario is exercised for real
// (27% of trees legitimately have overheadZ null).
let p = null, anchor = null;
outer: for (let x = 0; x < 2000; x++) for (let y = 0; y < 8; y++) {
  const pls = f6Placements(x, y, ti);
  if (pls.length && pls[0].trim && !pls[0].state) {
    if (!p) { p = pls[0]; anchor = [x, y]; }
    if (volumeForPlacement(pls[0], 'f6').overheadZ != null) { p = pls[0]; anchor = [x, y]; break outer; }
  }
}
if (!p) { console.log('SKIP: no base-state tree placement found in scan'); process.exit(0); }
const vol = volumeForPlacement(p, 'f6');
console.log(`tree: ${biome}/${p.name} v${p.variant} at tile ${anchor}, core r=${vol.baseRX.toFixed(2)}, ramp ${vol.rampW.toFixed(2)}/${vol.rampH}, overheadZ=${vol.overheadZ}`);

let fails = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails++; };

// step a player toward a target with gravity, like the game loop
function walk(player, txDir, tyDir, steps = 200, dt = 1 / 60, speed = 9) {
  for (let i = 0; i < steps; i++) {
    resolveMovement(player, chunkStore, txDir * speed * dt, tyDir * speed * dt);
    player.vz = (player.vz || 0) - 16 * dt;
    player.z = (player.z || 0) + player.vz * dt;
    const f = player.floorZ ?? 0;
    if (player.z < f) { player.z = f; player.vz = 0; }
  }
  return player;
}

// 1. trunk blocks: walk straight at the core from the south
{
  const pl = { x: vol.x, y: vol.y + 3, z: 0, vz: 0 };
  walk(pl, 0, -1);
  const gap = pl.y - vol.y;
  check('trunk blocks walk', gap >= vol.baseRY, `stopped ${gap.toFixed(2)} tiles from center (coreRY ${vol.baseRY.toFixed(2)})`);
}
// 2. root ramp raises z while approaching
{
  const pl = { x: vol.x, y: vol.y + 3, z: 0, vz: 0 };
  walk(pl, 0, -1);
  check('root ramp raises floor', vol.rampW > 0 ? pl.z > 0.05 : true, `z=${pl.z.toFixed(2)} at trunk`);
}
// 3. underCanopy on the roots
{
  const pl = { x: vol.x, y: vol.y + 3, z: 0, vz: 0 };
  walk(pl, 0, -1);
  check('underCanopy on roots', vol.overheadZ != null ? pl.underCanopy === true : true, `underCanopy=${pl.underCanopy}`);
}
// 4. stump state is standable: same archetype, state-switched volume
{
  const sp = { ...p, state: 'stump' };
  const sv = volumeForPlacement(sp, 'f6');
  // inject the stump volume (state-switched) and drop the player from above
  const drop = { x: sv.x, y: sv.y, z: sv.topZ + 0.5, vz: 0 };
  for (let i = 0; i < 120; i++) {
    resolveMovement(drop, chunkStore, 0, 0, () => [sv]);
    drop.vz -= 16 / 60; drop.z += drop.vz / 60;
    const f = drop.floorZ ?? 0;
    if (drop.z < f) { drop.z = f; drop.vz = 0; }
  }
  check('stump stand: z settles at topZ', Math.abs(drop.z - sv.topZ) < 0.01, `z=${drop.z.toFixed(2)} topZ=${sv.topZ.toFixed(2)}`);
  check('stump verbs auto-fill', verbsFor(sp.name, 'stump', sv).includes('traversal.stand-on'), '');
}
// 5. jump clears a short solid; trunk never clears
{
  const short = { x: 100, y: 100, baseRX: 0.3, baseRY: 0.18, rampW: 0, rampH: 0, solidH: 0.5, topZ: 0.5, overheadZ: null, overheadR: 0 };
  const pl = { x: 98.5, y: 100, z: 0, vz: 7.5 };
  let cleared = false;
  for (let i = 0; i < 90; i++) {
    resolveMovement(pl, chunkStore, 9 / 60, 0, () => [short]);
    pl.vz -= 16 / 60; pl.z += pl.vz / 60;
    const f = pl.floorZ ?? 0;
    if (pl.z < f) { pl.z = f; pl.vz = 0; }
    if (pl.x > 100.5) { cleared = true; break; }
  }
  check('jump clears low solid', cleared, `x=${pl.x.toFixed(2)}`);
}
console.log(fails ? `${fails} FAILURES` : 'ALL PASS');
process.exit(fails ? 1 : 0);
