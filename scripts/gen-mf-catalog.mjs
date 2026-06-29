// scripts/gen-mf-catalog.mjs
// Scans assets/pixelab/landscape_v2/micro/medium_flora and writes
// src/world/mf-catalog.js. Re-run any time (e.g. as wind-sway anims land).
import fs from 'fs';
import path from 'path';
import url from 'url';
import { alphaBBoxFromBuffer, decodeAlpha } from './lib/png-alpha-bbox.mjs';
import { measureSilhouette } from './lib/silhouette-measure.mjs';
import { loadCuration, omitSetMap } from './lib/field-curation.mjs';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const FLORA = path.join(ROOT, 'assets/pixelab/landscape_v2/micro/medium_flora');
const OUT = path.join(ROOT, 'src/world/mf-catalog.js');

// PNG width from IHDR (bytes 16-19 big-endian)
function pngWidth(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(24);
  fs.readSync(fd, buf, 0, 24, 0);
  fs.closeSync(fd);
  return buf.readUInt32BE(16);
}

// Per-variant alpha trims [x,y,w,h]; null entry = fully transparent variant.
function trimsFor(odir, bases) {
  return bases.map(f => {
    const b = alphaBBoxFromBuffer(fs.readFileSync(path.join(odir, f)));
    return b ? [b.x, b.y, b.w, b.h] : null;
  });
}

// Per-variant silhouette measurements; null where trim is null.
function silsFor(odir, bases, trims) {
  return bases.map((f, i) => {
    if (!trims[i]) return null;
    return measureSilhouette(decodeAlpha(fs.readFileSync(path.join(odir, f))), trims[i]);
  });
}

// Per-type variant cap ('biome/object' -> first excluded index). Drops a
// contiguous tail of bad variants from rotation, including their state
// sprites and anims. Must be a tail block — the renderer assumes variant
// indices are contiguous from v000.
const VARIANT_CAP = {
  // v048-v059 are literal birds (PixelLab prompt drift) — no fauna in F4
  'tropical_forest/bird_of_paradise': 48,
};

// Per-species on-screen size in WORLD TILES for folded large_objects (sprites are small-native, so size by
// tiles not px). Recovered from the retired large-object-renderer.js. Unmapped species default to LO_DEFAULT_TILES.
const LO_OBJECT_TILES = {
  ancient_oak: 5, gnarled_elm: 5, strangler_fig: 5, oak: 5, spirit_tree: 5,
  banyan: 5, jungle_tree: 5, coconut_palm: 5, cypress: 5, spruce: 5,
  birch: 4, maple: 4, cherry_blossom: 4, meadow_oak: 4, beach_palm: 4,
  date_palm: 4, frost_cedar: 4, snow_pine: 4, dead_willow: 4, crystal_tree: 4,
  apple_tree: 4, baobab: 5, mangrove: 4, frozen_tree: 4,
  rowan: 4, scots_pine: 4, cliff_pine: 4, mountain_ash: 4, coastal_pine: 4,
  acacia: 4, thorny_acacia: 4, dead_tree: 4, charred_tree: 4,
  frost_willow: 4, saguaro: 3, aether_pillar: 3, ice_crystal_spire: 3,
  crystal_ice_tower: 4, stunted_pine: 3,
  standing_stone: 3, stone_monolith: 3, rock_spire: 3, ice_pillar: 3,
  obsidian_spike: 3, sandstone_arch: 3, twisted_shrub: 3,
  driftwood: 2, magma_vent: 2,
};
const LO_DEFAULT_TILES = 4;

