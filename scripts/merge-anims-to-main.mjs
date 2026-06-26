#!/usr/bin/env node
/**
 * merge-anims-to-main.mjs — ADD-ONLY copy of this worktree's generated F6
 * anim/state frames into the MAIN repo's large_flora tree, WITHOUT ever
 * overwriting or deleting anything main already has.
 *
 * WHY ADD-ONLY (the one rule): two workstreams touch the same tree but disjoint
 * files —
 *   - MAIN (upscale pipeline): adds  ...@384.png  files next to the originals
 *     (base + anim + state) and a _upscaled.json manifest. These exist ONLY on
 *     main and are hours of GPU work.
 *   - THIS worktree: adds the missing SOURCE anim frames + state sprites under
 *     anim/ and _states/ (plain frame_NNN.png / vNNN.png, never @384). These
 *     exist ONLY here and are hours of PixelLab work.
 * No single file is written by both. So the merge is a UNION: copy our net-new
 * files in, never replace an existing file, never mirror/purge/clean.
 *
 * This script ONLY copies *.png that DO NOT already exist in main. It NEVER:
 *   - overwrites an existing file (skips it),
 *   - deletes anything,
 *   - touches any @384 file (we never produce them),
 *   - copies _upscaled.json (main's; regenerated there),
 *   - copies _f6_state.json (see the WARNING it prints — that JSON is stale and
 *     belongs to a different generator; the upscaler gate is disk-first anyway).
 *
 * DRY-RUN BY DEFAULT. Prints the exact net-new file list + asserts 0 overwrites.
 * Pass --apply to actually copy. Pass --limit N to cap (testing).
 *
 *   node scripts/merge-anims-to-main.mjs            # dry run (default)
 *   node scripts/merge-anims-to-main.mjs --apply    # perform the add-only copy
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WT_ROOT = path.resolve(__dirname, "..");                       // this worktree
// main repo = the worktree's parent-of-parent-of-parent (…/default/.claude/worktrees/field-curation → …/default)
const MAIN_ROOT = path.resolve(WT_ROOT, "..", "..", "..");
const REL_FLORA = path.join("assets", "pixelab", "landscape_v2", "micro", "large_flora");
const WT_FLORA = path.join(WT_ROOT, REL_FLORA);
const MAIN_FLORA = path.join(MAIN_ROOT, REL_FLORA);

const APPLY = process.argv.includes("--apply");
const limIdx = process.argv.indexOf("--limit");
const LIMIT = limIdx >= 0 ? parseInt(process.argv[limIdx + 1], 10) : Infinity;

// Hard guards: refuse to run if the main tree isn't where we expect.
function assertSanity() {
  if (!fs.existsSync(WT_FLORA)) { console.error(`FATAL: worktree flora not found: ${WT_FLORA}`); process.exit(1); }
  if (!fs.existsSync(MAIN_FLORA)) { console.error(`FATAL: main flora not found: ${MAIN_FLORA}`); process.exit(1); }
  if (path.resolve(WT_FLORA) === path.resolve(MAIN_FLORA)) {
    console.error("FATAL: worktree and main flora resolve to the SAME path — refusing (would be a no-op/foot-gun).");
    process.exit(1);
  }
}

// Recursively list every *.png under a dir, returned as paths relative to that dir.
function listPngs(root) {
  const out = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith(".png")) out.push(path.relative(root, p));
    }
  })(root);
  return out;
}

// We only ever copy SOURCE frames/sprites we produce: plain *.png that are NOT @384.
// (Belt-and-suspenders: we never generate @384, but exclude it explicitly so a copy
// can never carry an upscale file in either direction.)
// Exclude a stray dressing prop that got misfiled under flora (not a tree) — must
// not be carried into main's flora tree.
const EXCLUDE_SPECIES = new Set(["hills/fringed_shop_canopy"]);

function isOurArtifact(rel) {
  if (rel.includes("@384")) return false;                 // never touch upscale outputs
  const parts = rel.split(path.sep);
  if (EXCLUDE_SPECIES.has(`${parts[0]}/${parts[1]}`)) return false;
  // only anim frames and state/base sprites
  const base = path.basename(rel);
  return /^frame_\d{3}\.png$/.test(base) || /^v\d{3}\.png$/.test(base) || /^lg__.*v\d{3}\.png$/.test(base);
}

function copyAddOnly(rel) {
  const src = path.join(WT_FLORA, rel);
  const dst = path.join(MAIN_FLORA, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  // copyFile with COPYFILE_EXCL: fails if dst exists -> guarantees never-overwrite.
  fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
}

function main() {
  assertSanity();
  console.log(`worktree flora : ${WT_FLORA}`);
  console.log(`main flora     : ${MAIN_FLORA}`);
  console.log(`mode           : ${APPLY ? "APPLY (add-only copy)" : "DRY RUN (no writes)"}${LIMIT !== Infinity ? `  limit=${LIMIT}` : ""}\n`);

  console.log("scanning trees…");
  const wt = new Set(listPngs(WT_FLORA).filter(isOurArtifact));
  const mainSet = new Set(listPngs(MAIN_FLORA)); // ALL main pngs (incl @384) — for existence check

  const toAdd = [];        // net-new (in worktree, absent from main)
  const overwriteHits = []; // exist in both (we will SKIP — must be 0 copies)
  for (const rel of wt) {
    if (mainSet.has(rel)) overwriteHits.push(rel);
    else toAdd.push(rel);
  }
  toAdd.sort();

  // group net-new by species for a readable summary
  const bySpecies = {};
  for (const rel of toAdd) {
    const parts = rel.split(path.sep);
    const key = `${parts[0]}/${parts[1]}`;
    bySpecies[key] = (bySpecies[key] || 0) + 1;
  }

  console.log(`\n=== ADD-ONLY MERGE PLAN ===`);
  console.log(`worktree source PNGs (anim/state/base, non-@384): ${wt.size}`);
  console.log(`already present in main (will SKIP, never overwrite): ${overwriteHits.length}`);
  console.log(`NET-NEW to add into main: ${toAdd.length}\n`);
  console.log(`net-new by species (${Object.keys(bySpecies).length} species):`);
  for (const k of Object.keys(bySpecies).sort()) console.log(`  ${k}: +${bySpecies[k]}`);

  console.log(`\nsample of net-new files (first 8):`);
  toAdd.slice(0, 8).forEach((r) => console.log(`  + ${r.split(path.sep).join("/")}`));

  // ---- bookkeeping-file WARNINGS (handled by humans/agents, NOT this script) ----
  console.log(`\n=== BOOKKEEPING FILES (this script does NOT copy these) ===`);
  console.log(`  _upscaled.json  : main's only — DO NOT copy; regenerate on main`);
  console.log(`                    (node scripts/tree-upscale/gen-upscale-manifest.mjs) after upscaling.`);
  console.log(`  _f6_state.json  : ⚠ the worktree's copy is STALE and from a DIFFERENT generator`);
  console.log(`                    (bulk_generate_f6.py). The real progress lives in`);
  console.log(`                    scripts/_states_anims_state.json. Do NOT blind-copy _f6_state.json`);
  console.log(`                    to main — it would under-report completion and make the upscaler's`);
  console.log(`                    --ready gate SKIP the newly-arrived types. Instead run the upscaler`);
  console.log(`                    disk-first (no --ready / no state file), or rebuild _f6_state.json`);
  console.log(`                    on main from disk after this copy.`);

  if (!APPLY) {
    console.log(`\nDRY RUN complete. Nothing was written. Re-run with --apply to copy the ${toAdd.length} net-new files.`);
    console.log(`(Every copy uses COPYFILE_EXCL — it is physically impossible to overwrite an existing file.)`);
    return;
  }

  // ---- APPLY ----
  console.log(`\n=== APPLYING add-only copy (${Math.min(toAdd.length, LIMIT)} files) ===`);
  let copied = 0, skipped = 0, errors = 0;
  for (const rel of toAdd) {
    if (copied >= LIMIT) break;
    try { copyAddOnly(rel); copied++; }
    catch (e) {
      if (e.code === "EEXIST") { skipped++; } // raced — main got it first; never overwrite
      else { errors++; console.error(`  ERROR ${rel}: ${e.message}`); }
    }
    if (copied % 500 === 0) console.log(`  …${copied} copied`);
  }
  console.log(`\nDONE: copied ${copied}, skipped-existing ${skipped}, errors ${errors}.`);
  console.log(`Overwrites: 0 (guaranteed by COPYFILE_EXCL).`);
  console.log(`\nNEXT (per the coordination plan):`);
  console.log(`  1. let main's upscaler --watch pick up the now-complete types -> @384`);
  console.log(`  2. regenerate _upscaled.json on main`);
  console.log(`  3. rebuild/refresh _f6_state.json on main from disk (do NOT use the worktree's)`);
  console.log(`  4. commit assets on main; cherry-pick the worktree's code commits`);
}

main();
