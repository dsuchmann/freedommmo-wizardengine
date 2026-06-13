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
  ['trade_route',       'economy'],
  ['golden_age',        'economy'],
  ['great_works',       'society'],
  ['imperial_seat',     'society'],
  ['cultural_zenith',   'society'],
  ['population_boom',   'ecology'],
  ['alliance',          'society'],
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

  // Phase 5: Advanced history — only non-abandoned, ancient sites with high fertility
  const lastEv5 = events[events.length - 1];
  const isAlive = lastEv5 && lastEv5.type !== 'abandonment';
  const hasAncientFounding = events.some(e => e.type === 'ancient_founding');
  const maxAge = events.length > 0 ? Math.max(...events.map(e => e.age ?? 0)) : 0;

  if (isAlive && hasAncientFounding) {
    // Trade route (distinct from trade event — implies infrastructure)
    if (rand(seed, 3, cellHash, 20) < 0.25 * fertility && peoples.length > 1) {
      emit('trade_route', 1, 0.15, peoples.length > 1 ? peoples[1].raceId : dominant.raceId);
    }

    // Golden age — very fertile, ancient
    if (maxAge >= 5 && rand(seed, 3, cellHash, 21) < 0.15 * fertility) {
      emit('golden_age', 2, 0.1, dominant.raceId);
    }

    // Great works — requires golden age or deep history
    const hasGoldenAge = events.some(e => e.type === 'golden_age');
    if (hasGoldenAge && rand(seed, 3, cellHash, 22) < 0.12 * fertility) {
      emit('great_works', 1, 0.1, dominant.raceId);
    }

    // Imperial seat — very rare, requires golden age + deep history
    if (hasGoldenAge && maxAge >= 6 && rand(seed, 3, cellHash, 23) < 0.06 * fertility) {
      emit('imperial_seat', 0, 0.05, dominant.raceId);
    }

    // Cultural zenith — extremely rare
    const hasImperial = events.some(e => e.type === 'imperial_seat');
    if (hasImperial && rand(seed, 3, cellHash, 24) < 0.04 * fertility) {
      emit('cultural_zenith', 0, 0.02, dominant.raceId);
    }

    // Population boom — fertility-driven
    if (maxAge >= 4 && rand(seed, 3, cellHash, 25) < 0.20 * fertility) {
      emit('population_boom', 1, 0.1, dominant.raceId);
    }

    // Alliance — multi-race
    if (peoples.length > 1 && rand(seed, 3, cellHash, 26) < 0.15) {
      emit('alliance', 0, 0.1, peoples[1].raceId);
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

/** Derive settlement tier from chronicle events.
 *  Scores based on age, event richness, and rarity markers.
 *  Returns one of the 12 TIER_NAMES.
 *
 *  Distribution target: most common = homestead/hamlet/village,
 *  tier 8+ = ~1 in 100, tier 11-12 = ~1 in 1000. */
export function chronicleTier(events, seed, macroKey) {
  if (!events || events.length === 0) return 'homestead';

  const chronicleAge = Math.max(...events.map(e => e.age ?? 0));
  const has = (type) => events.some(e => e.type === type);
  const count = (type) => events.filter(e => e.type === type).length;

  // Score accumulation: higher score = larger settlement
  let score = 0;

  // Age contributes linearly
  score += Math.min(chronicleAge, 8);

  // Key events raise the score
  if (has('ancient_founding'))  score += 2;
  if (has('flourishing'))       score += 3;
  if (has('trade'))             score += 1;
  if (has('trade_route'))       score += 3;
  if (has('golden_age'))        score += 5;
  if (has('great_works'))       score += 4;
  if (has('imperial_seat'))     score += 8;
  if (has('cultural_zenith'))   score += 10;
  if (has('population_boom'))   score += 3;
  if (has('alliance'))          score += 2;
  if (has('refounding'))        score += 1;
  if (has('young_colony'))      score += 0;

  // Negative events reduce score
  if (has('war'))               score -= 1;
  if (has('famine'))            score -= 1;
  if (has('plague'))            score -= 2;
  if (has('decline'))           score -= 2;

  // Event count density bonus (more history = more growth)
  score += Math.min(events.length, 10) * 0.5;

  // Seeded jitter to break ties deterministically (+/- 1)
  const [mx, my] = macroKey.split(',').map(Number);
  const jitter = (rand(seed, 3, mix(mx, my), 99) - 0.5) * 2;
  score += jitter;

  // Map score to tier
  if (score >= 40) return 'world_capital';
  if (score >= 34) return 'megacity';
  if (score >= 28) return 'metropolis';
  if (score >= 23) return 'capital';
  if (score >= 18) return 'great_city';
  if (score >= 14) return 'city';
  if (score >= 11) return 'borough';
  if (score >= 8)  return 'town';
  if (score >= 5)  return 'township';
  if (score >= 3)  return 'village';
  if (score >= 1)  return 'hamlet';
  return 'homestead';
}
