# Pass 3 P5 — Settlement Growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settlements grow and decline through scheduled, rule-based group decisions paid from real pooled time — new huts rise on vacant plots, forges follow, territory expands when full, tiers (village→town) are labels over real building counts, and unfunded villages decay into ghost towns whose claims heal back to wilderness.

**Architecture:** One new module `sim/society/growth.js` registers a `settlement_growth` scheduler handler (P4 `building_decay` precedent). Each interval the handler makes ONE decision in fixed priority order (maintain → clear → build hut → build forge → expand → idle/ghost), every decision emitted as a provenanced `growth_decision` ledger event with a reason code (world-compiler discipline). All construction pays through the existing P4 `constructBuilding`; clearing uses the existing real verbs (`chop`/`take`) with the group as a *declared* collective laborer; territory expansion is a zero-cost provenanced declaration (P3 founding precedent).

**Tech Stack:** Node test runner (ESM), existing kernel (scheduler/ledger/deltas/graph), P3 settlements + P4 buildings modules. No new dependencies.

---

## Locked design decisions (the no-mock boundary)

1. **Growth driver = group reserve surplus ONLY.** There are no NPCs, so "population pressure" cannot be honestly simulated — it is a DECLARED ABSENCE until Pass 4 Life. A group's wallet (funded by real member `contribute` calls) is the only growth signal. This deviates from the roadmap row's "population pressure + surplus" — record in Deviations and the roadmap close-out.
2. **Farms are ABSENT.** No cultivation system exists; a farm without crops is cardboard (no-mock rule outranks roadmap scope). Declared backlog: farms arrive with cultivation (Pass 4 Life / flora interaction). Record in Deviations + roadmap row.
3. **Group as collective laborer (declared).** Clearing land uses the real `chop`/`take` verbs with the group node as actor. `chop` only reads the actor's wielded tool (none → factor 1, `sim/world/actions.js:97-104`); `take` stores the matter item into `actor.attrs.inventory` (`actions.js:171-174`), which `stocks()` counts — fully conserving. This is the probe-buildings clearing pattern formalized; individual laborer bodies arrive with Pass 4 Life.
4. **One decision per growth interval.** Keeps each tick's work bounded, the event log legible, and determinism trivial.
5. **Decision rules are fixed priorities, not politics.** Declared limitation (roadmap: "rule-based group decisions only — declared limitation, not fake politics").
6. **Tier is a label over real counts**, recomputed every interval (promotion AND demotion), never placed. `town` ≥ 4 standing buildings in territory, `city` ≥ 12 (unreachable in probe bounds — honest).
7. **Territory expansion is a zero-cost provenanced declaration** (P3 precedent: founding moves zero time; the *labor* is paid later by clearing and construction on the new plots).
8. **Maintenance is survival, construction is surplus.** Maintain whenever `R ≥ MAINTAIN_COST`; build/expand only when `R ≥ cost + RESERVE_FLOOR`.
9. **Ghost town = structural fact.** Tier flips to `'ghost'` and the growth loop stops when the territory has zero standing buildings, at least one building was ever constructed (tracked via `attrs.peakBuildings`), and the wallet cannot fund a hut. Claims have already healed via P4 decay — wilderness returns on reboot.

## Honest absences (declared)

- No population / NPCs (Pass 4 Life) — surplus-only driver.
- No farms (needs cultivation — Pass 4 Life backlog).
- No group politics — fixed priority rules.
- No inter-settlement roads/trade triggered by growth (P2 verbs exist; wiring is Economy/P6+).
- No save/load rehydration for growth schedule state (shared P1–P4 backlog).
- LOD note: growth runs as scheduler events independent of any viewer — there is no attention-bubble coupling to get wrong; statistical-tier aggregation interplay deferred with the LOD lane.

## File structure

- **Create** `sim/society/growth.js` — constants, `clearPlot`, `enableGrowth`, `onSettlementGrowth` (module-private), `expandTerritory`, `registerGrowth`.
- **Modify** `sim/kernel/kernel.js` — wire `registerGrowth(this)` after `registerBuildings(this)`.
- **Create** `sim/test/growth.test.js` — behavior tests.
- **Create** `sim/test/probe-growth.test.js` — the experienceable lifecycle probe.
- **Modify** `docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md` — P5 row close-out.

Verified seams (implementers: trust these, verify before deviating):
- `kernel.scheduler.schedule(tick, nodeId, kind, ver)`; handlers via `kernel.on(kind, (kernel, node, ev) => {})`, dispatched in `runTo` (`kernel.js:157-173`).
- `constructBuilding(kernel, groupId, {plotId}|{settlementId,x,y}, templateId, tick)` → node|null; hut cost 610, forge cost 1150; `maintainBuilding(kernel, groupId, buildingId, tick)` → bool, cost 10 (`sim/world/buildings.js`).
- Settlement attrs `{tier, founderGroup, territory{x0,y0,w,h}, districts[{kind,rect,reason}], reasons, noFlux}`; plot attrs `{rect, settlement, district, owner, noFlux}`; `TERRITORY_W 12, TERRITORY_H 10, PLOT_W 5, PLOT_H 4` (`sim/society/settlements.js`).
- `chop(kernel, actorId, targetId, tick)` → bool; `take(kernel, actorId, targetId, tick)` → item|null (matter only) (`sim/world/actions.js:78,157`).
- `tileCost(x,y)` === Infinity on water (`sim/world/routing.js`).
- Ledger: `emit({tick,type,actor,targets,magnitude,causeEventId,attrs})` → evId; `count(counter, amount)`; totals keys `captured/burned/decayed/transferLoss`.
- Long-run conservation identity (probe-conservation precedent): `stocks(end) − stocks(0) == captured − burned − decayed − transferLoss` (relative err < 1e-9).
- Test geography: SEED 7, `RECT {x0:926, y0:0, w:28, h:14}`; NO naturally-clear plots (every plot carries baseline flora); funding pattern = boot berry bushes, `pick` to players, `contribute` to group (gift 0.90).

---

### Task 1: `growth.js` — constants + group-paid plot clearing

**Files:**
- Create: `sim/society/growth.js`
- Test: `sim/test/growth.test.js` (create)

- [ ] **Step 1: Write the failing tests** — create `sim/test/growth.test.js`:

