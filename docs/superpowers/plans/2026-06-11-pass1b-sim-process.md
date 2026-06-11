# Pass 1 Plan B — Sim Process + Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the headless kernel (Plan A) into a separate authoritative sim process with checkpoint/recovery and a WebSocket protocol, proven by in-game probe 6 (pick a berry, fell a tree, watch the stump-delta heal).

**Architecture:** Three layers. (1) Persistence: formalize the deltas store, persist scheduler + node versions, and add `checkpoint(kernel, db)` / `loadKernel(db)` so the world equation `f(seed, deltas, ledger)` survives process death. (2) Actions: player as a provenance-clean time-wallet node plus `pick`/`chop` verbs that move time through harvest channels and write healing deltas. (3) Process: `ws`-based SimServer pumping sim-time at a fixed scale, serving snapshot/tick-delta/events/time to attached clients, recording every intent in the ledger (determinism discipline §5.5), plus a minimal canvas probe client.

**Tech Stack:** Node ESM, better-sqlite3 (WAL), `ws` (new dependency), node:test, vanilla canvas client (no framework).

**Spec:** `docs/superpowers/specs/2026-06-11-pass1-time-metabolism-simulation-kernel-design.md` §3, §5.2, §5.3, §6.2 (probe 6). Roadmap: `docs/superpowers/plans/2026-06-11-pass1-roadmap.md` (set B → DONE when finished).

