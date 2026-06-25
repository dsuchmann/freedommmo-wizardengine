// bench-resolve.mjs — measure + decompose the building-resolve cost after L1/L2/L3.
// resolveBuildingsInRange is pure CPU (no GPU/DOM), so node timing is representative
// of the main-thread freeze the player hit (~1162ms before the fix).
import { performance } from 'node:perf_hooks';
import { resolveBuildingsInRange, clearCandidateMemo } from '../sim/world/buildings/resolved-buildings.js';
import { clearDiscoveryMemo } from '../sim/world/buildings/settlement-discovery.js';
import { classifyBiome, classifyBiomeNoStream, clearClimateCache } from '../src/world/biomes.js';
import { clearHydrologyCache } from '../src/world/hydrology.js';

const SEED = 42;
const WIDE = [15, 6, 25, 16];   // 11x11 macro range — a full visible-range crossing
const t = (fn) => { const s = performance.now(); const r = fn(); return [performance.now() - s, r]; };
function coldCaches() { clearClimateCache(); clearDiscoveryMemo(); clearHydrologyCache(); clearCandidateMemo(); }
function run(label, fn) {
  globalThis._dbgResolveMax = 0; globalThis._dbgResolveBreakdown = null;
  const [ms, r] = t(fn);
  return { label, ms: +ms.toFixed(1), breakdown: globalThis._dbgResolveBreakdown, n: r?.buildings?.length };
}

// The cost L1 removed: one cold classifyBiome WITH streams vs stream-free.
coldCaches(); const [streamMs] = t(() => classifyBiome(20 * 64 + 32, 11 * 64 + 32));
coldCaches(); const [noStreamMs] = t(() => classifyBiomeNoStream(20 * 64 + 32, 11 * 64 + 32));

const out = { removedByL1_classifyWithStreamMs: +streamMs.toFixed(1), classifyNoStreamMs: +noStreamMs.toFixed(2) };

coldCaches();
out.cold = run('cold (all caches cleared)', () => resolveBuildingsInRange(SEED, ...WIDE));
out.warm = run('warm (same range again)', () => resolveBuildingsInRange(SEED, ...WIDE));
out.shift = run('walk-crossing (shifted +1,+1)', () => resolveBuildingsInRange(SEED, 16, 7, 26, 17));

console.log(JSON.stringify(out, null, 2));