const F4_OMIT = omitSetMap(loadCuration('f4')); // "biome/object" -> Set(omitted variant indices)
const catalog = {};
for (const biome of fs.readdirSync(FLORA)) {
  const bdir = path.join(FLORA, biome);
  if (!fs.statSync(bdir).isDirectory()) continue;
  for (const obj of fs.readdirSync(bdir)) {
    const odir = path.join(bdir, obj);
    if (!fs.statSync(odir).isDirectory()) continue;
    if (!fs.existsSync(path.join(odir, '_states'))) continue; // legacy dirs excluded
    const cap = VARIANT_CAP[biome + '/' + obj] ?? Infinity;
    const bases = fs.readdirSync(odir)
      .filter(f => /^mf__.*__v\d{3}\.png$/.test(f))
      .filter(f => parseInt(f.match(/__v(\d{3})\.png$/)[1], 10) < cap)
      .sort();
    if (!bases.length) continue;
    // Curation: drop omitted variants (non-destructive — files stay on disk).
    const omit = F4_OMIT.get(biome + '/' + obj) || new Set();
    const survEntries = bases
      .map(f => ({ f, idx: parseInt(f.match(/__v(\d{3})\.png$/)[1], 10) }))
      .filter(({ idx }) => !omit.has(idx));
    if (!survEntries.length) continue;
    const survBases = survEntries.map(e => e.f);
    const vmap = survEntries.map(e => e.idx);
    const vmapSet = new Set(vmap);
    const size = pngWidth(path.join(odir, survBases[0]));
    // state pool: union of variant indices across all state dirs, intersected with vmap
    // so omitted variants can never be selected via a state pick either.
    const pool = new Set();
    for (const st of fs.readdirSync(path.join(odir, '_states'))) {
      const sdir = path.join(odir, '_states', st);
      if (!fs.statSync(sdir).isDirectory()) continue;
      for (const f of fs.readdirSync(sdir)) {
        const m = f.match(/__v(\d{3})\.png$/);
        if (m && parseInt(m[1], 10) < cap && vmapSet.has(parseInt(m[1], 10))) pool.add(parseInt(m[1], 10));
      }
    }
    // anim variants: v dirs under anim/wind_sway with >= 9 frames
    const anims = [];
    const adir = path.join(odir, 'anim', 'wind_sway');
    if (fs.existsSync(adir)) {
      for (const vd of fs.readdirSync(adir)) {
        const m = vd.match(/^v(\d{3})$/);
        if (!m || parseInt(m[1], 10) >= cap) continue;
        const frames = fs.readdirSync(path.join(adir, vd)).filter(f => /^frame_\d{3}\.png$/.test(f));
        if (frames.length >= 9) anims.push(parseInt(m[1], 10));
      }
    }
    (catalog[biome] = catalog[biome] || []).push({
      name: obj, size,
      variants: survBases.length,
      vmap,
      statePool: [...pool].sort((a, b) => a - b),
      anims: anims.sort((a, b) => a - b),
    });
  }
}

let nTypes = 0, nAnims = 0;
for (const b in catalog) for (const o of catalog[b]) { nTypes++; nAnims += o.anims.length; }
const body = 'export var MF_CATALOG = ' + JSON.stringify(catalog, null, 1) + ';\n';
fs.writeFileSync(OUT, '// AUTO-GENERATED by scripts/gen-mf-catalog.mjs — do not edit.\n' +
  '// Regenerate as wind-sway animations land on disk.\n' + body);
console.log(`wrote ${OUT}: ${nTypes} types, ${nAnims} animated variants`);

// ---- F5 medium objects -> src/world/mo-catalog.js ----
const OBJECTS = path.join(ROOT, 'assets/pixelab/landscape_v2/micro/medium_objects');
const MO_OUT = path.join(ROOT, 'src/world/mo-catalog.js');

const F5_OMIT = omitSetMap(loadCuration('f5')); // "biome/object" -> Set(omitted variant indices)
const moCatalog = {};
for (const biome of fs.readdirSync(OBJECTS)) {
  const bdir = path.join(OBJECTS, biome);
  if (!fs.statSync(bdir).isDirectory()) continue;
  for (const obj of fs.readdirSync(bdir)) {
    const odir = path.join(bdir, obj);
    if (!fs.statSync(odir).isDirectory()) continue;
    const bases = fs.readdirSync(odir)
      .filter(f => /^mo__.*__v\d{3}\.png$/.test(f))
      .sort();
    if (!bases.length) continue;
    // Curation: drop omitted variants (non-destructive — files stay on disk).
    const omit = F5_OMIT.get(biome + '/' + obj) || new Set();
    const survEntries = bases
      .map(f => ({ f, idx: parseInt(f.match(/__v(\d{3})\.png$/)[1], 10) }))
      .filter(({ idx }) => !omit.has(idx));
    if (!survEntries.length) continue;
    const survBases = survEntries.map(e => e.f);
    const vmap = survEntries.map(e => e.idx);
    const size = pngWidth(path.join(odir, survBases[0]));
    // per-state variant lists: _states/<name> -> sorted variant indices on disk
    // (original indices; omitted indices can never be selected because vmap excludes them)
    const states = {};
    const sroot = path.join(odir, '_states');
    if (fs.existsSync(sroot)) {
      for (const st of fs.readdirSync(sroot)) {
        const sdir = path.join(sroot, st);
        if (!fs.statSync(sdir).isDirectory()) continue;
        const vs = fs.readdirSync(sdir)
          .map(f => f.match(/__v(\d{3})\.png$/))
          .filter(Boolean)
          .map(m => parseInt(m[1], 10))
          .sort((a, b) => a - b);
        if (vs.length) states[st] = vs;
      }
    }
    // anim variants: v dirs under anim/<category> with >= 9 frames (none yet — future)
    const anims = [];
    const adir = path.join(odir, 'anim', 'wind_sway');
    if (fs.existsSync(adir)) {
      for (const vd of fs.readdirSync(adir)) {
        const m = vd.match(/^v(\d{3})$/);
        if (!m) continue;
        const frames = fs.readdirSync(path.join(adir, vd)).filter(f => /^frame_\d{3}\.png$/.test(f));
        if (frames.length >= 9) anims.push(parseInt(m[1], 10));
      }
    }
    // trims/sil aligned to survBases (positional, parallel to vmap).
    const trims = trimsFor(odir, survBases);
    (moCatalog[biome] = moCatalog[biome] || []).push({
      name: obj, size,
      variants: survBases.length,
      vmap,
      trims,
      sil: silsFor(odir, survBases, trims),
      states,
      anims: anims.sort((a, b) => a - b),
    });
  }
}

