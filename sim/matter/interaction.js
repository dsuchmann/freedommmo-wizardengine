// sim/matter/interaction.js — minimal assembly rules over grain properties (atlas S3 recipes row).
// PURE material math: no kernel, no RNG, no recipe data. Locked decision 5: which combinations
// work is DERIVED — the only authored inputs are grain properties and these two thresholds.
import { GRAINS } from './grains.js';
import { propertiesOf, archetypeClassOf } from './composition.js';

export const INTERACTION = {
  minBind: 0.35,        // unit-weighted adhesion below this → mixture won't hold
  minStability: 0.4,    // mixture stability below this → falls apart
};

/** Sum compositions unit-for-unit. Conservation by construction. */
export function mergeGrains(list) {
  const out = {};
  for (const comp of list) {
    for (const [g, u] of Object.entries(comp ?? {})) {
      if (u > 0) out[g] = (out[g] ?? 0) + u;
    }
  }
  return out;
}

/** Unit-weighted mean adhesion of a composition. 0 when empty. */
export function adhesionOf(composition) {
  let units = 0, sum = 0;
  for (const [g, u] of Object.entries(composition)) {
    const def = GRAINS[g];
    if (!def || u <= 0) continue;
    units += u; sum += u * def.adhesion;
  }
  return units === 0 ? 0 : sum / units;
}

/** Classify a combination attempt from grain math alone.
 *  Success → form 'composite:<g1>+<g2>' (top-2 grains by units, alphabetical — derived, not named).
 *  Failure → form 'ruined_mash' (output item still carries ALL grains and E: conservation). */
export function combineOutcome(grainsList) {
  const merged = mergeGrains(grainsList);
  const props = propertiesOf(merged);
  const bind = adhesionOf(merged);
  const ok = props.totalUnits > 0 && bind >= INTERACTION.minBind && props.stability >= INTERACTION.minStability;
  let form = 'ruined_mash';
  if (ok) {
    const top = Object.entries(merged).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 2).map(([g]) => g).sort();
    form = 'composite:' + top.join('+');
  }
  return { ok, form, merged, props, bind };
}

/** Canonical input signature of an attempt: sorted item classes joined with '+'.
 *  Class = species (harvest items) or archetype CLASS (matter items). Order-independent. */
export function signatureOf(items) {
  return items.map(it => it.species ?? archetypeClassOf(it.archetype)).sort().join('+');
}
