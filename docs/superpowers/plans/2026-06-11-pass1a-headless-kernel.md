# Pass 1 Plan A — Headless Simulation Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless simulation kernel — hypergraph store, lazy time flows, event-queue scheduler, deterministic RNG — proven by the spec's probes 1–5 as a test suite.

**Architecture:** A Node.js ES-module package (`sim/`) alongside the existing browser game. Time reserves are never ticked: each is `(R, r, lastTick)`, materialized on read. The kernel is a priority queue of due events; lifecycle (growth, senescence, death, decay, reproduction) runs as scheduled events with stale-event versioning. SQLite (better-sqlite3) is durable truth; a plain in-memory graph is the hot set. Every random draw is `hash(seed, ids…)` — never call-order dependent.

**Tech Stack:** Node ≥ 20 (built-in `node:test` runner, zero test deps), better-sqlite3, ES modules. No bundler. Spec: `docs/superpowers/specs/2026-06-11-pass1-time-metabolism-simulation-kernel-design.md`.

**Units (locked for all tasks):** 1 tick = 1 sim-second. `DAY = 86_400` ticks, `YEAR = 360 * DAY`. 1 time-unit (tu) = 1 sim-second of baseline adult-human life. All species constants are *initial tunables* — probes assert qualitative behavior (distributions, stability), not magic numbers.

**File structure (all new):**

```
package.json                 ESM package, better-sqlite3 dep, test script
sim/kernel/rng.js            deterministic hash streams (call-order independent)
sim/kernel/heap.js           binary min-heap with deterministic tie-break
sim/kernel/scheduler.js      event queue + dispatch + stale-version filtering
sim/store/db.js              SQLite open/DDL/WAL + canonical dump
sim/store/graph.js           in-memory hypergraph, provenance enforcement, flush
sim/store/ledger.js          causal events + conservation counters
sim/time/flux.js             ambient flux field + per-tile capture shares
sim/time/metabolism.js       materialize, rates, transfers, species table
sim/time/lifecycle.js        stage transitions, senescence, death, corpse, decay, seeding
sim/world/spawn.js           baseline population from seed
sim/kernel/kernel.js         composition root: wires everything, runTo()
sim/test/*.test.js           unit tests + probes 1–5
```

---

### Task 1: Package scaffolding

**Files:**
- Create: `package.json`
- Create: `sim/test/smoke.test.js`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "freedom-sim",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test sim/test/"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  }
}
```

- [ ] **Step 2: Write a smoke test**

`sim/test/smoke.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

test('node:test runs and better-sqlite3 loads', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t(x)');
  db.prepare('INSERT INTO t VALUES (?)').run(42);
  assert.equal(db.prepare('SELECT x FROM t').get().x, 42);
  db.close();
});
```

- [ ] **Step 3: Install and run**

Run: `npm install && npm test`
Expected: 1 test passes. (better-sqlite3 ships Windows prebuilds; if a build error occurs, check Node version is ≥20.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json sim/test/smoke.test.js .gitignore
git commit -m "feat(sim): scaffold sim package — node:test + better-sqlite3"
```

Note: ensure `node_modules/` is in `.gitignore` (create the file if the repo lacks one).

---

### Task 2: Deterministic RNG streams

**Files:**
- Create: `sim/kernel/rng.js`
- Test: `sim/test/rng.test.js`

Spec §5.5: randomness is `hash(seed, entity_id, event_tick)` — never call-order dependent. Same mixing style as the browser's `src/core/random.js` (large-prime imul XOR), but standalone and with explicit seed (no localStorage).

- [ ] **Step 1: Write the failing test**

`sim/test/rng.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mix, rand, randRange } from '../kernel/rng.js';

test('mix is deterministic and sensitive to every argument', () => {
  assert.equal(mix(1, 2, 3), mix(1, 2, 3));
  assert.notEqual(mix(1, 2, 3), mix(1, 2, 4));
  assert.notEqual(mix(1, 2, 3), mix(2, 1, 3));
});

test('rand returns [0,1) and is call-order independent', () => {
  const a = rand(42, 7, 1000);
  rand(42, 999, 5);           // unrelated draw in between
  const b = rand(42, 7, 1000);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 1);
});

test('rand distributes roughly uniformly', () => {
  let sum = 0;
  for (let i = 0; i < 10000; i++) sum += rand(1, i, 0);
  const mean = sum / 10000;
  assert.ok(Math.abs(mean - 0.5) < 0.02, `mean ${mean}`);
});

test('randRange maps to [lo,hi)', () => {
  const v = randRange(42, 1, 2, 10, 20);
  assert.ok(v >= 10 && v < 20);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/rng.test.js`
Expected: FAIL — cannot find module `../kernel/rng.js`

- [ ] **Step 3: Implement**

`sim/kernel/rng.js`:

```js
// Deterministic, call-order-independent randomness (spec §5.5).
// Every draw is a pure function of (seed, ...integer ids).

function scramble(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = Math.imul(n, 9);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return n >>> 0;
}

const PRIMES = [374761393, 668265263, 1442695041, 2246822519, 3266489917];

/** Mix any number of integer args into one uint32. */
export function mix(...ids) {
  let h = 0x9e3779b9;
  for (let i = 0; i < ids.length; i++) {
    h = scramble(h ^ Math.imul(ids[i] | 0, PRIMES[i % PRIMES.length]));
  }
  return h;
}

/** Uniform [0,1) from (seed, ...ids). */
export function rand(seed, ...ids) {
  return mix(seed, ...ids) / 4294967296;
}

/** Uniform [lo,hi) from (seed, ...ids, lo, hi). */
export function randRange(seed, a, b, lo, hi) {
  return lo + rand(seed, a, b) * (hi - lo);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sim/test/rng.test.js`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sim/kernel/rng.js sim/test/rng.test.js
git commit -m "feat(sim): deterministic call-order-independent RNG streams"
```

---

### Task 3: Binary min-heap with deterministic tie-break

**Files:**
- Create: `sim/kernel/heap.js`
- Test: `sim/test/heap.test.js`

Spec §5.5: event-queue ties broken by stable entity-id order. Heap items are `{tick, nodeId, kind, ver}`; ordering is `(tick, nodeId, kind)` lexicographic.

- [ ] **Step 1: Write the failing test**

`sim/test/heap.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventHeap } from '../kernel/heap.js';

test('pops in tick order', () => {
  const h = new EventHeap();
  h.push({ tick: 30, nodeId: 1, kind: 'a', ver: 0 });
  h.push({ tick: 10, nodeId: 2, kind: 'a', ver: 0 });
  h.push({ tick: 20, nodeId: 3, kind: 'a', ver: 0 });
  assert.equal(h.pop().tick, 10);
  assert.equal(h.pop().tick, 20);
  assert.equal(h.pop().tick, 30);
  assert.equal(h.pop(), undefined);
});

test('ties break by nodeId then kind, regardless of insert order', () => {
  const mk = () => {
    const h = new EventHeap();
    return h;
  };
  const items = [
    { tick: 5, nodeId: 9, kind: 'b', ver: 0 },
    { tick: 5, nodeId: 2, kind: 'z', ver: 0 },
    { tick: 5, nodeId: 9, kind: 'a', ver: 0 },
  ];
  for (const perm of [[0,1,2],[2,1,0],[1,2,0]]) {
    const h = mk();
    for (const i of perm) h.push(items[i]);
    assert.deepEqual(
      [h.pop(), h.pop(), h.pop()].map(e => [e.nodeId, e.kind]),
      [[2,'z'],[9,'a'],[9,'b']]
    );
  }
});

