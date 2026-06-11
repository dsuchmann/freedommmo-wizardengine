# Pass 1 Plan C — Simulation LOD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three simulation tiers (full / procedural / statistical) over one truth — distant regions run as conservation-exact aggregate nodes, promotion/demotion are auditable ledger events, pinned entities and group nodes never aggregate.

**Architecture:** A new `sim/lod/` package adds (1) **aggregate nodes** — one graph node per 16×16-tile region holding per-species population buckets `{count, sumR, sumBody, ageSum, detritusE}` that step once per sim-day through the same flux-rationing/burn/growth/death/birth physics as individuals, counting into the same ledger counters so the conservation identity holds across tiers; and (2) a **TierManager** that promotes aggregates → individuals (deterministic materialization honoring aggregate truth) and demotes individuals → aggregates as the attention bubble moves, with hysteresis. The server pump drives the TierManager from session viewports. Spec: §4.2, §4.3 of `docs/superpowers/specs/2026-06-11-pass1-time-metabolism-simulation-kernel-design.md`.

**Tech Stack:** Node ESM, `node:test`, better-sqlite3 (existing store), ws (existing server). No new dependencies.

**Branch:** `pass1c-simulation-lod` off `master`.

---

## Design decisions (read before any task)

1. **One aggregate node per region** (not per species). `type: 'aggregate'`, `R: null` (so flux/`reRateTileOf`/`runEagerTo`/`loadKernel` flux-rebuild all skip it automatically), positioned at the region center so `nodesNear` finds it. `attrs: { region: "rx,ry", pops: { [species]: { count, sumR, sumBody, ageSum, detritusE } } }`. One node per region means cross-species flux rationing happens inside a single `agg_step` handler — no sibling-ordering subtleties.
2. **Aggregates are step-discrete, not lazy-continuous.** They accrue ONLY at `agg_step` events (every sim-day). Both the stock change and the `captured`/`burned`/`decayed` counter increments happen at the same instant, so the conservation identity `Δ(stocks) = captured − burned − decayed − transferLoss` holds exactly at any tick — un-stepped partial days appear on neither side.
3. **Region size 16 tiles** (`REGION = 16`) — exactly 2×2 of the graph's 8-tile grid cells.
4. **Statistical physics mirrors individual physics**: demand/burn from `SPECIES` × stage factors at the population's *mean age* (single-bucket demographics — count, sums, ageSum; documented simplification), senescence multipliers computed analytically from mean age, flux rationed against `phi × 256` per region, growth split by `growFrac` capped at `count × maxBody`, starvation kills the fraction whose burn went unmet (burn is only counted up to what's available — same rule as individual `die()` overdraft correction), births at `count·dt/seed.every` paying `seed.cost` through the nurture channel, dead bodies become `detritusE` decaying exponentially with the species' `embodiedDecayDays` (counted as `decayed`).
5. **Stochastic rounding** for fractional deaths/births uses `rand(seed, aggId, tick-derived salt)` — deterministic, call-order independent (spec §5.5).
6. **Promotion honors aggregate truth**: materializes exactly `count` individuals whose R/body sums equal `sumR`/`sumBody` exactly (deterministic weights, normalized), ages jittered around mean age, positions from `rand(seed, aggId, slot)` within the region. `detritusE` becomes a real corpse node. Every individual carries `causeEventId` = the `promote` ledger event (provenance §5.4). Promotion of a region that was *never* individual will not reproduce the same individuals a never-demoted baseline would have — accepted: spec §4.3 requires honoring counts/aggregate truth, not individual identity.
7. **Never demoted**: `player`, `group`, `corpse`, `aggregate` node types, and anything with `attrs.pinned`. Corpses stay individual because they are inert and lazy (zero CPU between events). `pick` pins its target (named in a player ledger event → story-relevant, spec §4.3).
8. **Procedural tier = individuals, same dynamics as full.** The only spec'd differences (rule-based vs LLM Agency, coarser Agency events) have no consumer in Pass 1 — Agency is honestly absent (§6.1). The TierManager still tracks `full` vs `procedural` labels per region so the future Agency pass has its seam. Building fake "coarser events" with no consumer would violate YAGNI without changing any observable.
9. **Hysteresis**: promote everything within `ringR = 4` regions (Chebyshev) of a bubble center; demote only beyond `demoteR = 5`. A center oscillating across a region boundary never thrashes.
10. **Demote-then-merge**: demoting into a region that already has an aggregate first steps the aggregate to the current tick, then merges sums.
11. **`graph.boot()` becomes re-entrant** (save/restore `_boot`) so `spawnWorld` can call `spawnMeadow` per-region inside one boot scope.

**GIT SAFETY (repeat in every subagent prompt):** Never `git add -A` or `git add .` — stage exact files only. Never `reset --hard`, `checkout --`/`checkout <sha>`, `stash`, or `--amend`. The repo contains unrelated dirty/untracked asset files (`assets/`, `.claude/`, `.playwright-mcp/`) — do not touch them. Never push.

## File structure

- Create: `sim/lod/aggregate.js` — region math, aggregate creation, `agg_step` statistical dynamics
- Create: `sim/lod/tiers.js` — `demoteRegion`, `promoteRegion`, `TierManager`
- Modify: `sim/kernel/kernel.js` — register aggregate handler; `stocks()` counts aggregates
- Modify: `sim/store/graph.js` — re-entrant `boot()`
- Modify: `sim/world/spawn.js` — `spawnRegionAggregate`, `spawnWorld`; export `DENSITY`/`START`
- Modify: `sim/world/actions.js` — `pick` pins its target
- Modify: `sim/server/server.js` — TierManager in pump; aggregates filtered from bubble
- Modify: `sim/server/main.js` — boot a statistical world with an individual start area
- Test: `sim/test/aggregate.test.js`, `sim/test/tiers.test.js`, `sim/test/probe-lod.test.js`; extend `sim/test/server.test.js`

---

### Task 1: Aggregate node + statistical baseline spawn