```js
// sim/test/growth.test.js — P5: scheduled, rule-based settlement growth.
// The group acts as a DECLARED collective laborer (no NPC bodies until Pass 4 Life):
// clearing uses the real chop/take verbs with the group as actor — fully conserving
// (chopped corpses stay on the tile ledgered, taken matter sits in group inventory
// which stocks() counts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, pick } from '../world/actions.js';
import { createGroup, contribute } from '../society/groups.js';
import { foundSettlement } from '../society/settlements.js';
import { findSettlementSite } from '../society/suitability.js';
import { materializeRect } from '../world/wire.js';
import { clearPlot } from '../society/growth.js';
import { DAY } from '../time/metabolism.js';

const RECT = { x0: 926, y0: 0, w: 28, h: 14 };

/** Boot a funded settlement: bush → players pick → contribute to group → found. */
export function growthScenario(fund = 2600) {
  const k = new Kernel({ seed: 7, bounds: RECT });
  let bush;
  k.graph.boot(() => {
    bush = k.addLiving({ species: 'berry_bush', x: 941, y: 1,
                         R: 60000, body: 80000, tick: 0, age: 400 * DAY });
    materializeRect(k, RECT, 0);
  });
  const p = createPlayer(k, 0, { x: 941, y: 1 });
  const pl = k.graph.nodes.get(p.id);
  const g = createGroup(k, 0, { x: 941, y: 0 });
  while (pl.R < fund) { if (pick(k, p.id, bush.id, 0) <= 0) break; }
  assert.ok(pl.R >= fund, `player holds ≥${fund}`);
  assert.equal(contribute(k, p.id, g.id, fund, 0), true);
  const site = findSettlementSite(k, RECT);
  const s = foundSettlement(k, g.id, site, 0);
  assert.ok(s, 'settlement founded');
  return { k, p, g, s, bush };
}

function plotsOf(k, s) {
  return [...k.graph.nodes.values()]
    .filter(n => n.type === 'plot' && n.attrs.settlement === s.id)
    .sort((a, b) => a.id - b.id);
}

function placementsIn(k, rect) {
  return [...k.graph.nodes.values()].filter(n =>
    n.attrs?.placement &&
    n.x >= rect.x0 && n.x < rect.x0 + rect.w &&
    n.y >= rect.y0 && n.y < rect.y0 + rect.h);
}

test('clearPlot: group clears a deeded plot with real verbs, conserving time', () => {
  const { k, g, s } = growthScenario();
  const plot = plotsOf(k, s)[0];
  assert.ok(placementsIn(k, plot.attrs.rect).length > 0, 'seed-7 plot starts dirty');
  const stocks0 = k.stocks(0);
  const tl0 = k.ledger.totals.transferLoss;
  const n = clearPlot(k, g.id, plot.id, 0);
  assert.ok(n > 0, 'clearing did real work');
  assert.equal(placementsIn(k, plot.attrs.rect).length, 0, 'plot is clear');
  // chop conserves into corpses; take conserves into group inventory — zero drift.
  const drift = (k.stocks(0) - stocks0) + (k.ledger.totals.transferLoss - tl0);
  assert.ok(Math.abs(drift) < 1e-6, `conservation drift ${drift}`);
  assert.ok((k.graph.nodes.get(g.id).attrs.inventory ?? []).length > 0,
    'salvaged matter sits in the group inventory (counted by stocks)');
});

test('clearPlot refuses, side-effect-free, on bad group / unowned plot', () => {
  const { k, p, g, s } = growthScenario();
  const plot = plotsOf(k, s)[0];
  const events0 = k.ledger.events.length;
  assert.equal(clearPlot(k, p.id, plot.id, 0), null);        // not a group
  assert.equal(clearPlot(k, g.id, 999999, 0), null);         // no such plot
  plot.attrs.owner = p.id;                                   // deeded away
  assert.equal(clearPlot(k, g.id, plot.id, 0), null);        // group no longer owns
  plot.attrs.owner = g.id;
  assert.equal(k.ledger.events.length, events0, 'refusals emitted nothing');
});
```

- [ ] **Step 2: Run to verify failure** — `node --test sim/test/growth.test.js` → FAIL (`growth.js` missing).

- [ ] **Step 3: Implement** — create `sim/society/growth.js`:

```js
// sim/society/growth.js — P5: settlements grow and decline through scheduled,
// rule-based group decisions paid from real pooled time. One decision per
// interval, fixed priority (maintain → clear → hut → forge → expand → idle),
// every decision a provenanced growth_decision event with a reason code.
// HONEST ABSENCES: no population pressure (no NPCs until Pass 4 Life — surplus
// is the only driver); no farms (no cultivation system — declared backlog); no
// politics (fixed rules, declared); no save/load rehydration of the schedule.
// The group is a DECLARED collective laborer: clearing uses the real chop/take
// verbs with the group as actor (chop reads only the wielded tool; take stores
// into attrs.inventory, which stocks() counts) — conserving, bodies come later.
import { chop, take } from '../world/actions.js';

export const GROWTH_INTERVAL_DAYS = 10;   // one decision every 10 days
export const RESERVE_FLOOR = 200;         // surplus gate for NEW construction
export const MAINTAIN_AT = 60;            // maintain when condition drops below

function inRect(x, y, r) {
  return x >= r.x0 && x < r.x0 + r.w && y >= r.y0 && y < r.y0 + r.h;
}

/** Module-private: clear every materialized placement (and loose debris) in rect
 *  with real verbs, the group acting as collective laborer. Returns count of
 *  placements cleared. Mirrors the probe-buildings clearing pattern. */
function clearLand(kernel, groupId, rect, tick) {
  let cleared = 0;
  for (const n of [...kernel.graph.nodes.values()]) {
    if (!n.attrs?.placement || !inRect(n.x, n.y, rect)) continue;
    if (n.type === 'matter') { if (take(kernel, groupId, n.id, tick)) cleared++; }
    else if (chop(kernel, groupId, n.id, tick)) cleared++;
  }
  // chop leaves corpses/products (not placements) on the tiles; salvage them too.
  for (const n of [...kernel.graph.nodes.values()]) {
    if (n.type !== 'matter' || n.attrs.placement || !inRect(n.x, n.y, rect)) continue;
    take(kernel, groupId, n.id, tick);
  }
  return cleared;
}

/** Group clears a plot it owns. Returns cleared count, or null (side-effect-free)
 *  on missing/non-group actor, missing/non-plot target, or non-owned plot. */
export function clearPlot(kernel, groupId, plotId, tick) {
  const group = kernel.graph.nodes.get(groupId);
  const plot = kernel.graph.nodes.get(plotId);
  if (!group || group.type !== 'group' || !plot || plot.type !== 'plot') return null;
  if (plot.attrs.owner !== groupId) return null;
  return clearLand(kernel, groupId, plot.attrs.rect, tick);
}
```

