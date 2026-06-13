// src/render/sprite-pool-util.js — pure helpers for the GL persistent
// sprite pool. No DOM/GL dependencies so node --test covers them.

// Merge a list of dirty instance indices into upload ranges. Indices `gap`
// or closer apart merge into one range (inclusive) — a few large bufferSubData
// calls beat many tiny ones on every driver we target.
export function coalesceDirty(indices, gap) {
  if (indices.length === 0) return [];
  var sorted = Array.from(indices).sort(function (a, b) { return a - b; });
  var ranges = [];
  var start = sorted[0];
  var end = sorted[0];
  for (var i = 1; i < sorted.length; i++) {
    var idx = sorted[i];
    if (idx - end <= gap) { end = idx; continue; }
    ranges.push({ start: start, count: end - start + 1 });
    start = idx; end = idx;
  }
  ranges.push({ start: start, count: end - start + 1 });
  return ranges;
}

// First index in sortedArr[0..len) with value >= needle (binary search).
// len of null/undefined means "use the full array length"; a real 0 means
// empty range (callers pass the live instance count, which is 0 for empty pool).
// Used to find the player's insertion point in the y-sorted pool.
export function lowerBound(sortedArr, needle, len) {
  var lo = 0, hi = (len == null) ? sortedArr.length : len;
  while (lo < hi) {
    var mid = (lo + hi) >> 1;
    if (sortedArr[mid] < needle) lo = mid + 1; else hi = mid;
  }
  return lo;
}