**Files:**
- Create: `sim/lod/aggregate.js` (region helpers + creation only; dynamics in Task 2)
- Modify: `sim/store/graph.js:18` (re-entrant boot)
- Modify: `sim/world/spawn.js` (export tables; `spawnRegionAggregate`; `spawnWorld`)
- Test: `sim/test/aggregate.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// sim/test/aggregate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { REGION, regionKeyOf, regionOrigin, aggregateOf, createAggregate, AGG_STEP } from '../lod/aggregate.js';
import { spawnWorld, spawnRegionAggregate } from '../world/spawn.js';

test('region helpers: 16-tile regions, stable keys', () => {
  assert.equal(REGION, 16);
  assert.equal(regionKeyOf(0, 0), '0,0');
  assert.equal(regionKeyOf(15.9, 15.9), '0,0');
  assert.equal(regionKeyOf(16, 0), '1,0');
  assert.deepEqual(regionOrigin('2,3'), [32, 48]);
});

test('createAggregate places the node at region center and schedules agg_step', () => {
  const k = new Kernel({ seed: 7 });
  let agg;
  k.graph.boot(() => {
    agg = createAggregate(k, '1,1', { grass: { count: 10, sumR: 5000, sumBody: 300, ageSum: 10 * 20 * 86400, detritusE: 0 } }, 0, null);
  });
  assert.equal(agg.type, 'aggregate');
  assert.equal(agg.x, 24); assert.equal(agg.y, 24);
  assert.equal(agg.R, null);                       // never captures flux, never re-rated
  assert.equal(aggregateOf(k, '1,1'), agg);
  assert.equal(aggregateOf(k, '0,0'), undefined);
  assert.ok(k.scheduler.heap.a.some(e => e.nodeId === agg.id && e.kind === 'agg_step' && e.tick === AGG_STEP));
});

test('spawnRegionAggregate is deterministic and mass matches expected densities', () => {
  const a = new Kernel({ seed: 42 }), b = new Kernel({ seed: 42 });
  a.graph.boot(() => spawnRegionAggregate(a, 3, 5));
  b.graph.boot(() => spawnRegionAggregate(b, 3, 5));
  const pa = aggregateOf(a, '3,5').attrs.pops, pb = aggregateOf(b, '3,5').attrs.pops;
  assert.deepEqual(pa, pb);                          // bit-identical from seed
  // grass density 0.5 over 256 tiles → count near 128 (stochastic rounding ±1)
  assert.ok(Math.abs(pa.grass.count - 128) <= 1);
  assert.ok(pa.grass.sumR > 0 && pa.grass.sumBody > 0 && pa.grass.ageSum > 0);
});

test('spawnWorld: individuals inside fullRect, aggregates outside, all baseline provenance', () => {
  const k = new Kernel({ seed: 42, bounds: { x0: 0, y0: 0, w: 64, h: 32 } });
  spawnWorld(k, { x0: 0, y0: 0, w: 64, h: 32 }, { x0: 0, y0: 0, w: 16, h: 16 });
  assert.equal(aggregateOf(k, '0,0'), undefined);    // start region is individual
  assert.ok(aggregateOf(k, '1,0'));                  // everything else statistical
  assert.ok(aggregateOf(k, '3,1'));
  const individuals = [...k.graph.nodes.values()].filter(n => n.R != null);
  assert.ok(individuals.length > 0);
  assert.ok(individuals.every(n => n.x < 16 && n.y < 16));
});

test('nested boot scopes stay baseline (re-entrant)', () => {
  const k = new Kernel({ seed: 1 });
  k.graph.boot(() => {
    k.graph.boot(() => {});
    // still inside outer boot — must not throw provenance
    k.graph.createNode({ type: 'group', tick: 0, attrs: {} });
  });
  assert.ok([...k.graph.nodes.values()].some(n => n.type === 'group'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sim/test/aggregate.test.js`
Expected: FAIL — `Cannot find module '../lod/aggregate.js'`.

- [ ] **Step 3: Implement**

`sim/lod/aggregate.js` (creation half — `stepAggregate`/`registerAggregates` arrive in Task 2):

```js
// sim/lod/aggregate.js — statistical-tier aggregate nodes (spec §4.2).
// One node per 16×16-tile region; per-species buckets {count,sumR,sumBody,ageSum,detritusE}.
// Aggregates are step-discrete: stocks AND ledger counters change only at agg_step,
// so the conservation identity holds exactly at every tick.
import { DAY } from '../time/metabolism.js';

export const REGION = 16;            // tiles per region side (2×2 graph grid cells)
export const AGG_STEP = DAY;         // statistical step cadence (coarse events, spec §4.2)

export const regionKeyOf = (x, y) => `${Math.floor(x / REGION)},${Math.floor(y / REGION)}`;
export const regionOrigin = key => key.split(',').map(n => Number(n) * REGION);

/** The aggregate node for a region, or undefined. (It sits exactly at the region center.) */
export function aggregateOf(kernel, regionKey) {
  const [x0, y0] = regionOrigin(regionKey);
  return kernel.graph.nodesNear(x0 + REGION / 2, y0 + REGION / 2, 0.5)
    .find(n => n.type === 'aggregate' && n.attrs.region === regionKey);
}

/** Create an aggregate node (inside boot scope or with a causal event) and schedule its first step. */
export function createAggregate(kernel, regionKey, pops, tick, causeEventId) {
  const [x0, y0] = regionOrigin(regionKey);
  const node = kernel.graph.createNode({
    type: 'aggregate', tick, x: x0 + REGION / 2, y: y0 + REGION / 2,
    causeEventId, attrs: { region: regionKey, pops },
  });
  kernel.scheduler.schedule(tick + AGG_STEP, node.id, 'agg_step', -1);
  return node;
}
```

`sim/store/graph.js` — make `boot` re-entrant. Replace line 18:

```js
  boot(fn) { const prev = this._boot; this._boot = true; try { fn(); } finally { this._boot = prev; } }
```

`sim/world/spawn.js` — export the tables and add the statistical spawners. Change line 5–11 `const` to `export const` for both `DENSITY` and `START`, then append:

```js
import { REGION, createAggregate } from '../lod/aggregate.js';

/** Statistical baseline for one region: expected counts from the same DENSITY table,
 *  means from the same START ranges the individual spawner uses (spec §5.1 — baseline from seed).
 *  w/h: actual in-bounds tile extent (edge regions clipped by world bounds). */
export function spawnRegionAggregate(kernel, rx, ry, w = REGION, h = REGION) {
  const pops = {};
  let salt = 0;
  for (const species of Object.keys(DENSITY)) {
    salt += 1000;
    const expected = DENSITY[species] * w * h;
    const frac = expected - Math.floor(expected);
    const count = Math.floor(expected) + (rand(kernel.seed, rx * 131 + salt, ry * 173 + salt) < frac ? 1 : 0);
    if (count === 0) continue;
    const s = START[species];
    pops[species] = {
      count,
      sumR: count * (s.R[0] + s.R[1]) / 2,
      sumBody: count * (s.body[0] + s.body[1]) / 2,
      ageSum: count * s.maxAgeDays * DAY / 2,
      detritusE: 0,
    };
  }
  if (Object.keys(pops).length) createAggregate(kernel, `${rx},${ry}`, pops, kernel.tick, null);
}

/** Whole-world baseline: individuals where the attention bubble starts, aggregates everywhere else. */
export function spawnWorld(kernel, bounds, fullRect) {
  kernel.graph.boot(() => {
    const r0x = Math.floor(bounds.x0 / REGION), r1x = Math.ceil((bounds.x0 + bounds.w) / REGION);
    const r0y = Math.floor(bounds.y0 / REGION), r1y = Math.ceil((bounds.y0 + bounds.h) / REGION);
    for (let ry = r0y; ry < r1y; ry++) for (let rx = r0x; rx < r1x; rx++) {
      const gx = rx * REGION, gy = ry * REGION;
      // clip edge regions to the world bounds so baseline never spawns outside the world
      const cw = Math.min(REGION, bounds.x0 + bounds.w - gx), ch = Math.min(REGION, bounds.y0 + bounds.h - gy);
      const overlaps = gx < fullRect.x0 + fullRect.w && gx + REGION > fullRect.x0
        && gy < fullRect.y0 + fullRect.h && gy + REGION > fullRect.y0;
      if (overlaps) spawnMeadow(kernel, { x0: gx, y0: gy, w: cw, h: ch });
      else spawnRegionAggregate(kernel, rx, ry, cw, ch);
    }
  });
}
```

