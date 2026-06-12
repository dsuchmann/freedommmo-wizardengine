// sim/matter/audit.js — Grain conservation audit (atlas S3 Material System, Task 5).
// Transfer identity: for every grain type g:
//   expected_from_events == held_in_inventories + metabolized_counter
// Decay counters (grain:decayed:*) are accepted as their own sink (corpse-derived,
// never enter events) — audited for ≥0 and finite only.
import { grainsForBite, yieldOf } from './composition.js';

/**
 * Audit grain conservation for a kernel.
 *
 * @param {object} kernel
 * @returns {{ ok: boolean, perGrain: { [g]: { expected, held, metabolized, decayed } } }}
 */
export function auditGrains(kernel) {
  // --- 1. Expected from ledger events ---
  const expected = {};

  function addExpected(grains) {
    for (const [g, u] of Object.entries(grains)) {
      if (u <= 0) continue;
      expected[g] = (expected[g] ?? 0) + u;
    }
  }

  for (const ev of kernel.ledger.events) {
    if (ev.type === 'pick' || ev.type === 'harvest') {
      const species = ev.attrs?.species;
      if (species && ev.magnitude != null) {
        addExpected(grainsForBite(species, ev.magnitude));
      }
    } else if (ev.type === 'take') {
      const archetype = ev.attrs?.archetype;
      const magnitude = ev.magnitude;  // whole node E at take time
      if (magnitude != null && magnitude > 0) {
        // yieldOf on a synthetic matter-shaped node (just needs type + attrs)
        const yld = yieldOf({ type: 'matter', attrs: { archetype: archetype ?? '' } });
        for (const [g, perTu] of Object.entries(yld)) {
          const u = perTu * magnitude;
          if (u > 0) expected[g] = (expected[g] ?? 0) + u;
        }
      }
    }
  }

  // --- 2. Held: sum grains in all inventory items across all nodes ---
  const held = {};
  for (const node of kernel.graph.nodes.values()) {
    for (const item of (node.attrs?.inventory ?? [])) {
      if (!item.grains) continue;
      for (const [g, u] of Object.entries(item.grains)) {
        if (u > 0) held[g] = (held[g] ?? 0) + u;
      }
    }
  }

  // --- 3. Metabolized + decayed: read from ledger totals ---
  const metabolized = {};
  const decayed = {};
  for (const [key, val] of Object.entries(kernel.ledger.totals)) {
    if (key.startsWith('grain:metabolized:')) {
      const g = key.slice('grain:metabolized:'.length);
      metabolized[g] = val;
    } else if (key.startsWith('grain:decayed:')) {
      const g = key.slice('grain:decayed:'.length);
      decayed[g] = val;
    }
  }

  // --- 4. Build perGrain and check identity ---
  const allGrains = new Set([
    ...Object.keys(expected),
    ...Object.keys(held),
    ...Object.keys(metabolized),
    ...Object.keys(decayed),
  ]);

  const perGrain = {};
  let ok = true;

  for (const g of allGrains) {
    const exp = expected[g] ?? 0;
    const hld = held[g] ?? 0;
    const met = metabolized[g] ?? 0;
    const dec = decayed[g] ?? 0;

    // Identity: expected == held + metabolized (decayed is its own sink from corpse events)
    const diff = Math.abs(exp - hld - met);
    const tolerance = 1e-6 * Math.max(1, exp);
    const grainOk = diff < tolerance;
    if (!grainOk) ok = false;

    // Decayed: just assert ≥0 and finite
    const decayedOk = isFinite(dec) && dec >= 0;
    if (!decayedOk) ok = false;

    perGrain[g] = { expected: exp, held: hld, metabolized: met, decayed: dec };
  }

  return { ok, perGrain };
}
