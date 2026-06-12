// sim/test/probe-taxonomy-coverage.test.js — the taxonomy must subsume what the pipeline
// already generated (spec §6.3: "nothing is thrown away"). Missing assets are informational.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FIELD_SHEETS, CORE_VISUAL, AXES } from '../../src/world/asset-state-taxonomy.js';

const MICRO = join(import.meta.dirname, '../../assets/pixelab/landscape_v2/micro');

/** Collect distinct `_states/<name>` dir names under micro/<diskDir>/<biome>/<archetype>/.
 *  For layout:'flat' (F3 small_scatter): states live as a root-level _states/<biome>/<archetype>/
 *  directory containing flat files named `*__state__<stateName>.png`; dirs within _states/<biome>/
 *  are archetype directories (not state dirs), so we parse filenames instead. */
function statesOnDisk(diskDir, layout) {
  const root = join(MICRO, diskDir);
  if (!existsSync(root)) return null;                       // field tree absent → skip
  const found = new Set();

  if (layout === 'flat') {
    // F3 small_scatter: _states/<biome>/<archetype>/<files named *__state__<name>.png>
    const statesRoot = join(root, '_states');
    if (!existsSync(statesRoot)) return found;              // no states generated yet
    for (const biome of readdirSync(statesRoot, { withFileTypes: true })) {
      if (!biome.isDirectory()) continue;
      const bdir = join(statesRoot, biome.name);
      for (const arch of readdirSync(bdir, { withFileTypes: true })) {
        if (!arch.isDirectory()) continue;
        const adir = join(bdir, arch.name);
        for (const f of readdirSync(adir)) {
          const m = f.match(/__state__([^.]+)\.png$/);
          if (m) found.add(m[1]);
        }
      }
    }
    return found;
  }

  // Default layout: <biome>/<archetype>/_states/<state>/
  for (const biome of readdirSync(root, { withFileTypes: true })) {
    if (!biome.isDirectory() || biome.name.startsWith('_')) continue;
    const bdir = join(root, biome.name);
    for (const arch of readdirSync(bdir, { withFileTypes: true })) {
      if (!arch.isDirectory()) continue;
      const sdir = join(bdir, arch.name, '_states');
      if (!existsSync(sdir)) continue;
      for (const st of readdirSync(sdir, { withFileTypes: true })) {
        if (st.isDirectory()) found.add(st.name);
      }
    }
  }
  return found;
}

test('probe: every on-disk state name is declared in its field sheet', () => {
  for (const [field, sheet] of Object.entries(FIELD_SHEETS)) {
    if (field === '_meta' || !sheet.diskDir) continue;
    const disk = statesOnDisk(sheet.diskDir, sheet.layout);
    if (disk === null) { console.log(`[taxonomy] ${field}: no asset tree at ${sheet.diskDir} — skipped`); continue; }
    const undeclared = [...disk].filter(s => !(s in sheet.states));
    assert.deepEqual(undeclared, [], `${field}: on-disk states missing from sheet: ${undeclared}`);
    const missing = Object.entries(sheet.states)
      .filter(([s, m]) => (m === 'E' || m === 'R') && s !== 'base' && s !== 'normal' && !disk.has(s))
      .map(([s]) => s);
    console.log(`[taxonomy] ${field}: disk=${[...disk].sort()} | declared-not-yet-on-disk=${missing.sort()}`);
  }
});

test('probe: sheet vocabularies stay inside the taxonomy', () => {
  // 'growing' admitted for F6's dedicated sapling sprite (mirrors taxonomy.test.js).
  const legal = new Set([...CORE_VISUAL, ...AXES.yield, ...AXES.damage, ...AXES.dress, 'base', 'growing']);
  for (const [field, sheet] of Object.entries(FIELD_SHEETS)) {
    if (field === '_meta') continue;
    for (const s of Object.keys(sheet.states)) assert.ok(legal.has(s), `${field}.${s}`);
  }
});