let moTypes = 0, moStates = 0;
for (const b in moCatalog) for (const o of moCatalog[b]) { moTypes++; moStates += Object.keys(o.states).length; }
fs.writeFileSync(MO_OUT, '// AUTO-GENERATED by scripts/gen-mf-catalog.mjs — do not edit.\n' +
  '// Regenerate as F5 state art / animations land on disk.\n' +
  'export var MO_CATALOG = ' + JSON.stringify(moCatalog, null, 1) + ';\n');
console.log(`wrote ${MO_OUT}: ${moTypes} types, ${moStates} state sets`);

// ---- F6 large flora -> src/world/lg-catalog.js ----
const LARGE = path.join(ROOT, 'assets/pixelab/landscape_v2/micro/large_flora');
const LG_OUT = path.join(ROOT, 'src/world/lg-catalog.js');

const F6_OMIT = omitSetMap(loadCuration('f6')); // "biome/species" -> Set(omitted variant indices)
const lgCatalog = {};
if (fs.existsSync(LARGE)) {
  for (const biome of fs.readdirSync(LARGE).sort()) {
    const bdir = path.join(LARGE, biome);
    if (!fs.statSync(bdir).isDirectory()) continue;
    for (const obj of fs.readdirSync(bdir).sort()) {
      const odir = path.join(bdir, obj);
      if (!fs.statSync(odir).isDirectory()) continue;
      // W2 burst naming: plain v###.png (no lg__ prefix)
      const bases = fs.readdirSync(odir).filter(f => /^v\d{3}\.png$/.test(f)).sort();
      if (!bases.length) continue;
      // Curation: drop omitted variants from the in-game pool (non-destructive — files stay on disk).
      // survBases[i] and vmap[i] are derived in one pass so they always correspond (the parallel-array
      // contract that trims/sil also align to).
      const omit = F6_OMIT.get(biome + '/' + obj) || new Set();
      const survEntries = bases
        .map(f => ({ f, idx: parseInt(f.match(/^v(\d{3})\.png$/)[1], 10) }))
        .filter(({ idx }) => !omit.has(idx));
      if (!survEntries.length) continue;
      const survBases = survEntries.map(e => e.f);
      const vmap = survEntries.map(e => e.idx);
      const size = pngWidth(path.join(odir, survBases[0]));
      // states/anims keep ORIGINAL filename indices (membership tested vs realV at runtime; omitted indices
      // can never be selected because vmap excludes them).
      const states = {};
      const sroot = path.join(odir, '_states');
      if (fs.existsSync(sroot)) {
        for (const st of fs.readdirSync(sroot).sort()) {
          const sdir = path.join(sroot, st);
          if (!fs.statSync(sdir).isDirectory()) continue;
          // F6 states also use plain v###.png — no lg__ prefix (unlike F5's mo__…__v###.png).
          const vs = fs.readdirSync(sdir)
            .map(f => f.match(/^v(\d{3})\.png$/)).filter(Boolean)
            .map(m => parseInt(m[1], 10)).sort((a, b) => a - b);
          if (vs.length) states[st] = vs;
        }
      }
      const anims = [];
      const adir = path.join(odir, 'anim', 'wind_sway');
      if (fs.existsSync(adir)) {
        for (const vd of fs.readdirSync(adir)) {
          const m = vd.match(/^v(\d{3})$/);
          if (!m) continue;
          const frames = fs.readdirSync(path.join(adir, vd)).filter(f => /^frame_\d{3}\.png$/.test(f));
          if (frames.length >= 8) anims.push(parseInt(m[1], 10));
        }
      }
      const trims = trimsFor(odir, survBases);
      (lgCatalog[biome] = lgCatalog[biome] || []).push({
        name: obj, size,
        variants: survBases.length,
        vmap,
        trims,
        sil: silsFor(odir, survBases, trims),
        states,
        anims: anims.sort((a, b) => a - b),
        source: { dir: 'large_flora', file: 'plain' },
      });
    }
  }
}

