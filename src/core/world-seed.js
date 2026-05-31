const WORLD_SEED_KEY = 'freedommmo.world.seed.v1';
const DEFAULT_SEED = 42;

let cachedSeed = null;

export function getWorldSeed() {
  if (cachedSeed !== null) return cachedSeed;
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      cachedSeed = DEFAULT_SEED;
      return cachedSeed;
    }
    const raw = window.localStorage.getItem(WORLD_SEED_KEY);
    const parsed = Number.parseInt(raw, 10);
    cachedSeed = Number.isFinite(parsed) ? parsed : DEFAULT_SEED;
    window.localStorage.setItem(WORLD_SEED_KEY, String(cachedSeed));
  } catch {
    cachedSeed = DEFAULT_SEED;
  }
  return cachedSeed;
}

export function setWorldSeed(seed) {
  cachedSeed = Number.isFinite(seed) ? Math.trunc(seed) : DEFAULT_SEED;
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(WORLD_SEED_KEY, String(cachedSeed));
  } catch {
    // Ignore persistence failures; deterministic fallback remains available.
  }
  return cachedSeed;
}

export function resetWorldSeed() {
  return setWorldSeed(DEFAULT_SEED);
}
