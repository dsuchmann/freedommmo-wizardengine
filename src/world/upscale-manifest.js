// src/world/upscale-manifest.js — which F6 large-flora sprites have a produced @384 upscale.
//
// The tree-upscale pipeline (scripts/tree-upscale/) writes assets/.../large_flora/_upscaled.json — a
// list of source keys (path under large_flora, no extension) that have a matching @384 detail upscale.
// The renderer loads it once and uses it to (a) swap a 192px sprite/frame URL for its crisper @384, and
// (b) draw that tree at its bigger native footprint (384px = 12 tiles vs 192px = 6). Everything falls
// back to the 192 source when no @384 exists — zero impact on un-upscaled trees, no 404 spam.
//
// Refresh after a comfy-batch run: `node scripts/tree-upscale/gen-upscale-manifest.mjs` then reload.

const LF_PREFIX = '/assets/pixelab/landscape_v2/micro/large_flora/';
let _set = new Set();
let _loaded = false;

// Fire-and-forget load. Until it resolves, every query returns false (so the world stays on 192px and
// nothing pops). Absent manifest is fine — just means nothing is upscaled yet.
(function _load() {
  if (typeof fetch !== 'function') { _loaded = true; return; }
  fetch(LF_PREFIX + '_upscaled.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((arr) => { _set = new Set(arr); _loaded = true; })
    .catch(() => { _loaded = true; });
})();

/** Does this source key (e.g. "dense_forest/ancient_oak/v000") have a produced @384? */
export function isUpscaled(key) { return _set.size > 0 && _set.has(key); }

/** Rewrite a large_flora sprite/frame URL to its @384 variant IF one exists; else return it unchanged.
 *  Handles base, state, and anim-frame URLs uniformly (any "<…>/large_flora/<key>.png"). */
export function upscaleUrl(url) {
  if (_set.size === 0 || typeof url !== 'string') return url;
  const i = url.indexOf(LF_PREFIX);
  if (i < 0 || !url.endsWith('.png')) return url;
  const key = url.slice(i + LF_PREFIX.length, -4); // strip prefix + ".png"
  return _set.has(key) ? url.slice(0, -4) + '@384.png' : url;
}

export function upscaleManifestLoaded() { return _loaded; }
export function upscaleManifestSize() { return _set.size; }
