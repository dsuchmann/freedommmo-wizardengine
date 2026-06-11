import { f3Placements, getClaimMask, isClaimedAt, clearClaimCaches } from '../src/world/decoration-claims.js';

const tileInfo = (wx, wy) => ({ biome: 'grassland', transition: false });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); fails++; } };

// determinism across cache clears (simulates worker vs main thread)
const a = JSON.stringify(f3Placements(100, 200, tileInfo));
clearClaimCaches();
const b = JSON.stringify(f3Placements(100, 200, tileInfo));
ok(a === b, 'placements deterministic');
const m1 = Array.from(getClaimMask(100, 200, tileInfo)).join(',');
clearClaimCaches();
const m2 = Array.from(getClaimMask(100, 200, tileInfo)).join(',');
ok(m1 === m2, 'masks deterministic');

// somewhere in a 50x50 region there are placements, and every placement's
// base center cell is claimed in its own tile's mask
let found = 0;
for (let wy = 0; wy < 50; wy++) for (let wx = 0; wx < 50; wx++) {
  for (const p of f3Placements(wx, wy, tileInfo)) {
    found++;
    ok(isClaimedAt(p.bx, p.by, tileInfo), `base center claimed @${wx},${wy}`);
  }
}
ok(found > 10, 'grassland 50x50 produced >10 placements, got ' + found);

// transition tiles and unknown biomes produce nothing
ok(f3Placements(5, 5, () => ({ biome: 'grassland', transition: true })).length === 0, 'transition skip');
ok(f3Placements(5, 5, () => ({ biome: 'nope', transition: false })).length === 0, 'unknown biome skip');

// ---- F4 medium flora ----
const { f4Placements, f4SpriteUrl } = await import('../src/world/decoration-claims.js');
const c1 = JSON.stringify(f4Placements(300, 400, tileInfo));
clearClaimCaches();
const c2 = JSON.stringify(f4Placements(300, 400, tileInfo));
ok(c1 === c2, 'f4 placements deterministic');

let f4found = 0, f4WithState = 0;
for (let wy = 0; wy < 80; wy++) for (let wx = 0; wx < 80; wx++) {
  for (const p of f4Placements(wx, wy, tileInfo)) {
    f4found++;
    if (p.state) f4WithState++;
    ok(p.size === 64 || p.size === 80, 'f4 size sane');
    ok(isClaimedAt(p.bx, p.by, tileInfo), `f4 base claimed @${wx},${wy}`);
    const u = f4SpriteUrl(p);
    ok(u.includes('/medium_flora/') && u.endsWith('.png'), 'f4 url shape: ' + u);
    if (p.state) ok(u.includes('/_states/' + p.state + '/'), 'f4 state url shape: ' + u);
  }
}
ok(f4found > 300, 'grassland 80x80 produced >300 f4 placements, got ' + f4found);
ok(f4WithState > 0, 'some f4 placements roll states, got ' + f4WithState);
ok(f4Placements(5, 5, () => ({ biome: 'grassland', transition: true })).length === 0, 'f4 transition skip');
ok(f4Placements(5, 5, () => ({ biome: 'water', transition: false })).length === 0, 'f4 unknown biome skip');

console.log(fails ? `${fails} FAILURES` : 'all decoration-claims tests passed');
process.exit(fails ? 1 : 0);