- [ ] **Step 4: Run tests** — `node --test sim/test/growth.test.js` → PASS (2/2).

- [ ] **Step 5: Commit** — `git add sim/society/growth.js sim/test/growth.test.js && git commit -m "feat(p5): group-paid plot clearing — the collective laborer verb"`

---

### Task 2: the growth loop — `enableGrowth`, maintain/clear/build-hut decisions, kernel wiring

**Files:**
- Modify: `sim/society/growth.js`
- Modify: `sim/kernel/kernel.js` (wire `registerGrowth`)
- Test: `sim/test/growth.test.js` (append)

- [ ] **Step 1: Write the failing tests** — append to `sim/test/growth.test.js` (extend the import from `'../society/growth.js'` with `enableGrowth, GROWTH_INTERVAL_DAYS, RESERVE_FLOOR`):

```js
function decisions(k) {
  return k.ledger.events.filter(e => e.type === 'growth_decision')
    .map(e => e.attrs.decision);
}

test('growth loop: scheduled decisions clear then build huts while surplus lasts', () => {
  const { k, g, s } = growthScenario(2600);   // ≈2340 in wallet after gift loss
  assert.equal(enableGrowth(k, s.id, 0), true);
  k.runTo(GROWTH_INTERVAL_DAYS * DAY * 6);
  const d = decisions(k);
  // Priority order is observable: first interval clears plot 1, second builds on it,
  // then the next plot, until surplus (cost 610 + floor 200) runs out.
  assert.equal(d[0], 'clear', 'first decision clears the first dirty plot');
  assert.equal(d[1], 'build_hut', 'second decision builds on the cleared plot');
  const built = [...k.graph.nodes.values()].filter(n => n.type === 'building');
  assert.ok(built.length >= 1, 'at least one hut stands');
  assert.ok(built.length <= plotsOf(k, s).length, 'never more huts than plots');
  for (const e of k.ledger.events.filter(e => e.type === 'growth_decision')) {
    assert.ok(typeof e.attrs.reason === 'string' && e.attrs.reason.length > 0,
      'every decision carries a reason code');
    assert.equal(e.actor, g.id, 'decisions are the founder group acting');
  }
});

test('growth loop: maintenance outranks construction', () => {
  const { k, g, s } = growthScenario(2600);
  assert.equal(enableGrowth(k, s.id, 0), true);
  k.runTo(GROWTH_INTERVAL_DAYS * DAY * 2);     // clear + build first hut
  const hut = [...k.graph.nodes.values()].find(n => n.type === 'building');
  assert.ok(hut);
  hut.attrs.condition = 30;                    // below MAINTAIN_AT
  k.runTo(GROWTH_INTERVAL_DAYS * DAY * 3);
  const d = decisions(k);
  assert.equal(d[2], 'maintain', 'third decision repairs instead of building');
  assert.equal(hut.attrs.condition, 100, 'hut restored to full condition');
});

test('growth loop: underfunded group idles (no construction below floor)', () => {
  const { k, g, s } = growthScenario(2600);
  const group = k.graph.nodes.get(g.id);
  group.R = RESERVE_FLOOR + 10;                // can't afford hut + floor
  assert.equal(enableGrowth(k, s.id, 0), true);
  k.runTo(GROWTH_INTERVAL_DAYS * DAY * 2);
  const d = decisions(k);
  // clearing is free labor → still happens; construction must not.
  assert.ok(!d.includes('build_hut'), 'no hut built below the reserve floor');
  assert.equal([...k.graph.nodes.values()].filter(n => n.type === 'building').length, 0);
});

test('enableGrowth refuses non-settlements and double-enable', () => {
  const { k, g, s } = growthScenario();
  assert.equal(enableGrowth(k, g.id, 0), false);
  assert.equal(enableGrowth(k, s.id, 0), true);
  assert.equal(enableGrowth(k, s.id, 0), false, 'already enabled');
});
```

- [ ] **Step 2: Run to verify failure** — `node --test sim/test/growth.test.js` → new tests FAIL (`enableGrowth` not exported).

- [ ] **Step 3: Implement** — extend `sim/society/growth.js`:

Add imports at top:
```js
import { constructBuilding, maintainBuilding, MAINTAIN_COST } from '../world/buildings.js';
import { DAY } from '../time/metabolism.js';
```

