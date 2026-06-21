// Headless test for the per-building material assignment (rendezvous hashing).
// Replicates the exact algorithm stamped in resolved-buildings.js + mix() from rng.js,
// and asserts: determinism, coherence, variance, and graceful pool-growth (gradual adoption).
// Run: node scripts/_test_material_assignment.mjs

// --- exact copy of sim/kernel/rng.js mix() ---
function scramble(n){ n=(n^61)^(n>>>16); n=Math.imul(n,9); n=n^(n>>>4); n=Math.imul(n,0x27d4eb2d); n=n^(n>>>15); return n>>>0; }
const PRIMES=[374761393,668265263,1442695041,2246822519,3266489917];
function mix(...ids){ let h=0x9e3779b9; for(let i=0;i<ids.length;i++){ h=scramble(h^Math.imul(ids[i]|0, PRIMES[i%PRIMES.length])); } return h; }

// --- exact copy of resolved-buildings.js assignment ---
const WALL_SALT=0x7741, ROOF_SALT=0x524f;
function slugInt(s){ let h=0; for(let i=0;i<s.length;i++) h=(Math.imul(h,131)+s.charCodeAt(i))|0; return h; }
function rendezvous(pool, seed, x, y, salt){
  let best=null, bw=-1;
  for(let i=0;i<pool.length;i++){ const w=mix(seed,x,y,slugInt(pool[i]),salt)>>>0; if(w>bw){bw=w;best=pool[i];} }
  return best;
}

const WALLS = ['wattle_daub','timber_frame','fieldstone','cob'];
const ROOFS = ['thatch','wood_shingle','clay_tile','turf_sod'];
const SEED = 1234567;
let fail = 0;
const ok = (c,m)=>{ if(!c){ console.log('  FAIL:',m); fail++; } else console.log('  ok  :',m); };

// build a synthetic grassland village of 400 buildings at distinct tiles
const town = [];
for(let i=0;i<400;i++) town.push({ x: 100 + (i%20)*3, y: 200 + ((i/20)|0)*3 });
const wallOf = (b,pool=WALLS)=>rendezvous(pool, SEED, b.x, b.y, WALL_SALT);
const roofOf = (b)=>rendezvous(ROOFS, SEED, b.x, b.y, ROOF_SALT);

console.log('1. DETERMINISM');
ok(town.every(b=>wallOf(b)===wallOf(b)), 'same building → same wall slug across calls');

console.log('2. COHERENCE');
ok(town.every(b=>WALLS.includes(wallOf(b)) && ROOFS.includes(roofOf(b))), 'every building resolves to a real wall+roof slug');

console.log('3. VARIANCE');
const wc={}, combos=new Set();
for(const b of town){ const w=wallOf(b); wc[w]=(wc[w]||0)+1; combos.add(w+'|'+roofOf(b)); }
console.log('   wall distribution:', wc);
ok(Object.keys(wc).length===4, 'all 4 wall materials appear across the village');
const min=Math.min(...Object.values(wc)), max=Math.max(...Object.values(wc));
ok(min > 400/4*0.5 && max < 400/4*1.6, `distribution roughly even (min ${min}, max ${max})`);
console.log('   distinct wall×roof combos seen:', combos.size, '/ 16');
ok(combos.size>=14, 'wall and roof vary independently (≥14 of 16 combos)');

console.log('4. RENDEZVOUS STABILITY (gradual adoption)');
const POOL5 = [...WALLS, 'limewash_brick'];
let moved=0, toNew=0;
for(const b of town){ const before=wallOf(b,WALLS), after=wallOf(b,POOL5); if(before!==after){ moved++; if(after==='limewash_brick') toNew++; } }
console.log(`   adding a 5th material: ${moved}/400 buildings changed, ${toNew} adopted the new one`);
ok(moved===toNew, 'the ONLY buildings that changed are the ones that adopted the new material (no reshuffle)');
ok(toNew > 400/5*0.4 && toNew < 400/5*1.8, `~1/5 adopted the new material (got ${toNew}, expect ~80)`);
const unchanged = 400 - moved;
ok(unchanged > 400*0.7, `${unchanged}/400 existing buildings UNCHANGED when the pool grew`);

console.log(fail===0 ? '\nALL ASSIGNMENT TESTS PASSED' : `\n${fail} ASSIGNMENT TEST(S) FAILED`);
process.exit(fail===0?0:1);
