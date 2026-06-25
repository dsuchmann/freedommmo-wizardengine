// scripts/lib/field-curation.mjs
// Durable per-field curation sidecar: the single source of truth for which variants are OMITTED.
// Read by the sidecar-aware gen-mf-catalog (to build vmap) and written by apply-field-picks.
import fs from 'fs';
import path from 'path';
import url from 'url';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');

// field id -> disk root holding <biome>/<species>/ dirs. F6 only for now; F2-F5 plug in here later.
export const FIELD_ROOTS = {
  f6: 'assets/pixelab/landscape_v2/micro/large_flora',
};

export function curationPath(field) {
  const root = FIELD_ROOTS[field];
  if (!root) throw new Error(`field-curation: unknown field "${field}"`);
  return path.join(ROOT, root, `_${field}_curation.json`);
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