**Standing rules (from Plan A — read before any task):**
- GIT SAFETY: never `git add -A`/`git add .`; never `git reset --hard`; never `git checkout <sha>`; never amend; stay on branch `pass1b-sim-process`.
- No-mock rule: systems may be ABSENT but never FAKE. The probe client is a *probe view*, not the game renderer (that's Plan E) — it must render only what the sim serves.
- Tune constants, never mechanisms. Deviations from this plan must be appended to the "Canonical deviations" section at the bottom of this file.
- All randomness via `rand(seed, a, b)` from `sim/kernel/rng.js`. No `Math.random`, no `Date.now` anywhere in `sim/` except the server pump (`sim/server/server.js` is the ONLY file allowed to read the wall clock, and only to decide how far to advance sim-time).
- Run the full suite (`npm test`) before every commit; never commit red.

**Existing code you build on (read these files first):**
- `sim/kernel/kernel.js` — Kernel: `addLiving`, `closeSegment`, `_reRateOne`, `runTo`, `stocks`.
- `sim/kernel/scheduler.js` + `heap.js` — heap entries `{tick, nodeId, kind, ver}`; heap array `scheduler.heap.a`; `rebuild(items)`.
- `sim/store/db.js` — `openDb(path)`, DDL, `canonicalDump(db)`.
- `sim/store/graph.js` — in-memory hypergraph, `flush(db, tick)`.
- `sim/store/ledger.js` — append-only events + conservation totals, `flush(db)`.
- `sim/time/lifecycle.js` — event handlers; `die()`; monkey-patches `kernel.deltas` (array) — Task 2 formalizes this.
- `sim/time/metabolism.js` — `SPECIES`, `materialize`, `transfer`, `stageAt`, `DAY`, `YEAR`.
- `sim/time/flux.js` — per-tile flux; `enter/leave/updateDemand/captureOf`.
- `sim/world/spawn.js` — deterministic baseline meadow.

---

### Task 1: Persist the full kernel state shape (ver, demand, scheduler table)

The Plan A schema can't round-trip a kernel: `node.ver` (staleness filtering) and each node's flux `demand` aren't persisted, and the scheduler heap isn't stored at all. Fix the shape first, before writing checkpoint logic.

**Files:**
- Modify: `sim/store/db.js` (DDL: `ver` column on nodes, new `sched` table, add both to `canonicalDump`)
- Modify: `sim/store/graph.js` (flush `ver`)
- Modify: `sim/kernel/kernel.js` (record `attrs.demand` in `_reRateOne`)
- Modify: `sim/kernel/scheduler.js` (add `flush(db)` and `load(db)`)
- Test: `sim/test/checkpoint.test.js` (new file, grows over Tasks 1–3)

- [x] **Step 1: Write the failing test**

```js
// sim/test/checkpoint.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../store/db.js';
import { Scheduler } from '../kernel/scheduler.js';
import { Kernel } from '../kernel/kernel.js';
import { DAY } from '../time/metabolism.js';

test('scheduler heap round-trips through SQLite preserving array order', () => {
  const db = openDb(':memory:');
  const s = new Scheduler();
  s.schedule(50, 3, 'seed', -1);
  s.schedule(10, 1, 'death_check', 4);
  s.schedule(10, 2, 'stage', -1);
  s.flush(db);
  const s2 = new Scheduler();
  s2.load(db);
  assert.deepEqual(s2.heap.a, s.heap.a);   // exact array order, not just heap order
});

test('node ver and flux demand survive flush', () => {
  const db = openDb(':memory:');
  const k = new Kernel({ seed: 7, bounds: { x0: 0, y0: 0, w: 4, h: 4 } });
  let n;
  k.graph.boot(() => { n = k.addLiving({ species: 'grass', x: 1, y: 1, R: 500, body: 20, tick: 0 }); });
  k.runTo(20 * DAY);
  const live = k.graph.nodes.get(n.id) ?? [...k.graph.nodes.values()][0];
  assert.ok(live.ver >= 0);
  assert.ok(typeof live.attrs.demand === 'number'); // _reRateOne must record it
  k.graph.flush(db, k.tick);
  const row = db.prepare('SELECT ver, attrs FROM nodes WHERE id=?').get(live.id);
  assert.equal(row.ver, live.ver);
  assert.equal(JSON.parse(row.attrs).demand, live.attrs.demand);
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `node --test sim/test/checkpoint.test.js`
Expected: FAIL — `s.flush is not a function`, and the demand assertion fails.

- [x] **Step 3: Implement**

In `sim/store/db.js`, change the `nodes` DDL to add `ver` (after `last_tick`):

```sql
  R REAL, rate REAL, last_tick INTEGER,
  ver INTEGER NOT NULL DEFAULT 0,
```

and append a `sched` table to the DDL string (before `meta`):

```sql
CREATE TABLE IF NOT EXISTS sched(
  idx INTEGER PRIMARY KEY,
  tick INTEGER NOT NULL,
  node_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ver INTEGER NOT NULL
);
```

In `canonicalDump`, add `['sched', 'idx']` to the `tables` list (after `deltas`).

NOTE: no migration needed — no shipped world files exist yet; `CREATE IF NOT EXISTS` on fresh DBs is enough. The repo's existing tests all use `:memory:`.

In `sim/store/graph.js` `flush()`, update the insert to include ver:

```js
const ni = db.prepare('INSERT INTO nodes(id,type,born_tick,x,y,R,rate,last_tick,ver,created_by_event,owner,attrs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
for (const n of this.nodes.values()) {
  ni.run(n.id, n.type, n.bornTick, n.x, n.y, n.R, n.r, n.lastTick, n.ver, n.createdByEvent, n.owner, JSON.stringify(n.attrs));
}
```

In `sim/kernel/kernel.js` `_reRateOne`, right after `const demand = sp.demand * dF * sen.demandMul;` add:

```js
    node.attrs.demand = demand;   // persisted so loadKernel can rebuild the flux field
```

In `sim/kernel/scheduler.js`, add two methods:

```js
  /** Persist the heap array verbatim (its order IS deterministic state). */
  flush(db) {
    const tx = db.transaction(() => {
      db.exec('DELETE FROM sched;');
      const ins = db.prepare('INSERT INTO sched(idx,tick,node_id,kind,ver) VALUES (?,?,?,?,?)');
      this.heap.a.forEach((e, i) => ins.run(i, e.tick, e.nodeId, e.kind, e.ver));
    });
    tx();
  }

  load(db) {
    this.heap.a = db.prepare('SELECT tick, node_id, kind, ver FROM sched ORDER BY idx').all()
      .map(r => ({ tick: r.tick, nodeId: r.node_id, kind: r.kind, ver: r.ver }));
    // already a valid heap (stored verbatim) — no rebuild needed
  }
```

- [x] **Step 4: Run tests**

Run: `node --test sim/test/checkpoint.test.js` → PASS. Then `npm test` → all green (the determinism probe re-canonicalizes with the new columns; if `probe-determinism` fails, it's comparing two dumps *of the same code* so it should still match — investigate any failure, don't paper over it).

- [x] **Step 5: Commit**

```bash
git add sim/store/db.js sim/store/graph.js sim/kernel/kernel.js sim/kernel/scheduler.js sim/test/checkpoint.test.js
git commit -m "feat(sim): persist node ver, flux demand, and scheduler heap (checkpoint groundwork)"
```

---

### Task 2: Formalize the Deltas store (replace the monkey-patched array)

`registerLifecycle` currently does `kernel.deltas = []` and lifecycle pushes plain objects. Deltas are spec §5.2 first-class state ("the world's scars") and must flush/load and support removal (healing).

**Files:**
- Create: `sim/store/deltas.js`
- Modify: `sim/kernel/kernel.js` (construct `this.deltas = new Deltas()` in the constructor)
- Modify: `sim/time/lifecycle.js` (delete the `kernel.deltas = []` line; `push` callsite keeps working)
- Test: `sim/test/deltas.test.js`

- [x] **Step 1: Write the failing test**

```js
// sim/test/deltas.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../store/db.js';
import { Deltas } from '../store/deltas.js';

test('deltas push/remove/flush/load round-trip', () => {
  const d = new Deltas();
  const a = d.push({ tick: 5, x: 1, y: 2, target: 'node:9', kind: 'felled' });
  const b = d.push({ tick: 6, x: 3, y: 4, target: 'corpse:9', kind: 'gone' });
  assert.equal(a, 1); assert.equal(b, 2);
  d.remove(a);                              // healed
  assert.equal(d.list.length, 1);
  const db = openDb(':memory:');
  d.flush(db);
  const d2 = Deltas.load(db);
  assert.deepEqual(d2.list, d.list);
  assert.equal(d2.nextDeltaId, 3);          // ids never reused after heal
});

test('kernel owns a Deltas store, not a plain array', async () => {
  const { Kernel } = await import('../kernel/kernel.js');
  const k = new Kernel({ seed: 1 });
  assert.ok(k.deltas instanceof Deltas);
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `node --test sim/test/deltas.test.js` → FAIL (module not found).

- [x] **Step 3: Implement**

```js
// sim/store/deltas.js
// Persistent overrides of baseline — the world's scars (spec §5.2).
// Deltas heal: remove(id) deletes a delta when regrowth/decay pays it off.
export class Deltas {
  constructor() {
    this.list = [];          // { id, tick, x, y, target, kind, attrs }
    this.nextDeltaId = 1;
  }

  push({ tick, x = null, y = null, target, kind, attrs = {} }) {
    const id = this.nextDeltaId++;
    this.list.push({ id, tick, x, y, target, kind, attrs });
    return id;
  }

  remove(id) {
    const i = this.list.findIndex(d => d.id === id);
    if (i >= 0) this.list.splice(i, 1);
  }

  flush(db) {
    const tx = db.transaction(() => {
      db.exec('DELETE FROM deltas;');
      const ins = db.prepare('INSERT INTO deltas(id,tick,x,y,target,kind,attrs) VALUES (?,?,?,?,?,?,?)');
      for (const d of this.list) ins.run(d.id, d.tick, d.x, d.y, d.target, d.kind, JSON.stringify(d.attrs));
      db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('nextDeltaId', String(this.nextDeltaId));
    });
    tx();
  }

  static load(db) {
    const d = new Deltas();
    d.list = db.prepare('SELECT * FROM deltas ORDER BY id').all()
      .map(r => ({ id: r.id, tick: r.tick, x: r.x, y: r.y, target: r.target, kind: r.kind, attrs: JSON.parse(r.attrs) }));
    const meta = db.prepare('SELECT value FROM meta WHERE key=?').get('nextDeltaId');
    d.nextDeltaId = meta ? Number(meta.value) : (d.list.at(-1)?.id ?? 0) + 1;
    return d;
  }
}
```

In `sim/kernel/kernel.js`: `import { Deltas } from '../store/deltas.js';` and in the constructor (before `registerLifecycle(this)`): `this.deltas = new Deltas();`.

In `sim/time/lifecycle.js`: delete the line `kernel.deltas = [];` (the `k.deltas.push({...})` call in `decay_gone` now hits the class — same signature).

- [x] **Step 4: Run tests**

`node --test sim/test/deltas.test.js` → PASS, then `npm test` → all green.

- [x] **Step 5: Commit**

```bash
git add sim/store/deltas.js sim/kernel/kernel.js sim/time/lifecycle.js sim/test/deltas.test.js
git commit -m "feat(sim): first-class Deltas store with heal (remove) + persistence"
```

---

### Task 3: checkpoint(kernel, db) + loadKernel(db) — the world survives process death

Spec §3.4: quit → checkpoint; crash → reopen (SQLite WAL replays automatically) → resume at saved tick, bit-identical. Flush order is mandatory: **ledger BEFORE graph** (`nodes.created_by_event` references `events.id`).

**Files:**
- Create: `sim/store/checkpoint.js`
- Test: `sim/test/checkpoint.test.js` (extend)

- [x] **Step 1: Write the failing test (append to checkpoint.test.js)**

```js
import { checkpoint, loadKernel } from '../store/checkpoint.js';
import { spawnMeadow } from '../world/spawn.js';
import { canonicalDump } from '../store/db.js';

test('checkpoint at day 30, load, run to day 60 === straight run to day 60', () => {
  const bounds = { x0: 0, y0: 0, w: 12, h: 12 };
  const mk = () => { const k = new Kernel({ seed: 99, bounds }); spawnMeadow(k, bounds); return k; };

  const straight = mk();
  straight.runTo(60 * DAY);

  const split = mk();
  split.runTo(30 * DAY);
  const db = openDb(':memory:');
  checkpoint(split, db);
  const resumed = loadKernel(db);
  assert.equal(resumed.tick, 30 * DAY);
  resumed.runTo(60 * DAY);

  const dbA = openDb(':memory:'); checkpoint(straight, dbA);
  const dbB = openDb(':memory:'); checkpoint(resumed, dbB);
  assert.equal(canonicalDump(dbB), canonicalDump(dbA));   // bit-identical recovery (spec §5.1)
});

test('checkpoint preserves conservation totals across load', () => {
  const k = new Kernel({ seed: 5, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  spawnMeadow(k, { x0: 0, y0: 0, w: 8, h: 8 });
  k.runTo(10 * DAY);
  const db = openDb(':memory:');
  checkpoint(k, db);
  const k2 = loadKernel(db);
  assert.deepEqual(k2.ledger.totals, k.ledger.totals);
});
```

- [x] **Step 2: Run to verify it fails** — `node --test sim/test/checkpoint.test.js` → FAIL (module not found).

- [x] **Step 3: Implement**

```js
// sim/store/checkpoint.js
// World equation persistence (spec §5.1, §3.4): everything a Kernel needs to
// resume bit-identically. Flush order: ledger BEFORE graph (FK created_by_event).
import { Kernel } from '../kernel/kernel.js';
import { Ledger } from './ledger.js';
import { Deltas } from './deltas.js';

export function checkpoint(kernel, db) {
  const tx = db.transaction(() => {
    kernel.ledger.flush(db);            // events first (FK target)
    kernel.graph.flush(db, kernel.tick);
    kernel.deltas.flush(db);
    kernel.scheduler.flush(db);
    const meta = db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)');
    meta.run('seed', String(kernel.seed));
    meta.run('phi', String(kernel.flux.phi));
    meta.run('bounds', JSON.stringify(kernel.bounds));
  });
  tx();
}

export function loadKernel(db) {
  const get = key => db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;
  const kernel = new Kernel({
    seed: Number(get('seed')),
    phi: Number(get('phi')),
    bounds: JSON.parse(get('bounds') ?? 'null'),
  });
  kernel.tick = Number(get('tick'));

  // graph
  for (const r of db.prepare('SELECT * FROM nodes ORDER BY id').all()) {
    const node = {
      id: r.id, type: r.type, bornTick: r.born_tick, x: r.x, y: r.y,
      R: r.R, r: r.rate, lastTick: r.last_tick, ver: r.ver,
      createdByEvent: r.created_by_event, owner: r.owner, attrs: JSON.parse(r.attrs),
    };
    kernel.graph.nodes.set(node.id, node);
    if (node.x != null) {
      const k = kernel.graph._cellKey(node.x, node.y);
      if (!kernel.graph.grid.has(k)) kernel.graph.grid.set(k, new Set());
      kernel.graph.grid.get(k).add(node.id);
    }
  }
  for (const r of db.prepare('SELECT * FROM edges ORDER BY id').all()) {
    const members = db.prepare('SELECT node_id, role FROM edge_members WHERE edge_id=? ORDER BY node_id, role').all(r.id)
      .map(m => [m.node_id, m.role]);
    const edge = { id: r.id, type: r.type, weight: r.weight, bornTick: r.born_tick, owner: r.owner, attrs: JSON.parse(r.attrs), members };
    kernel.graph.edges.set(edge.id, edge);
    for (const [nid] of members) {
      if (!kernel.graph.byNode.has(nid)) kernel.graph.byNode.set(nid, new Set());
      kernel.graph.byNode.get(nid).add(edge.id);
    }
  }
  kernel.graph.nextNodeId = Number(get('nextNodeId'));
  kernel.graph.nextEdgeId = Number(get('nextEdgeId'));

  // ledger
  kernel.ledger = new Ledger();
  const targets = new Map();
  for (const t of db.prepare('SELECT event_id, node_id FROM event_targets ORDER BY rowid').all()) {
    if (!targets.has(t.event_id)) targets.set(t.event_id, []);
    targets.get(t.event_id).push(t.node_id);
  }
  for (const r of db.prepare('SELECT * FROM events ORDER BY id').all()) {
    kernel.ledger.events.push({
      id: r.id, tick: r.tick, type: r.type, actor: r.actor, targets: targets.get(r.id) ?? [],
      magnitude: r.magnitude, causeEventId: r.cause_event_id, attrs: JSON.parse(r.attrs),
    });
  }
  kernel.ledger.nextEventId = Number(get('nextEventId'));
  kernel.ledger.totals = JSON.parse(get('totals'));

  kernel.deltas = Deltas.load(db);
  kernel.scheduler.load(db);

  // flux: living nodes re-enter with their persisted demand (set by _reRateOne)
  for (const n of kernel.graph.nodes.values()) {
    if (n.R != null && n.attrs.demand != null) kernel.flux.enter(n.id, n.x, n.y, n.attrs.demand);
    else if (n.R != null) kernel.flux.enter(n.id, n.x, n.y, 0);  // never re-rated yet (e.g. player wallet won't be in flux — see Task 4 note)
  }
  return kernel;
}
```

IMPORTANT correctness note for the implementer: `loadKernel` must NOT re-rate anything — re-rating closes segments and bumps `ver`, which would invalidate persisted scheduler entries and break bit-identity. It is pure state reconstruction. Also note Task 4 will exclude non-metabolizing wallet nodes (player) from flux on load via `attrs.noFlux === true` — when you reach Task 4, come back and guard the flux re-entry loop with `if (n.attrs.noFlux) continue;`.

- [x] **Step 4: Run tests** — `node --test sim/test/checkpoint.test.js` then `npm test` → all green.

- [x] **Step 5: Commit**

```bash
git add sim/store/checkpoint.js sim/test/checkpoint.test.js
git commit -m "feat(sim): checkpoint/loadKernel — bit-identical resume (ledger-before-graph flush order)"
```

---

### Task 4: Tree species + player wallet + pick/chop actions (the probe-6 verbs)

The player is *an entity sending intents* (spec §3.2). Pass 1 has no body/embodiment system (S4 absent — honest absence), so the player node is a pure **time wallet**: it holds harvested time but does not metabolize. It is provenance-clean (created by a `player_join` ledger event) and excluded from flux via `attrs.noFlux`.

**Matter seam (S3, future pass):** harvest events must record `species` and `magnitude` in the ledger so the future Matter system (grains: wood, leaves...) can derive yields from the causal record. Do NOT model grains now — matter is ABSENT, not faked. The scalar moved today is time (tu); the event carries enough to re-derive matter later.

**Files:**
- Modify: `sim/time/metabolism.js` (add `tree` to SPECIES)
- Modify: `sim/world/spawn.js` (tree density + start ranges)
- Modify: `sim/time/lifecycle.js` (`die()` returns the corpse node or null; `decay_gone` heals `attrs.healDeltaId`)
- Modify: `sim/store/checkpoint.js` (skip `attrs.noFlux` nodes in flux re-entry — see Task 3 note)
- Create: `sim/world/actions.js`
- Test: `sim/test/actions.test.js`

- [x] **Step 1: Write the failing test**

```js
// sim/test/actions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, pick, chop } from '../world/actions.js';
import { SPECIES, DAY } from '../time/metabolism.js';

function world() {
  const k = new Kernel({ seed: 3, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let bush, tree;
  k.graph.boot(() => {
    bush = k.addLiving({ species: 'berry_bush', x: 2, y: 2, R: 8000, body: 4000, tick: 0, age: 200 * DAY });
    tree = k.addLiving({ species: 'tree', x: 5, y: 5, R: 20000, body: 30000, tick: 0, age: 400 * DAY });
  });
  return { k, bush, tree };
}

test('pick moves time from bush to player through harvest channel', () => {
  const { k, bush } = world();
  const player = createPlayer(k, 0);
  assert.equal(player.attrs.noFlux, true);
  const gained = pick(k, player.id, bush.id, 0);
  assert.ok(gained > 0);
  assert.equal(player.R, gained);
  assert.ok(Math.abs(gained / SPECIES.berry_bush.pick.bite - 0.5) < 1e-9); // harvest eff 0.5
  const ev = k.ledger.events.at(-1);
  assert.equal(ev.type, 'pick');
  assert.equal(ev.attrs.species, 'berry_bush');   // matter seam: species recorded
});

test('chop kills the tree, writes a felled delta, corpse decay heals it', () => {
  const { k, tree } = world();
  const player = createPlayer(k, 0);
  chop(k, player.id, tree.id, 0);
  assert.equal(k.graph.nodes.get(tree.id), undefined);          // tree is dead
  const corpse = [...k.graph.nodes.values()].find(n => n.type === 'corpse');
  assert.ok(corpse, 'stump corpse exists');
  assert.equal(k.deltas.list.length, 1);
  assert.equal(k.deltas.list[0].kind, 'felled');
  assert.ok(corpse.attrs.healDeltaId === k.deltas.list[0].id);
  k.runTo(2 * 360 * DAY);                                        // long enough for decay_gone
  assert.equal(k.deltas.list.filter(d => d.kind === 'felled').length, 0);  // healed
  assert.ok(k.ledger.events.some(e => e.type === 'delta_healed'));
});

test('chop death is causally chained to the chop event', () => {
  const { k, tree } = world();
  const player = createPlayer(k, 0);
  chop(k, player.id, tree.id, 0);
  const chopEv = k.ledger.events.find(e => e.type === 'chop');
  const deathEv = k.ledger.events.find(e => e.type === 'death');
  assert.equal(deathEv.causeEventId, chopEv.id);
});
```

- [x] **Step 2: Run to verify failure** — `node --test sim/test/actions.test.js` → FAIL (no actions.js, no tree species).

- [x] **Step 3: Implement**

In `sim/time/metabolism.js`, add to SPECIES (after `berry_bush`); also add a `pick` block to `berry_bush`:

```js
  tree: {
    demand: 0.80, burn: 0.08, growFrac: 0.6, maxBody: 50000,
    stages: [
      ['seedling', 0,          0.4, 0.5],
      ['growing',  60 * DAY,   0.8, 0.8],
      ['mature',   1 * YEAR,   1.0, 1.0],
    ],
    senescence: { start: 30 * YEAR, stepEvery: 180 * DAY, burnGrowth: 1.08, demandDecay: 0.96 },
    seed: { every: 180 * DAY, cost: 8000, minR: 30000, jitter: 0.3 },
    embodiedDecayDays: 21,    // stump heals over ~weeks (probe 6)
  },
```

and inside `berry_bush` add: `pick: { bite: 300 },` (a hand-pick takes less than a grazer bite).

In `sim/world/spawn.js`, add to DENSITY: `tree: 0.02,` and to START:

```js
  tree: { R: [10000, 40000], body: [5000, 30000], maxAgeDays: 3000 },
```

In `sim/time/lifecycle.js`:
- `die()` — change the corpse branch to capture and return the corpse, and return `null` from the else branch:

```js
  if (E > GONE_THRESHOLD) {
    const halflife = sp.embodiedDecayDays * DAY;
    const corpseEv = kernel.ledger.emit({ tick, type: 'corpse', causeEventId: deathEv });
    const corpse = kernel.graph.createNode({
      type: 'corpse', tick, x, y, causeEventId: corpseEv,
      attrs: { E, decayHalflifeTicks: halflife, of: node.type },
    });
    const goneTick = tick + halflife * Math.log2(E / GONE_THRESHOLD);
    kernel.scheduler.schedule(goneTick, corpse.id, 'decay_gone', -1);
    return corpse;
  }
  kernel.ledger.count('decayed', E);
  return null;
```

- `decay_gone` handler — after the existing `k.deltas.push(...)` line, add:

```js
    if (node.attrs.healDeltaId != null) {
      k.deltas.remove(node.attrs.healDeltaId);
      k.ledger.emit({ tick: ev.tick, type: 'delta_healed', targets: [node.id], causeEventId: node.createdByEvent });
    }
```

In `sim/store/checkpoint.js` flux re-entry loop, add the guard promised in Task 3: `if (n.attrs.noFlux) continue;` as the first line of the loop body.

Create `sim/world/actions.js`:

```js
// Player verbs (spec §3.2 intents, probe 6). The player is a time WALLET:
// no metabolism, no flux capture — body/embodiment is S4, honestly absent.
// Matter seam: every harvest event records species + magnitude so the future
// S3 Matter pass can derive grain yields from the causal ledger.
import { SPECIES, transfer } from '../time/metabolism.js';
import { die } from '../time/lifecycle.js';

export function createPlayer(kernel, tick) {
  const evId = kernel.ledger.emit({ tick, type: 'player_join' });
  const player = kernel.graph.createNode({
    type: 'player', tick, x: null, y: null, R: 0, causeEventId: evId,
    attrs: { body: 0, cap: 0, burn: 0, noFlux: true },
  });
  kernel.ledger.events[evId - 1].targets.push(player.id);
  return player;
}

/** Harvest a bite from a pickable plant into the player's wallet. Returns tu gained (0 if invalid). */
export function pick(kernel, playerId, targetId, tick) {
  const player = kernel.graph.nodes.get(playerId);
  const prey = kernel.graph.nodes.get(targetId);
  if (!player || !prey || prey.R == null) return 0;
  const sp = SPECIES[prey.attrs.species];
  if (!sp?.pick) return 0;
  kernel.closeSegment(prey, tick);
  const bite = Math.min(sp.pick.bite, prey.attrs.body + Math.max(prey.R, 0));
  if (bite <= 0) return 0;
  const fromBody = Math.min(bite, prey.attrs.body);
  prey.attrs.body -= fromBody;
  prey.R -= (bite - fromBody);
  const gained = transfer(bite, 'harvest', kernel.ledger);
  player.R += gained;
  const evId = kernel.ledger.emit({
    tick, type: 'pick', actor: playerId, targets: [targetId], magnitude: bite,
    attrs: { species: prey.attrs.species },
  });
  if (prey.attrs.body + Math.max(prey.R, 0) <= 1e-9) die(kernel, prey, tick, evId);
  else kernel.reRateTileOf(targetId, tick);
  return gained;
}

/** Fell a living plant: causal death + felled delta that heals when the stump decays. */
export function chop(kernel, playerId, targetId, tick) {
  const target = kernel.graph.nodes.get(targetId);
  if (!target || target.R == null) return false;
  const { x, y } = target;
  const species = target.attrs.species;
  const evId = kernel.ledger.emit({
    tick, type: 'chop', actor: playerId, targets: [targetId],
    attrs: { species },
  });
  const corpse = die(kernel, target, tick, evId);
  if (corpse) {
    const deltaId = kernel.deltas.push({ tick, x, y, target: `node:${targetId}`, kind: 'felled', attrs: { species } });
    corpse.attrs.healDeltaId = deltaId;
  }
  return true;
}
```

- [x] **Step 4: Run tests** — `node --test sim/test/actions.test.js` then `npm test` → all green. (Probe suite re-runs with the new tree species in spawn — capacity/conservation probes use their own bounds and densities; if a probe assertion breaks because trees changed meadow composition, that is a REAL finding: re-check the probe's tolerances and document any retune as a deviation. Do not silently weaken assertions.)

- [x] **Step 5: Commit**

```bash
git add sim/time/metabolism.js sim/world/spawn.js sim/time/lifecycle.js sim/store/checkpoint.js sim/world/actions.js sim/test/actions.test.js
git commit -m "feat(sim): tree species, player time-wallet, pick/chop verbs with healing felled-deltas"
```

---

### Task 5: Protocol module (pure message validation/builders)

Spec §3.2. JSON messages, validated at the boundary (user input!), built by pure functions — no sockets in this module, fully unit-testable.

**Files:**
- Create: `sim/server/protocol.js`
- Test: `sim/test/protocol.test.js`

- [x] **Step 1: Write the failing test**

```js
// sim/test/protocol.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMsg, serializeEntity, snapshotMsg, tickDeltaMsg, eventsMsg, timeMsg } from '../server/protocol.js';

test('parseClientMsg accepts the four client message types', () => {
  assert.deepEqual(parseClientMsg(JSON.stringify({ type: 'hello', viewport: { x: 0, y: 0, w: 40, h: 25 } })),
    { type: 'hello', viewport: { x: 0, y: 0, w: 40, h: 25 } });
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'pick', target: 7 })).verb, 'pick');
  assert.equal(parseClientMsg(JSON.stringify({ type: 'query', id: 3 })).id, 3);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'admin', op: 'ff', days: 14 })).days, 14);
});

test('parseClientMsg rejects junk', () => {
  assert.equal(parseClientMsg('not json'), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'evil' })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'rm -rf' })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'admin', op: 'drop' })), null);
});

test('serializeEntity sends only render-relevant fields', () => {
  const node = { id: 4, type: 'grass', x: 1.5, y: 2.5, R: 100, attrs: { species: 'grass', body: 20, birthTick: 0 } };
  const e = serializeEntity(node, 10);
  assert.deepEqual(Object.keys(e).sort(), ['body', 'id', 'species', 'stage', 'type', 'x', 'y']);
  assert.equal(e.stage, 'seedling');
});

test('message builders stamp type and tick', () => {
  assert.equal(snapshotMsg(5, 1, [], []).type, 'snapshot');
  assert.equal(tickDeltaMsg(5, [], [], { R: 0 }).type, 'tick-delta');
  assert.equal(eventsMsg(5, []).type, 'events');
  assert.deepEqual(timeMsg(86400), { type: 'time', tick: 86400, day: 1 });
});
```

- [x] **Step 2: Run to verify failure** — module not found.

- [x] **Step 3: Implement**

```js
// sim/server/protocol.js
// Spec §3.2. JSON now; binary framing later if profiling demands.
// Validation lives HERE because client messages are untrusted input.
import { stageAt, DAY } from '../time/metabolism.js';

const VERBS = new Set(['pick', 'chop']);
const ADMIN_OPS = new Set(['pause', 'resume', 'save', 'ff']);

export function parseClientMsg(raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return null; }
  if (m == null || typeof m !== 'object') return null;
  switch (m.type) {
    case 'hello': {
      const v = m.viewport;
      if (!v || ![v.x, v.y, v.w, v.h].every(Number.isFinite)) return null;
      return { type: 'hello', viewport: { x: v.x, y: v.y, w: v.w, h: v.h } };
    }
    case 'intent':
      if (!VERBS.has(m.verb) || !Number.isInteger(m.target)) return null;
      return { type: 'intent', verb: m.verb, target: m.target };
    case 'query':
      if (!Number.isInteger(m.id)) return null;
      return { type: 'query', id: m.id };
    case 'admin':
      if (!ADMIN_OPS.has(m.op)) return null;
      return { type: 'admin', op: m.op, days: Number.isFinite(m.days) ? m.days : 1 };
    default:
      return null;
  }
}

/** Wire form of an entity: render-relevant fields only (sim stays authoritative). */
export function serializeEntity(node, tick) {
  if (node.type === 'corpse') {
    return { id: node.id, type: 'corpse', species: node.attrs.of, x: node.x, y: node.y, body: node.attrs.E, stage: 'corpse' };
  }
  const species = node.attrs.species;
  const stage = species ? stageAt(species, tick - node.attrs.birthTick)[0] : node.type;
  return { id: node.id, type: node.type, species, x: node.x, y: node.y, body: node.attrs.body, stage };
}

export const snapshotMsg = (tick, playerId, entities, deltas) =>
  ({ type: 'snapshot', tick, playerId, entities, deltas });
export const tickDeltaMsg = (tick, upserts, removed, player) =>
  ({ type: 'tick-delta', tick, upserts, removed, player });
export const eventsMsg = (tick, events) => ({ type: 'events', tick, events });
export const timeMsg = tick => ({ type: 'time', tick, day: Math.floor(tick / DAY) });
```

- [x] **Step 4: Run tests** — `node --test sim/test/protocol.test.js` then `npm test` → green.

- [x] **Step 5: Commit**

```bash
git add sim/server/protocol.js sim/test/protocol.test.js
git commit -m "feat(sim): protocol module — validated client msgs + wire builders (spec §3.2)"
```

---

### Task 6: SimServer — WebSocket sessions, pump, snapshot/tick-delta/events/time

The server owns the only wall-clock read in `sim/`: a pump interval that advances sim-time at `timeScale` sim-seconds per real second (default 48 → 1 game-day ≈ 30 real minutes, spec §1.7). Intents are queued as they arrive and applied at the next pump boundary tick — each application emits ledger events (Task 4 actions already do), keeping `f(seed, deltas, ledger)` replayable (§5.5).

First: `npm install ws` (run it, verify `package.json` gains the dependency).

**Files:**
- Create: `sim/server/server.js`
- Test: `sim/test/server.test.js`

- [x] **Step 1: Write the failing test**

```js
// sim/test/server.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { SimServer } from '../server/server.js';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';
import { DAY } from '../time/metabolism.js';

function makeServer() {
  const bounds = { x0: 0, y0: 0, w: 16, h: 16 };
  const kernel = new Kernel({ seed: 11, bounds });
  spawnMeadow(kernel, bounds);
  return new SimServer({ kernel, port: 0, timeScale: 48 });  // port 0 = OS-assigned
}

function connect(server) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
const next = (ws, type) => new Promise(res => {
  const h = data => { const m = JSON.parse(data); if (m.type === type) { ws.off('message', h); res(m); } };
  ws.on('message', h);
});

test('hello → snapshot with bubble entities and a player wallet', async () => {
  const server = makeServer();
  await server.listen();
  const ws = await connect(server);
  ws.send(JSON.stringify({ type: 'hello', viewport: { x: 0, y: 0, w: 16, h: 16 } }));
  const snap = await next(ws, 'snapshot');
  assert.ok(snap.entities.length > 0);
  assert.ok(Number.isInteger(snap.playerId));
  assert.ok(snap.entities.every(e => 'species' in e && 'stage' in e));
  ws.close(); await server.close();
});

test('pick intent is applied at pump tick and acknowledged via events', async () => {
  const server = makeServer();
  await server.listen();
  const ws = await connect(server);
  ws.send(JSON.stringify({ type: 'hello', viewport: { x: 0, y: 0, w: 16, h: 16 } }));
  const snap = await next(ws, 'snapshot');
  const bush = snap.entities.find(e => e.species === 'berry_bush');
  assert.ok(bush, 'meadow has a bush in bubble');
  ws.send(JSON.stringify({ type: 'intent', verb: 'pick', target: bush.id }));
  // pump runs intents; events stream carries the ledger event
  const evMsg = await next(ws, 'events');
  assert.ok(evMsg.events.some(e => e.type === 'pick' && e.targets.includes(bush.id)));
  const td = await next(ws, 'tick-delta');
  assert.ok(td.player.R > 0, 'wallet gained time');
  ws.close(); await server.close();
});

test('admin ff advances sim weeks instantly; admin pause freezes the clock', async () => {
  const server = makeServer();
  await server.listen();
  const ws = await connect(server);
  ws.send(JSON.stringify({ type: 'hello', viewport: { x: 0, y: 0, w: 16, h: 16 } }));
  await next(ws, 'snapshot');
  ws.send(JSON.stringify({ type: 'admin', op: 'ff', days: 14 }));
  const t = await next(ws, 'time');
  assert.ok(t.tick >= 14 * DAY);
  ws.close(); await server.close();
});
```

- [x] **Step 2: Run to verify failure** — `node --test sim/test/server.test.js` → FAIL (module not found).

- [x] **Step 3: Implement**

```js
// sim/server/server.js
// Spec §3. The ONLY file in sim/ allowed to read the wall clock — and only to
// decide how far to advance sim-time. The kernel itself never sees real time.
import { WebSocketServer } from 'ws';
import { parseClientMsg, serializeEntity, snapshotMsg, tickDeltaMsg, eventsMsg, timeMsg } from './protocol.js';
import { createPlayer, pick, chop } from '../world/actions.js';
import { checkpoint } from '../store/checkpoint.js';

const PUMP_MS = 100;   // ~10 Hz (spec §3.2)

export class SimServer {
  constructor({ kernel, port = 8787, timeScale = 48, db = null }) {
    this.kernel = kernel;
    this.port = port;
    this.timeScale = timeScale;
    this.db = db;                 // optional: admin save / shutdown checkpoint target
    this.paused = false;
    this.sessions = new Set();    // { ws, viewport, playerId, knownIds:Set }
    this.pendingIntents = [];     // applied at next pump boundary, in arrival order
    this._lastReal = null;
    this._eventCursor = 0;        // ledger index already broadcast
  }

  listen() {
    return new Promise(resolve => {
      this.wss = new WebSocketServer({ host: '127.0.0.1', port: this.port }, () => {
        this.port = this.wss.address().port;
        this._eventCursor = this.kernel.ledger.events.length;
        this._lastReal = Date.now();
        this.pump = setInterval(() => this._pump(), PUMP_MS);
        resolve();
      });
      this.wss.on('connection', ws => this._onConnection(ws));
    });
  }

  async close() {
    clearInterval(this.pump);
    if (this.db) checkpoint(this.kernel, this.db);    // quit → checkpoint (spec §3.4)
    for (const s of this.sessions) s.ws.close();
    await new Promise(res => this.wss.close(res));
  }

  _onConnection(ws) {
    let session = null;
    ws.on('message', raw => {
      const m = parseClientMsg(String(raw));
      if (!m) return;                                  // junk from untrusted input: drop
      if (m.type === 'hello') {
        const player = createPlayer(this.kernel, this.kernel.tick);
        session = { ws, viewport: m.viewport, playerId: player.id, knownIds: new Set() };
        this.sessions.add(session);
        this._sendSnapshot(session);
      } else if (!session) {
        // ignore everything before hello
      } else if (m.type === 'intent') {
        this.pendingIntents.push({ session, ...m });
      } else if (m.type === 'query') {
        const node = this.kernel.graph.nodes.get(m.id);
        ws.send(JSON.stringify({ type: 'query-result', id: m.id, entity: node ? serializeEntity(node, this.kernel.tick) : null }));
      } else if (m.type === 'admin') {
        if (m.op === 'pause') this.paused = true;
        if (m.op === 'resume') { this.paused = false; this._lastReal = Date.now(); }
        if (m.op === 'save' && this.db) checkpoint(this.kernel, this.db);
        if (m.op === 'ff') { this.kernel.runTo(this.kernel.tick + Math.round(m.days * 86400)); this._broadcastFrame(); }
      }
    });
    ws.on('close', () => { if (session) this.sessions.delete(session); });
  }

  _bubbleEntities(viewport) {
    const cx = viewport.x + viewport.w / 2, cy = viewport.y + viewport.h / 2;
    const radius = Math.hypot(viewport.w, viewport.h) / 2;
    return this.kernel.graph.nodesNear(cx, cy, radius)
      .map(n => serializeEntity(n, this.kernel.tick));
  }

  _sendSnapshot(session) {
    const entities = this._bubbleEntities(session.viewport);
    session.knownIds = new Set(entities.map(e => e.id));
    session.ws.send(JSON.stringify(snapshotMsg(
      this.kernel.tick, session.playerId, entities, this.kernel.deltas.list)));
  }

  _pump() {
    const now = Date.now();
    const elapsed = (now - this._lastReal) / 1000;
    this._lastReal = now;
    // 1. apply queued intents at the current boundary tick (arrival order = ledger order)
    const intents = this.pendingIntents.splice(0);
    for (const it of intents) {
      if (it.verb === 'pick') pick(this.kernel, it.session.playerId, it.target, this.kernel.tick);
      else if (it.verb === 'chop') chop(this.kernel, it.session.playerId, it.target, this.kernel.tick);
    }
    // 2. advance sim-time
    if (!this.paused && elapsed > 0) {
      this.kernel.runTo(this.kernel.tick + Math.max(1, Math.round(elapsed * this.timeScale)));
    }
    this._broadcastFrame();
  }

  _broadcastFrame() {
    // events: everything appended to the ledger since last frame
    const fresh = this.kernel.ledger.events.slice(this._eventCursor)
      .map(e => ({ id: e.id, tick: e.tick, type: e.type, actor: e.actor, targets: e.targets, magnitude: e.magnitude }));
    this._eventCursor = this.kernel.ledger.events.length;
    for (const s of this.sessions) {
      if (s.ws.readyState !== 1) continue;
      const entities = this._bubbleEntities(s.viewport);
      const curIds = new Set(entities.map(e => e.id));
      const removed = [...s.knownIds].filter(id => !curIds.has(id));
      s.knownIds = curIds;
      const player = this.kernel.materialized(s.playerId);
      s.ws.send(JSON.stringify(tickDeltaMsg(this.kernel.tick, entities, removed, { R: player?.R ?? 0 })));
      if (fresh.length) s.ws.send(JSON.stringify(eventsMsg(this.kernel.tick, fresh)));
      s.ws.send(JSON.stringify(timeMsg(this.kernel.tick)));
    }
  }
}
```

Coarse-delta note (document, don't "fix"): `tick-delta.upserts` re-sends every bubble entity each frame. Spec §3.2 allows this — JSON on localhost, tiny bubbles in Pass 1; per-entity dirty tracking arrives with LOD (Plan C) if profiling demands.

- [x] **Step 4: Run tests** — `node --test sim/test/server.test.js` then `npm test` → green. Server tests must always `close()` in a `finally` or at test end so the suite exits.

- [x] **Step 5: Commit**

```bash
git add package.json package-lock.json sim/server/server.js sim/test/server.test.js
git commit -m "feat(sim): SimServer — ws sessions, 10Hz pump, intents at boundary ticks, admin ops"
```

---

### Task 7: Process entry point + graceful shutdown

Spec §3.4 lifecycle: launch → open SQLite world → resume at saved tick (or spawn baseline if the file is new) → serve. Quit (SIGINT) → checkpoint, drain, exit.

**Files:**
- Create: `sim/server/main.js`
- Modify: `package.json` (script `sim:serve`)
- Modify: `.gitignore` (add `worlds/`)
- Test: `sim/test/main.test.js`

- [x] **Step 1: Write the failing test**

```js
// sim/test/main.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootWorld } from '../server/main.js';
import { openDb } from '../store/db.js';
import { checkpoint } from '../store/checkpoint.js';
import { DAY } from '../time/metabolism.js';

test('bootWorld spawns baseline into an empty db, resumes from a saved one', () => {
  const db = openDb(':memory:');
  const k1 = bootWorld(db, { seed: 21, bounds: { x0: 0, y0: 0, w: 12, h: 12 } });
  assert.ok(k1.graph.nodes.size > 0, 'fresh world spawned');
  k1.runTo(5 * DAY);
  checkpoint(k1, db);
  const k2 = bootWorld(db, { seed: 21, bounds: { x0: 0, y0: 0, w: 12, h: 12 } });
  assert.equal(k2.tick, 5 * DAY);                       // resumed, not respawned
  assert.equal(k2.graph.nodes.size, k1.graph.nodes.size);
});
```

- [x] **Step 2: Run to verify failure** — module not found.

- [x] **Step 3: Implement**

```js
// sim/server/main.js
// Sim process entry (spec §3.4): node sim/server/main.js --world=worlds/dev.db --seed=42 --port=8787
import { openDb } from '../store/db.js';
import { checkpoint, loadKernel } from '../store/checkpoint.js';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';
import { SimServer } from './server.js';

/** Open-or-create: a db with a saved tick resumes; an empty one gets the baseline. */
export function bootWorld(db, { seed, bounds, phi = 4 }) {
  const saved = db.prepare('SELECT value FROM meta WHERE key=?').get('tick');
  if (saved != null) return loadKernel(db);
  const kernel = new Kernel({ seed, phi, bounds });
  spawnMeadow(kernel, bounds);
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
    bounds: { x0: 0, y0: 0, w: 40, h: 25 },
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
```

In `package.json` scripts add: `"sim:serve": "node sim/server/main.js"`.
In `.gitignore` add a line: `worlds/`.

- [x] **Step 4: Run tests** — `node --test sim/test/main.test.js`, then `npm test` → green. Also smoke the process by hand: `npm run sim:serve` in background, confirm the startup line prints, Ctrl-C (or kill) → "checkpointing…" → exits; second start resumes at a tick > 0. Delete `worlds/dev.db*` afterwards.

- [x] **Step 5: Commit**

```bash
git add sim/server/main.js sim/test/main.test.js package.json .gitignore
git commit -m "feat(sim): process entry — boot-or-resume world, SIGINT checkpoint drain"
```

---

### Task 8: Probe 6 (headless) — pick the berry, fell the tree, stump-delta heals

Spec §6.2.6 as an automated probe against the kernel + actions (fast, no sockets — the socket path is covered by Task 6; the human-experienceable path by Task 9).

**Files:**
- Test: `sim/test/probe-interaction.test.js`

- [x] **Step 1: Write the probe**

```js
// sim/test/probe-interaction.test.js — Probe 6 (spec §6.2): the world answers to hands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';
import { createPlayer, pick, chop } from '../world/actions.js';
import { DAY } from '../time/metabolism.js';

test('probe 6: pick gains time, chop fells, the stump-delta heals over weeks, conservation holds', () => {
  const bounds = { x0: 0, y0: 0, w: 20, h: 20 };
  const k = new Kernel({ seed: 77, bounds });
  spawnMeadow(k, bounds);
  k.runTo(30 * DAY);                       // let the meadow settle
  const player = createPlayer(k, k.tick);

  const start = k.stocks(k.tick);
  const startFlow = k.ledger.totals.captured - k.ledger.totals.burned
    - k.ledger.totals.decayed - k.ledger.totals.transferLoss;

  // pick the berry
  const bush = [...k.graph.nodes.values()].find(n => n.attrs.species === 'berry_bush');
  assert.ok(bush, 'meadow grew a bush');
  const gained = pick(k, player.id, bush.id, k.tick);
  assert.ok(gained > 0, 'picking gains time');

  // fell the tree
  const tree = [...k.graph.nodes.values()].find(n => n.attrs.species === 'tree');
  assert.ok(tree, 'meadow grew a tree');
  assert.ok(chop(k, player.id, tree.id, k.tick));
  const felled = k.deltas.list.find(d => d.kind === 'felled');
  assert.ok(felled, 'chop scarred the world');

  // weeks pass; the stump decays and the scar heals
  k.runTo(k.tick + 360 * DAY);
  assert.ok(!k.deltas.list.some(d => d.id === felled.id), 'felled delta healed');
  assert.ok(k.ledger.events.some(e => e.type === 'delta_healed'));

  // conservation across the whole interaction (probe 1 identity, spec §6.2.1)
  const end = k.stocks(k.tick);
  const endFlow = k.ledger.totals.captured - k.ledger.totals.burned
    - k.ledger.totals.decayed - k.ledger.totals.transferLoss;
  assert.ok(Math.abs((end - start) - (endFlow - startFlow)) < 1e-3,
    `conservation: Δstocks=${end - start} Δflows=${endFlow - startFlow}`);
});
```

- [x] **Step 2: Run it** — `node --test sim/test/probe-interaction.test.js` → PASS (everything was built in Tasks 1–7; if it fails, the failure is a real bug — debug it, don't loosen the probe).

- [x] **Step 3: Run the full suite** — `npm test` → all green.

- [x] **Step 4: Commit**

```bash
git add sim/test/probe-interaction.test.js
git commit -m "test(sim): probe 6 — pick/chop/heal with conservation identity"
```

---

### Task 9: Probe client — watch it happen (in-game leg of probe 6)

A minimal canvas page served from the repo: connects to the sim, draws bubble entities, click to pick/chop, HUD shows wallet + sim clock, FF button to watch the stump heal. This is a *probe view* (dev tool) — the real renderer binding is Plan E. No build step, no framework.

**Files:**
- Create: `sim/client/probe.html`
- Create: `sim/client/probe.js`

- [x] **Step 1: Write the client**

```html
<!-- sim/client/probe.html -->
<!doctype html>
<html><head><meta charset="utf-8"><title>Sim Probe</title>
<style>
  body { margin: 0; background: #111; color: #ddd; font: 13px monospace; }
  #hud { padding: 6px 10px; display: flex; gap: 18px; align-items: center; }
  canvas { display: block; image-rendering: pixelated; cursor: crosshair; }
  button { font: inherit; }
</style></head>
<body>
<div id="hud">
  <span id="clock">day –</span>
  <span id="wallet">wallet: 0 tu</span>
  <span id="status">connecting…</span>
  <button id="ff">FF 7 days</button>
  <label><input type="checkbox" id="chopmode"> chop mode (else pick)</label>
</div>
<canvas id="c" width="1280" height="800"></canvas>
<script type="module" src="./probe.js"></script>
</body></html>
```

```js
// sim/client/probe.js — probe view of the sim (NOT the game renderer; Plan E binds that).
const SCALE = 32;                       // px per tile
const VIEW = { x: 0, y: 0, w: 40, h: 25 };
const COLORS = {
  grass: '#4a8f3c', berry_bush: '#b3458f', tree: '#2e5d34',
  grazer: '#c9a04e', corpse: '#6b5b4a', player: '#fff',
};
const STAGE_R = { seedling: 3, growing: 5, mature: 7, corpse: 5 };

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);
let entities = [], deltas = [], tick = 0, playerR = 0;

const ws = new WebSocket('ws://127.0.0.1:8787');
ws.onopen = () => {
  $('status').textContent = 'attached';
  ws.send(JSON.stringify({ type: 'hello', viewport: VIEW }));
};
ws.onclose = () => { $('status').textContent = 'sim gone'; };
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.type === 'snapshot') { entities = m.entities; deltas = m.deltas; }
  else if (m.type === 'tick-delta') { entities = m.upserts; playerR = m.player.R; }
  else if (m.type === 'events') {
    for (const e of m.events) if (e.type === 'delta_healed' || e.type === 'chop' || e.type === 'death') log(e);
  }
  else if (m.type === 'time') { tick = m.tick; }
  draw();
};

function log(e) { $('status').textContent = `${e.type} @day ${(e.tick / 86400).toFixed(1)}`; }

function draw() {
  ctx.fillStyle = '#1a2412'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#3a2f24';
  for (const d of deltas) ctx.fillRect(d.x * SCALE - 6, d.y * SCALE - 6, 12, 12);  // scars
  for (const e of entities) {
    ctx.fillStyle = COLORS[e.species ?? e.type] ?? '#888';
    ctx.beginPath();
    ctx.arc(e.x * SCALE, e.y * SCALE, STAGE_R[e.stage] ?? 4, 0, Math.PI * 2);
    ctx.fill();
  }
  $('clock').textContent = `day ${(tick / 86400).toFixed(2)}`;
  $('wallet').textContent = `wallet: ${playerR.toFixed(0)} tu`;
}

cv.addEventListener('click', ev => {
  const x = ev.offsetX / SCALE, y = ev.offsetY / SCALE;
  let best = null, bd = 1;                              // within 1 tile
  for (const e of entities) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return;
  const verb = $('chopmode').checked ? 'chop' : 'pick';
  ws.send(JSON.stringify({ type: 'intent', verb, target: best.id }));
});

$('ff').addEventListener('click', () => ws.send(JSON.stringify({ type: 'admin', op: 'ff', days: 7 })));
```

- [x] **Step 2: Manual smoke (the experienceable artifact — required by project rules)**

1. `npm run sim:serve` (background).
2. Serve the repo root (the project's existing dev server, or `npx serve .`) and open `sim/client/probe.html`.
3. Verify: dots render and grow over FF; clicking a magenta bush in pick mode increments the wallet; chop mode on a dark-green tree turns it into a brown corpse dot + a scar square; pressing FF 7 days repeatedly makes the corpse vanish and the scar disappear (delta healed); status line narrates chop/death/heal events.
4. Stop the sim with Ctrl-C, restart, reattach — world resumes where it was (tick preserved).
5. Delete `worlds/dev.db*` after the smoke test.

Record the outcome of each check in the commit message body (honest pass/fail; a failed check is a Task 6/7 bug to fix first).

- [x] **Step 3: Run `npm test`** — green (no test changes, but never commit red).

- [x] **Step 4: Commit**

```bash
git add sim/client/probe.html sim/client/probe.js
git commit -m "feat(sim): probe client — attach, watch, pick, chop, heal (probe 6 in-game leg)"
```

---

### Task 10: Determinism with an intent log (probe 4 extension, §5.5)

Intents arrive at nondeterministic real times, but their *effects* are `(tick, verb, target)` tuples. Same seed + same intent schedule, twice → bit-identical canonical dumps. This is the seam that later lets LLM-mind outputs replay (§5.5 last bullet).

**Files:**
- Test: `sim/test/probe-intent-replay.test.js`

- [x] **Step 1: Write the probe**

```js
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
```

- [x] **Step 2: Run it** — `node --test sim/test/probe-intent-replay.test.js` → PASS (a failure means hidden nondeterminism — find it; never loosen to "approximately equal").

- [x] **Step 3: Full suite** — `npm test` → green.

- [x] **Step 4: Commit**

```bash
git add sim/test/probe-intent-replay.test.js
git commit -m "test(sim): probe 4 extension — intent-log replay is bit-identical"
```

---

### Task 11: Close out Plan B

**Files:**
- Modify: `docs/superpowers/plans/2026-06-11-pass1-roadmap.md` (B → DONE with deviation note, C → NEXT)
- Modify: this file (check all boxes, finalize Canonical deviations)

- [x] **Step 1:** Run `npm test` one final time → all green. Run the Task 9 manual smoke once more if any server/client file changed since.
- [x] **Step 2:** Update the roadmap: Plan B status `**DONE** (see "Canonical deviations" in plan doc)`, Plan C status `**NEXT**`.
- [x] **Step 3:** Commit:

```bash
git add docs/superpowers/plans/2026-06-11-pass1-roadmap.md docs/superpowers/plans/2026-06-11-pass1b-sim-process.md
git commit -m "docs: roadmap — Plan B DONE, Plan C NEXT"
```

---

## Canonical deviations (authoritative over original task text)

Append entries here when implementation legitimately diverges from the plan. Format: number, what changed, why, where.

1. **Checkpoint atomicity / commit marker** (Task 3, commit 89c3f7247): `graph.flush(db, tick)` became `flush(db)` — it no longer writes `meta.tick`. `checkpoint()` is one outer `db.transaction` (better-sqlite3 promotes inner transactions to savepoints — the plan's "if savepoints misbehave" fallback was unnecessary) and writes `meta.tick` LAST as the checkpoint's commit marker, so a crash mid-checkpoint can never leave a mixed-generation DB that boot would treat as valid. Found by code review.
2. **Flux re-entry sorted by id** (Task 3): `loadKernel` re-enters living nodes into flux in id-sorted order so float accumulation order in tile sums is identical to a fresh run regardless of Map iteration order.
3. **Admin ff days clamped to [1, 365]** (Task 5, commit 0ce0acc8c): untrusted client input must not fast-forward the sim arbitrarily far; flagged by code review, clamped in `parseClientMsg`.
4. **Tree `embodiedDecayDays` 21 → 7** (Task 8): a mature tree at 30 sim-days holds E≈1.8M tu; halflife decay time is `halflife × log2(E/0.5)`, so 21d gave ~458 days to gone — violating the "stump heals over weeks" intent and probe 6's 360-day window. Constant tuned (mechanism untouched); 7d gives ~150 days.
5. **Probe 6 conservation tolerance is relative** (Task 8): the plan's absolute `< 1e-3` cannot hold over 390 sim-days where flows reach ~1.9e9 tu (float accumulation alone is ~1e-2). Probe 6 now uses probe 1's canonical form: `|Δstocks − Δflows| / captured < 1e-9` (measured rel err ≈ 4e-12).
6. **tick-delta carries `deltas`** (Task 9, found by live smoke): the plan's client only received scars in the snapshot, so a live chop never showed its scar until reconnect. `tickDeltaMsg` gained a fifth param `deltas = []`; the server sends `kernel.deltas.list` each frame (consistent with the sanctioned coarse-frame philosophy). Client also keys corpse color by `type` — `serializeEntity` puts the dead thing's species in `species`, which otherwise wins the color lookup.

## Deliberately out of scope (per spec §6.4 and roadmap)

- §5.3 claims/renderer claim-mask binding → Plan E. Plan B ships the kernel-side semantics probe 6 needs: death releases tile occupancy (`flux.leave` in `die()`) and writes a delta; the F2–F7 claim-mask integration is world wiring.
- Simulation LOD tiers, aggregate nodes, bubble sampler → Plan C.
- Asset-state taxonomy → Plan D. Binding the REAL renderer/landscape to kernel entities → Plan E.
- Client prediction (protocol leaves room; localhost makes it pointless now).
- Matter/grains decomposition of harvests (S3): harvest events record species+magnitude as the seam; grains arrive in a later atlas pass.
- Biome-modulated φ (flux.js comment) — arrives with Plan C/E world wiring.
- Binary protocol framing — JSON until profiling demands otherwise.