// ---- large_objects folded into F6 (source-tagged; static, no states/anims yet) ----
const LOBJ = path.join(ROOT, 'assets/pixelab/landscape_v2/micro/large_objects');
const LOBJ_OMIT = omitSetMap(loadCuration('large_objects'));
if (fs.existsSync(LOBJ)) {
  for (const biome of fs.readdirSync(LOBJ).sort()) {
    const bdir = path.join(LOBJ, biome);
    let st; try { st = fs.statSync(bdir); } catch { continue; }
    if (!st.isDirectory() || biome.startsWith('_')) continue;
    const existing = new Set((lgCatalog[biome] || []).map((e) => e.name)); // 8 overlaps prefer large_flora
    for (const obj of fs.readdirSync(bdir).sort()) {
      const odir = path.join(bdir, obj);
      let os; try { os = fs.statSync(odir); } catch { continue; }
      if (!os.isDirectory() || existing.has(obj)) continue;
      const re = /^lg__.*__v(\d{3})\.png$/; // 3-digit to match the padded size-probe path below
      const present = fs.readdirSync(odir)
        .map((f) => { const m = f.match(re); return m ? parseInt(m[1], 10) : null; })
        .filter((v) => v !== null).sort((a, b) => a - b);
      if (!present.length) continue;
      const omit = LOBJ_OMIT.get(biome + '/' + obj) || new Set();
      const vmap = present.filter((v) => !omit.has(v));
      if (!vmap.length) continue; // fully omitted -> dropped
      const size = pngWidth(path.join(odir, `lg__${biome}__${obj}__v${String(vmap[0]).padStart(3, '0')}.png`));
      (lgCatalog[biome] = lgCatalog[biome] || []).push({
        name: obj, size, variants: vmap.length, vmap,
        tileSize: LO_OBJECT_TILES[obj] || LO_DEFAULT_TILES,
        states: {}, anims: [], trims: null, sil: null,
        source: { dir: 'large_objects', file: 'lg_prefixed', biome },
      });
    }
  }
}

let lgTypes = 0;
for (const b in lgCatalog) lgTypes += lgCatalog[b].length;
fs.writeFileSync(LG_OUT, '// AUTO-GENERATED by scripts/gen-mf-catalog.mjs — do not edit.\n' +
  '// Regenerate as the W2 tree burst lands variants/states/anims on disk.\n' +
  'export var LG_CATALOG = ' + JSON.stringify(lgCatalog, null, 1) + ';\n');
console.log(`wrote ${LG_OUT}: ${lgTypes} types`);

// ---- F2 small flora -> src/world/sf-catalog.js ----
const SF_SMALL = path.join(ROOT, 'assets/pixelab/landscape_v2/micro/small_flora');
const SF_OUT = path.join(ROOT, 'src/world/sf-catalog.js');

const F2_OMIT = omitSetMap(loadCuration('f2')); // "biome/object" -> Set(omitted variant indices)
const sfCatalog = {};
if (fs.existsSync(SF_SMALL)) {
  for (const biome of fs.readdirSync(SF_SMALL).sort()) {
    if (biome.startsWith('_')) continue;
    const bdir = path.join(SF_SMALL, biome);
    let bst; try { bst = fs.statSync(bdir); } catch { continue; }
    if (!bst.isDirectory()) continue;
    for (const obj of fs.readdirSync(bdir).sort()) {
      const odir = path.join(bdir, obj);
      let ost; try { ost = fs.statSync(odir); } catch { continue; }
      if (!ost.isDirectory()) continue;
      const re = /^sf__.*__v(\d{3})\.png$/;
      const present = fs.readdirSync(odir)
        .map(f => { const m = f.match(re); return m ? parseInt(m[1], 10) : null; })
        .filter(v => v !== null)
        .sort((a, b) => a - b);
      if (!present.length) continue;
      const omit = F2_OMIT.get(biome + '/' + obj) || new Set();
      const vmap = present.filter(v => !omit.has(v));
      // Do NOT drop fully-omitted species — emit with empty vmap so the renderer
      // can distinguish "no catalog entry" (null → full fallback) from
      // "fully culled" ([] → render nothing). Species with no base sprites on
      // disk were already skipped above (present.length check).
      (sfCatalog[biome] = sfCatalog[biome] || []).push({ name: obj, vmap });
    }
  }
}

let sfTypes = 0;
for (const b in sfCatalog) sfTypes += sfCatalog[b].length;
fs.writeFileSync(SF_OUT, '// AUTO-GENERATED by scripts/gen-mf-catalog.mjs — do not edit.\n' +
  '// Regenerate whenever _f2_curation.json changes or new sprites land on disk.\n' +
  'export var SF_CATALOG = ' + JSON.stringify(sfCatalog, null, 1) + ';\n');
console.log(`wrote ${SF_OUT}: ${sfTypes} types`);
