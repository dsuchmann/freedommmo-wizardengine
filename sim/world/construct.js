// sim/world/construct.js — M4: blueprint compilation → kernel nodes (locked decisions 6+7).
// One 'building' node per LEAF building (groups recurse, leave no node).
// Interior features are inert matter nodes with declared embodied time E,
// exactly like F3 baseline matter — created at boot they are part of initial stocks,
// so the conservation identity is untouched.
// Provenance: must run inside kernel.graph.boot() (baseline) OR with a causeEventId
// (future runtime construction). graph.createNode enforces this (spec §5.4).
// Honest absence: npc_slots are data only (no NPCs yet); walkable flags are data only
// (no movement consumer yet); there is no runtime 'construct' verb in M4.
import { expandBlueprint } from './blueprints.js';

/** Declared embodied time (tu) per interior-feature archetype. Coarse, declared, conserved. */
export const FEATURE_E = { hearth: 150, bedroll: 60, furnace: 300, anvil: 250, default: 100 };

/** Compile a blueprint at an origin into kernel nodes. Returns the building nodes (one per leaf). */
export function compileBlueprint(kernel, templateId, { x, y }, tick, causeEventId = null) {
  const { leaves } = expandBlueprint(templateId, x, y);
  const buildings = [];
  for (const leaf of leaves) {
    const building = kernel.graph.createNode({
      type: 'building', tick, x: leaf.footprint.x0, y: leaf.footprint.y0, causeEventId,
      attrs: {
        template: leaf.template, footprint: leaf.footprint, stamps: leaf.stamps,
        npcSlots: leaf.npcSlots, noFlux: true,
      },
    });
    for (const f of leaf.features) {
      kernel.graph.createNode({
        type: 'matter', tick, x: f.x, y: f.y, causeEventId,
        attrs: {
          archetype: f.type, E: FEATURE_E[f.type] ?? FEATURE_E.default,
          provides: f.provides, building: building.id, noFlux: true,
        },
      });
    }
    buildings.push(building);
  }
  return buildings;
}