test('peek does not remove', () => {
  const h = new EventHeap();
  h.push({ tick: 1, nodeId: 1, kind: 'a', ver: 0 });
  assert.equal(h.peek().tick, 1);
  assert.equal(h.size, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/heap.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement**

`sim/kernel/heap.js`:

```js
// Binary min-heap of due events. Deterministic order: (tick, nodeId, kind).

function lt(a, b) {
  if (a.tick !== b.tick) return a.tick < b.tick;
  if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId;
  return a.kind < b.kind;
}

export class EventHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  peek() { return this.a[0]; }

  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!lt(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }

  pop() {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && lt(a[l], a[m])) m = l;
        if (r < a.length && lt(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sim/test/heap.test.js`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sim/kernel/heap.js sim/test/heap.test.js
git commit -m "feat(sim): event heap with deterministic (tick, nodeId, kind) ordering"
```

---

### Task 4: SQLite store — DDL, WAL, canonical dump

**Files:**
- Create: `sim/store/db.js`
- Test: `sim/test/db.test.js`

Schema per spec §2.1–§2.2, §2.7, §5.2: `nodes` (with `R, rate, last_tick`, `created_by_event`, `owner` — SQLite identifiers are case-insensitive so the in-memory `r` field maps to column `rate`), `edges`, `edge_members`, `events`, `event_targets`, `deltas`, `meta`. `canonicalDump(db)` returns a stable string for determinism comparison (probe 4) — raw file bytes differ across runs (WAL timing), so equality is defined over content.

- [ ] **Step 1: Write the failing test**

`sim/test/db.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, canonicalDump } from '../store/db.js';

test('openDb creates schema in WAL mode', () => {
  const db = openDb(':memory:');
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name);
  for (const t of ['nodes','edges','edge_members','events','event_targets','deltas','meta']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  db.close();
});

test('canonicalDump is equal for identical content, differs for different content', () => {
  const a = openDb(':memory:'), b = openDb(':memory:');
  const ins = d => d.prepare(
    'INSERT INTO nodes(id,type,born_tick,x,y,R,rate,last_tick,created_by_event,owner,attrs) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  );
  ins(a).run(1,'grass',0,5,5,100,0.2,0,null,null,'{}');
  ins(b).run(1,'grass',0,5,5,100,0.2,0,null,null,'{}');
  assert.equal(canonicalDump(a), canonicalDump(b));
  ins(b).run(2,'grass',0,6,5,100,0.2,0,null,null,'{}');
  assert.notEqual(canonicalDump(a), canonicalDump(b));
  a.close(); b.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/db.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement**

`sim/store/db.js`:

```js
import Database from 'better-sqlite3';

const DDL = `
CREATE TABLE IF NOT EXISTS nodes(
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  born_tick INTEGER NOT NULL,
  x REAL, y REAL,
  R REAL, rate REAL, last_tick INTEGER,
  created_by_event INTEGER REFERENCES events(id),
  owner INTEGER REFERENCES nodes(id),
  attrs TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE TABLE IF NOT EXISTS edges(
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  born_tick INTEGER NOT NULL,
  owner INTEGER REFERENCES nodes(id),
  attrs TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS edge_members(
  edge_id INTEGER NOT NULL REFERENCES edges(id),
  node_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(edge_id, node_id, role)
);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY,
  tick INTEGER NOT NULL,
  type TEXT NOT NULL,
  actor INTEGER,
  magnitude REAL,
  cause_event_id INTEGER REFERENCES events(id),
  attrs TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_tick ON events(tick);
CREATE TABLE IF NOT EXISTS event_targets(
  event_id INTEGER NOT NULL REFERENCES events(id),
  node_id INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deltas(
  id INTEGER PRIMARY KEY,
  tick INTEGER NOT NULL,
  x REAL, y REAL,
  target TEXT NOT NULL,
  kind TEXT NOT NULL,
  attrs TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
`;

export function openDb(path) {
  const db = new Database(path);
  if (path !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(DDL);
  return db;
}

/** Stable string of all content — determinism is defined over this, not file bytes. */
export function canonicalDump(db) {
  const parts = [];
  const tables = [
    ['nodes', 'id'], ['edges', 'id'], ['edge_members', 'edge_id, node_id, role'],
    ['events', 'id'], ['event_targets', 'event_id, node_id'],
    ['deltas', 'id'], ['meta', 'key'],
  ];
  for (const [t, order] of tables) {
    parts.push(`== ${t}`);
    for (const row of db.prepare(`SELECT * FROM ${t} ORDER BY ${order}`).all()) {
      parts.push(JSON.stringify(row));
    }
  }
  return parts.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sim/test/db.test.js`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sim/store/db.js sim/test/db.test.js
git commit -m "feat(sim): SQLite store — full Pass 1 schema, WAL, canonical dump"
```

---

### Task 5: In-memory graph with provenance enforcement

**Files:**
- Create: `sim/store/graph.js`
- Test: `sim/test/graph.test.js`

Spec §5.4: creating a non-baseline node without a causal event must be impossible. Baseline creation is only allowed inside a world-boot scope. The graph holds plain JS objects (hot set); `flush(db)` persists everything in one transaction.

- [ ] **Step 1: Write the failing test**

`sim/test/graph.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Graph } from '../store/graph.js';
import { openDb } from '../store/db.js';

test('provenance rule: caused nodes require an event, baseline only in boot scope', () => {
  const g = new Graph();
  assert.throws(() => g.createNode({ type: 'chest', tick: 5 }), /provenance/);
  const n1 = g.createNode({ type: 'chest', tick: 5, causeEventId: 77 });
  assert.equal(n1.createdByEvent, 77);
  let n2;
  g.boot(() => { n2 = g.createNode({ type: 'tree', tick: 0, x: 3, y: 4 }); });
  assert.equal(n2.createdByEvent, null);
  assert.throws(() => g.createNode({ type: 'tree', tick: 0 }), /provenance/);
});

test('nodes get sequential ids and live in spatial index', () => {
  const g = new Graph();
  g.boot(() => {
    const a = g.createNode({ type: 'grass', tick: 0, x: 10, y: 10 });
    const b = g.createNode({ type: 'grass', tick: 0, x: 10.4, y: 10.4 });
    g.createNode({ type: 'grass', tick: 0, x: 500, y: 500 });
    assert.equal(b.id, a.id + 1);
  });
  const near = g.nodesNear(10, 10, 2);
  assert.equal(near.length, 2);
});

test('edges connect members with roles', () => {
  const g = new Graph();
  let a, b, e;
  g.boot(() => {
    a = g.createNode({ type: 'bush', tick: 0, x: 0, y: 0 });
    b = g.createNode({ type: 'bush', tick: 0, x: 1, y: 0 });
    e = g.createEdge({ type: 'kin', tick: 0, members: [[a.id, 'parent'], [b.id, 'child']] });
  });
  assert.deepEqual(g.edgesOf(a.id).map(x => x.id), [e.id]);
  assert.deepEqual(g.edgesOf(b.id).map(x => x.id), [e.id]);
});

test('flush persists nodes/edges to SQLite and removeNode drops them', () => {
  const g = new Graph();
  let a;
  g.boot(() => {
    a = g.createNode({ type: 'grass', tick: 0, x: 1, y: 1, R: 50, r: 0.1, attrs: { body: 5 } });
    g.createNode({ type: 'grass', tick: 0, x: 2, y: 1 });
  });
  g.removeNode(a.id);
  const db = openDb(':memory:');
  g.flush(db, 123);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM nodes').get().c, 1);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='tick'").get().value, '123');
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/graph.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement**

`sim/store/graph.js`:

```js
// In-memory hypergraph (hot set). SQLite is durable truth via flush().
// Node: { id, type, bornTick, x, y, R, r, lastTick, ver, createdByEvent, owner, attrs }
// attrs is a plain object (JSON in SQLite). Living state like body/stage/species lives there.

const CELL = 8; // spatial grid cell size in tiles

export class Graph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.byNode = new Map();   // nodeId -> Set<edgeId>
    this.grid = new Map();     // "cx,cy" -> Set<nodeId>
    this.nextNodeId = 1;
    this.nextEdgeId = 1;
    this._boot = false;
  }

  boot(fn) { this._boot = true; try { fn(); } finally { this._boot = false; } }

  _cellKey(x, y) { return `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`; }

  createNode({ type, tick, x = null, y = null, R = null, r = 0, owner = null, attrs = {}, causeEventId = null }) {
    if (causeEventId == null && !this._boot) {
      throw new Error(`provenance: node of type '${type}' has no causal event and is not baseline (spec §5.4)`);
    }
    const node = {
      id: this.nextNodeId++, type, bornTick: tick, x, y,
      R, r, lastTick: tick, ver: 0,
      createdByEvent: causeEventId, owner, attrs,
    };
    this.nodes.set(node.id, node);
    if (x != null) {
      const k = this._cellKey(x, y);
      if (!this.grid.has(k)) this.grid.set(k, new Set());
      this.grid.get(k).add(node.id);
    }
    return node;
  }

  removeNode(id) {
    const n = this.nodes.get(id);
    if (!n) return;
    if (n.x != null) this.grid.get(this._cellKey(n.x, n.y))?.delete(id);
    for (const eid of this.byNode.get(id) ?? []) this.edges.delete(eid);
    this.byNode.delete(id);
    this.nodes.delete(id);
  }

  createEdge({ type, tick, members, weight = 1, owner = null, attrs = {} }) {
    const edge = { id: this.nextEdgeId++, type, weight, bornTick: tick, owner, attrs, members };
    this.edges.set(edge.id, edge);
    for (const [nid] of members) {
      if (!this.byNode.has(nid)) this.byNode.set(nid, new Set());
      this.byNode.get(nid).add(edge.id);
    }
    return edge;
  }

  edgesOf(nodeId) {
    return [...(this.byNode.get(nodeId) ?? [])].map(id => this.edges.get(id));
  }

  nodesNear(x, y, radius) {
    const out = [];
    const c0x = Math.floor((x - radius) / CELL), c1x = Math.floor((x + radius) / CELL);
    const c0y = Math.floor((y - radius) / CELL), c1y = Math.floor((y + radius) / CELL);
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      for (const id of this.grid.get(`${cx},${cy}`) ?? []) {
        const n = this.nodes.get(id);
        const dx = n.x - x, dy = n.y - y;
        if (dx * dx + dy * dy <= radius * radius) out.push(n);
      }
    }
    out.sort((a, b) => a.id - b.id); // deterministic order
    return out;
  }

  flush(db, tick) {
    const tx = db.transaction(() => {
      db.exec('DELETE FROM nodes; DELETE FROM edges; DELETE FROM edge_members;');
      const ni = db.prepare('INSERT INTO nodes(id,type,born_tick,x,y,R,rate,last_tick,created_by_event,owner,attrs) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const n of this.nodes.values()) {
        ni.run(n.id, n.type, n.bornTick, n.x, n.y, n.R, n.r, n.lastTick, n.createdByEvent, n.owner, JSON.stringify(n.attrs));
      }
      const ei = db.prepare('INSERT INTO edges(id,type,weight,born_tick,owner,attrs) VALUES (?,?,?,?,?,?)');
      const mi = db.prepare('INSERT INTO edge_members(edge_id,node_id,role) VALUES (?,?,?)');
      for (const e of this.edges.values()) {
        ei.run(e.id, e.type, e.weight, e.bornTick, e.owner, JSON.stringify(e.attrs));
        for (const [nid, role] of e.members) mi.run(e.id, nid, role ?? '');
      }
      db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('tick', String(tick));
      db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('nextNodeId', String(this.nextNodeId));
      db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('nextEdgeId', String(this.nextEdgeId));
    });
    tx();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sim/test/graph.test.js`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sim/store/graph.js sim/test/graph.test.js
git commit -m "feat(sim): in-memory hypergraph — provenance enforcement, spatial index, flush"
```

---

### Task 6: Causal ledger + conservation counters

**Files:**
- Create: `sim/store/ledger.js`
- Test: `sim/test/ledger.test.js`

Spec §2.7 (events with cause chains) + probe 1's accounting needs. The ledger owns the **conservation counters** — every tu that moves anywhere is recorded in exactly one counter, so the audit identity is checkable:

```
(ΣR + Σbody)_end − (ΣR + Σbody)_start = captured − burned − decayed − transferLoss
```

- [ ] **Step 1: Write the failing test**

`sim/test/ledger.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../store/ledger.js';
import { openDb } from '../store/db.js';

test('emits events with sequential ids and cause chains', () => {
  const l = new Ledger();
  const e1 = l.emit({ tick: 10, type: 'death', actor: 5, targets: [5], magnitude: 1 });
  const e2 = l.emit({ tick: 11, type: 'decay_gone', actor: null, targets: [6], causeEventId: e1 });
  assert.equal(e2, e1 + 1);
  assert.equal(l.events[1].causeEventId, e1);
});

test('conservation counters accumulate', () => {
  const l = new Ledger();
  l.count('captured', 10);
  l.count('burned', 4);
  l.count('captured', 2.5);
  assert.equal(l.totals.captured, 12.5);
  assert.equal(l.totals.burned, 4);
  assert.equal(l.totals.decayed, 0);
  assert.throws(() => l.count('nonsense', 1));
});

test('flush writes events and counters to SQLite', () => {
  const l = new Ledger();
  l.emit({ tick: 1, type: 'birth', actor: 2, targets: [3, 4] });
  l.count('transferLoss', 7);
  const db = openDb(':memory:');
  l.flush(db);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM events').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM event_targets').get().c, 2);
  assert.equal(
    JSON.parse(db.prepare("SELECT value FROM meta WHERE key='totals'").get().value).transferLoss, 7);
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/ledger.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement**

`sim/store/ledger.js`:

```js
// Append-only causal ledger (spec §2.7) + conservation counters (probe 1).

const COUNTERS = ['captured', 'burned', 'decayed', 'transferLoss'];

export class Ledger {
  constructor() {
    this.events = [];
    this.nextEventId = 1;
    this.totals = Object.fromEntries(COUNTERS.map(k => [k, 0]));
  }

  emit({ tick, type, actor = null, targets = [], magnitude = null, causeEventId = null, attrs = {} }) {
    const id = this.nextEventId++;
    this.events.push({ id, tick, type, actor, targets, magnitude, causeEventId, attrs });
    return id;
  }

  count(counter, amount) {
    if (!(counter in this.totals)) throw new Error(`unknown counter ${counter}`);
    this.totals[counter] += amount;
  }

  flush(db) {
    const tx = db.transaction(() => {
      db.exec('DELETE FROM events; DELETE FROM event_targets;');
      const ei = db.prepare('INSERT INTO events(id,tick,type,actor,magnitude,cause_event_id,attrs) VALUES (?,?,?,?,?,?,?)');
      const ti = db.prepare('INSERT INTO event_targets(event_id,node_id) VALUES (?,?)');
      for (const e of this.events) {
        ei.run(e.id, e.tick, e.type, e.actor, e.magnitude, e.causeEventId, JSON.stringify(e.attrs));
        for (const t of e.targets) ti.run(e.id, t);
      }
      db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)')
        .run('totals', JSON.stringify(this.totals));
      db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)')
        .run('nextEventId', String(this.nextEventId));
    });
    tx();
  }
}
```

(Note: Plan A flushes the whole ledger at checkpoint for simplicity; incremental append lands in Plan B with the process lifecycle. At Plan A test scales this is fine.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sim/test/ledger.test.js`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sim/store/ledger.js sim/test/ledger.test.js
git commit -m "feat(sim): causal ledger with cause chains + conservation counters"
```

---

### Task 7: Ambient flux field + per-tile capture shares

**Files:**
- Create: `sim/time/flux.js`
- Test: `sim/test/flux.test.js`

Spec §1.1: every tile yields φ tu/sec; total capture on a tile cannot exceed φ; occupants share. Plan A model: each living occupant *demands* its `baseCapture × modifiers`; if Σdemand ≤ φ everyone gets their demand; otherwise everyone gets `demand × φ/Σdemand` (proportional rationing). Tile occupancy is tracked reactively — when membership changes, all occupants' rates are stale and must be re-rated (kernel does that in Task 9).

- [ ] **Step 1: Write the failing test**

`sim/test/flux.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FluxField } from '../time/flux.js';

test('lone occupant captures its full demand', () => {
  const f = new FluxField({ phi: 4 });
  f.enter(1, 10, 10, 0.5);
  assert.equal(f.captureOf(1), 0.5);
});

test('over-demand rations proportionally, total never exceeds phi', () => {
  const f = new FluxField({ phi: 4 });
  f.enter(1, 5, 5, 3);
  f.enter(2, 5, 5, 3);
  f.enter(3, 5, 5, 2);   // Σdemand = 8 > φ = 4
  const total = f.captureOf(1) + f.captureOf(2) + f.captureOf(3);
  assert.ok(Math.abs(total - 4) < 1e-9);
  assert.ok(Math.abs(f.captureOf(1) - 3 * 4 / 8) < 1e-9);
});

test('leave frees share; occupantsOf reports tile members', () => {
  const f = new FluxField({ phi: 4 });
  f.enter(1, 5, 5, 3);
  f.enter(2, 5, 5, 3);
  f.leave(2);
  assert.equal(f.captureOf(1), 3);
  assert.deepEqual(f.occupantsOf(5, 5), [1]);
});

test('updateDemand re-rations the tile', () => {
  const f = new FluxField({ phi: 4 });
  f.enter(1, 0, 0, 2);
  f.enter(2, 0, 0, 2);
  f.updateDemand(1, 6);   // Σ = 8 → rationed
  assert.ok(Math.abs(f.captureOf(1) - 6 * 4 / 8) < 1e-9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/flux.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement**

`sim/time/flux.js`:

```js
// Ambient time-flux per tile (spec §1.1). Occupants demand capture;
// over-subscribed tiles ration proportionally. Pure bookkeeping —
// the kernel reacts to membership/demand changes by re-rating occupants.

export class FluxField {
  constructor({ phi = 4 } = {}) {
    this.phi = phi;             // tu/sec per tile (biome modulation arrives in Plan B/C)
    this.tiles = new Map();     // "tx,ty" -> Map<nodeId, demand>
    this.where = new Map();     // nodeId -> "tx,ty"
  }

  _key(x, y) { return `${Math.floor(x)},${Math.floor(y)}`; }

  enter(nodeId, x, y, demand) {
    const k = this._key(x, y);
    if (!this.tiles.has(k)) this.tiles.set(k, new Map());
    this.tiles.get(k).set(nodeId, demand);
    this.where.set(nodeId, k);
  }

  leave(nodeId) {
    const k = this.where.get(nodeId);
    if (k == null) return;
    this.tiles.get(k).delete(nodeId);
    this.where.delete(nodeId);
  }

  updateDemand(nodeId, demand) {
    const k = this.where.get(nodeId);
    if (k != null) this.tiles.get(k).set(nodeId, demand);
  }

  captureOf(nodeId) {
    const k = this.where.get(nodeId);
    if (k == null) return 0;
    const tile = this.tiles.get(k);
    let sum = 0;
    for (const d of tile.values()) sum += d;
    const demand = tile.get(nodeId);
    return sum <= this.phi ? demand : demand * this.phi / sum;
  }

  occupantsOf(x, y) {
    return [...(this.tiles.get(this._key(x, y))?.keys() ?? [])].sort((a, b) => a - b);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sim/test/flux.test.js`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sim/time/flux.js sim/test/flux.test.js
git commit -m "feat(sim): ambient flux field with proportional per-tile rationing"
```

---

### Task 8: Metabolism — species table, lazy materialization, transfers

**Files:**
- Create: `sim/time/metabolism.js`
- Test: `sim/test/metabolism.test.js`

The heart of the spec (§1.2). Living nodes carry TWO lazy linear stocks sharing `lastTick`: `R` (liquid reserve, rate `r`) and `attrs.body` (embodied structure, rate `attrs.bodyRate`). Corpses carry exponential `attrs.E` with closed-form decay; each materialization counts the decayed amount incrementally so conservation accounting is always exact. Transfers are typed channels (§1.5); losses go to the `transferLoss` counter.

- [ ] **Step 1: Write the failing test**

`sim/test/metabolism.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES, CHANNEL_EFF, materialize, transfer, DAY } from '../time/metabolism.js';
import { Ledger } from '../store/ledger.js';

function livingNode(over = {}) {
  return { id: 1, type: 'grass', R: 100, r: 0.2, lastTick: 0, ver: 0,
    attrs: { species: 'grass', body: 50, bodyRate: 0.1 }, ...over };
}

test('species table has the Plan A species with required fields', () => {
  for (const s of ['grass', 'berry_bush', 'grazer']) {
    const sp = SPECIES[s];
    for (const f of ['demand','burn','growFrac','maxBody','stages','senescence','seed','embodiedDecayDays'])
      assert.ok(f in sp, `${s}.${f} missing`);
  }
});

test('materialize advances R and body linearly and is idempotent at same tick', () => {
  const l = new Ledger();
  const n = livingNode();
  materialize(n, 1000, l);
  assert.equal(n.R, 100 + 0.2 * 1000);
  assert.equal(n.attrs.body, 50 + 0.1 * 1000);
  assert.equal(n.lastTick, 1000);
  const r1 = n.R;
  materialize(n, 1000, l);
  assert.equal(n.R, r1);
});

test('corpse materialization decays E exponentially and counts decayed', () => {
  const l = new Ledger();
  const c = { id: 2, type: 'corpse', R: null, r: 0, lastTick: 0, ver: 0,
    attrs: { E: 80, decayHalflifeTicks: 10 * DAY } };
  materialize(c, 10 * DAY, l);
  assert.ok(Math.abs(c.attrs.E - 40) < 1e-9);
  assert.ok(Math.abs(l.totals.decayed - 40) < 1e-9);
});

test('transfer moves tu at channel efficiency, loss counted', () => {
  const l = new Ledger();
  const got = transfer(20, 'harvest', l);   // 50% channel
  assert.equal(got, 20 * CHANNEL_EFF.harvest);
  assert.ok(Math.abs(l.totals.transferLoss - 10) < 1e-9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/metabolism.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement**

`sim/time/metabolism.js`:

```js
// The Time Metabolism (spec §1). Lazy stocks: R (linear), body (linear),
// corpse E (exponential, decay counted incrementally on materialization).

export const DAY = 86_400;            // ticks (1 tick = 1 sim-second)
export const YEAR = 360 * DAY;

export const CHANNEL_EFF = {          // spec §1.5
  nurture: 0.95, gift: 0.90, trade: 0.85, harvest: 0.50, violence: 0.30,
};

// Initial tunables. Stages: [name, startAgeTicks, demandFactor, burnFactor].
// senescence: { start, stepEvery, burnGrowth, demandDecay } — applied per step event.
// seed: { every, cost, minR, jitter } — reproduction (Task 10).
export const SPECIES = {
  grass: {
    demand: 0.30, burn: 0.05, growFrac: 0.6, maxBody: 200,
    stages: [
      ['seedling', 0,        0.5, 0.6],
      ['growing',  5 * DAY,  0.8, 0.8],
      ['mature',   15 * DAY, 1.0, 1.0],
    ],
    senescence: { start: 60 * DAY, stepEvery: 5 * DAY, burnGrowth: 1.10, demandDecay: 0.93 },
    seed: { every: 12 * DAY, cost: 400, minR: 1200, jitter: 0.3 },
    embodiedDecayDays: 5,
  },
  berry_bush: {
    demand: 0.60, burn: 0.10, growFrac: 0.6, maxBody: 8000,
    stages: [
      ['seedling', 0,         0.4, 0.5],
      ['growing',  30 * DAY,  0.8, 0.8],
      ['mature',   120 * DAY, 1.0, 1.0],
    ],
    senescence: { start: 4 * YEAR, stepEvery: 30 * DAY, burnGrowth: 1.08, demandDecay: 0.95 },
    seed: { every: 90 * DAY, cost: 3000, minR: 10000, jitter: 0.3 },
    embodiedDecayDays: 30,
  },
  grazer: {
    demand: 0.10, burn: 0.50, growFrac: 0.4, maxBody: 20000,   // ambient barely feeds it: must graze (Task 11)
    stages: [
      ['seedling', 0,         0.5, 0.5],       // "juvenile"
      ['growing',  60 * DAY,  0.8, 0.8],
      ['mature',   180 * DAY, 1.0, 1.0],
    ],
    senescence: { start: 6 * YEAR, stepEvery: 60 * DAY, burnGrowth: 1.12, demandDecay: 0.95 },
    seed: { every: YEAR, cost: 20000, minR: 60000, jitter: 0.2 },
    embodiedDecayDays: 20,
    graze: { every: 6 * 3600, bite: 600, radius: 3 },   // every 6 sim-hours
  },
};

/** Advance a node's lazy stocks to `tick`. Safe to call repeatedly. */
export function materialize(node, tick, ledger) {
  const dt = tick - node.lastTick;
  if (dt <= 0) return node;
  if (node.type === 'corpse') {
    const h = node.attrs.decayHalflifeTicks;
    const before = node.attrs.E;
    node.attrs.E = before * Math.pow(2, -dt / h);
    ledger.count('decayed', before - node.attrs.E);
  } else if (node.R != null) {
    node.R += node.r * dt;
    node.attrs.body += (node.attrs.bodyRate ?? 0) * dt;
  }
  node.lastTick = tick;
  return node;
}

/** Move `amount` tu through a typed channel; returns delivered amount. */
export function transfer(amount, channel, ledger) {
  const eff = CHANNEL_EFF[channel];
  if (eff == null) throw new Error(`unknown channel ${channel}`);
  const delivered = amount * eff;
  ledger.count('transferLoss', amount - delivered);
  return delivered;
}

/** Current life stage for a species at a given age (ticks). */
export function stageAt(species, age) {
  const st = SPECIES[species].stages;
  let cur = st[0];
  for (const s of st) if (age >= s[1]) cur = s;
  return cur; // [name, startAge, demandFactor, burnFactor]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sim/test/metabolism.test.js`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sim/time/metabolism.js sim/test/metabolism.test.js
git commit -m "feat(sim): time metabolism — species table, lazy materialization, typed transfers"
```

---

### Task 9: Kernel — scheduler loop, re-rating, death prediction

**Files:**
- Create: `sim/kernel/kernel.js`
- Create: `sim/kernel/scheduler.js`
- Test: `sim/test/kernel.test.js`

The composition root (spec §4.1). Key mechanics:
- **Stale-event versioning — two event classes.** *Predictions* (`death_check`, `body_full`) are derived from current rates: they carry the node's `ver` at schedule time; any re-rate bumps `node.ver`, so stale predictions are dropped silently when popped. *Lifecycle events* (`stage`, `sen_step`, `seed`, `graze`, `decay_gone`) are unconditional appointments: they carry `ver: -1` ("always fresh") and survive re-rates.
- **Tile re-rating:** an entity's *actual* capture depends on tile rationing, so any demand/membership change on a tile re-rates **all** its occupants (materialize → recompute rates → reschedule predictions). Tiles hold ~a dozen occupants, so this is cheap.
- **Death prediction:** after re-rating, if `r < 0`, schedule a `death_check` at the zero-crossing tick. Burned tu are counted at materialization sites via the rate split (capture and burn are both folded into `r`; the `captured`/`burned` counters accrue at re-rate boundaries using exact `rate × dt` over the segment just closed).

Counter mechanics (exactness): when re-rating at tick T, the segment since `lastTick` was governed by the OLD capture `c` and burn `b`. So `reRate` first materializes (advancing stocks), then counts `captured += c·dt`, `burned += b·dt` for that closed segment. The node stores its current `c` and `b` in `attrs.cap`/`attrs.burn` for this purpose.

- [ ] **Step 1: Write the failing test**

`sim/test/kernel.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';

function makeKernel() {
  const k = new Kernel({ seed: 42, phi: 4 });
  return k;
}

test('spawnBaseline + runTo: lone grass accrues time from ambient', () => {
  const k = makeKernel();
  let g;
  k.graph.boot(() => { g = k.addLiving({ species: 'grass', x: 5, y: 5, R: 500, body: 10, tick: 0 }); });
  k.runTo(1000);
  const n = k.materialized(g.id);
  assert.ok(n.R > 500, 'reserve should grow: demand 0.15 (seedling) > burn 0.03');
});

test('stale events are dropped after re-rate', () => {
  const k = makeKernel();
  let g;
  k.graph.boot(() => { g = k.addLiving({ species: 'grass', x: 5, y: 5, R: 500, body: 10, tick: 0 }); });
  const verBefore = k.graph.nodes.get(g.id).ver;
  k.reRateTileOf(g.id, 0);
  assert.ok(k.graph.nodes.get(g.id).ver > verBefore);
  // queue still drains without throwing
  k.runTo(1000);
});

test('overcrowded tile starves: rationing drives r negative and death fires', () => {
  const k = makeKernel();
  k.graph.boot(() => {
    // 200 mature grass on ONE tile: share = φ/N = 0.02 < burn 0.05 → starvation
    for (let i = 0; i < 200; i++) {
      k.addLiving({ species: 'grass', x: 5.5, y: 5.5, R: 200, body: 20, tick: 0, age: 20 * 86400 });
    }
  });
  k.runTo(60 * 86400);
  const alive = [...k.graph.nodes.values()].filter(n => n.type === 'grass');
  assert.ok(alive.length < 200, `some grass must starve (alive: ${alive.length})`);
  const corpses = [...k.graph.nodes.values()].filter(n => n.type === 'corpse');
  assert.ok(corpses.length > 0, 'starved grass leaves corpses');
  assert.ok(k.ledger.events.some(e => e.type === 'death'));
});

test('conservation identity holds through starvation', () => {
  const k = makeKernel();
  k.graph.boot(() => {
    for (let i = 0; i < 200; i++) {
      k.addLiving({ species: 'grass', x: 5.5, y: 5.5, R: 200, body: 20, tick: 0, age: 20 * 86400 });
    }
  });
  const start = k.stocks(0);
  k.runTo(60 * 86400);
  const end = k.stocks(60 * 86400);
  const t = k.ledger.totals;
  const lhs = end - start;
  const rhs = t.captured - t.burned - t.decayed - t.transferLoss;
  assert.ok(Math.abs(lhs - rhs) < 1e-3, `lhs ${lhs} rhs ${rhs}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/kernel.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement scheduler**

`sim/kernel/scheduler.js`:

```js
import { EventHeap } from './heap.js';

// Priority queue of due events with stale-version filtering (spec §4.1, §5.5).
export class Scheduler {
  constructor() { this.heap = new EventHeap(); }

  schedule(tick, nodeId, kind, ver) {
    this.heap.push({ tick: Math.ceil(tick), nodeId, kind, ver });
  }

  /** Pop next event due at or before `tick` that is still fresh, else undefined. */
  nextDue(tick, isFresh) {
    while (this.heap.size > 0 && this.heap.peek().tick <= tick) {
      const ev = this.heap.pop();
      if (isFresh(ev)) return ev;
    }
    return undefined;
  }
}
```

- [ ] **Step 4: Implement kernel**

`sim/kernel/kernel.js`:

```js
import { Graph } from '../store/graph.js';
import { Ledger } from '../store/ledger.js';
import { FluxField } from '../time/flux.js';
import { Scheduler } from './scheduler.js';
import { SPECIES, materialize, stageAt } from '../time/metabolism.js';
import { registerLifecycle } from '../time/lifecycle.js';

export class Kernel {
  constructor({ seed, phi = 4 }) {
    this.seed = seed;
    this.tick = 0;
    this.graph = new Graph();
    this.ledger = new Ledger();
    this.flux = new FluxField({ phi });
    this.scheduler = new Scheduler();
    this.handlers = new Map();   // kind -> (kernel, node, ev) => void
    registerLifecycle(this);
  }

  on(kind, fn) { this.handlers.set(kind, fn); }

  /** Create a living node (inside boot scope or with causeEventId) and wire it in. */
  addLiving({ species, x, y, R, body, tick, age = 0, causeEventId = null }) {
    const node = this.graph.createNode({
      type: species, tick, x, y, R, causeEventId,
      attrs: { species, body, bodyRate: 0, cap: 0, burn: 0, birthTick: tick - age },
    });
    this.flux.enter(node.id, x, y, 0);
    this.reRateTileOf(node.id, tick);
    this._scheduleLifecycle(node, tick);   // provided by lifecycle registration
    return node;
  }

  materialized(id) {
    const n = this.graph.nodes.get(id);
    return n ? materialize(n, this.tick, this.ledger) : undefined;
  }

  /** Close the open rate segment for a node: materialize + accrue counters. */
  closeSegment(node, tick) {
    const dt = tick - node.lastTick;
    if (dt > 0 && node.R != null) {
      this.ledger.count('captured', (node.attrs.cap ?? 0) * dt);
      this.ledger.count('burned', (node.attrs.burn ?? 0) * dt);
    }
    materialize(node, tick, this.ledger);
  }

  /** Recompute rates for every occupant of the tile containing node `id`. */
  reRateTileOf(id, tick) {
    const n = this.graph.nodes.get(id);
    if (!n) return;
    // 1. update this node's demand, 2. re-rate all tile occupants (rationing shifts)
    for (const occId of this.flux.occupantsOf(n.x, n.y)) {
      const occ = this.graph.nodes.get(occId);
      if (occ?.R != null) this._reRateOne(occ, tick);
    }
  }

  _reRateOne(node, tick) {
    this.closeSegment(node, tick);
    const sp = SPECIES[node.attrs.species];
    const age = tick - node.attrs.birthTick;
    const [, , dF, bF] = stageAt(node.attrs.species, age);
    const sen = node.attrs.sen ?? { burnMul: 1, demandMul: 1 };
    const demand = sp.demand * dF * sen.demandMul;
    this.flux.updateDemand(node.id, demand);
    const cap = this.flux.captureOf(node.id);
    const burn = sp.burn * bF * sen.burnMul;
    const net = cap - burn;
    const grow = net > 0 && node.attrs.sen == null && node.attrs.body < sp.maxBody
      ? sp.growFrac * net : 0;
    node.attrs.cap = cap;
    node.attrs.burn = burn;
    node.attrs.bodyRate = grow;
    node.r = net - grow;
    node.ver++;
    if (node.r < 0 && node.R > 0) {
      this.scheduler.schedule(tick + node.R / -node.r, node.id, 'death_check', node.ver);
    }
    if (grow > 0) {  // body-full crossing: growth stops, surplus reroutes to R
      this.scheduler.schedule(tick + (sp.maxBody - node.attrs.body) / grow, node.id, 'body_full', node.ver);
    }
  }

  /** World stocks at `tick`: ΣR + Σbody (living) + ΣE (corpses), materialized. */
  stocks(tick) {
    let s = 0;
    for (const n of this.graph.nodes.values()) {
      materialize(n, tick, this.ledger);
      if (n.type === 'corpse') s += n.attrs.E;
      else if (n.R != null) s += n.R + n.attrs.body;
    }
    return s;
  }

  runTo(targetTick) {
    for (;;) {
      const ev = this.scheduler.nextDue(targetTick, e => {
        const n = this.graph.nodes.get(e.nodeId);
        return n != null && (e.ver === -1 || e.ver === n.ver);
      });
      if (!ev) break;
      this.tick = ev.tick;
      const node = this.graph.nodes.get(ev.nodeId);
      const h = this.handlers.get(ev.kind);
      if (h) h(this, node, ev);
    }
    this.tick = targetTick;
  }
}
```

Note: `_scheduleLifecycle` and the `death_check` handler are registered by `registerLifecycle` (Task 10). For THIS task's tests to run, Task 10's `sim/time/lifecycle.js` must exist — Tasks 9 and 10 are one TDD cycle split across two files; implement both before running this task's tests, or temporarily stub `registerLifecycle` as `(k) => { k._scheduleLifecycle = () => {}; }` plus a minimal `death_check` handler. **Prefer implementing Task 10 immediately after, then running both test files together.**

- [ ] **Step 5: Continue to Task 10 before running tests** (single commit covers both — see Task 10 Step 5)

---

### Task 10: Lifecycle — stages, senescence, death, corpse decay, seeding

**Files:**
- Create: `sim/time/lifecycle.js`
- Test: `sim/test/lifecycle.test.js`

All lifecycle behavior as scheduled events: `stage` (re-rate at stage boundaries), `sen_step` (worsen senescence multipliers), `death_check` (verify R≤0, die → corpse), `decay_gone` (corpse below threshold → remove node, write delta), `seed` (reproduce, spending R through the nurture channel).

- [ ] **Step 1: Write the failing test**

`sim/test/lifecycle.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { DAY, YEAR } from '../time/metabolism.js';

test('grass dies of old age and leaves a decaying corpse with cause chain', () => {
  const k = new Kernel({ seed: 7, phi: 4 });
  let g;
  k.graph.boot(() => { g = k.addLiving({ species: 'grass', x: 2, y: 2, R: 800, body: 10, tick: 0 }); });
  k.runTo(2 * YEAR);
  assert.equal(k.graph.nodes.get(g.id), undefined, 'original grass node gone');
  const death = k.ledger.events.find(e => e.type === 'death' && e.actor === g.id);
  assert.ok(death, 'death event recorded');
  const corpseBirth = k.ledger.events.find(e => e.type === 'corpse' && e.causeEventId === death.id);
  assert.ok(corpseBirth, 'corpse caused by death');
});

test('seeding creates provenance-correct offspring and population grows', () => {
  const k = new Kernel({ seed: 7, phi: 4 });
  k.graph.boot(() => {
    k.addLiving({ species: 'grass', x: 2, y: 2, R: 2000, body: 30, tick: 0, age: 16 * DAY });
  });
  k.runTo(100 * DAY);
  const grass = [...k.graph.nodes.values()].filter(n => n.type === 'grass');
  assert.ok(grass.length > 1, `population should grow (got ${grass.length})`);
  const child = grass.find(n => n.createdByEvent != null);
  assert.ok(child, 'offspring carries created_by_event');
  const ev = k.ledger.events.find(e => e.id === child.createdByEvent);
  assert.equal(ev.type, 'seed');
});

test('corpse decays to gone and writes a delta', () => {
  const k = new Kernel({ seed: 7, phi: 4 });
  k.graph.boot(() => {
    k.addLiving({ species: 'grass', x: 2, y: 2, R: 1, body: 5, tick: 0, age: 20 * DAY });
  });
  // R=1 with senescence-free mature rates is fine; force starvation by crowding instead:
  k.graph.boot(() => {
    for (let i = 0; i < 30; i++) k.addLiving({ species: 'grass', x: 2.5, y: 2.5, R: 50, body: 5, tick: 0, age: 20 * DAY });
  });
  k.runTo(YEAR);
  const corpses = [...k.graph.nodes.values()].filter(n => n.type === 'corpse');
  const gone = k.ledger.events.filter(e => e.type === 'decay_gone');
  assert.ok(gone.length > 0, 'some corpses fully decayed');
  assert.ok(k.deltas?.length > 0 || gone.length > 0, 'decay recorded');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test sim/test/lifecycle.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement**

`sim/time/lifecycle.js`:

```js
import { SPECIES, materialize, transfer, stageAt, DAY } from './metabolism.js';
import { rand, randRange } from '../kernel/rng.js';

const GONE_THRESHOLD = 0.5;   // tu — corpse below this is gone

export function registerLifecycle(kernel) {
  kernel.deltas = [];

  kernel._scheduleLifecycle = (node, tick) => {
    const sp = SPECIES[node.attrs.species];
    const birth = node.attrs.birthTick;
    // Lifecycle events are unconditional appointments: ver -1 = never stale.
    for (const [, startAge] of sp.stages) {
      if (birth + startAge > tick) kernel.scheduler.schedule(birth + startAge, node.id, 'stage', -1);
    }
    if (birth + sp.senescence.start > tick) {
      kernel.scheduler.schedule(birth + sp.senescence.start, node.id, 'sen_step', -1);
    }
    const jit = 1 + (rand(kernel.seed, node.id, 101) - 0.5) * 2 * sp.seed.jitter;
    kernel.scheduler.schedule(tick + sp.seed.every * jit, node.id, 'seed', -1);
  };

  kernel.on('stage', (k, node, ev) => {
    k.reRateTileOf(node.id, ev.tick);
  });

  kernel.on('body_full', (k, node, ev) => {
    k.reRateTileOf(node.id, ev.tick);   // growth stops; surplus reroutes to R
  });

  kernel.on('sen_step', (k, node, ev) => {
    const sp = SPECIES[node.attrs.species];
    const sen = node.attrs.sen ?? { burnMul: 1, demandMul: 1, step: 0 };
    sen.step++;
    sen.burnMul *= sp.senescence.burnGrowth * randRange(k.seed, node.id, 200 + sen.step, 0.97, 1.03);
    sen.demandMul *= sp.senescence.demandDecay;
    node.attrs.sen = sen;
    k.reRateTileOf(node.id, ev.tick);
    kernel.scheduler.schedule(ev.tick + sp.senescence.stepEvery, node.id, 'sen_step', -1);
  });

  kernel.on('death_check', (k, node, ev) => {
    k.closeSegment(node, ev.tick);
    if (node.R > 1e-9) {   // rates changed since prediction; re-predict
      if (node.r < 0) k.scheduler.schedule(ev.tick + node.R / -node.r, node.id, 'death_check', node.ver);
      return;
    }
    die(k, node, ev.tick, null);
  });

  kernel.on('seed', (k, node, ev) => {
    const sp = SPECIES[node.attrs.species];
    k.closeSegment(node, ev.tick);
    const age = ev.tick - node.attrs.birthTick;
    const mature = stageAt(node.attrs.species, age)[0] === 'mature';
    if (mature && node.R >= sp.seed.minR && node.attrs.sen == null) {
      node.R -= sp.seed.cost;
      const delivered = transfer(sp.seed.cost, 'nurture', k.ledger);
      const evId = k.ledger.emit({ tick: ev.tick, type: 'seed', actor: node.id, magnitude: sp.seed.cost });
      const dx = Math.floor(randRange(k.seed, node.id, ev.tick, -2, 3));
      const dy = Math.floor(randRange(k.seed, node.id, ev.tick + 1, -2, 3));
      const child = k.addLiving({
        species: node.attrs.species, x: node.x + dx, y: node.y + dy,
        R: delivered * 0.7, body: delivered * 0.3, tick: ev.tick, causeEventId: evId,
      });
      k.ledger.events[evId - 1].targets.push(child.id);   // events array is id-ordered
      k.reRateTileOf(node.id, ev.tick);
    }
    const jit = 1 + (rand(k.seed, node.id, 102 + ev.tick % 7) - 0.5) * 2 * sp.seed.jitter;
    k.scheduler.schedule(ev.tick + sp.seed.every * jit, node.id, 'seed', -1);
  });

  kernel.on('decay_gone', (k, node, ev) => {
    materialize(node, ev.tick, k.ledger);
    k.ledger.count('decayed', node.attrs.E);   // remainder returns to ambient
    node.attrs.E = 0;
    k.ledger.emit({ tick: ev.tick, type: 'decay_gone', targets: [node.id], causeEventId: node.createdByEvent });
    k.deltas.push({ tick: ev.tick, x: node.x, y: node.y, target: `corpse:${node.id}`, kind: 'gone' });
    k.graph.removeNode(node.id);
  });
}

export function die(kernel, node, tick, causeEventId) {
  kernel.closeSegment(node, tick);
  const sp = SPECIES[node.attrs.species];
  const E = Math.max(node.R, 0) + node.attrs.body;
  const deathEv = kernel.ledger.emit({
    tick, type: 'death', actor: node.id, targets: [node.id], magnitude: E, causeEventId,
  });
  kernel.flux.leave(node.id);
  const { x, y } = node;
  kernel.graph.removeNode(node.id);
  // re-rate survivors on that tile (their rationing improved)
  for (const occId of kernel.flux.occupantsOf(x, y)) {
    const occ = kernel.graph.nodes.get(occId);
    if (occ?.R != null) kernel._reRateOne(occ, tick);
  }
  if (E > GONE_THRESHOLD) {
    const halflife = sp.embodiedDecayDays * DAY;
    const corpseEv = kernel.ledger.emit({ tick, type: 'corpse', causeEventId: deathEv });
    const corpse = kernel.graph.createNode({
      type: 'corpse', tick, x, y, causeEventId: corpseEv,
      attrs: { E, decayHalflifeTicks: halflife, of: node.type },
    });
    const goneTick = tick + halflife * Math.log2(E / GONE_THRESHOLD);
    kernel.scheduler.schedule(goneTick, corpse.id, 'decay_gone', -1);
  } else {
    kernel.ledger.count('decayed', E);
  }
}
```

- [ ] **Step 4: Run Tasks 9+10 tests together**

Run: `node --test sim/test/kernel.test.js sim/test/lifecycle.test.js`
Expected: all 7 tests PASS. Debug notes: if the conservation test fails, the leak is almost always a code path that changes `R`/`body` without `closeSegment` first, or a death/decay path that forgets a counter.

- [ ] **Step 5: Commit**

```bash
git add sim/kernel/kernel.js sim/kernel/scheduler.js sim/time/lifecycle.js sim/test/kernel.test.js sim/test/lifecycle.test.js
git commit -m "feat(sim): event-driven kernel — lazy flows, rationed re-rating, lifecycle, death prediction"
```

---

### Task 11: Grazing — eating as time transfer (physiology, not agency)

**Files:**
- Modify: `sim/time/lifecycle.js` (add `graze` handler inside `registerLifecycle`, schedule it in `_scheduleLifecycle`)
- Test: `sim/test/grazing.test.js`

Honest-absence note (spec §6.1): grazers have no minds. Grazing is a *metabolic rule* — a scheduled physiological event, not a decision. Target selection is deterministic (nearest by distance, ties by lowest id), the same way roots "choose" soil.

- [ ] **Step 1: Write the failing test**

`sim/test/grazing.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { DAY } from '../time/metabolism.js';

test('grazer eats nearby grass: transfer at harvest efficiency, prey can die with cause chain', () => {
  const k = new Kernel({ seed: 11, phi: 4 });
  let grazer;
  k.graph.boot(() => {
    grazer = k.addLiving({ species: 'grazer', x: 5, y: 5, R: 40000, body: 5000, tick: 0, age: 200 * DAY });
    for (let i = 0; i < 6; i++) {
      k.addLiving({ species: 'grass', x: 5 + (i % 3), y: 5 + Math.floor(i / 3), R: 300, body: 400, tick: 0, age: 20 * DAY });
    }
  });
  k.runTo(30 * DAY);
  const grazes = k.ledger.events.filter(e => e.type === 'graze' && e.actor === grazer.id);
  assert.ok(grazes.length > 0, 'graze events recorded');
  assert.ok(k.ledger.totals.transferLoss > 0, 'harvest channel loses 50%');
  const preyDeaths = k.ledger.events.filter(e => e.type === 'death' && e.causeEventId != null);
  // some grass may be eaten to death; if so the death must chain to a graze event
  for (const d of preyDeaths) {
    const cause = k.ledger.events.find(e => e.id === d.causeEventId);
    assert.equal(cause.type, 'graze');
  }
});

test('grazer starves without flora (ambient demand 0.1 < burn 0.5)', () => {
  const k = new Kernel({ seed: 11, phi: 4 });
  let grazer;
  k.graph.boot(() => {
    grazer = k.addLiving({ species: 'grazer', x: 50, y: 50, R: 5000, body: 100, tick: 0, age: 200 * DAY });
  });
  k.runTo(60 * DAY);
  assert.equal(k.graph.nodes.get(grazer.id), undefined, 'grazer dead');
  assert.ok(k.ledger.events.some(e => e.type === 'death' && e.actor === grazer.id));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test sim/test/grazing.test.js`
Expected: FAIL — no `graze` events (handler does not exist)

- [ ] **Step 3: Implement** — add to `registerLifecycle` in `sim/time/lifecycle.js`:

In `_scheduleLifecycle`, after the seed scheduling, add:

```js
    if (sp.graze) {
      kernel.scheduler.schedule(tick + sp.graze.every, node.id, 'graze', -1);
    }
```

Add the handler (import `die` is already local; add `transfer` to imports if not present):

```js
  kernel.on('graze', (k, node, ev) => {
    const sp = SPECIES[node.attrs.species];
    k.closeSegment(node, ev.tick);
    // deterministic target: nearest living flora within radius, ties by lowest id
    const prey = k.graph.nodesNear(node.x, node.y, sp.graze.radius)
      .filter(n => n.R != null && SPECIES[n.attrs.species] && !SPECIES[n.attrs.species].graze && n.id !== node.id)
      .sort((a, b) => {
        const da = (a.x - node.x) ** 2 + (a.y - node.y) ** 2;
        const db = (b.x - node.x) ** 2 + (b.y - node.y) ** 2;
        return da - db || a.id - b.id;
      })[0];
    if (prey) {
      k.closeSegment(prey, ev.tick);
      const bite = Math.min(sp.graze.bite, prey.attrs.body + Math.max(prey.R, 0));
      const fromBody = Math.min(bite, prey.attrs.body);
      prey.attrs.body -= fromBody;
      prey.R -= (bite - fromBody);
      const gained = transfer(bite, 'harvest', k.ledger);
      node.R += gained;
      const evId = k.ledger.emit({
        tick: ev.tick, type: 'graze', actor: node.id, targets: [prey.id], magnitude: bite,
      });
      if (prey.attrs.body + Math.max(prey.R, 0) <= 1e-9) {
        die(k, prey, ev.tick, evId);
      } else {
        k.reRateTileOf(prey.id, ev.tick);
      }
      k.reRateTileOf(node.id, ev.tick);
    }
    k.scheduler.schedule(ev.tick + sp.graze.every, node.id, 'graze', -1);
  });
```

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/grazing.test.js sim/test/kernel.test.js sim/test/lifecycle.test.js`
Expected: all PASS (conservation test must still hold — grazing moves tu through counted channels only)

- [ ] **Step 5: Commit**

```bash
git add sim/time/lifecycle.js sim/test/grazing.test.js
git commit -m "feat(sim): grazing — eating as harvest-channel time transfer with causal chains"
```

---

### Task 12: Baseline spawn from seed

**Files:**
- Create: `sim/world/spawn.js`
- Test: `sim/test/spawn.test.js`

A deterministic meadow: given `(seed, region bounds)`, scatter grass/bushes/grazers with hash-based positions and ages (spec §5.1 baseline; the lesson from the F0 soil bug — per-position large-prime hashes, no regional constants). Real terrain/biome coupling arrives in Plan B; Plan A's spawn is the probe substrate.

- [ ] **Step 1: Write the failing test**

`sim/test/spawn.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';

test('spawn is deterministic for a given seed and differs across seeds', () => {
  const desc = k => [...k.graph.nodes.values()]
    .map(n => `${n.type}@${n.x},${n.y}:R${n.R?.toFixed(2)}`).join('|');
  const k1 = new Kernel({ seed: 42 }); spawnMeadow(k1, { x0: 0, y0: 0, w: 16, h: 16 });
  const k2 = new Kernel({ seed: 42 }); spawnMeadow(k2, { x0: 0, y0: 0, w: 16, h: 16 });
  const k3 = new Kernel({ seed: 43 }); spawnMeadow(k3, { x0: 0, y0: 0, w: 16, h: 16 });
  assert.equal(desc(k1), desc(k2));
  assert.notEqual(desc(k1), desc(k3));
});

test('spawn produces a mixed population with baseline provenance', () => {
  const k = new Kernel({ seed: 42 });
  spawnMeadow(k, { x0: 0, y0: 0, w: 16, h: 16 });
  const types = new Set([...k.graph.nodes.values()].map(n => n.type));
  assert.ok(types.has('grass') && types.has('berry_bush'), 'flora present');
  for (const n of k.graph.nodes.values()) assert.equal(n.createdByEvent, null, 'all baseline');
  assert.ok(k.graph.nodes.size > 50, 'meaningful population');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test sim/test/spawn.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement**

`sim/world/spawn.js`:

```js
import { rand, randRange } from '../kernel/rng.js';
import { SPECIES, DAY } from '../time/metabolism.js';

// Deterministic baseline meadow (spec §5.1). Densities are per-tile probabilities.
const DENSITY = { grass: 0.5, berry_bush: 0.05, grazer: 0.004 };
const START = {
  grass:      { R: [200, 1500],   body: [10, 60],    maxAgeDays: 50 },
  berry_bush: { R: [3000, 15000], body: [500, 3000], maxAgeDays: 600 },
  grazer:     { R: [20000, 60000], body: [2000, 8000], maxAgeDays: 1500 },
};

export function spawnMeadow(kernel, { x0, y0, w, h }) {
  kernel.graph.boot(() => {
    for (let ty = y0; ty < y0 + h; ty++) {
      for (let tx = x0; tx < x0 + w; tx++) {
        let salt = 0;
        for (const species of Object.keys(DENSITY)) {
          salt += 1000;
          if (rand(kernel.seed, tx * 31 + salt, ty * 17 + salt) < DENSITY[species]) {
            const s = START[species];
            kernel.addLiving({
              species,
              x: tx + rand(kernel.seed, tx + salt + 1, ty),
              y: ty + rand(kernel.seed, tx, ty + salt + 2),
              R: randRange(kernel.seed, tx + salt + 3, ty, s.R[0], s.R[1]),
              body: randRange(kernel.seed, tx + salt + 4, ty, s.body[0], s.body[1]),
              tick: 0,
              age: Math.floor(randRange(kernel.seed, tx + salt + 5, ty, 0, s.maxAgeDays * DAY)),
            });
          }
        }
      }
    }
  });
}
```

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/spawn.test.js`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sim/world/spawn.js sim/test/spawn.test.js
git commit -m "feat(sim): deterministic baseline meadow spawn from seed"
```

---

### Task 13: Probe 1+2 — conservation audit & mortality curve (spec §6.2.1–2)

**Files:**
- Test: `sim/test/probe-conservation.test.js`
- Test: `sim/test/probe-mortality.test.js`

Pure tests over the full system — no new implementation unless they expose bugs (fix at the source, never in the probe).

- [ ] **Step 1: Write the conservation probe**

`sim/test/probe-conservation.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';
import { DAY } from '../time/metabolism.js';

test('PROBE 1: full meadow, 90 sim-days — economy neither mints nor leaks', () => {
  const k = new Kernel({ seed: 42, phi: 4 });
  spawnMeadow(k, { x0: 0, y0: 0, w: 16, h: 16 });
  const start = k.stocks(0);
  k.runTo(90 * DAY);
  const end = k.stocks(90 * DAY);
  const t = k.ledger.totals;
  const lhs = end - start;
  const rhs = t.captured - t.burned - t.decayed - t.transferLoss;
  const scale = Math.max(Math.abs(t.captured), 1);
  assert.ok(Math.abs(lhs - rhs) / scale < 1e-9,
    `conservation violated: Δstocks=${lhs} flows=${rhs} (rel err ${(Math.abs(lhs - rhs) / scale)})`);
});
```

- [ ] **Step 2: Write the mortality probe**

`sim/test/probe-mortality.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { DAY, YEAR } from '../time/metabolism.js';

test('PROBE 2: 1000 uncrowded grass — senescence yields a plausible lifespan distribution', () => {
  const k = new Kernel({ seed: 1, phi: 4 });
  k.graph.boot(() => {
    // one per tile: no rationing, death only by senescence
    for (let i = 0; i < 1000; i++) {
      k.addLiving({ species: 'grass', x: (i % 40) * 3, y: Math.floor(i / 40) * 3, R: 800, body: 20, tick: 0 });
    }
  });
  k.runTo(2 * YEAR);
  // offspring exist (seeding) — count deaths of the ORIGINAL 1000 only (ids 1..1000)
  const deaths = k.ledger.events.filter(e => e.type === 'death' && e.actor <= 1000);
  assert.equal(deaths.length, 1000, 'every original grass eventually dies');
  const lifespans = deaths.map(e => e.tick / DAY);
  lifespans.sort((a, b) => a - b);
  const median = lifespans[500];
  assert.ok(median > 60 && median < 400, `median lifespan ${median} days plausible`);
  const spread = lifespans[900] - lifespans[100];
  assert.ok(spread > 10, `distribution has spread (${spread} days), not a synchronized cliff`);
  // corpses decay: well after the last death, mass returns to ambient
  const corpses = [...k.graph.nodes.values()].filter(n => n.type === 'corpse');
  for (const c of corpses) assert.ok(c.attrs.E < 1000, 'corpses are decaying');
});
```

- [ ] **Step 3: Run both probes**

Run: `node --test sim/test/probe-conservation.test.js sim/test/probe-mortality.test.js`
Expected: PASS. If mortality's median falls outside [60, 400] days, tune `SPECIES.grass.senescence` (raise `burnGrowth` to die sooner, lower to live longer) — tuning constants is legitimate; weakening the assertion is not.

- [ ] **Step 4: Commit**

```bash
git add sim/test/probe-conservation.test.js sim/test/probe-mortality.test.js
git commit -m "test(sim): probes 1-2 — conservation audit + mortality curve"
```

---

### Task 14: Probe 3 — carrying capacity (spec §6.2.3)

**Files:**
- Test: `sim/test/probe-capacity.test.js`

- [ ] **Step 1: Write the probe**

`sim/test/probe-capacity.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { DAY, YEAR } from '../time/metabolism.js';

test('PROBE 3: overpopulated meadow self-limits via flux competition alone', () => {
  const k = new Kernel({ seed: 5, phi: 4 });
  // 4x4 tiles, 400 grass = 25/tile — beyond φ-supported density (φ/burn-demand ≈ 13/tile)
  k.graph.boot(() => {
    for (let i = 0; i < 400; i++) {
      k.addLiving({
        species: 'grass', x: (i % 20) * 0.2, y: Math.floor(i / 20) * 0.2, R: 400, body: 20,
        tick: 0, age: 16 * DAY,
      });
    }
  });
  const count = () => [...k.graph.nodes.values()].filter(n => n.type === 'grass').length;
  k.runTo(1 * YEAR);
  const p1 = count();
  k.runTo(2 * YEAR);
  const p2 = count();
  assert.ok(p1 < 400, `die-back happened (${p1})`);
  assert.ok(p2 > 20, `population survives (${p2}) — not extinction`);
  // stability: second year does not collapse or explode relative to first
  assert.ok(p2 > p1 * 0.3 && p2 < p1 * 3, `stable band: year1=${p1} year2=${p2}`);
});
```

- [ ] **Step 2: Run it**

Run: `node --test sim/test/probe-capacity.test.js`
Expected: PASS. This probe exercises seeding + starvation + corpse decay together. If population explodes, raise `SPECIES.grass.seed.cost` or `minR`; if it goes extinct, lower them. Tune constants, never the mechanism.

- [ ] **Step 3: Commit**

```bash
git add sim/test/probe-capacity.test.js
git commit -m "test(sim): probe 3 — carrying capacity emerges from flux competition"
```

---

### Task 15: Probe 4 — determinism replay (spec §6.2.4)

**Files:**
- Test: `sim/test/probe-determinism.test.js`

- [ ] **Step 1: Write the probe**

`sim/test/probe-determinism.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';
import { openDb, canonicalDump } from '../store/db.js';
import { DAY } from '../time/metabolism.js';

function runWorld(seed) {
  const k = new Kernel({ seed, phi: 4 });
  spawnMeadow(k, { x0: 0, y0: 0, w: 12, h: 12 });
  k.runTo(60 * DAY);
  const db = openDb(':memory:');
  k.graph.flush(db, k.tick);
  k.ledger.flush(db);
  const dump = canonicalDump(db);
  db.close();
  return dump;
}

test('PROBE 4: same seed twice — canonically identical worlds', () => {
  assert.equal(runWorld(42), runWorld(42));
});

test('PROBE 4b: different seeds — different worlds', () => {
  assert.notEqual(runWorld(42), runWorld(43));
});
```

- [ ] **Step 2: Run it**

Run: `node --test sim/test/probe-determinism.test.js`
Expected: PASS. If it fails, hunt for: iteration over `Map`/`Set` feeding non-deterministic order into rates or RNG, `Math.random`, wall-clock reads, or float operations ordered by insertion. The canonical dump pinpoints the first differing row.

- [ ] **Step 3: Commit**

```bash
git add sim/test/probe-determinism.test.js
git commit -m "test(sim): probe 4 — determinism replay, canonically identical worlds"
```

---

### Task 16: Probe 5 — lazy/eager equivalence (spec §6.2.5)

**Files:**
- Modify: `sim/kernel/kernel.js` (add `runEagerTo`)
- Test: `sim/test/probe-lazy-eager.test.js`

- [ ] **Step 1: Write the probe**

`sim/test/probe-lazy-eager.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';
import { DAY } from '../time/metabolism.js';

function snapshot(k) {
  const map = new Map();
  for (const n of [...k.graph.nodes.values()].sort((a, b) => a.id - b.id)) {
    k.materialized(n.id);
    const v = n.type === 'corpse' ? n.attrs.E : n.R + n.attrs.body;
    map.set(n.id, { type: n.type, v });
  }
  return map;
}

test('PROBE 5: lazy and eager execution produce the same world', () => {
  const lazy = new Kernel({ seed: 9, phi: 4 });
  spawnMeadow(lazy, { x0: 0, y0: 0, w: 8, h: 8 });
  lazy.runTo(3 * DAY);

  const eager = new Kernel({ seed: 9, phi: 4 });
  spawnMeadow(eager, { x0: 0, y0: 0, w: 8, h: 8 });
  eager.runEagerTo(3 * DAY, 3600);   // force re-rate boundaries every sim-hour

  const a = snapshot(lazy);
  const b = snapshot(eager);
  assert.equal(a.size, b.size, 'same node count');
  for (const [id, sa] of a) {
    const sb = b.get(id);
    assert.ok(sb, `node ${id} exists in eager world`);
    assert.equal(sa.type, sb.type, `node ${id} same type`);
    // Float addition is non-associative: eager mode sums many small segments where
    // lazy sums one big one. Demand relative tolerance, not exact equality.
    const scale = Math.max(Math.abs(sa.v), Math.abs(sb.v), 1);
    assert.ok(Math.abs(sa.v - sb.v) / scale < 1e-6,
      `node ${id} value drift: lazy=${sa.v} eager=${sb.v}`);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test sim/test/probe-lazy-eager.test.js`
Expected: FAIL — `runEagerTo` is not a function

- [ ] **Step 3: Implement** — add to `Kernel` in `sim/kernel/kernel.js`:

```js
  /** Brute-force mode for probe 5: process events normally, but ALSO force a
      re-rate of every living node every `step` ticks. closeSegment inside
      _reRateOne folds the elapsed segment into (R, lastTick) and the ledger
      counters at every step, so eager mode exercises MANY short segments where
      lazy mode uses few long ones. Final state must agree within float tolerance. */
  runEagerTo(targetTick, step = 3600) {
    for (let t = this.tick + step; t <= targetTick; t += step) {
      this.runTo(t);
      for (const n of [...this.graph.nodes.values()].sort((a, b) => a.id - b.id)) {
        if (n.attrs?.alive) this._reRateOne(n, t);
        else if (n.type === 'corpse') this.materialized(n.id);
      }
    }
    this.runTo(targetTick);
  }
```

Two subtleties:
1. **Iterate in stable id order** — `_reRateOne` schedules prediction events, and the heap tie-breaks on nodeId, so order here must be deterministic too.
2. **This genuinely stresses the lazy math**: each `_reRateOne` closes the current segment (accruing counters) and recomputes rates. Both worlds see identical *causal* events; only segmentation differs. If the snapshots diverge beyond tolerance, the bug is real lazy-math drift — typically a handler that reads `node.R` without `closeSegment`/`materialize` first, or a rate that depends on when it's computed rather than on state.

- [ ] **Step 4: Run it**

Run: `node --test sim/test/probe-lazy-eager.test.js`
Expected: PASS (per-node relative tolerance 1e-6 — float addition is non-associative, so exact equality across different segmentations is not achievable)

- [ ] **Step 5: Run the ENTIRE suite**

Run: `npm test`
Expected: every test in `sim/test/` passes.

- [ ] **Step 6: Commit**

```bash
git add sim/kernel/kernel.js sim/test/probe-lazy-eager.test.js
git commit -m "test(sim): probe 5 — lazy/eager equivalence within float tolerance"
```

---

### Task 17: Close out Plan A — roadmap status + memory

**Files:**
- Modify: `docs/superpowers/plans/2026-06-11-pass1-roadmap.md` (Plan A row: `IN PROGRESS` → `DONE`; Plan B row: `NOT STARTED` → `NEXT`)

- [ ] **Step 1: Update the roadmap statuses** (exact edits above)

- [ ] **Step 2: Run the full suite one last time**

Run: `npm test`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-11-pass1-roadmap.md
git commit -m "docs: Plan A (headless kernel) complete — roadmap updated, Plan B next"
```

---

## Self-review notes (already applied)

- **Spec coverage:** §1 metabolism → Tasks 8/10/11; §2.1–2.4+2.7 store/ledger → Tasks 4/5/6; §4.1 lazy+events → Tasks 3/9; §5.1 world equation → Task 12 + probe 4; §5.4 provenance → Task 5 (enforcement) + Task 10/11 (cause chains); §5.5 discipline → Tasks 2/3 + probe 4; §6.2 probes 1–5 → Tasks 13–16. Not in Plan A by design (see roadmap): §2.5–2.6 (land with first consumer), §3 (Plan B), §4.2–4.3 (Plan C), §6.3 (Plan D).
- **Type consistency:** node fields are `bornTick/lastTick/ver/createdByEvent` in memory, snake_case in SQLite (mapped only in `flush`); `attrs` carries `species/body/bodyRate/cap/burn/birthTick/sen` for living, `E/decayHalflifeTicks/of` for corpses. `closeSegment` is the only counter-accrual point for flows; `transfer`/`die`/`decay_gone` are the only others.
- **Known simplifications (deliberate, Plan A only):** uniform φ (biome modulation in Plan B/C); full-table flush instead of incremental persistence (Plan B); `deltas` kept in-memory array + table written at flush (Plan B wires the delta lifecycle); no slow sweep (reactive tile re-rating covers Plan A's interaction set).