Add after `clearPlot`:
```js
const HUT_COST = 610;   // 20 stamps × 20 + hearth 150 + bedroll 60 (P4 invariant)

function emitDecision(kernel, groupId, settlementId, tick, decision, reason, targets = []) {
  return kernel.ledger.emit({
    tick, type: 'growth_decision', actor: groupId, targets: [settlementId, ...targets],
    attrs: { decision, reason },
  });
}

function buildingsIn(kernel, territory) {
  return [...kernel.graph.nodes.values()]
    .filter(n => n.type === 'building' && inRect(n.x, n.y, territory))
    .sort((a, b) => a.id - b.id);
}

function settlementPlots(kernel, settlementId) {
  return [...kernel.graph.nodes.values()]
    .filter(n => n.type === 'plot' && n.attrs.settlement === settlementId)
    .sort((a, b) => a.id - b.id);
}

function plotIsBuilt(kernel, plot) {
  return [...kernel.graph.nodes.values()].some(n =>
    n.type === 'building' && inRect(n.x, n.y, plot.attrs.rect));
}

function plotIsDirty(kernel, plot) {
  const r = plot.attrs.rect;
  for (const n of kernel.graph.nodes.values()) {
    if (n.attrs?.placement && inRect(n.x, n.y, r)) return true;
  }
  return false;
}

/** Begin the growth loop for a settlement: one decision per interval, forever
 *  (until ghost). Returns false on non-settlement or already-enabled. */
export function enableGrowth(kernel, settlementId, tick) {
  const s = kernel.graph.nodes.get(settlementId);
  if (!s || s.type !== 'settlement' || s.attrs.growthEnabled) return false;
  s.attrs.growthEnabled = true;
  s.attrs.peakBuildings = 0;
  kernel.scheduler.schedule(tick + GROWTH_INTERVAL_DAYS * DAY, settlementId, 'settlement_growth', -1);
  return true;
}

/** One decision per interval, fixed priority. Module-private handler. */
function onSettlementGrowth(kernel, node, ev) {
  if (!node || node.type !== 'settlement') return;   // settlement gone: loop ends
  const s = node;
  const group = kernel.graph.nodes.get(s.attrs.founderGroup);
  const tick = ev.tick;
  if (group && group.type === 'group') {
    decide(kernel, s, group, tick);
  }
  if (s.attrs.tier !== 'ghost') {
    kernel.scheduler.schedule(tick + GROWTH_INTERVAL_DAYS * DAY, s.id, 'settlement_growth', -1);
  }
}

function decide(kernel, s, group, tick) {
  const standing = buildingsIn(kernel, s.attrs.territory);
  s.attrs.peakBuildings = Math.max(s.attrs.peakBuildings ?? 0, standing.length);

  // 1. MAINTAIN (survival): worst-condition building below threshold.
  const worst = standing.filter(b => (b.attrs.condition ?? 100) < MAINTAIN_AT)
                        .sort((a, b) => a.attrs.condition - b.attrs.condition)[0];
  if (worst && group.R >= MAINTAIN_COST) {
    emitDecision(kernel, group.id, s.id, tick, 'maintain',
      `condition ${worst.attrs.condition} < ${MAINTAIN_AT}`, [worst.id]);
    maintainBuilding(kernel, group.id, worst.id, tick);
    return;
  }

  const plots = settlementPlots(kernel, s.id)
    .filter(p => p.attrs.owner === group.id && !plotIsBuilt(kernel, p));

  // 2. CLEAR (free labor): first vacant dirty plot.
  const dirty = plots.find(p => plotIsDirty(kernel, p));
  if (dirty) {
    emitDecision(kernel, group.id, s.id, tick, 'clear',
      'vacant plot carries wild growth', [dirty.id]);
    clearLand(kernel, group.id, dirty.attrs.rect, tick);
    return;
  }

  // 3. BUILD HUT (surplus): first vacant cleared plot.
  const ready = plots[0];
  if (ready && group.R >= HUT_COST + RESERVE_FLOOR) {
    const evId = emitDecision(kernel, group.id, s.id, tick, 'build_hut',
      `surplus ${group.R} ≥ ${HUT_COST + RESERVE_FLOOR}`, [ready.id]);
    const b = constructBuilding(kernel, group.id, { plotId: ready.id }, 'hut', tick);
    if (b) kernel.ledger.events[evId - 1].targets.push(b.id);
    return;
  }

  // 4. IDLE: nothing affordable/possible — an honest recorded non-choice.
  emitDecision(kernel, group.id, s.id, tick, 'idle',
    ready ? `reserve ${group.R} < ${HUT_COST + RESERVE_FLOOR}` : 'no vacant plots');
}

export function registerGrowth(kernel) {
  kernel.on('settlement_growth', onSettlementGrowth);
}
```

- [ ] **Step 4: Wire the kernel** — in `sim/kernel/kernel.js`, add the import next to the other registries and call `registerGrowth(this);` immediately after `registerBuildings(this);` (line 30):

```js
import { registerGrowth } from '../society/growth.js';
```
```js
    registerBuildings(this);
    registerGrowth(this);
```

- [ ] **Step 5: Run** — `node --test sim/test/growth.test.js sim/test/buildings.test.js` → PASS.

- [ ] **Step 6: Commit** — `git add sim/society/growth.js sim/kernel/kernel.js sim/test/growth.test.js && git commit -m "feat(p5): settlement growth loop — scheduled maintain/clear/build decisions with reason codes"`

---

### Task 3: forge decision + tier as a label over real counts

**Files:**
- Modify: `sim/society/growth.js`
- Test: `sim/test/growth.test.js` (append)

- [ ] **Step 1: Write the failing tests** — append (extend the growth.js import with `TIER_THRESHOLDS`):

```js
test('growth loop: forge follows huts; tier promotes on real building counts', () => {
  const { k, g, s } = growthScenario(2600);
  const group = k.graph.nodes.get(g.id);
  group.R = 20000;                       // rich village: let it build out fully
  assert.equal(enableGrowth(k, s.id, 0), true);
  k.runTo(GROWTH_INTERVAL_DAYS * DAY * 20);
  const built = [...k.graph.nodes.values()].filter(n => n.type === 'building');
  const huts = built.filter(b => b.attrs.template === 'hut');
  const forges = built.filter(b => b.attrs.template === 'forge');
  assert.ok(huts.length >= 2, 'huts filled the residential plots');
  assert.ok(forges.length >= 1, 'a forge rose in the craft district');
  // Tier is recomputed from standing buildings each interval.
  if (built.length >= TIER_THRESHOLDS.town) {
    assert.equal(s.attrs.tier, 'town', 'tier label tracks the real count');
    const tierEv = k.ledger.events.find(e => e.type === 'tier_changed');
    assert.ok(tierEv, 'promotion is a provenanced event');
    assert.equal(tierEv.attrs.to, 'town');
    assert.ok(tierEv.attrs.buildings >= TIER_THRESHOLDS.town, 'evidence recorded');
  }
});

test('tier demotes when buildings fall (label, never placed)', () => {
  const { k, g, s } = growthScenario(2600);
  const group = k.graph.nodes.get(g.id);
  group.R = 20000;
  assert.equal(enableGrowth(k, s.id, 0), true);
  k.runTo(GROWTH_INTERVAL_DAYS * DAY * 20);
  if (s.attrs.tier === 'town') {
    // Knock buildings down below the threshold; next interval demotes.
    for (const b of [...k.graph.nodes.values()].filter(n => n.type === 'building')) {
      b.attrs.condition = 0;             // next building_decay tick fells it
    }
    group.R = 0;                         // no maintenance possible
    k.runTo(k.tick + GROWTH_INTERVAL_DAYS * DAY * 2);
    assert.notEqual(s.attrs.tier, 'town', 'tier fell with the buildings');
  }
});
```

- [ ] **Step 2: Run to verify failure** — `node --test sim/test/growth.test.js` → FAIL (no forge decision, no TIER_THRESHOLDS).

- [ ] **Step 3: Implement** — in `sim/society/growth.js`:

Add constants:
```js
export const TIER_THRESHOLDS = { town: 4, city: 12 };   // labels over real counts
const FORGE_COST = 1150;   // 30 stamps × 20 + furnace 300 + anvil 250 (P4 invariant)
```

In `decide`, insert a FORGE rule between rule 3 (BUILD HUT) and the idle fallback (so the priority becomes maintain → clear → hut → forge → idle). Forge rises when the residential plots are all built (no `ready` plot), huts ≥ 2, fewer forges than `floor(huts/2)`, and surplus allows:

