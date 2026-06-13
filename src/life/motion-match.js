// src/life/motion-match.js — Parse natural-language commands and fuzzy-match
// against the choreography manifest. "do five jumping jacks" → {count:5, id:'jumping_jacks'}.

const NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const STOP_WORDS = new Set(['do', 'a', 'an', 'the', 'some', 'please', 'can', 'you', 'i', 'want', 'to', 'me', 'make', 'perform', 'lets', "let's"]);

/** Parse "do five jumping jacks" → { count: 5, tokens: ['jumping', 'jacks'] } */
export function parseCommand(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  let count = 1;
  const tokens = [];
  for (const w of words) {
    if (NUMBERS[w]) { count = NUMBERS[w]; continue; }
    const n = parseInt(w, 10);
    if (!isNaN(n) && n > 0 && n <= 100) { count = n; continue; }
    if (STOP_WORDS.has(w)) continue;
    tokens.push(w);
  }
  return { count, tokens };
}

/** Score a manifest entry against parsed tokens. Higher = better match.
 *  Matches on id (split by _), tags (split by space), and desc words. */
function score(entry, tokens) {
  if (tokens.length === 0) return 0;
  const idTokens = entry.id.split('_');
  const tagTokens = entry.tags.flatMap(t => t.split(/\s+/));
  const descTokens = (entry.desc || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  let hits = 0;
  for (const t of tokens) {
    if (idTokens.includes(t)) { hits += 3; continue; }
    if (tagTokens.includes(t)) { hits += 2; continue; }
    // partial match on tags/id
    if (idTokens.some(it => it.startsWith(t) || t.startsWith(it))) { hits += 2; continue; }
    if (tagTokens.some(tt => tt.startsWith(t) || t.startsWith(tt))) { hits += 1.5; continue; }
    if (descTokens.includes(t)) { hits += 0.5; continue; }
  }
  return hits / (tokens.length * 3); // normalize to [0, 1]
}

/** Find best manifest match for parsed tokens. Returns { id, score } or null if below threshold. */
export function matchMotion(tokens, manifest) {
  if (tokens.length === 0) return null;
  let best = null, bestScore = 0;
  for (const entry of manifest) {
    const s = score(entry, tokens);
    if (s > bestScore) { bestScore = s; best = entry; }
  }
  if (bestScore < 0.45) return null;
  return { id: best.id, score: bestScore, entry: best };
}
