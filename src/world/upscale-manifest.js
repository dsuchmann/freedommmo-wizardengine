// src/world/upscale-manifest.js — which decoration-field sprites have a produced @384 upscale.
//
// The tree-upscale pipeline (scripts/tree-upscale/) writes, PER FIELD, a manifest
// assets/.../micro/<field>/_upscaled.json — a list of source keys (path under that field's dir, no
// extension) that have a matching @384 detail upscale (the winners of an upscale/blend decision; objects
// left "direct" are absent). The renderer loads each field's manifest once and uses it to swap a native
// sprite/frame URL for its crisper @384. Everything falls back to the native source when no @384 exists —
// zero impact on un-upscaled sprites, no 404 spam.
//
// large_flora (F6) keeps its exact prior behaviour; the other object fields are wired by the same rule.
//
// Refresh after a comfy-batch / apply-upscale-decisions run:
//   `node scripts/tree-upscale/gen-upscale-manifest.mjs` then reload.

const MICRO_PREFIX = '/assets/pixelab/landscape_v2/micro/';

// Fields whose _upscaled.json the renderer honors. Mirrors scripts/tree-upscale/fields.json.
const FIELDS = ['large_flora', 'small_flora', 'medium_flora', 'medium_objects', 'large_objects'];

const _sets = new Map();      // field -> Set<sourceKey>
let _loadedCount = 0;

// Fire-and-forget per-field load. Until a field resolves, its queries fall through to the native sprite
// (so the world stays on the source size and nothing pops). An absent manifest is fine — it just means
// nothing in that field is upscaled yet.
(function _load() {
  if (typeof fetch !== 'function') { for (const f of FIELDS) _sets.set(f, new Set()); _loadedCount = FIELDS.length; return; }
  for (const field of FIELDS) {
    fetch(MICRO_PREFIX + field + '/_upscaled.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((arr) => { _sets.set(field, new Set(arr)); })
      .catch(() => { _sets.set(field, new Set()); })
      .finally(() => { _loadedCount++; });
  }
})();

/** Does this source key (e.g. "dense_forest/ancient_oak/v000") have a produced @384 in the given field? */
export function isUpscaled(key, field = 'large_flora') {
  const set = _sets.get(field);
  return !!set && set.has(key);
}

/** Rewrite a decoration-field sprite/frame URL to its @384 variant IF one exists; else return it unchanged.
 *  Works for ANY field under .../micro/<field>/ — picks the field from the path and consults its manifest.
 *  Handles base, state, and anim-frame URLs uniformly (any "<…>/micro/<field>/<key>.png"). */
export function upscaleUrl(url) {
  if (typeof url !== 'string') return url;
  const i = url.indexOf(MICRO_PREFIX);
  if (i < 0 || !url.endsWith('.png')) return url;
  const rest = url.slice(i + MICRO_PREFIX.length);   // "<field>/<key>.png"
  const s = rest.indexOf('/');
  if (s < 0) return url;
  const field = rest.slice(0, s);
  const set = _sets.get(field);
  if (!set || set.size === 0) return url;             // field not (yet) loaded or nothing upscaled
  const key = rest.slice(s + 1, -4);                  // "<key>" (strip "<field>/" and ".png")
  return set.has(key) ? url.slice(0, -4) + '@384.png' : url;
}

export function upscaleManifestLoaded() { return _loadedCount >= FIELDS.length; }
export function upscaleManifestSize() { let n = 0; for (const set of _sets.values()) n += set.size; return n; }

// Test/dev hook: inject a field's manifest set directly. The production path fetches each field's JSON; in
// a non-browser test there is no fetch host, so tests seed the sets through this. Not used by the renderer.
export function __setUpscaleManifest(field, keys) { _sets.set(field, new Set(keys)); }