```js
  // 4. BUILD FORGE (surplus): when dwellings are established, industry follows.
  const huts = standing.filter(b => b.attrs.template === 'hut');
  const forges = standing.filter(b => b.attrs.template === 'forge');
  const craft = s.attrs.districts.find(d => d.kind === 'craft');
  if (!ready && craft && huts.length >= 2 && forges.length < Math.floor(huts.length / 2)
      && group.R >= FORGE_COST + RESERVE_FLOOR) {
    // Deterministic origin scan (probe-buildings pattern): clear then try, in order.
    for (let oy = craft.rect.y0; oy + 5 <= craft.rect.y0 + craft.rect.h; oy++) {
      for (let ox = craft.rect.x0; ox + 6 <= craft.rect.x0 + craft.rect.w; ox++) {
        clearLand(kernel, group.id, { x0: ox, y0: oy, w: 6, h: 5 }, tick);
        const f = constructBuilding(kernel, group.id,
          { settlementId: s.id, x: ox, y: oy }, 'forge', tick);
        if (f) {
          emitDecision(kernel, group.id, s.id, tick, 'build_forge',
            `${huts.length} huts standing, ${forges.length} forges`, [f.id]);
          return;
        }
      }
    }
  }
```

At the END of `decide` (after every rule, including idle — tier reflects this interval's reality), add a tier recompute. Implement as a module-private function called from `decide` right before each `return` is awkward — instead call it from `onSettlementGrowth` AFTER `decide(...)` returns:

```js
function retier(kernel, s, group, tick) {
  const count = buildingsIn(kernel, s.attrs.territory).length;
  const want = count >= TIER_THRESHOLDS.city ? 'city'
             : count >= TIER_THRESHOLDS.town ? 'town' : 'village';
  if (want !== s.attrs.tier && s.attrs.tier !== 'ghost') {
    kernel.ledger.emit({
      tick, type: 'tier_changed', actor: group?.id ?? null, targets: [s.id],
      attrs: { from: s.attrs.tier, to: want, buildings: count },
    });
    s.attrs.tier = want;
  }
}
```
And in `onSettlementGrowth`, after the `decide(...)` call:
```js
    decide(kernel, s, group, tick);
    retier(kernel, s, group, tick);
```

- [ ] **Step 4: Run** — `node --test sim/test/growth.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add sim/society/growth.js sim/test/growth.test.js && git commit -m "feat(p5): forge decision + tier labels over real building counts"`

---

### Task 4: territory expansion — zero-cost declaration, new plots deeded

**Files:**
- Modify: `sim/society/growth.js`
- Test: `sim/test/growth.test.js` (append)

- [ ] **Step 1: Write the failing tests** — append (extend the growth.js import with `expandTerritory`):

```js
test('expandTerritory: declares new land, deeds new plots, refuses honestly', () => {
  const { k, g, s } = growthScenario(2600);
  const before = plotsOf(k, s).length;
  const t0 = { ...s.attrs.territory };
  const tl0 = k.ledger.totals.transferLoss;
  const r0 = k.graph.nodes.get(g.id).R;
  const ok = expandTerritory(k, g.id, s.id, 0);
  if (ok) {
    const t1 = s.attrs.territory;
    assert.ok(t1.w * t1.h > t0.w * t0.h, 'territory genuinely grew');
    assert.ok(plotsOf(k, s).length > before, 'new plots deeded in the new land');
    const ev = k.ledger.events.find(e => e.type === 'territory_expanded');
    assert.ok(ev, 'expansion is a provenanced declaration');
    assert.equal(ev.actor, g.id);
    assert.ok(typeof ev.attrs.reason === 'string' && ev.attrs.reason.length > 0);
    // Zero-cost declaration (P3 founding precedent): no time moved.
    assert.equal(k.ledger.totals.transferLoss, tl0, 'no transfer happened');
    assert.equal(k.graph.nodes.get(g.id).R, r0, 'wallet untouched');
  } else {
    // Bounds too tight in every direction — must be a clean refusal.
    assert.ok(!k.ledger.events.some(e => e.type === 'territory_expanded'));
  }
  // Refusals: non-founder group, non-settlement.
  assert.equal(expandTerritory(k, g.id, g.id, 0), false);
  const g2 = createGroup(k, 0, { x: 940, y: 0 });
  assert.equal(expandTerritory(k, g2.id, s.id, 0), false, 'only the founder expands');
});

test('growth loop: expansion follows a full residential district', () => {
  const { k, g, s } = growthScenario(2600);
  const group = k.graph.nodes.get(g.id);
  group.R = 40000;
  assert.equal(enableGrowth(k, s.id, 0), true);
  k.runTo(GROWTH_INTERVAL_DAYS * DAY * 40);
  const d = decisions(k);
  // Either the village expanded (and built more), or every direction was blocked
  // by bounds — in which case the idle reason says so (honest evidence).
  if (d.includes('expand')) {
    assert.ok(plotsOf(k, s).length > 2, 'expansion deeded more plots');
  } else {
    const idle = k.ledger.events.filter(e => e.type === 'growth_decision')
      .find(e => e.attrs.decision === 'idle' && /expand/.test(e.attrs.reason));
    assert.ok(idle, 'blocked expansion is recorded as an idle reason');
  }
});
```

- [ ] **Step 2: Run to verify failure** — `node --test sim/test/growth.test.js` → FAIL.

- [ ] **Step 3: Implement** — in `sim/society/growth.js`:

Add import:
```js
import { PLOT_W, PLOT_H } from './settlements.js';
import { tileCost } from '../world/routing.js';
```

Add:
```js
function rectsOverlap(a, b) {
  return a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w && a.y0 < b.y0 + b.h && b.y0 < a.y0 + a.h;
}

/** Deed PLOT_W×PLOT_H plots into `strip` for land tiles (founding's tiling rule),
 *  module-private. Returns number of plots deeded. */
function deedPlots(kernel, settlement, groupId, strip, evId, tick) {
  let deeded = 0;
  for (let py = strip.y0; py + PLOT_H <= strip.y0 + strip.h; py += PLOT_H) {
    for (let px = strip.x0; px + PLOT_W <= strip.x0 + strip.w; px += PLOT_W) {
      let land = true;
      for (let yy = py; yy < py + PLOT_H && land; yy++)
        for (let xx = px; xx < px + PLOT_W && land; xx++)
          if (tileCost(xx, yy) === Infinity) land = false;
      if (!land) continue;
      const plot = kernel.graph.createNode({
        type: 'plot', tick, x: px, y: py, causeEventId: evId,
        attrs: { rect: { x0: px, y0: py, w: PLOT_W, h: PLOT_H },
                 settlement: settlement.id, district: 'residential',
                 owner: groupId, noFlux: true },
      });
      kernel.ledger.events[evId - 1].targets.push(plot.id);
      deeded++;
    }
  }
  return deeded;
}

/** Founder group declares new territory: extend the rect by PLOT_W tiles in the
 *  first viable direction (W, E, N, S — deterministic), zone the new strip
 *  residential, deed plots. Zero-cost declaration (P3 founding precedent — the
 *  labor is paid later by clearing and construction). Returns true, or false
 *  (side-effect-free) when: bad actor/target, non-founder, or every direction is
 *  out of bounds / overlaps another settlement / yields zero land plots. */
export function expandTerritory(kernel, groupId, settlementId, tick) {
  const group = kernel.graph.nodes.get(groupId);
  const s = kernel.graph.nodes.get(settlementId);
  if (!group || group.type !== 'group' || !s || s.type !== 'settlement') return false;
  if (s.attrs.founderGroup !== groupId) return false;
  const b = kernel.bounds;
  const t = s.attrs.territory;
  const candidates = [
    { dir: 'west',  rect: { x0: t.x0 - PLOT_W, y0: t.y0, w: PLOT_W, h: t.h } },
    { dir: 'east',  rect: { x0: t.x0 + t.w,    y0: t.y0, w: PLOT_W, h: t.h } },
    { dir: 'north', rect: { x0: t.x0, y0: t.y0 - PLOT_H, w: t.w, h: PLOT_H } },
    { dir: 'south', rect: { x0: t.x0, y0: t.y0 + t.h,    w: t.w, h: PLOT_H } },
  ];
  for (const { dir, rect } of candidates) {
    if (rect.x0 < b.x0 || rect.y0 < b.y0 ||
        rect.x0 + rect.w > b.x0 + b.w || rect.y0 + rect.h > b.y0 + b.h) continue;
    let clash = false;
    for (const n of kernel.graph.nodes.values()) {
      if (n.type === 'settlement' && n.id !== s.id &&
          rectsOverlap(rect, n.attrs.territory)) { clash = true; break; }
    }
    if (clash) continue;
    // Dry-run the plot tiling: a strip with zero land plots is not an expansion.
    let anyLand = false;
    for (let py = rect.y0; py + PLOT_H <= rect.y0 + rect.h && !anyLand; py += PLOT_H)
      for (let px = rect.x0; px + PLOT_W <= rect.x0 + rect.w && !anyLand; px += PLOT_W) {
        let land = true;
        for (let yy = py; yy < py + PLOT_H && land; yy++)
          for (let xx = px; xx < px + PLOT_W && land; xx++)
            if (tileCost(xx, yy) === Infinity) land = false;
        if (land) anyLand = true;
      }
    if (!anyLand) continue;
    const evId = kernel.ledger.emit({
      tick, type: 'territory_expanded', actor: groupId, targets: [s.id],
      attrs: { dir, rect, reason: `residential district full; ${dir} land available` },
    });
    // Merge the strip into territory + the residential district rect.
    const nx0 = Math.min(t.x0, rect.x0), ny0 = Math.min(t.y0, rect.y0);
    const nx1 = Math.max(t.x0 + t.w, rect.x0 + rect.w);
    const ny1 = Math.max(t.y0 + t.h, rect.y0 + rect.h);
    s.attrs.territory = { x0: nx0, y0: ny0, w: nx1 - nx0, h: ny1 - ny0 };
    s.attrs.districts.push({ kind: 'residential', rect,
      reason: `expansion ${dir} (territory_expanded #${evId})` });
    deedPlots(kernel, s, groupId, rect, evId, tick);
    return true;
  }
  return false;
}
```

In `decide`, insert an EXPAND rule between FORGE and IDLE (priority: maintain → clear → hut → forge → expand → idle): when there is no `ready` plot, no `dirty` plot, the forge rule didn't fire, and surplus allows another hut, declare new land:

```js
  // 5. EXPAND (declaration): residential full and surplus could fund another hut.
  if (!ready && group.R >= HUT_COST + RESERVE_FLOOR) {
    if (expandTerritory(kernel, group.id, s.id, tick)) {
      emitDecision(kernel, group.id, s.id, tick, 'expand',
        'residential district full; new land declared');
      return;
    }
    emitDecision(kernel, group.id, s.id, tick, 'idle',
      'expansion blocked: no viable direction (bounds/overlap/water)');
    return;
  }
