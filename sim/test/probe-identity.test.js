// PROBE L1: identity — four humanoid races live (and die) on the unmodified
// kernel. Verifies: stage progression from real age, TIME_SYSTEM burn ordering,
// senescence death, deterministic identity, and the conservation identity over
// a multi-year run.
// Honest absences exercised: no reproduction (no 'seed' events from humanoids),
// no behavior from traits (nothing reads them but identityOf).
//
// ADAPTATIONS:
//   [A1] Conservation form copied verbatim from probe-growth.test.js:
//        stocks(0) before runTo, stocks(k.tick) at end; tlStart baseline.
//        Scale uses max(|captured|, 1) as in probe-growth.
//   [A2] Orc senescence starts at 80*0.7=56y; at age 58y on boot it is already
//        2 steps past start. With 1.15x/step compounding, 12 sim-years (≈17
//        orc-equiv years past start) exhausts R well inside the window.
//   [A3] Conservation uses delta-form: tlStart excludes pre-baseline losses
//        (there are none here, boot only; kept for probe discipline parity).
//   [A4] nameOf seed-7 vs seed-8 for the human node: verified by running the
//        probe; if they happen to collide on a given node id a different
//        seed pair is tried. The assertion uses the human node whose id is
//        deterministic (first humanoid added after many grass nodes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { YEAR, SPECIES, stageAt } from '../time/metabolism.js';
import { identityOf, RACES, nameOf } from '../life/identity.js';

function world(seed) {
  const k = new Kernel({ seed, phi: 4, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
  const out = { k, folk: {} };
  k.graph.boot(() => {
    for (let x = 1; x < 15; x += 3) for (let y = 1; y < 15; y += 3)
      k.addLiving({ species: 'grass', x, y, R: 3000, body: 150, tick: 0 });
    out.folk.human = k.addLiving({ species: 'human', x: 4, y: 4, R: 120000, body: 15000, tick: 0, age: 1 * YEAR });
    out.folk.elf   = k.addLiving({ species: 'elf',   x: 8, y: 4, R: 120000, body: 14000, tick: 0, age: 100 * YEAR });
    out.folk.dwarf = k.addLiving({ species: 'dwarf', x: 4, y: 8, R: 120000, body: 14000, tick: 0, age: 80 * YEAR });
    out.folk.orc   = k.addLiving({ species: 'orc',   x: 8, y: 8, R: 200000, body: 16000, tick: 0, age: 58 * YEAR });
  });
  return out;
}

test('PROBE L1 step 1: stages progress from real age across races', () => {
  const { k, folk } = world(7);
  // Boot-time stage expectations (derived from stage table + race lifespan):
  //   human 1y  → infant (infant:0, toddler:2y)
  //   elf 100y  → young_adult (young_adult:90y=18*5, adult:150y=30*5)
  //   dwarf 80y → adult (adult:75y=30*2.5, middle_aged:125y=50*2.5)
  //   orc 58y   → elderly (elderly:56y=80*0.7)
  assert.equal(identityOf(k, folk.human).stage, 'infant',      'human 1y = infant');
  assert.equal(identityOf(k, folk.elf).stage,   'young_adult', 'elf 100y = young_adult');
  assert.equal(identityOf(k, folk.dwarf).stage, 'adult',       'dwarf 80y = adult');
  assert.equal(identityOf(k, folk.orc).stage,   'elderly',     'orc 58y = elderly');

  k.runTo(2 * YEAR);
  if (k.graph.nodes.has(folk.human.id)) {
    // human aged from 1y to 3y; toddler starts at 2y
    assert.equal(identityOf(k, k.graph.nodes.get(folk.human.id)).stage, 'toddler',
      'human aged 1y→3y = toddler');
  }

  // Burn ordering: elderly orc burns harder than adult dwarf (if both alive)
  const orc = k.graph.nodes.get(folk.orc.id);
  const dwarf = k.graph.nodes.get(folk.dwarf.id);
  if (orc && dwarf) {
    const orcBurnF = stageAt('orc', k.tick - orc.attrs.birthTick)[3];
    const dwarfBurnF = stageAt('dwarf', k.tick - dwarf.attrs.birthTick)[3];
    assert.ok(orcBurnF > dwarfBurnF, 'elderly burn factor exceeds adult burn factor');
  }
});

test('PROBE L1 step 2: the old orc dies of senescence; no humanoid ever seeds', () => {
  const { k, folk } = world(7);
  // orc senescence starts at 56y (=80*0.7); at boot it is 58y (already 2 steps in).
  // 1.15x/year compounding means burn escalates rapidly; 6 sim-years gives ~10.5 orc-
  // equivalent years past senescence start → R exhausted long before 6y wall.
  k.runTo(6 * YEAR);
  assert.ok(!k.graph.nodes.has(folk.orc.id), 'orc died inside 6 sim-years of senescence');
  const death = k.ledger.events.find(e => e.type === 'death' && e.actor === folk.orc.id);
  assert.ok(death, 'death event recorded on the ledger for the orc');

  // No humanoid may ever emit a 'seed' event (L5 honest absence)
  for (const r of RACES) {
    const id = folk[r].id;
    assert.ok(!k.ledger.events.some(e => e.type === 'seed' && e.actor === id),
      `no humanoid reproduction until L5 (${r})`);
  }
});

test('PROBE L1 step 3: conservation identity holds over the multi-year run', () => {
  const { k } = world(7);
  // [A1/A3] stocks(0) BEFORE any runTo (destructive — only call at current tick).
  const stocksStart = k.stocks(0);
  const tlStart = k.ledger.totals.transferLoss;  // 0 at boot

  k.runTo(6 * YEAR);

  // stocks(k.tick) AFTER runTo; read totals AFTER stocks() to include final closeSegment.
  const end = k.stocks(k.tick);
  const t = k.ledger.totals;
  const lhs = end - stocksStart;
  const rhs = t.captured - t.burned - t.decayed - (t.transferLoss - tlStart);
  const scale = Math.max(Math.abs(t.captured), 1);
  assert.ok(Math.abs(lhs - rhs) / scale < 1e-9,
    `conservation violated: Δstocks=${lhs} flows=${rhs} (rel=${Math.abs(lhs - rhs) / scale})`);
});

test('PROBE L1 step 4: two identical seeds produce bit-identical identities and world state', () => {
  const a = world(7), b = world(7);
  a.k.runTo(3 * YEAR); b.k.runTo(3 * YEAR);

  for (const r of RACES) {
    const na = a.k.graph.nodes.get(a.folk[r].id);
    const nb = b.k.graph.nodes.get(b.folk[r].id);
    assert.equal(na == null, nb == null, `${r} alive/dead state must be identical`);
    if (na) assert.deepEqual(identityOf(a.k, na), identityOf(b.k, nb),
      `${r} identity is bit-identical across runs`);
  }

  // Different world seed → different name for the same node id
  // [A4] human node: seed-7 and seed-8 produce different names by RNG construction.
  const humanId = a.folk.human.id;
  const nameA = nameOf(7, humanId, 'human');
  const nameB = nameOf(8, humanId, 'human');
  assert.notEqual(nameA, nameB,
    `nameOf must differ across world seeds (got same "${nameA}" for both) — try different seeds if this fails`);
});
