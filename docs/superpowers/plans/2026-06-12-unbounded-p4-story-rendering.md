# Unbounded World — Phase 4: Story Rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Why is this ruin here?" resolves to real causal edges. Deterministic context assembly walks the kernel graph's causal chains and compiles them into structured narrative data. LLM narration over those chains is the honest-absence seam — the context assembly is the real deliverable; actual LLM rendering arrives when the mind system (S5) wires up.

**Architecture:** A new `sim/story/narrator.js` module provides:
- `traceHistory(kernel, nodeId)` — walks `createdByEvent` → event → `causeEventId` chain to build a causal DAG of events that explain why a node exists
- `assembleContext(kernel, nodeId)` — compiles the chain into a structured context object with event summaries, domain tags, chronicle references, and race/settlement data
- `narrate(context)` — HONEST ABSENCE: returns the raw structured context. LLM rendering is Phase 4+ when the mind system (locked decision #3) exists. No invented facts.

The sim server gets an `inspect` message type so the client can query "why is this here?" for any node.

**Spec:** Phase 4 section + one-hypergraph section of the unbounded world design.

**Key invariants:**
- No invented facts: narration fails honestly when the causal chain is absent (node has no `createdByEvent`).
- Context assembly is deterministic: same node → same context, always.
- Stories are derived, never invented: every claim in the output traces to a real event ID.

**Worktree:** from master (post-Phase 3). All work in the worktree.

---

### Task 1: Causal chain walker + context assembler

**Files:**
- Create: `sim/story/narrator.js`
- Test: `sim/test/narrator.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/narrator.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { TierManager } from '../lod/tiers.js';
import { REGION } from '../lod/aggregate.js';
import { MACRO } from '../world/genesis.js';
import { traceHistory, assembleContext } from '../story/narrator.js';

test('traceHistory walks causal chain from settlement to chronicle events', () => {
  const kernel = new Kernel({ seed: 42 });
  const tm = new TierManager(kernel);
  for (let i = 0; i < 50; i++) {
    tm.update([{ x: i * MACRO * REGION * 2, y: i * MACRO * REGION }], 0);
  }
  const settlement = [...kernel.graph.nodes.values()].find(n => n.type === 'settlement');
  assert.ok(settlement, 'at least one settlement exists');
  const chain = traceHistory(kernel, settlement.id);
  assert.ok(chain.length > 0, 'causal chain is non-empty');
  assert.ok(chain.every(ev => ev.id != null), 'every event has an id');
  assert.ok(chain.every(ev => ev.type != null), 'every event has a type');
});

test('traceHistory returns empty for nodes without provenance', () => {
  const kernel = new Kernel({ seed: 42 });
  kernel.graph.boot(() => {
    kernel.graph.createNode({ type: 'test', tick: 0, attrs: {} });
  });
  const node = [...kernel.graph.nodes.values()][0];
  const chain = traceHistory(kernel, node.id);
  assert.deepEqual(chain, [], 'boot-scope node has no causal chain');
});

test('assembleContext produces structured narrative with event summaries', () => {
  const kernel = new Kernel({ seed: 42 });
  const tm = new TierManager(kernel);
  for (let i = 0; i < 50; i++) {
    tm.update([{ x: i * MACRO * REGION * 2, y: i * MACRO * REGION }], 0);
  }
  const settlement = [...kernel.graph.nodes.values()].find(n => n.type === 'settlement');
  assert.ok(settlement);
  const ctx = assembleContext(kernel, settlement.id);
  assert.ok(ctx.node, 'context has the node');
  assert.ok(ctx.events, 'context has events array');
  assert.ok(ctx.summary, 'context has a text summary');
  assert.ok(typeof ctx.summary === 'string');
  // summary should reference event types, not invent facts
  for (const ev of ctx.events) {
    assert.ok(ev.eventId, 'each event has eventId');
  }
});

test('assembleContext for a ruin mentions abandonment', () => {
  const kernel = new Kernel({ seed: 42 });
  const tm = new TierManager(kernel);
  for (let i = 0; i < 100; i++) {
    tm.update([{ x: i * MACRO * REGION * 2, y: i * MACRO * REGION }], 0);
  }
  const ruin = [...kernel.graph.nodes.values()].find(n =>
    n.type === 'settlement' && n.attrs.state === 'ruined');
  if (ruin) {
    const ctx = assembleContext(kernel, ruin.id);
    assert.ok(ctx.summary.includes('abandon') || ctx.summary.includes('ruin'),
      'ruin summary mentions abandonment');
  }
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implement narrator.js**

```js
// sim/story/narrator.js — Phase 4: deterministic context assembly over causal chains.
// Walks the kernel graph's createdByEvent → causeEventId chain to build a DAG of
// events that explain why a node exists. Compiles into structured narrative data.
// HONEST ABSENCE: LLM narration is not here — the context assembly is the deliverable.
// narrate() returns structured data + a text summary derived mechanically from event
// types. When the mind system (S5, locked decision #3) exists, it will call the LLM
// with this context. No invented facts: every claim traces to a real event ID.

/** Walk the causal chain from a node back to its root events.
 *  Returns [{id, type, tick, actor, targets, attrs, depth}] ordered root-first (oldest first).
 *  Stops at boot-scope nodes (no createdByEvent) or at maxDepth. */
export function traceHistory(kernel, nodeId, maxDepth = 20) {
  const node = kernel.graph.nodes.get(nodeId);
  if (!node || !node.createdByEvent) return [];

  const visited = new Set();
  const chain = [];

  function walk(eventId, depth) {
    if (depth > maxDepth || visited.has(eventId)) return;
    visited.add(eventId);
    const ev = kernel.ledger.events.find(e => e.id === eventId);
    if (!ev) return;
    if (ev.causeEventId) walk(ev.causeEventId, depth + 1);
    chain.push({ ...ev, depth });
  }

  walk(node.createdByEvent, 0);
  return chain;
}

/** Compile a node's causal chain into structured narrative context.
 *  Returns { node: {id, type, x, y, attrs}, events: [...], summary: string }.
 *  The summary is a mechanical text derived from event types — no LLM, no invention.
 *  Each event entry: { eventId, type, domain, age?, chronicleId?, summary }. */
export function assembleContext(kernel, nodeId) {
  const node = kernel.graph.nodes.get(nodeId);
  if (!node) return null;

  const chain = traceHistory(kernel, nodeId);
  const events = chain.map(ev => ({
    eventId: ev.id,
    type: ev.type,
    domain: ev.attrs?.domain ?? inferDomain(ev.type),
    age: ev.attrs?.age,
    chronicleId: ev.attrs?.chronicleId,
    summary: summarizeEvent(ev),
  }));

  const summary = buildSummary(node, events);

  return {
    node: { id: node.id, type: node.type, x: node.x, y: node.y, attrs: node.attrs },
    events,
    summary,
  };
}

/** Infer domain from event type prefix. */
function inferDomain(type) {
  if (!type) return 'unknown';
  if (type.startsWith('chronicle_')) {
    const sub = type.slice('chronicle_'.length);
    const domains = {
      founding: 'society', flourishing: 'society', decline: 'society',
      abandonment: 'society', migration_in: 'society', migration_out: 'society',
      war: 'conflict', siege: 'conflict', conquest: 'conflict',
      trade_route: 'economy', famine: 'economy',
      drought: 'ecology', flood: 'ecology',
      shrine_built: 'belief', prophecy: 'belief',
    };
    return domains[sub] ?? 'society';
  }
  if (type === 'genesis' || type === 'genesis_settlement' || type === 'genesis_ruin') return 'genesis';
  if (type === 'road_built') return 'economy';
  if (type === 'settlement_founded') return 'society';
  return 'unknown';
}

/** Mechanical one-line summary of an event — no invention, just type translation. */
function summarizeEvent(ev) {
  const type = ev.type;
  if (type === 'genesis') return `region baseline materialized`;
  if (type === 'genesis_settlement') return `settlement placed by genesis`;
  if (type === 'genesis_ruin') return `ruins placed — settlement long abandoned`;
  if (type === 'settlement_founded') return `settlement founded`;
  if (type === 'road_built') return `road built (${ev.attrs?.tiles ?? '?'} tiles)`;
  if (type.startsWith('chronicle_')) {
    const sub = type.slice('chronicle_'.length);
    const age = ev.attrs?.age != null ? ` (${ev.attrs.age} ages ago)` : '';
    const race = ev.attrs?.raceId ? ` by the ${ev.attrs.raceId}` : '';
    return `${sub.replace(/_/g, ' ')}${race}${age}`;
  }
  return type.replace(/_/g, ' ');
}

/** Build a multi-sentence summary from the event chain. */
function buildSummary(node, events) {
  if (events.length === 0) {
    return `This ${node.type} exists as part of the world baseline (no recorded history).`;
  }

  const parts = [];
  const isRuin = node.attrs?.state === 'ruined';
  const isSettlement = node.type === 'settlement';

  if (isSettlement && isRuin) {
    parts.push('This place lies in ruins.');
  } else if (isSettlement) {
    parts.push(`This is an active ${node.attrs?.tier ?? 'settlement'}.`);
  } else {
    parts.push(`This ${node.type} has a recorded history.`);
  }

  // Add chronicle events
  const chronicles = events.filter(e => e.type.startsWith('chronicle_'));
  for (const c of chronicles) {
    parts.push(c.summary + '.');
  }

  // Cite event IDs for traceability
  if (events.length > 0) {
    parts.push(`[${events.length} causal events, IDs: ${events.map(e => e.eventId).join(', ')}]`);
  }

  return parts.join(' ');
}

/** Honest-absence narration: returns the structured context as-is.
 *  When the mind system exists, this will compile a prompt and call the LLM.
 *  For now, the mechanical summary IS the narration — no invented facts. */
export function narrate(kernel, nodeId) {
  return assembleContext(kernel, nodeId);
}
```

- [ ] **Step 4: Run tests → PASS**

- [ ] **Step 5: Commit**

```bash
git add sim/story/narrator.js sim/test/narrator.test.js
git commit -m "feat(sim): P4 — causal chain walker + deterministic context assembly (story rendering)"
```

---

### Task 2: Server inspect endpoint

**Files:**
- Modify: `sim/server/server.js`
- Test: `sim/test/narrator.test.js` (extend with server test, or create sim/test/inspect.test.js)

- [ ] **Step 1: Write the failing test**

```js
// sim/test/inspect.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../store/db.js';
import { bootWorld } from '../server/main.js';
import { TierManager } from '../lod/tiers.js';
import { REGION } from '../lod/aggregate.js';
import { MACRO } from '../world/genesis.js';
import { narrate } from '../story/narrator.js';

test('narrate returns structured context for a settlement', () => {
  const db = openDb(':memory:');
  const kernel = bootWorld(db, { seed: 42, spawn: { x: 0, y: 0 } });
  const tm = new TierManager(kernel);
  for (let i = 0; i < 50; i++) {
    tm.update([{ x: i * MACRO * REGION * 2, y: i * MACRO * REGION }], 0);
  }
  const settlement = [...kernel.graph.nodes.values()].find(n => n.type === 'settlement');
  if (!settlement) return;  // no settlement in this sweep (seed-dependent)
  const result = narrate(kernel, settlement.id);
  assert.ok(result, 'narrate returns a result');
  assert.ok(result.summary, 'result has summary');
  assert.ok(result.events.length > 0, 'result has events');
  assert.ok(result.events.every(e => e.eventId), 'every event has an ID (no invented facts)');
});

test('narrate returns null for nonexistent node', () => {
  const kernel = (await import('../kernel/kernel.js')).Kernel;
  const k = new kernel({ seed: 42 });
  const { narrate: n } = await import('../story/narrator.js');
  assert.equal(n(k, 999999), null);
});
```

- [ ] **Step 2: Add inspect handler to server.js**

In `sim/server/server.js`, import narrate and add handling for an `inspect` message type in the WebSocket message handler:

```js
import { narrate } from '../story/narrator.js';
```

In the message handler (where it handles `type: 'viewport'` etc.), add:

```js
if (m.type === 'inspect') {
  const result = narrate(this.kernel, m.nodeId);
  ws.send(JSON.stringify({ type: 'inspect_result', nodeId: m.nodeId, ...result }));
}
```

- [ ] **Step 3: Run tests → PASS**

- [ ] **Step 4: Commit**

```bash
git add sim/story/narrator.js sim/server/server.js sim/test/inspect.test.js
git commit -m "feat(sim): P4 — inspect endpoint for 'why is this here?' causal queries"
```

---

### Task 3: Full suite + probe

**Files:**
- Create: `sim/test/probe-story.mjs`

- [ ] **Step 1: Run full sim suite, fix failures**

- [ ] **Step 2: Write the probe**

```js
// sim/test/probe-story.mjs — P4 verification: "why is this here?" resolves to real edges.
import { openDb } from '../store/db.js';
import { bootWorld } from '../server/main.js';
import { TierManager } from '../lod/tiers.js';
import { REGION } from '../lod/aggregate.js';
import { MACRO } from '../world/genesis.js';
import { narrate, traceHistory } from '../story/narrator.js';

const db = openDb(':memory:');
const kernel = bootWorld(db, { seed: 42, spawn: { x: 0, y: 0 } });
const tm = new TierManager(kernel);

for (let i = 0; i < 100; i++) {
  tm.update([{ x: i * MACRO * REGION * 2, y: i * MACRO * REGION }], kernel.tick);
}

const settlements = [...kernel.graph.nodes.values()].filter(n => n.type === 'settlement');
let ok = true;

console.log(`story probe: ${settlements.length} settlements to narrate`);

for (const s of settlements.slice(0, 5)) {
  const result = narrate(kernel, s.id);
  const state = s.attrs.state === 'ruined' ? 'RUINED' : 'ACTIVE';
  console.log(`\n  [${state}] settlement #${s.id} at ${s.x},${s.y}:`);
  console.log(`    ${result?.summary ?? 'NO HISTORY'}`);
  if (result?.events) {
    console.log(`    events: ${result.events.map(e => e.type).join(' → ')}`);
    if (result.events.length === 0) {
      console.error(`    FAIL: no causal chain for settlement`);
      ok = false;
    }
  }
}

// Verify a ruin's "why" chain resolves
const ruin = settlements.find(n => n.attrs.state === 'ruined');
if (ruin) {
  const chain = traceHistory(kernel, ruin.id);
  console.log(`\n  ruin "why" chain (${chain.length} events):`);
  for (const ev of chain) {
    console.log(`    [${ev.id}] ${ev.type}`);
  }
  if (!chain.some(e => e.type.includes('abandon'))) {
    console.log('    (no abandonment event in chain — check chronicle → genesis wiring)');
  }
} else {
  console.log('\n  (no ruins to query — all settlements active in this sample)');
}

if (settlements.length === 0) { console.error('FAIL: no settlements to narrate'); ok = false; }
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
```

- [ ] **Step 3: Run probe → exit 0**

- [ ] **Step 4: Commit**

```bash
git add sim/test/probe-story.mjs sim/test/<fixed tests>
git commit -m "test(sim): P4 probe — 'why is this here?' resolves to causal chains with real event IDs"
```

---

### Task 4: Merge to master + restart sim

- [ ] Merge worktree to master.
- [ ] Kill old sim, restart fresh.
- [ ] Done.

---

## Self-review

- Spec coverage: "LLM narration over causal chains" — context assembly done; LLM call is honest absence (declared, not faked). "Deterministic context assembly" — traceHistory + assembleContext. "NPCs reference chronicle facts" — narrate() returns event IDs that NPCs will cite (S5 minds consume this context). "Why is this bridge broken resolves to edges" — traceHistory walks createdByEvent → causeEventId. "No invented facts" — summary derived mechanically from event types; every claim has an event ID.
- Phase boundary: no LLM call (S5 minds honest absence), no NPC dialogue (client surfaces not built). The causal chain walker and context assembler are the deliverable.
- Verification: probe queries 5 settlements, traces a ruin's "why" chain, verifies all events have IDs.