```
(The existing idle fallback stays last for the underfunded case.)

- [ ] **Step 4: Run** — `node --test sim/test/growth.test.js sim/test/probe-settlements.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add sim/society/growth.js sim/test/growth.test.js && git commit -m "feat(p5): territory expansion — zero-cost declaration deeds new plots when full"`

---

### Task 5: decline — ghost towns are structural facts

**Files:**
- Modify: `sim/society/growth.js`
- Test: `sim/test/growth.test.js` (append)

- [ ] **Step 1: Write the failing test** — append:

```js
test('decline: unfunded village decays to ghost town; growth loop stops', () => {
  const { k, g, s } = growthScenario(2600);
  assert.equal(enableGrowth(k, s.id, 0), true);
  k.runTo(GROWTH_INTERVAL_DAYS * DAY * 4);     // clear + build at least one hut
  assert.ok([...k.graph.nodes.values()].some(n => n.type === 'building'), 'village built');
  const group = k.graph.nodes.get(g.id);
  group.R = 0;                                  // funding stops dead
  k.runTo(k.tick + 150 * DAY);                  // decay 1/day from ≤100 → all fall
  assert.equal([...k.graph.nodes.values()].filter(n => n.type === 'building').length, 0,
    'all buildings decayed');
  assert.equal(s.attrs.tier, 'ghost', 'settlement is a ghost town');
  const ev = k.ledger.events.find(e => e.type === 'settlement_abandoned');
  assert.ok(ev, 'abandonment is a provenanced event');
  assert.ok(ev.attrs.peakBuildings >= 1, 'evidence: it was once alive');
  assert.equal(k.deltas.list.filter(d => d.kind === 'claimed').length, 0,
    'claims healed — wilderness returns on reboot');
  // The loop stopped: no growth_decision events after the abandonment tick.
  const after = k.ledger.events.filter(e =>
    e.type === 'growth_decision' && e.tick > ev.tick + GROWTH_INTERVAL_DAYS * DAY);
  assert.equal(after.length, 0, 'ghost towns make no decisions');
});
```

- [ ] **Step 2: Run to verify failure** — `node --test sim/test/growth.test.js` → FAIL (tier never becomes 'ghost').

- [ ] **Step 3: Implement** — in `sim/society/growth.js`, add a GHOST check at the TOP of `decide` (before the maintain rule):

```js
  // 0. GHOST: once-alive, now structureless, and too poor to rebuild — the
  //    settlement is abandoned; the loop ends (claims already healed via decay).
  if (standing.length === 0 && (s.attrs.peakBuildings ?? 0) > 0
      && group.R < HUT_COST + RESERVE_FLOOR) {
    kernel.ledger.emit({
      tick, type: 'settlement_abandoned', actor: group.id, targets: [s.id],
      attrs: { peakBuildings: s.attrs.peakBuildings,
               reason: `no standing buildings; reserve ${group.R} cannot rebuild` },
    });
    s.attrs.tier = 'ghost';
    return;
  }
