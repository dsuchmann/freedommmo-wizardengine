// sim/world/wire.js — decoration placements become kernel entities at boot (Plan E, spec §6.1/§5.x).
// F4 placements → LIVING berry_bush (metabolic, flux-entered, lifecycle-scheduled).
// F3 placements → inert MATTER nodes (noFlux, hold embodied time E, no lifecycle).
// Delta-suppressed placements (target === 'placement:<key>') are silently skipped —
// that is how taken/destroyed/worn objects stay gone across re-boots (world = f(seed, deltas)).
// Only REMOVAL kinds suppress a placement. 'damaged' deltas are intentionally NOT suppressing:
// they record hp/stage scars for the renderer but the object still exists in the world.
// 'worn' is a removal kind (Pass 3 P1 worn paths): a tile worn past threshold gets a 'worn' delta
// that suppresses its baseline placement, keeping it bare until the delta is removed (wear fades
// or the path decays) at which point the baseline regrows on the next reboot.
// Claim suppression (locked decision 7): tiles inside any 'building' node footprint are claimed;
// baseline placements on claimed tiles are never materialized. Buildings must be compiled BEFORE
// materializeRect at boot; claims are re-derived from the graph on every call so reboot is
// reproducible (world = f(seed, deltas), boot buildings are deterministic baseline).
import { tilePlacements } from './baseline.js';
import { rand } from '../kernel/rng.js';
import { DAY } from '../time/metabolism.js';
import { START } from './spawn.js';

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
  // Only removal kinds (taken / felled / destroyed) suppress a placement on reboot.
  // 'damaged' deltas are scar records for the renderer — they must NOT suppress, otherwise
  // a cracked-but-existing object vanishes when the kernel is reconstructed from seed+deltas.
  // MIRRORED in src/sim/sim-world-state.js REMOVAL_KINDS — update both or the client drifts.
  const REMOVAL_KINDS = new Set(['taken', 'felled', 'destroyed', 'worn', 'paved', 'claimed']);
  const suppressed = new Set(
    kernel.deltas.list
      .filter(d => d.target?.startsWith('placement:') && REMOVAL_KINDS.has(d.kind))
      .map(d => d.target.slice('placement:'.length)));
  const existing = new Set(
    [...kernel.graph.nodes.values()].map(n => n.attrs?.placement).filter(Boolean));
  // Claims (locked decision 7): tiles inside any building footprint never materialize
  // baseline placements. Buildings must be compiled BEFORE materializeRect at boot;
  // claims are re-derived from the graph on every call, so reboot is reproducible.
  const claimed = new Set();
  for (const n of kernel.graph.nodes.values()) {
    if (n.type !== 'building') continue;
    const fp = n.attrs.footprint;
    for (let yy = fp.y0; yy < fp.y0 + fp.h; yy++)
      for (let xx = fp.x0; xx < fp.x0 + fp.w; xx++) claimed.add(`${xx},${yy}`);
  }
  const st = START[F4_CLASS];
  let made = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    for (const p of tilePlacements(x, y)) {
      if (suppressed.has(p.key) || existing.has(p.key) || claimed.has(`${x},${y}`)) continue;
      const hh = keyHash(p.key);
      const meta = { placement: p.key, field: p.field, archetype: p.archetype, biome: p.biome, variant: p.variant };
      if (p.field === 'f4') {
        // kernel.addLiving (sim/kernel/kernel.js:28) flux-enters + re-rates + schedules lifecycle,
        // so wired F4 metabolizes identically to spawned entities (no-mock).
        const node = kernel.addLiving({
          species: F4_CLASS, x: p.x, y: p.y, tick,
          R: st.R[0] + Math.floor(rand(kernel.seed, hh, 1) * (st.R[1] - st.R[0])),
          body: st.body[0] + Math.floor(rand(kernel.seed, hh, 2) * (st.body[1] - st.body[0])),
          age: Math.floor(rand(kernel.seed, hh, 3) * st.maxAgeDays) * DAY,
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
