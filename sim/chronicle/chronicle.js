// sim/chronicle/chronicle.js — P3 L2: regional chronicle generation.
// Pure f(seed, macroKey, peoples, climate). Generates deterministic events
// that describe the history of a macro-cell: founding, wars, famines,
// flourishing, decline, abandonment, refounding.
import { rand, mix } from '../kernel/rng.js';

/** Event type → domain string mapping. */
export const CHRONICLE_EVENTS = new Map([
  ['ancient_founding',  'society'],
  ['survival',          'ecology'],
  ['war',               'conflict'],
  ['famine',            'ecology'],
  ['flourishing',       'economy'],
  ['decline',           'society'],
  ['abandonment',       'society'],
  ['refounding',        'society'],
  ['trade',             'economy'],
  ['young_colony',      'society'],
  ['plague',            'ecology'],
  ['pilgrimage',        'belief'],
  ['schism',            'conflict'],
]);

/** Pure f(seed, macroKey, peoples, climate).
 *  climate: { moisture, heat, elevation } (from biome classification).
 *  peoples: [{raceId, name, presence}] from macroCellPeoples.
 *  Returns [{id, type, domain, age, severity, raceId?, cause?}]. */
export function regionChronicle(seed, macroKey, peoples, climate) {
  if (!peoples || peoples.length === 0) return []; // wilderness — no history

  const [mx, my] = macroKey.split(',').map(Number);
  const cellHash = mix(mx, my);
  const events = [];
  let ordinal = 0;

  function emit(type, age, severity, raceId, cause) {
    const id = mix(seed, 2, cellHash, ordinal);
    const domain = CHRONICLE_EVENTS.get(type) ?? 'society';
    events.push({ id, type, domain, age, severity, raceId: raceId ?? null, cause: cause ?? null });
    ordinal++;
    return id;
  }

  // Fertility: higher moisture + moderate heat = more hospitable
  const fertility = Math.min(1, (climate.moisture ?? 0.5) * 0.6 + (climate.heat ?? 0.5) * 0.4);

  // Dominant race (highest presence)
  const dominant = peoples.reduce((a, b) => a.presence >= b.presence ? a : b);

  // Phase 1: Ancient history (ages 4–8)
  const foundingRoll = rand(seed, 3, cellHash, 0);
  if (foundingRoll < 0.7 + fertility * 0.2) {
    const foundingAge = 4 + Math.floor(rand(seed, 3, cellHash, 1) * 5);
    const foundId = emit('ancient_founding', foundingAge, 0.2, dominant.raceId);

    // Phase 2: Middle history — survival challenges
    const survivalRoll = rand(seed, 3, cellHash, 2);
    if (survivalRoll < 0.6) {
      const midAge = 2 + Math.floor(rand(seed, 3, cellHash, 3) * 2);
      if (rand(seed, 3, cellHash, 4) < 0.5) {
        emit('war', midAge, 0.4 + rand(seed, 3, cellHash, 5) * 0.4,
          peoples.length > 1 ? peoples[1].raceId : dominant.raceId, foundId);
      } else {
        emit('famine', midAge, 0.3 + rand(seed, 3, cellHash, 6) * 0.3, dominant.raceId, foundId);
      }
    }

    // Phase 3: Outcome — flourishing, decline, or abandonment
    const outcomeRoll = rand(seed, 3, cellHash, 7);
    if (outcomeRoll < 0.35 * fertility) {
      // Flourishing
      emit('flourishing', 1, 0.1, dominant.raceId);
    } else if (outcomeRoll < 0.35 * fertility + 0.25) {
      // Decline
      const declineId = emit('decline', 1, 0.5 + rand(seed, 3, cellHash, 8) * 0.3, dominant.raceId);
      // Some declines lead to abandonment
      if (rand(seed, 3, cellHash, 9) < 0.4) {
        emit('abandonment', 0, 0.8, dominant.raceId, declineId);
      }
    } else if (outcomeRoll > 0.85) {
      // Abandonment directly (harsh conditions)
      emit('abandonment', 0, 0.7 + rand(seed, 3, cellHash, 10) * 0.2, dominant.raceId);
    }
    // else: survival — settlement continues modestly
  }

  // Phase 4: Recent history — refounding abandoned sites, trade, young colonies
  const lastEvent = events[events.length - 1];
  if (lastEvent && lastEvent.type === 'abandonment') {
    // Chance of refounding
    if (rand(seed, 3, cellHash, 11) < 0.3) {
      emit('refounding', 0, 0.2, dominant.raceId, lastEvent.id);
    }
  } else if (events.length === 0) {
    // No ancient founding — young colony?
    if (rand(seed, 3, cellHash, 12) < 0.4 * fertility) {
      emit('young_colony', 0, 0.1, dominant.raceId);
    }
  } else if (lastEvent && lastEvent.type !== 'abandonment') {
    // Trade routes for established settlements
    if (rand(seed, 3, cellHash, 13) < 0.3 && peoples.length > 1) {
      emit('trade', 0, 0.1, peoples[1].raceId);
    }
  }

  return events;
}

/** Derive settlement state from chronicle events.
 *  Returns 'active' | 'ruined' | 'wilderness'. */
export function settlementState(events) {
  if (!events || events.length === 0) return 'wilderness';
  const last = events[events.length - 1];
  if (last.type === 'abandonment') return 'ruined';
  return 'active';
}