```
(`onSettlementGrowth` already stops rescheduling when `tier === 'ghost'`; `retier` already skips ghosts.)

- [ ] **Step 4: Run** — `node --test sim/test/growth.test.js` → PASS (all).

- [ ] **Step 5: Commit** — `git add sim/society/growth.js sim/test/growth.test.js && git commit -m "feat(p5): decline — unfunded villages become ghost towns and stop deciding"`

---

### Task 6: probe — the full settlement lifecycle, conserved and deterministic

**Files:**
- Test: `sim/test/probe-growth.test.js` (create)

- [ ] **Step 1: Write the probe** — create `sim/test/probe-growth.test.js`:

```js
// sim/test/probe-growth.test.js — P5 probe: a funded founder group's village
// GROWS through scheduled rule-based decisions (every decision a provenanced
// event with a reason code), huts fill the plots, a forge follows, the tier
// label tracks real building counts, funding stops → maintenance fails →
// buildings fall → ghost town → claims heal (wilderness on reboot). The whole
// 2-sim-year history satisfies the conservation identity and is bit-identical
// across runs. HONEST ABSENCES: no population (surplus-only driver), no farms
// (no cultivation system), fixed decision rules (not politics).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, pick } from '../world/actions.js';
import { createGroup, contribute } from '../society/groups.js';
import { foundSettlement } from '../society/settlements.js';
import { findSettlementSite } from '../society/suitability.js';
import { materializeRect } from '../world/wire.js';
import { enableGrowth, GROWTH_INTERVAL_DAYS, TIER_THRESHOLDS } from '../society/growth.js';
import { DAY } from '../time/metabolism.js';

const RECT = { x0: 926, y0: 0, w: 28, h: 14 };
const SEED = 7;

function runScenario() {
  const k = new Kernel({ seed: SEED, bounds: RECT });
  let bush;
  k.graph.boot(() => {
    bush = k.addLiving({ species: 'berry_bush', x: 941, y: 1,
                         R: 200000, body: 250000, tick: 0, age: 400 * DAY });
    const made = materializeRect(k, RECT, 0);
    assert.ok(made >= 1, 'vacuity: baseline materialized something');
  });
  const p = createPlayer(k, 0, { x: 941, y: 1 });
  const pl = k.graph.nodes.get(p.id);
  const g = createGroup(k, 0, { x: 941, y: 0 });

  // Fund generously with real harvests: the village should build out fully.
  const FUND = 12000;
  while (pl.R < FUND) { if (pick(k, p.id, bush.id, 0) <= 0) break; }
  assert.ok(pl.R >= FUND, `player holds ≥${FUND}`);
  assert.equal(contribute(k, p.id, g.id, FUND, 0), true);

  const stocksStart = k.stocks(0);   // baseline at tick 0 (stocks is destructive)

  const site = findSettlementSite(k, RECT);
  const s = foundSettlement(k, g.id, site, 0);
  assert.ok(s, 'settlement founded');
  assert.equal(enableGrowth(k, s.id, 0), true);

  // ── GROWTH: ~1 sim-year of decisions ──
  k.runTo(36 * GROWTH_INTERVAL_DAYS * DAY);
  const decisions = k.ledger.events.filter(e => e.type === 'growth_decision');
  assert.ok(decisions.length >= 30, 'the loop ran every interval');
  for (const e of decisions) {
    assert.equal(e.actor, g.id, 'every decision is the founder group acting');
    assert.ok(typeof e.attrs.reason === 'string' && e.attrs.reason.length > 0,
      'every decision carries a reason code (world-compiler discipline)');
  }
  const kinds = new Set(decisions.map(e => e.attrs.decision));
  assert.ok(kinds.has('clear'), 'land was cleared');
  assert.ok(kinds.has('build_hut'), 'huts were built');
  const standing = [...k.graph.nodes.values()].filter(n => n.type === 'building');
  assert.ok(standing.length >= 2, `village built out (${standing.length} standing)`);
  const peakTier = s.attrs.tier;
  if (standing.length >= TIER_THRESHOLDS.town) {
    assert.equal(peakTier, 'town', 'tier label tracks real counts');
  }

  // ── DECLINE: funding stops; maintenance fails; everything falls ──
  k.graph.nodes.get(g.id).R = 0;
  k.runTo(k.tick + 200 * DAY);
  assert.equal([...k.graph.nodes.values()].filter(n => n.type === 'building').length, 0,
    'every building decayed');
  assert.equal(s.attrs.tier, 'ghost', 'ghost town');
  assert.ok(k.ledger.events.some(e => e.type === 'settlement_abandoned'),
    'abandonment recorded with evidence');
  assert.equal(k.deltas.list.filter(d => d.kind === 'claimed').length, 0,
    'claims healed — flora regrows on the next reboot');

  // ── CONSERVATION over the whole 2-sim-year history ──
  const end = k.stocks(k.tick);
  const t = k.ledger.totals;
  const lhs = end - stocksStart;
  const rhs = t.captured - t.burned - t.decayed - t.transferLoss;
  const scale = Math.max(Math.abs(t.captured), 1);
  assert.ok(Math.abs(lhs - rhs) / scale < 1e-9,
    `conservation violated: Δstocks=${lhs} flows=${rhs}`);

  return {
    site: { x: site.x, y: site.y },
    decisions: decisions.map(e => e.attrs.decision),
    peakTier,
    peakBuildings: s.attrs.peakBuildings,
    events: k.ledger.events.map(e => e.type),
    deltaCount: k.deltas.list.length,
  };
}

test('PROBE: fund → found → grow → tier → defund → ghost → wilderness', () => {
  runScenario();
});

