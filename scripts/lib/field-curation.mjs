// scripts/lib/field-curation.mjs
// Durable per-field curation sidecar: the single source of truth for which variants are OMITTED.
// Read by the sidecar-aware gen-mf-catalog (to build vmap) and written by apply-field-picks.
import fs from 'fs';
import path from 'path';
import url from 'url';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');

// Source registry: every curatable corpus (decoration fields + building-dressing props).
// Each entry: { id, label, root (repo-relative), group (top dir name, e.g. biome), object (2nd dir name),
//   fileRegex (string; capture group 1 = variant index, parsed with parseInt) }.
// fileRegex stored as a STRING so it round-trips into field-sources.json / the manifest if ever needed.
export const SOURCES = [
  { id: 'f6', label: 'F6 large flora', root: 'assets/pixelab/landscape_v2/micro/large_flora',
    group: 'biome', object: 'species', fileRegex: '^v(\\d{3})\\.png$' },
  { id: 'f4', label: 'F4 medium flora', root: 'assets/pixelab/landscape_v2/micro/medium_flora',
    group: 'biome', object: 'object', fileRegex: '^mf__.*__v(\\d{3})\\.png$' },
  { id: 'f5', label: 'F5 medium objects', root: 'assets/pixelab/landscape_v2/micro/medium_objects',
    group: 'biome', object: 'object', fileRegex: '^mo__.*__v(\\d{3})\\.png$' },
  { id: 'f2', label: 'F2 small flora', root: 'assets/pixelab/landscape_v2/micro/small_flora',
    group: 'biome', object: 'object', fileRegex: '^sf__.*__v(\\d{3})\\.png$' },
  { id: 'large_objects', label: 'Large objects', root: 'assets/pixelab/landscape_v2/micro/large_objects',
    group: 'biome', object: 'object', fileRegex: '^lg__.*__v(\\d{3})\\.png$' },
  { id: 'dressing', label: 'Building dressing', root: 'assets/pixelab/buildings/dressing',
    group: 'biome', object: 'prop', fileRegex: '^base__v(\\d+)\\.png$' },
];

export function sourceById(id) {
  const s = SOURCES.find(x => x.id === id);
  if (!s) throw new Error(`field-curation: unknown source "${id}"`);
  return s;
}

// field/source id -> disk root holding <group>/<object>/ dirs. Derived from SOURCES so existing
// consumers (gen-mf-catalog, curationPath) keep working unchanged.
export const FIELD_ROOTS = Object.fromEntries(SOURCES.map(s => [s.id, s.root]));

// FIELD_ASSET_ROOT lets the sidecar resolve against a DIFFERENT checkout than this script — some fields'
// assets (e.g. large_objects) are gitignored and live only in the MAIN checkout while the curation code runs
// from a worktree. Defaults to the repo root the script lives in.
const ASSET_BASE = process.env.FIELD_ASSET_ROOT ? path.resolve(process.env.FIELD_ASSET_ROOT) : ROOT;

export function curationPath(field) {
  const root = FIELD_ROOTS[field];
  if (!root) throw new Error(`field-curation: unknown field "${field}"`);
  return path.join(ASSET_BASE, root, `_${field}_curation.json`);
}

export function loadCuration(field) {
  const p = curationPath(field);
  if (!fs.existsSync(p)) return { field, omits: {}, history: [], regenWorklist: [] };
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { field, omits: c.omits || {}, history: c.history || [], regenWorklist: c.regenWorklist || [] };
}

export function saveCuration(field, curation) {
  fs.writeFileSync(curationPath(field), JSON.stringify(curation, null, 1) + '\n');
}

// "biome/species" -> Set of omitted variant indices (the effective current omit-set).
export function omitSetMap(curation) {
  const m = new Map();
  for (const [key, vs] of Object.entries(curation.omits || {})) m.set(key, new Set(vs));
  return m;
}

// Merge a dashboard export (authoritative per touched species) into a curation object. Returns a new object.
// picks = { field, savedAt, decisions: { "biome/species": { omit:[v], tags:{v:tag}, notes:{v:str} } } }
export function mergePicks(curation, picks, isoNow) {
  const omits = { ...(curation.omits || {}) };
  // seed reason/note memory from the prior worklist so untouched species keep their reasons
  const meta = {};
  for (const w of curation.regenWorklist || []) {
    meta[`${w.biome}/${w.species}:${w.replaces}`] = { reason: w.reason || 'unspecified', note: w.note || '' };
  }
  for (const [key, d] of Object.entries(picks.decisions || {})) {
    omits[key] = [...new Set(d.omit || [])].sort((a, b) => a - b);
    for (const v of d.omit || []) {
      meta[`${key}:${v}`] = { reason: (d.tags || {})[v] || 'unspecified', note: (d.notes || {})[v] || '' };
    }
  }
  for (const k of Object.keys(omits)) if (!omits[k].length) delete omits[k];
  const regenWorklist = [];
  for (const [key, vs] of Object.entries(omits)) {
    const slash = key.indexOf('/');
    const biome = key.slice(0, slash), species = key.slice(slash + 1);
    for (const v of vs) {
      const mm = meta[`${key}:${v}`] || {};
      regenWorklist.push({ biome, species, replaces: v, reason: mm.reason || 'unspecified', note: mm.note || '' });
    }
  }
  return {
    field: curation.field,
    omits,
    history: [...(curation.history || []), { appliedAt: isoNow, decisions: picks.decisions || {} }],
    regenWorklist,
  };
}
