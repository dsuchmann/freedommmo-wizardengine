// sim/chronicle/epochs.js — P3 L0: world-level epoch generation.
// Pure f(seed). Returns the deep history of this world seed.
import { rand, mix } from '../kernel/rng.js';

const EPOCH_TYPES = [
  'creation', 'golden_age', 'great_war', 'plague',
  'migration', 'ice_age', 'renaissance', 'cataclysm',
];

/** Pure f(seed). Returns [{type, age, severity}] — the world's macro-history. */
export function worldEpochs(seed) {
  const epochs = [];
  // Always starts with creation
  const creationAge = 5 + Math.floor(rand(seed, 100, 1) * 6); // 5–10 ages ago
  epochs.push({ type: 'creation', age: creationAge, severity: 0.0 });

  // Roll 3–6 additional epochs
  const count = 3 + Math.floor(rand(seed, 100, 2) * 4);
  for (let i = 0; i < count; i++) {
    const typeIdx = Math.floor(rand(seed, 100, 3, i) * (EPOCH_TYPES.length - 1)) + 1; // skip creation
    const type = EPOCH_TYPES[typeIdx];
    const age = 1 + Math.floor(rand(seed, 100, 4, i) * (creationAge - 1));
    const severity = rand(seed, 100, 5, i);
    epochs.push({ type, age, severity });
  }

  // Sort by age descending (oldest first)
  epochs.sort((a, b) => b.age - a.age);
  return epochs;
}