test('PROBE determinism: identical 2-year history on identical seed', () => {
  const a = runScenario();
  const b = runScenario();
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run** — `node --test sim/test/probe-growth.test.js` → PASS. If seed-7 geography makes an assertion impossible (e.g. the bush can't yield FUND, or fewer plots exist than expected), adapt PROGRAMMATICALLY — never hardcode coordinates, never weaken an assertion silently; record every adaptation for the Deviations section. The conservation identity and determinism assertions are NON-NEGOTIABLE.

- [ ] **Step 3: Run the coupled neighbors** — `node --test sim/test/probe-buildings.test.js sim/test/probe-settlements.test.js sim/test/probe-conservation.test.js sim/test/growth.test.js` → PASS.

- [ ] **Step 4: Commit** — `git add sim/test/probe-growth.test.js && git commit -m "test(sim): probe — villages grow by paid decisions and die back to wilderness"`

---

### Task 7: roadmap close-out

**Files:**
- Modify: `docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md` (P5 row)
- Modify: `docs/superpowers/plans/2026-06-12-pass3-p5-growth.md` (Deviations section)

- [ ] **Step 1:** Set the P5 row status to `**DONE** 2026-06-12 (plan 2026-06-12-pass3-p5-growth.md, Deviations canonical; …)` summarizing what shipped, EXPLICITLY noting the two roadmap-scope deviations: population pressure absent (no NPCs — surplus-only driver) and farms absent (no cultivation system), plus the other honest absences.
- [ ] **Step 2:** Append `## Deviations (canonical)` to THIS plan recording every deviation the implementers logged.
- [ ] **Step 3:** Commit — `git add docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md docs/superpowers/plans/2026-06-12-pass3-p5-growth.md && git commit -m "docs(p5): roadmap close-out + deviations"`

---

## Quality backlog (accepted up front)

- `buildingsIn`/`settlementPlots`/`plotIsBuilt`/`plotIsDirty` are O(all nodes) per interval — joins the existing tile-index backlog (fine at 10-day cadence, one settlement).
- HUT_COST/FORGE_COST constants duplicate the P4 cost formula — recompute from `expandBlueprint` if the templates ever change (extraction candidate).
- Group inventory accumulates salvaged matter forever (counted by stocks, conserving) — a market/Economy sink is the consumer.
- Expansion only zones residential strips — craft-district expansion when forge demand outgrows the original district is future work.
- `growthEnabled`/`peakBuildings` attrs join the save/load rehydration backlog.

---

## Deviations (canonical)

Recorded during execution (Tasks 1–6, branch `pass3-p5-growth`, commits `2d2f40384`…`da0e915e9`). Where this section conflicts with the task bodies above, THIS section is canonical.

1. **Forge gate adapted to 1-plot geography (Task 3).** Seed-7's initial residential district `{x0:935,y0:0,w:6,h:10}` yields EXACTLY one plot at (935,4) — water blocks the y=0..3 plot row. The plan's `huts >= 2` forge gate would have been dead code pre-expansion, so it became `huts.length >= 1 && forges.length < Math.max(1, Math.floor(huts.length / 2))`. Verified by direct probe; minimal, honest, deterministic.
2. **Maintenance test asserts `condition >= 99`, not `=== 100` (Task 2).** A `building_decay` scheduler event in the same `runTo` window fires after the maintain decision, dropping condition by 1. Spec reviewer confirmed the assertion is still real (condition was forced to 30; no path to ≥99 without maintain firing).
3. **`kernel.bounds` is nullable (Task 4).** Bounds check wrapped `if (b && ...)` — null bounds (unbounded world) skip bounds rejection. Consequence accepted: with null bounds and unlimited R the loop expands forever; probe runs 36 intervals; flag if unattended long runs ever matter.
4. **Territory rect is a bounding-box envelope, not a zoning authority (Task 4, quality review).** Alternating-direction expansions produce territory rects containing tiles never zoned into any district. Benign today: plots are deeded only inside district strips, and all queries go through plot/district nodes. If territory ever gates placement/pathing directly, migrate to a district-set union. Overlap risk between converging settlements is caught by the strip-vs-territory check.
5. **Failed forge-candidate clearing salvages matter into group inventory (Task 3, quality review).** The forge origin scan clears each candidate site before `constructBuilding`; a refused candidate leaves honestly-earned salvage in the group inventory. Conserving (stocks counts inventory); accepted.
6. **Ghost is permanent through the current API (Task 5, quality review).** `enableGrowth` guards on `growthEnabled`, so it returns false on a ghost — no silent resurrection. Explicit re-founding is a declared future seam (clear `growthEnabled`, reset `peakBuildings`). A structureless settlement with R ≥ 810 correctly rebuilds via the normal clear→hut chain instead of ghosting.
7. **Probe A3 — `standing.length >= 2` guarded on expansion (Task 6).** On seed-7 expand fires twice (west, east) and 5 buildings stand, so the ≥2 assertion executes; the guard's else-branch still asserts ≥1 plus honest blocked-expansion idle evidence for hypothetical blocked seeds.
8. **Probe A5 — ledger-safe defund (Task 6).** The plan's bare `group.R = 0` deletes energy unrecorded and breaks the conservation identity by exactly the zeroed amount. The probe instead does `k.ledger.count('burned', grp.R)` before zeroing — group surplus evaporating on abandonment is semantically a burn. (The unit test in growth.test.js keeps bare zeroing; it asserts no conservation identity, so it is unaffected.)
9. **Probe A6 — transferLoss baseline windowing (Task 6).** Pre-baseline pick/contribute losses occur before the `stocks(0)` snapshot, so the identity subtracts `tlStart`; final `stocks(k.tick)` is called before reading `ledger.totals` so closing accruals land on both sides. Same window both sides — canonical identity, not a weakened variant.
10. **Quality-review notes accepted as backlog (Tasks 1–3):** zombie reschedule if the founder group node is ever removed (loop no-ops forever); event-targets backpatch `ledger.events[evId-1]` relies on 1-based contiguous ids + shared array reference (11 call sites — established pattern, helper extraction candidate); `inRect` duplicated growth.js/buildings.js; expandTerritory dry-run land scan duplicates deedPlots' inner loop; `clearLand` return count understates second-pass debris work; underfunded test could additionally assert the idle event.
11. **Roadmap-scope deviations (declared in plan, restated):** population pressure ABSENT (no NPCs until Pass 4 Life — surplus-only driver), farms ABSENT (no cultivation system — no-mock rule outranks roadmap scope), fixed priority rules not politics (Pass 5), LOD statistical growth tier NOT implemented (single-settlement scale).
