// sim/world/wire.js — decoration placements become kernel entities at boot (Plan E, spec §6.1/§5.x).
// F4 placements → LIVING berry_bush (metabolic, flux-entered, lifecycle-scheduled).
// F3 placements → inert MATTER nodes (noFlux, hold embodied time E, no lifecycle).
// Delta-suppressed placements (target === 'placement:<key>') are silently skipped —
// that is how taken/destroyed objects stay gone across re-boots (world = f(seed, deltas)).
import { tilePlacements } from './baseline.js';
import { rand } from '../kernel/rng.js';
import { DAY } from '../time/metabolism.js';

/** FNV-1a over the key string → 31-bit int for rand() salting (deterministic, order-free). */
export function keyHash(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 1;
}

/** Embodied time for F3 matter by archetype category (tu). Coarse, declared, conserved. */
const F3_E = { default: 120 };

/** Metabolic class for F4 wired placements. F4 field = medium flora → berry_bush tier. */
const F4_CLASS = 'berry_bush';

/** Materialize all placements in rect as kernel entities. MUST run inside kernel.graph.boot()
 *  (baseline provenance) or with a causal event (promotion — later pass). Skips delta-suppressed
 *  and already-materialized keys. Returns count created. */
export function materializeRect(kernel, { x0, y0, w, h }, tick) {
  const suppressed = new Set(
    kernel.deltas.list.filter(d => d.target?.startsWith('placement:'))
      .map(d => d.target.slice('placement:'.length)));
  const existing = new Set(
    [...kernel.graph.nodes.values()].map(n => n.attrs?.placement).filter(Boolean));
  let made = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    for (const p of tilePlacements(x, y)) {
      if (suppressed.has(p.key) || existing.has(p.key)) continue;
      const hh = keyHash(p.key);
      const meta = { placement: p.key, field: p.field, archetype: p.archetype, biome: p.biome, variant: p.variant };
      if (p.field === 'f4') {
        // kernel.addLiving (sim/kernel/kernel.js:28) flux-enters + re-rates + schedules lifecycle,
        // so wired F4 metabolizes identically to spawned entities (no-mock).
        const node = kernel.addLiving({
          species: F4_CLASS, x: p.x, y: p.y, tick,
          R: 600 + Math.floor(rand(kernel.seed, hh, 1) * 900),
          body: 200 + Math.floor(rand(kernel.seed, hh, 2) * 400),
          age: Math.floor(rand(kernel.seed, hh, 3) * 40) * DAY,
        });
        Object.assign(node.attrs, meta);
      } else {
        // F3: inert matter — createNode alone gives no flux, no lifecycle schedules (no-mock).
        kernel.graph.createNode({
          type: 'matter', tick, x: p.x, y: p.y,
          attrs: { ...meta, E: F3_E[p.archetype] ?? F3_E.default, noFlux: true },
        });
      }
      made++;
    }
  }
  return made;
}