(`rand` and `DAY` are already imported at the top of spawn.js.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test sim/test/aggregate.test.js` → PASS (5 tests). Then the full suite: `npm test` → all green (no regressions; nothing yet consumes aggregates).

- [ ] **Step 5: Commit**

```bash
git add sim/lod/aggregate.js sim/store/graph.js sim/world/spawn.js sim/test/aggregate.test.js
git commit -m "feat(lod): aggregate node shape + statistical baseline spawn (spec 4.2)"
```

---

### Task 2: Aggregate dynamics — the `agg_step` handler

**Files:**
- Modify: `sim/lod/aggregate.js` (append dynamics)
- Modify: `sim/kernel/kernel.js` (register handler; `stocks()` aggregate branch)
- Test: `sim/test/aggregate.test.js` (append)

- [ ] **Step 1: Write the failing tests** (append to `sim/test/aggregate.test.js`)

```js
function flows(k) {
  const t = k.ledger.totals;
  return t.captured - t.burned - t.decayed - t.transferLoss;
}

test('agg_step: conservation identity holds exactly over a statistical year', () => {
  const k = new Kernel({ seed: 42, bounds: { x0: 0, y0: 0, w: 64, h: 64 } });
  spawnWorld(k, { x0: 0, y0: 0, w: 64, h: 64 }, { x0: 0, y0: 0, w: 0, h: 0 });  // all statistical
  const start = k.stocks(0), f0 = flows(k);
  k.runTo(360 * 86400);
  const end = k.stocks(k.tick), f1 = flows(k);
  const scale = Math.max(Math.abs(k.ledger.totals.captured), 1);
  assert.ok(Math.abs((end - start) - (f1 - f0)) / scale < 1e-9,
    `conservation: Δstocks=${end - start} Δflows=${f1 - f0}`);
});

test('agg_step: populations persist without explosion or instant extinction', () => {
  const k = new Kernel({ seed: 42, bounds: { x0: 0, y0: 0, w: 64, h: 64 } });
  spawnWorld(k, { x0: 0, y0: 0, w: 64, h: 64 }, { x0: 0, y0: 0, w: 0, h: 0 });
  const count = kk => [...kk.graph.nodes.values()].filter(n => n.type === 'aggregate')
    .reduce((s, n) => s + (n.attrs.pops.grass?.count ?? 0), 0);
  const c0 = count(k);
  k.runTo(360 * 86400);
  const c1 = count(k);
  assert.ok(c1 > 0, 'grass must not go extinct in a year');
  // Region-pooled flux carries ~25× the baseline density before starvation bites
  // (baseline spawns well below carrying capacity); the bound catches unbounded growth.
  assert.ok(c1 < c0 * 50, `grass must not explode (was ${c0}, now ${c1})`);
});

test('agg_step is deterministic (two runs, identical pops)', () => {
  const run = () => {
    const k = new Kernel({ seed: 99, bounds: { x0: 0, y0: 0, w: 32, h: 32 } });
    spawnWorld(k, { x0: 0, y0: 0, w: 32, h: 32 }, { x0: 0, y0: 0, w: 0, h: 0 });
    k.runTo(200 * 86400);
    return JSON.stringify([...k.graph.nodes.values()].filter(n => n.type === 'aggregate')
      .sort((a, b) => a.id - b.id).map(n => n.attrs));
  };
  assert.equal(run(), run());
});

test('stocks() counts aggregate mass', () => {
  const k = new Kernel({ seed: 7 });
  k.graph.boot(() => createAggregate(k, '0,0',
    { grass: { count: 4, sumR: 1000, sumBody: 100, ageSum: 4 * 86400 * 20, detritusE: 50 } }, 0, null));
  assert.equal(k.stocks(0), 1150);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test sim/test/aggregate.test.js`
Expected: FAIL — `stocks()` returns 0 for aggregate-only worlds; no `agg_step` handler ('agg_step' events pop with no handler, populations never change → conservation trivially passes but population/stocks tests fail).

- [ ] **Step 3: Implement dynamics** (append to `sim/lod/aggregate.js`)

```js
import { SPECIES, stageAt, transfer } from '../time/metabolism.js';
import { rand } from '../kernel/rng.js';
```

(Merge into the existing import from `'../time/metabolism.js'` — final form `import { DAY, SPECIES, stageAt, transfer } from '../time/metabolism.js';` at top.)

```js
/** Deterministic stochastic rounding: floor(x) + Bernoulli(frac) from (seed, ids). */
function stochRound(seed, a, b, x) {
  const fl = Math.floor(x);
  return fl + (rand(seed, a, b) < x - fl ? 1 : 0);
}

/** Senescence multipliers at a mean age, computed analytically (mirrors sen_step compounding). */
function senMuls(sp, meanAge) {
  if (meanAge <= sp.senescence.start) return { burnMul: 1, demandMul: 1 };
  const steps = (meanAge - sp.senescence.start) / sp.senescence.stepEvery;
  return { burnMul: sp.senescence.burnGrowth ** steps, demandMul: sp.senescence.demandDecay ** steps };
}

/** Advance one region's populations by dt ticks. Conservation-exact: every stock change
 *  has a matching counter increment in the same call. */
export function stepAggregate(kernel, node, tick, dt) {
  const pops = node.attrs.pops;
  for (const p of Object.values(pops)) p.ageSum += p.count * dt;   // aging first

  // Region-wide flux rationing across species (same proportional rule as FluxField).
  const regionPhi = kernel.flux.phi * REGION * REGION;
  const demands = {};
  let totalDemand = 0;
  for (const [species, p] of Object.entries(pops)) {
    if (p.count <= 0) { demands[species] = 0; continue; }
    const sp = SPECIES[species];
    const meanAge = p.ageSum / p.count;
    demands[species] = sp.demand * stageAt(species, meanAge)[2] * senMuls(sp, meanAge).demandMul * p.count;
    totalDemand += demands[species];
  }
  const ration = totalDemand > regionPhi ? regionPhi / totalDemand : 1;

  for (const [species, p] of Object.entries(pops)) {
    const sp = SPECIES[species];
    if (p.count > 0) {
      const meanAge = p.ageSum / p.count;
      const captured = demands[species] * ration * dt;
      const burnDemand = sp.burn * stageAt(species, meanAge)[3] * senMuls(sp, meanAge).burnMul * p.count * dt;
      // Burn only what exists (the individual-tier overdraft rule, applied up front).
      const burned = Math.min(burnDemand, p.sumR + captured);
      kernel.ledger.count('captured', captured);
      kernel.ledger.count('burned', burned);
      let net = captured - burned;
      if (net > 0 && meanAge <= sp.senescence.start) {
        const grow = Math.min(sp.growFrac * net, Math.max(0, p.count * sp.maxBody - p.sumBody));
        p.sumBody += grow; net -= grow;
      }
      p.sumR += net;   // ≥ 0 by construction of `burned`
      // Starvation: the fraction whose burn went unmet dies; bodies persist as detritus.
      if (burned < burnDemand - 1e-9) {
        const deaths = Math.min(p.count,
          stochRound(kernel.seed, node.id, tick + 7, p.count * (burnDemand - burned) / burnDemand));
        if (deaths > 0) {
          const mAge = p.ageSum / p.count, mBody = p.sumBody / p.count;
          p.count -= deaths;
          p.ageSum -= deaths * mAge;
          p.sumBody -= deaths * mBody;
          p.detritusE += deaths * mBody;
          kernel.ledger.emit({ tick, type: 'agg_deaths', targets: [node.id], magnitude: deaths, attrs: { species } });
        }
      }
      // Births: mature, pre-senescent, per-capita reserve above the seeding floor.
      if (p.count > 0) {
        const mAge = p.ageSum / p.count;
        if (stageAt(species, mAge)[0] === 'mature' && mAge <= sp.senescence.start
            && p.sumR / p.count >= sp.seed.minR) {
          const births = stochRound(kernel.seed, node.id, tick + 11, p.count * dt / sp.seed.every);
          if (births > 0) {
            const cost = Math.min(births * sp.seed.cost, p.sumR);
            p.sumR -= cost;
            const delivered = transfer(cost, 'nurture', kernel.ledger);
            p.sumR += delivered * 0.7;
            p.sumBody += delivered * 0.3;
            p.count += births;            // newborns at age 0: ageSum unchanged
          }
        }
      }
    }
    // Detritus decays like a corpse pool.
    if (p.detritusE > 0) {
      const f = Math.pow(2, -dt / (sp.embodiedDecayDays * DAY));
      kernel.ledger.count('decayed', p.detritusE * (1 - f));
      p.detritusE *= f;
    }
    if (p.count <= 0 && p.detritusE <= 0.5) {
      kernel.ledger.count('decayed', p.detritusE);
      delete pops[species];
    }
  }
  if (Object.keys(pops).length === 0) kernel.graph.removeNode(node.id);  // pending agg_step goes stale
}

/** Bring an aggregate current (used by demote-merge and promote). */
export function stepAggregateTo(kernel, node, tick) {
  const dt = tick - node.lastTick;
  if (dt > 0) { stepAggregate(kernel, node, tick, dt); node.lastTick = tick; }
}

export function registerAggregates(kernel) {
  kernel.on('agg_step', (k, node, ev) => {
    stepAggregateTo(k, node, ev.tick);
    if (k.graph.nodes.get(node.id)) k.scheduler.schedule(ev.tick + AGG_STEP, node.id, 'agg_step', -1);
  });
}
```

`sim/kernel/kernel.js` — two edits:

1. Register the handler. Add to imports: `import { registerAggregates } from '../lod/aggregate.js';` and in the constructor after `registerLifecycle(this);` add `registerAggregates(this);`
2. `stocks()` — in the for-loop, before the `else if (n.R != null)` branch, add:

```js
      } else if (n.type === 'aggregate') {
        for (const p of Object.values(n.attrs.pops)) s += p.sumR + p.sumBody + p.detritusE;
```

(Final branch order: `corpse` → `aggregate` → `R != null`.)

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/aggregate.test.js` → PASS. Then `npm test` → all green. If the population-band test fails (extinction/explosion), the dynamics constants are NOT to be tuned — the same SPECIES tables drive both tiers; investigate the math instead (likely a dt or per-capita error).

- [ ] **Step 5: Commit**

```bash
git add sim/lod/aggregate.js sim/kernel/kernel.js sim/test/aggregate.test.js
git commit -m "feat(lod): agg_step statistical dynamics — conservation-exact, deterministic (spec 4.2)"
```

---

### Task 3: Demotion — individuals fold into aggregates

**Files:**
- Create: `sim/lod/tiers.js` (demotion half)
- Modify: `sim/world/actions.js` (pick pins)
- Test: `sim/test/tiers.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// sim/test/tiers.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';
import { aggregateOf } from '../lod/aggregate.js';
import { demoteRegion } from '../lod/tiers.js';
import { createPlayer, pick } from '../world/actions.js';

const meadowKernel = (seed = 42) => {
  const k = new Kernel({ seed, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
  spawnMeadow(k, { x0: 0, y0: 0, w: 16, h: 16 });
  return k;
};

test('demotion folds individuals into an aggregate, conserving count and mass exactly', () => {
  const k = meadowKernel();
  k.runTo(30 * 86400);
  const living = [...k.graph.nodes.values()].filter(n => n.R != null);
  const expect = {};
  for (const n of living) {
    k.closeSegment(n, k.tick);
    const e = expect[n.attrs.species] ??= { count: 0, mass: 0 };
    e.count++; e.mass += Math.max(0, n.R) + n.attrs.body;
  }
  const before = k.stocks(k.tick);
  const agg = demoteRegion(k, '0,0', k.tick);
  assert.ok(agg, 'aggregate created');
  for (const [species, e] of Object.entries(expect)) {
    const p = agg.attrs.pops[species];
    assert.equal(p.count, e.count, species);
    assert.ok(Math.abs(p.sumR + p.sumBody - e.mass) < 1e-6, species);
  }
  assert.ok([...k.graph.nodes.values()].every(n => n.R == null || n.attrs.noFlux), 'no loose individuals');
  // demotion moves mass between tiers; it must not create or destroy any
  assert.ok(Math.abs(k.stocks(k.tick) - before) / Math.max(before, 1) < 1e-9);
  assert.ok(k.ledger.events.some(e => e.type === 'demote' && e.targets.includes(agg.id)));
});

test('pinned, player, group, and corpse nodes survive demotion individually', () => {
  const k = meadowKernel();
  k.runTo(10 * 86400);
  const player = createPlayer(k, k.tick);
  const bush = [...k.graph.nodes.values()].find(n => n.attrs.species === 'berry_bush');
  assert.ok(bush, 'meadow has a bush');
  pick(k, player.id, bush.id, k.tick);              // pick pins (named in a player ledger event)
  assert.equal(bush.attrs.pinned, true);
  let group;
  k.graph.boot(() => { group = k.graph.createNode({ type: 'group', tick: k.tick, x: 4, y: 4, attrs: {} }); });
  k.runTo(k.tick + 86400);
  demoteRegion(k, '0,0', k.tick);
  assert.ok(k.graph.nodes.get(bush.id), 'pinned bush still individual');
  assert.ok(k.graph.nodes.get(group.id), 'group node individual at every tier (spec 4.2)');
  assert.ok(k.graph.nodes.get(player.id), 'player untouched');
});

test('demoting an already-aggregated or empty region is a no-op', () => {
  const k = meadowKernel();
  demoteRegion(k, '0,0', 0);
  assert.equal(demoteRegion(k, '0,0', 0), null);    // nothing left to fold
  assert.equal(demoteRegion(k, '5,5', 0), null);    // empty region
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test sim/test/tiers.test.js`
Expected: FAIL — `Cannot find module '../lod/tiers.js'`.

- [ ] **Step 3: Implement**

`sim/lod/tiers.js`:

```js
// sim/lod/tiers.js — promotion/demotion between tiers, as ledger events (spec §4.3).
import { REGION, regionKeyOf, regionOrigin, aggregateOf, createAggregate, stepAggregateTo } from './aggregate.js';

const NEVER_DEMOTE = new Set(['player', 'group', 'corpse', 'aggregate']);
const HALF = REGION / 2;
const RADIUS = HALF * Math.SQRT2 + 1e-9;   // circumscribes the region square

function regionNodes(kernel, regionKey) {
  const [x0, y0] = regionOrigin(regionKey);
  return kernel.graph.nodesNear(x0 + HALF, y0 + HALF, RADIUS)
    .filter(n => regionKeyOf(n.x, n.y) === regionKey);
}

/** Fold every unpinned individual in a region into the region aggregate.
 *  Returns the aggregate (or null if nothing was folded). */
export function demoteRegion(kernel, regionKey, tick) {
  const victims = regionNodes(kernel, regionKey)
    .filter(n => n.R != null && !NEVER_DEMOTE.has(n.type) && !n.attrs.pinned && !n.attrs.noFlux);
  if (victims.length === 0) return null;
  const pops = {};
  for (const n of victims) {
    kernel.closeSegment(n, tick);
    if (n.R < 0) { kernel.ledger.count('burned', n.R); n.R = 0; }   // scheduler-ceil overdraft correction
    const p = pops[n.attrs.species] ??= { count: 0, sumR: 0, sumBody: 0, ageSum: 0, detritusE: 0 };
    p.count++; p.sumR += n.R; p.sumBody += n.attrs.body;
    p.ageSum += tick - n.attrs.birthTick;
    kernel.flux.leave(n.id);
    kernel.graph.removeNode(n.id);                                   // scheduled events go stale
  }
  const evId = kernel.ledger.emit({
    tick, type: 'demote',
    attrs: { region: regionKey, counts: Object.fromEntries(Object.entries(pops).map(([s, p]) => [s, p.count])) },
  });
  let agg = aggregateOf(kernel, regionKey);
  if (agg) {
    stepAggregateTo(kernel, agg, tick);                              // bring current before merging
    if (!kernel.graph.nodes.get(agg.id)) agg = null;                 // it may have emptied out
  }
  if (agg) {
    for (const [s, p] of Object.entries(pops)) {
      const t = agg.attrs.pops[s] ??= { count: 0, sumR: 0, sumBody: 0, ageSum: 0, detritusE: 0 };
      t.count += p.count; t.sumR += p.sumR; t.sumBody += p.sumBody; t.ageSum += p.ageSum;
    }
  } else {
    agg = createAggregate(kernel, regionKey, pops, tick, evId);
  }
  kernel.ledger.events[evId - 1].targets.push(agg.id);               // events array is id-ordered
  // Survivors (pinned) get the freed flux: re-rate everything still living in the region.
  for (const n of regionNodes(kernel, regionKey)) {
    if (n.R != null && !n.attrs.noFlux) kernel._reRateOne(n, tick);
  }
  return agg;
}
```

`sim/world/actions.js` — in `pick()`, right after the `if (!sp?.pick) return 0;` line, add:

```js
  prey.attrs.pinned = true;   // named in a player ledger event → pinned individual (spec §4.3)
```

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/tiers.test.js` → PASS. Then `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add sim/lod/tiers.js sim/world/actions.js sim/test/tiers.test.js
git commit -m "feat(lod): demotion — individuals fold into aggregates; pinning via pick (spec 4.3)"
```

---

### Task 4: Promotion — aggregates materialize into individuals

**Files:**
- Modify: `sim/lod/tiers.js` (append `promoteRegion`)
- Test: `sim/test/tiers.test.js` (append)

- [ ] **Step 1: Write the failing tests** (append to `sim/test/tiers.test.js`; extend the import from `../lod/tiers.js` with `promoteRegion`, and add `import { spawnWorld } from '../world/spawn.js';` plus `REGION` to the aggregate import if not present)

```js
test('promotion materializes exactly the aggregate truth (counts + mass), deterministically', () => {
  const k = new Kernel({ seed: 42, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
  spawnWorld(k, { x0: 0, y0: 0, w: 16, h: 16 }, { x0: 16, y0: 16, w: 0, h: 0 });  // all statistical
  k.runTo(100 * 86400);
  const agg = aggregateOf(k, '0,0');
  assert.ok(agg);
  // capture truth AFTER stepping to now (promotion steps internally; mirror it)
  const before = k.stocks(k.tick);
  const popsBefore = JSON.parse(JSON.stringify(agg.attrs.pops));
  const made = promoteRegion(k, '0,0', k.tick);
  assert.equal(aggregateOf(k, '0,0'), undefined, 'aggregate gone');
  for (const [species, p] of Object.entries(popsBefore)) {
    const kin = made.filter(n => n.attrs.species === species);
    assert.equal(kin.length, p.count, `${species} count honored`);
    const sumR = kin.reduce((s, n) => s + n.R, 0);
    const sumBody = kin.reduce((s, n) => s + n.attrs.body, 0);
    assert.ok(Math.abs(sumR - p.sumR) / Math.max(p.sumR, 1) < 1e-9, `${species} sumR exact`);
    assert.ok(Math.abs(sumBody - p.sumBody) / Math.max(p.sumBody, 1) < 1e-9, `${species} sumBody exact`);
    assert.ok(kin.every(n => regionKeyOf(n.x, n.y) === '0,0'), `${species} inside region`);
    assert.ok(kin.every(n => n.createdByEvent != null), 'provenance: caused by promote event');
  }
  assert.ok(Math.abs(k.stocks(k.tick) - before) / Math.max(before, 1) < 1e-9, 'promotion conserves');
  assert.ok(k.ledger.events.some(e => e.type === 'promote'));
});

test('promotion is deterministic: same world, same tick → identical individuals', () => {
  const run = () => {
    const k = new Kernel({ seed: 7, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
    spawnWorld(k, { x0: 0, y0: 0, w: 16, h: 16 }, { x0: 16, y0: 16, w: 0, h: 0 });
    k.runTo(50 * 86400);
    return JSON.stringify(promoteRegion(k, '0,0', k.tick)
      .map(n => [n.attrs.species, n.x, n.y, n.R, n.attrs.body, n.attrs.birthTick]));
  };
  assert.equal(run(), run());
});

test('demote → promote round trip conserves and repopulates', () => {
  const k = meadowKernel();
  k.runTo(30 * 86400);
  const before = k.stocks(k.tick);
  demoteRegion(k, '0,0', k.tick);
  const made = promoteRegion(k, '0,0', k.tick);
  assert.ok(made.length > 0);
  assert.ok(Math.abs(k.stocks(k.tick) - before) / Math.max(before, 1) < 1e-9);
  // promoted individuals live: they capture flux and survive further sim
  k.runTo(k.tick + 30 * 86400);
  assert.ok([...k.graph.nodes.values()].some(n => n.R != null));
});

test('promoting a region with no aggregate is a no-op', () => {
  const k = meadowKernel();
  assert.deepEqual(promoteRegion(k, '0,0', 0), []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test sim/test/tiers.test.js`
Expected: FAIL — `promoteRegion` is not exported.

- [ ] **Step 3: Implement** (append to `sim/lod/tiers.js`; add imports `SPECIES, DAY` from `'../time/metabolism.js'` and `rand` from `'../kernel/rng.js'`)

```js
const SPECIES_IDX = Object.fromEntries(Object.keys(SPECIES).map((s, i) => [s, i + 1]));

/** Materialize a region's aggregate into individuals, honoring count/sumR/sumBody exactly
 *  (spec §4.3: counts and aggregate truth are honored, never contradicted).
 *  Returns the created nodes ([] if the region has no aggregate). */
export function promoteRegion(kernel, regionKey, tick) {
  const agg = aggregateOf(kernel, regionKey);
  if (!agg) return [];
  stepAggregateTo(kernel, agg, tick);                     // settle the partial day first
  if (!kernel.graph.nodes.get(agg.id)) return [];         // it emptied out while stepping
  const [x0, y0] = regionOrigin(regionKey);
  const pops = agg.attrs.pops;
  const evId = kernel.ledger.emit({
    tick, type: 'promote', targets: [agg.id],
    attrs: { region: regionKey, counts: Object.fromEntries(Object.entries(pops).map(([s, p]) => [s, p.count])) },
  });
  const made = [];
  for (const [species, p] of Object.entries(pops)) {
    const sIdx = SPECIES_IDX[species] * 1_000_000;
    if (p.count > 0) {
      // Deterministic weights, normalized → ΣR_i = sumR and Σbody_i = sumBody exactly.
      const wR = [], wB = [];
      let WR = 0, WB = 0;
      for (let i = 0; i < p.count; i++) {
        wR[i] = 0.5 + rand(kernel.seed, agg.id, sIdx + i * 8 + 1); WR += wR[i];
        wB[i] = 0.5 + rand(kernel.seed, agg.id, sIdx + i * 8 + 2); WB += wB[i];
      }
      const meanAge = p.ageSum / p.count;
      for (let i = 0; i < p.count; i++) {
        made.push(kernel.addLiving({
          species,
          x: x0 + rand(kernel.seed, agg.id, sIdx + i * 8 + 3) * REGION,
          y: y0 + rand(kernel.seed, agg.id, sIdx + i * 8 + 4) * REGION,
          R: p.sumR * wR[i] / WR,
          body: p.sumBody * wB[i] / WB,
          tick,
          age: Math.max(0, Math.floor(meanAge * (0.6 + 0.8 * rand(kernel.seed, agg.id, sIdx + i * 8 + 5)))),
          causeEventId: evId,
        }));
      }
    }
    // Dead mass becomes a real decaying corpse (the region's accumulated dead).
    if (p.detritusE > 0.5) {
      const halflife = SPECIES[species].embodiedDecayDays * DAY;
      const corpseEv = kernel.ledger.emit({ tick, type: 'corpse', causeEventId: evId });
      const corpse = kernel.graph.createNode({
        type: 'corpse', tick, x: x0 + HALF, y: y0 + HALF, causeEventId: corpseEv,
        attrs: { E: p.detritusE, decayHalflifeTicks: halflife, of: species },
      });
      kernel.scheduler.schedule(tick + halflife * Math.log2(p.detritusE / 0.5), corpse.id, 'decay_gone', -1);
    } else if (p.detritusE > 0) {
      kernel.ledger.count('decayed', p.detritusE);
    }
  }
  kernel.graph.removeNode(agg.id);                         // pending agg_step goes stale
  return made;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/tiers.test.js` → PASS. Then `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add sim/lod/tiers.js sim/test/tiers.test.js
git commit -m "feat(lod): promotion — aggregates materialize deterministically, truth honored (spec 4.3)"
```

---

### Task 5: TierManager — bubble-driven reconciliation with hysteresis

**Files:**
- Modify: `sim/lod/tiers.js` (append `TierManager`)
- Test: `sim/test/tiers.test.js` (append)

- [ ] **Step 1: Write the failing tests** (append; extend the tiers import with `TierManager`)

```js
test('TierManager promotes the ring around a center and demotes beyond it', () => {
  const k = new Kernel({ seed: 42, bounds: { x0: 0, y0: 0, w: 160, h: 160 } });
  spawnWorld(k, { x0: 0, y0: 0, w: 160, h: 160 }, { x0: 0, y0: 0, w: 16, h: 16 });
  const tm = new TierManager(k);
  tm.update([{ x: 8, y: 8 }], 0);                       // center in region 0,0
  assert.equal(aggregateOf(k, '2,2'), undefined, 'inside ring → individuals');
  assert.equal(tm.tiers.get('0,0'), 'full');
  assert.equal(tm.tiers.get('4,0'), 'procedural');
  assert.ok(aggregateOf(k, '9,9'), 'far region stays statistical');
  // move the bubble far away: old regions demote (beyond demoteR)
  tm.update([{ x: 152, y: 152 }], 86400);
  assert.ok(aggregateOf(k, '0,0'), 'left-behind region demoted');
  assert.equal(tm.tiers.get('0,0'), undefined);
});

test('TierManager hysteresis: oscillating across a region boundary never thrashes', () => {
  const k = new Kernel({ seed: 42, bounds: { x0: 0, y0: 0, w: 160, h: 160 } });
  spawnWorld(k, { x0: 0, y0: 0, w: 160, h: 160 }, { x0: 0, y0: 0, w: 0, h: 0 });
  const tm = new TierManager(k);
  // warm-up: visit both sides once (advancing the ring legitimately promotes new regions)
  tm.update([{ x: 15, y: 8 }], 0);
  tm.update([{ x: 17, y: 8 }], 1);
  const events0 = k.ledger.events.filter(e => e.type === 'promote' || e.type === 'demote').length;
  for (let i = 0; i < 10; i++) tm.update([{ x: i % 2 ? 15 : 17, y: 8 }], i + 2);  // hop the 0,0/1,0 line
  const events1 = k.ledger.events.filter(e => e.type === 'promote' || e.type === 'demote').length;
  assert.equal(events1, events0, 'no promote/demote churn from a 2-tile wobble (demoteR > ringR)');
});

test('TierManager seeds itself from existing individual regions at construction', () => {
  const k = meadowKernel();                              // individuals in 0,0, no TierManager yet
  const tm = new TierManager(k);
  assert.ok(tm.tiers.has('0,0'));
  tm.update([{ x: 200, y: 200 }], 0);                    // bubble far away
  assert.ok(aggregateOf(k, '0,0'), 'boot-time individual region demotes once the bubble leaves');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test sim/test/tiers.test.js`
Expected: FAIL — `TierManager` is not exported.

- [ ] **Step 3: Implement** (append to `sim/lod/tiers.js`)

```js
/** Reconciles region tiers around attention-bubble centers (spec §4.2).
 *  full ≤ fullR regions (Chebyshev), procedural ≤ ringR, statistical beyond.
 *  Demotion only beyond demoteR (> ringR) — hysteresis prevents boundary thrash.
 *  Full and procedural tiers run identical dynamics in Pass 1: the differences the
 *  spec assigns (LLM vs rule-based Agency, coarser Agency events) have no consumer
 *  yet — Agency is honestly absent (§6.1). The tier labels are the seam. */
export class TierManager {
  constructor(kernel, { fullR = 2, ringR = 4, demoteR = 5 } = {}) {
    this.kernel = kernel;
    this.fullR = fullR; this.ringR = ringR; this.demoteR = demoteR;
    this.tiers = new Map();   // regionKey -> 'full' | 'procedural'; absent = statistical
    for (const n of kernel.graph.nodes.values()) {       // seed from boot-time individuals
      if (n.R != null && n.x != null && !n.attrs.noFlux) this.tiers.set(regionKeyOf(n.x, n.y), 'procedural');
    }
  }

  _dist(regionKey, centers) {
    const [rx, ry] = regionKey.split(',').map(Number);
    let best = Infinity;
    for (const c of centers) {
      const d = Math.max(Math.abs(rx - Math.floor(c.x / REGION)), Math.abs(ry - Math.floor(c.y / REGION)));
      if (d < best) best = d;
    }
    return best;
  }

  /** Reconcile around centers ([{x,y}] in tile coords). Safe to call every pump. */
  update(centers, tick) {
    if (centers.length === 0) return;
    for (const c of centers) {                            // promote the ring
      const cx = Math.floor(c.x / REGION), cy = Math.floor(c.y / REGION);
      for (let ry = cy - this.ringR; ry <= cy + this.ringR; ry++) {
        for (let rx = cx - this.ringR; rx <= cx + this.ringR; rx++) {
          const key = `${rx},${ry}`;
          if (aggregateOf(this.kernel, key)) promoteRegion(this.kernel, key, tick);
          this.tiers.set(key, 'procedural');              // label refined below
        }
      }
    }
    for (const key of [...this.tiers.keys()]) {           // re-label + demote stragglers
      const d = this._dist(key, centers);
      if (d > this.demoteR) {
        demoteRegion(this.kernel, key, tick);             // null when only pinned/empty — fine
        this.tiers.delete(key);
      } else {
        this.tiers.set(key, d <= this.fullR ? 'full' : 'procedural');
      }
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/tiers.test.js` → PASS. Then `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add sim/lod/tiers.js sim/test/tiers.test.js
git commit -m "feat(lod): TierManager — bubble-driven promote/demote with hysteresis (spec 4.2-4.3)"
```

---

### Task 6: Server + boot wiring

**Files:**
- Modify: `sim/server/server.js` (TierManager in pump; aggregates never serialized)
- Modify: `sim/server/main.js` (statistical world with individual start area)
- Test: `sim/test/server.test.js` (append), `sim/test/main.test.js` (verify still green)

- [ ] **Step 1: Write the failing test** (append to `sim/test/server.test.js`, following its existing setup pattern — it already builds kernels and SimServers with `port: 0`; reuse its helpers/imports, adding `import { spawnWorld } from '../world/spawn.js';` and `import { aggregateOf } from '../lod/aggregate.js';` as needed)

```js
test('attaching a client promotes the regions around its viewport', async () => {
  const kernel = new Kernel({ seed: 42, bounds: { x0: 0, y0: 0, w: 160, h: 160 } });
  spawnWorld(kernel, { x0: 0, y0: 0, w: 160, h: 160 }, { x0: 160, y0: 160, w: 0, h: 0 }); // all statistical
  const server = new SimServer({ kernel, port: 0 });
  await server.listen();
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
  await new Promise(res => ws.on('open', res));
  ws.send(JSON.stringify({ type: 'hello', viewport: { x: 0, y: 0, w: 40, h: 25 } }));
  const snap = await new Promise(res => ws.on('message', d => { const m = JSON.parse(d); if (m.type === 'snapshot') res(m); }));
  // wait one pump so the tier manager has run
  await new Promise(res => setTimeout(res, 250));
  assert.equal(aggregateOf(kernel, '1,0'), undefined, 'viewport region promoted to individuals');
  assert.ok(aggregateOf(kernel, '9,9'), 'distant region still statistical');
  assert.ok(snap.entities.every(e => e.type !== 'aggregate'), 'aggregates never serialized to clients');
  ws.close();
  await server.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test sim/test/server.test.js`
Expected: the new test FAILS (regions stay aggregated; snapshot may even contain `aggregate` entries).

- [ ] **Step 3: Implement**

`sim/server/server.js`:
1. Add import: `import { TierManager } from '../lod/tiers.js';`
2. In the constructor, after `this.pendingIntents = [];` add: `this.tiers = new TierManager(kernel);`
3. In `_onConnection`, in the `hello` branch, right after `this.sessions.add(session);` and BEFORE `this._sendSnapshot(session);` add:

```js
        this.tiers.update(this._centers(), this.kernel.tick);   // promote before first snapshot
```

4. In `_pump()`, after the intent loop and before the `if (!this.paused …)` advance, add:

```js
    // reconcile simulation LOD around the attention bubbles (spec §4.2)
    const centers = this._centers();
    if (centers.length) this.tiers.update(centers, this.kernel.tick);
```

5. Add the helper method:

```js
  _centers() {
    return [...this.sessions].map(s => ({
      x: s.viewport.x + s.viewport.w / 2,
      y: s.viewport.y + s.viewport.h / 2,
    }));
  }
```

6. In `_bubbleEntities`, filter aggregates (statistical truth is never a render entity):

```js
    return this.kernel.graph.nodesNear(cx, cy, radius)
      .filter(n => n.type !== 'aggregate')
      .map(n => serializeEntity(n, this.kernel.tick));
```

`sim/server/main.js`:
1. Replace the spawn import: `import { spawnWorld } from '../world/spawn.js';`
2. `bootWorld` gains a `start` rect (the initially-individual area) and uses `spawnWorld`:

```js
export function bootWorld(db, { seed, bounds, start = bounds, phi = 4 }) {
  const saved = db.prepare('SELECT value FROM meta WHERE key=?').get('tick');
  if (saved != null) return loadKernel(db);
  const kernel = new Kernel({ seed, phi, bounds });
  spawnWorld(kernel, bounds, start);
  checkpoint(kernel, db);          // birth certificate: baseline is durable immediately
  return kernel;
}
```

3. In the CLI block, grow the default world and keep the probe viewport individual:

```js
  const kernel = bootWorld(db, {
    seed: Number(arg('seed', '42')),
    bounds: { x0: 0, y0: 0, w: 320, h: 320 },
    start: { x0: 0, y0: 0, w: 48, h: 32 },
  });
```

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/server.test.js sim/test/main.test.js` → PASS (existing `bootWorld` tests keep passing because `start` defaults to `bounds`, i.e. all-individual — same behavior as before). Then `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add sim/server/server.js sim/server/main.js sim/test/server.test.js
git commit -m "feat(lod): server pump drives tier reconciliation; statistical world at boot"
```

---

### Task 7: Probe — distance defers resolution, never causation

**Files:**
- Test: `sim/test/probe-lod.test.js` (create)

This is Plan C's experienceable probe (CLAUDE.md continuous-testability): a distant region lives a real year statistically; arriving promotes it into real individuals with real history; the whole journey is conservation-exact, replayable bit-identically, and resumable from a checkpoint.

- [ ] **Step 1: Write the probe**

```js
// sim/test/probe-lod.test.js — Plan C probe (spec §4.2–4.3, §5.1).
// "A war between distant civilizations happens for real while the player is in C":
// here, a distant meadow lives a real statistical year — populations shift, dead mass
// accumulates, the ledger records it — and walking there materializes real individuals
// that honor every aggregate truth. Same seed+ledger → bit-identical world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnWorld } from '../world/spawn.js';
import { aggregateOf } from '../lod/aggregate.js';
import { TierManager } from '../lod/tiers.js';
import { openDb } from '../store/db.js';
import { checkpoint, loadKernel } from '../store/checkpoint.js';

const DAY = 86400;
const BOUNDS = { x0: 0, y0: 0, w: 160, h: 160 };
const START = { x0: 0, y0: 0, w: 16, h: 16 };

function canonicalDump(k) {
  const nodes = [...k.graph.nodes.values()].sort((a, b) => a.id - b.id)
    .map(n => [n.id, n.type, n.x, n.y, n.R, n.r, n.lastTick, JSON.stringify(n.attrs)]);
  return JSON.stringify({ tick: k.tick, nodes, totals: k.ledger.totals, deltas: k.deltas.list,
    events: k.ledger.events.length });
}

function journey(seed) {
  const k = new Kernel({ seed, bounds: BOUNDS });
  spawnWorld(k, BOUNDS, START);
  // small radii keep the probe fast (fewer individuals to full-sim for a year); semantics identical
  const tm = new TierManager(k, { fullR: 0, ringR: 1, demoteR: 2 });
  tm.update([{ x: 8, y: 8 }], 0);            // player starts at home
  k.runTo(180 * DAY);                        // half a year at home
  tm.update([{ x: 8, y: 8 }], k.tick);
  k.runTo(360 * DAY);                        // a full year total
  tm.update([{ x: 152, y: 152 }], k.tick);   // travel to the far corner: promote there, demote home
  k.runTo(390 * DAY);
  return { k, tm };
}

test('probe LOD: a distant region lives a real year, arrival materializes real history', () => {
  const { k } = journey(42);
  // home was demoted, destination promoted
  assert.ok(aggregateOf(k, '0,0'), 'home region now statistical');
  assert.equal(aggregateOf(k, '9,9'), undefined, 'destination now individual');
  const there = [...k.graph.nodes.values()].filter(n => n.R != null && n.x >= 144 && n.y >= 144);
  assert.ok(there.length > 0, 'real individuals at the destination');
  // promotion/demotion are auditable ledger events (spec §4.3)
  assert.ok(k.ledger.events.some(e => e.type === 'promote' && e.attrs.region === '9,9'));
  assert.ok(k.ledger.events.some(e => e.type === 'demote' && e.attrs.region === '0,0'));
  // the year was real: statistical deaths happened somewhere and were recorded
  assert.ok(k.ledger.events.some(e => e.type === 'agg_deaths'), 'aggregate-level deaths are ledger truth');
});

test('probe LOD: conservation identity holds across tiers and transitions', () => {
  const seedK = new Kernel({ seed: 42, bounds: BOUNDS });
  spawnWorld(seedK, BOUNDS, START);
  const start = seedK.stocks(0);
  const f0 = (t => t.captured - t.burned - t.decayed - t.transferLoss)(seedK.ledger.totals);
  const { k } = journey(42);
  const end = k.stocks(k.tick);
  const f1 = (t => t.captured - t.burned - t.decayed - t.transferLoss)(k.ledger.totals);
  const scale = Math.max(Math.abs(k.ledger.totals.captured), 1);
  assert.ok(Math.abs((end - start) - (f1 - f0)) / scale < 1e-9,
    `Δstocks=${end - start} Δflows=${f1 - f0}`);
});

test('probe LOD: the journey is bit-identical on replay (world equation)', () => {
  assert.equal(canonicalDump(journey(42).k), canonicalDump(journey(42).k));
});

test('probe LOD: checkpoint mid-journey resumes bit-identically', () => {
  // run A: straight through
  const a = journey(42);
  // run B: same journey, but checkpoint+reload right after the travel promotion
  const k = new Kernel({ seed: 42, bounds: BOUNDS });
  spawnWorld(k, BOUNDS, START);
  const tm = new TierManager(k, { fullR: 0, ringR: 1, demoteR: 2 });   // must mirror journey()
  tm.update([{ x: 8, y: 8 }], 0);
  k.runTo(180 * DAY);
  tm.update([{ x: 8, y: 8 }], k.tick);
  k.runTo(360 * DAY);
  tm.update([{ x: 152, y: 152 }], k.tick);
  const db = openDb(':memory:');
  checkpoint(k, db);
  const k2 = loadKernel(db);
  k2.runTo(390 * DAY);
  assert.equal(canonicalDump(k2), canonicalDump(a.k));
});

test('probe LOD: a 1600×1600-tile statistical world runs a year cheaply', () => {
  const big = { x0: 0, y0: 0, w: 1600, h: 1600 };       // 10k regions ≈ 1.4M expected entities
  const k = new Kernel({ seed: 42, bounds: big });
  spawnWorld(k, big, { x0: 0, y0: 0, w: 0, h: 0 });
  const aggs = [...k.graph.nodes.values()].filter(n => n.type === 'aggregate').length;
  assert.equal(aggs, 10000);
  const t0 = process.hrtime.bigint();
  k.runTo(360 * DAY);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 120_000, `statistical year took ${ms}ms`);   // generous CI bound
  assert.ok([...k.graph.nodes.values()].some(n => n.type === 'aggregate'), 'world still populated');
});
```

- [ ] **Step 2: Run the probe**

Run: `node --test sim/test/probe-lod.test.js`
Expected: PASS (everything was built in Tasks 1–6; this validates the integration). If the checkpoint test fails, the likely cause is non-JSON-stable `attrs.pops` ordering — object key order survives `JSON.parse(JSON.stringify(…))`, so investigate what actually diverged (diff the two dumps) rather than papering over it.

- [ ] **Step 3: Run the full suite**

Run: `npm test` → all green.

- [ ] **Step 4: Commit**

```bash
git add sim/test/probe-lod.test.js
git commit -m "test(sim): probe LOD — distance defers resolution, never causation (spec 4.2-4.3)"
```

---

### Task 8: Close-out

- [ ] **Step 1:** `npm test` one final time → all green; note final test count.
- [ ] **Step 2:** Check every box in this plan doc.
- [ ] **Step 3:** Update `docs/superpowers/plans/2026-06-11-pass1-roadmap.md`: Plan C row → `**DONE**` (cite this plan doc + any entries in "Canonical deviations" below), Plan D row → `**NEXT**`.
- [ ] **Step 4:** Commit:

```bash
git add docs/superpowers/plans/2026-06-11-pass1c-simulation-lod.md docs/superpowers/plans/2026-06-11-pass1-roadmap.md
git commit -m "docs: roadmap — Plan C DONE, Plan D NEXT"
```

---

## Canonical deviations (authoritative over task text above)

*Append entries here when execution legitimately diverges from the plan. Each entry: what changed, why, and which task it affects. None yet.*
