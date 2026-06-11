// Deterministic, call-order-independent randomness (spec §5.5).
// Every draw is a pure function of (seed, ...integer ids).

function scramble(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = Math.imul(n, 9);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return n >>> 0;
}

const PRIMES = [374761393, 668265263, 1442695041, 2246822519, 3266489917];

/** Mix any number of integer args into one uint32. */
export function mix(...ids) {
  let h = 0x9e3779b9;
  for (let i = 0; i < ids.length; i++) {
    h = scramble(h ^ Math.imul(ids[i] | 0, PRIMES[i % PRIMES.length]));
  }
  return h;
}

/** Uniform [0,1) from (seed, ...ids). */
export function rand(seed, ...ids) {
  return mix(seed, ...ids) / 4294967296;
}

/** Uniform [lo,hi) from (seed, ...ids, lo, hi). */
export function randRange(seed, a, b, lo, hi) {
  return lo + rand(seed, a, b) * (hi - lo);
}
