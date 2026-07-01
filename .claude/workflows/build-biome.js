export const meta = {
  name: 'build-biome',
  description: 'Autonomously build a biome tile-corpus to DONE: per-material states+anims+gable, roofs, then verify — no human check-ins, PixelLab throttled to <=6 concurrent jobs',
  whenToUse: 'After biomes are onboarded (manifest doc + ledger + dirs + wiring). Pass args = [{biome, materials:[slug...], window_anim:"shutters"|"glow"}, ...] (read from assets/pixelab/buildings/manifest/biome-build-config.json by the caller — the workflow sandbox has no fs). Runs the building-tile-pipeline end-to-end per Rule -1 (autonomy contract): gate every object, re-roll on >25% holes, sensible defaults, never pause. Throttled: materials run 2-at-a-time (<=6 PixelLab jobs peak), biomes + roofs serial.',
  phases: [
    { title: 'Materials', detail: 'per biome, 2 wall materials at a time: base?→states→derive/flip→door+window anim→gable (disk-driven, idempotent)' },
    { title: 'Roofs', detail: 'one biome at a time: 4 roof tilesets → solidify → 4 variants/slug' },
    { title: 'Verify', detail: 'tracker + qa + an opinionated contact-sheet review per biome' },
  ],
};

// args = [{biome, materials:[...], window_anim}] (preferred) OR ["biome", ...] (legacy; materials then unknown → error).
let _raw = args;
if (typeof _raw === 'string') { try { _raw = JSON.parse(_raw); } catch { _raw = [_raw]; } }
const list = (Array.isArray(_raw) ? _raw : [_raw]).flatMap((b) => {
  if (typeof b === 'string' && b.trim().startsWith('[')) { try { return JSON.parse(b); } catch { return [b]; } }
  return [b];
}).map((b) => (typeof b === 'string' ? { biome: b, materials: [], window_anim: 'shutters' } : b))
  .filter((b) => b && b.biome);
if (!list.length) { log('no biome passed'); return { error: 'pass args=[{biome,materials,window_anim}]' }; }
const bad = list.filter((b) => !b.materials || !b.materials.length);
if (bad.length) { log('missing materials for: ' + bad.map((b) => b.biome).join(', ')); return { error: 'each biome needs materials[] (read biome-build-config.json and pass it)' }; }
log('building: ' + list.map((b) => `${b.biome}[${b.materials.length}]`).join(', '));

// Concurrency limiter: run fn over items at most `limit` at once (tighter than the runtime's agent cap, to bound PixelLab jobs).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  const worker = async () => { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const MATERIAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { material: { type: 'string' }, done: { type: 'boolean' }, tiles: { type: 'number' }, notes: { type: 'string' }, rerolled: { type: 'array', items: { type: 'string' } } },
  required: ['material', 'done', 'notes'],
};

const matPrompt = (biome, mat, windowAnim) => `You are autonomously building ONE wall material for a 2.5D pixel-art game's building tile-corpus, following the \`building-tile-pipeline\` SKILL and its Rule -1 AUTONOMY CONTRACT (drive to done, NEVER ask for approval, gate + re-roll yourself).

BIOME: ${biome}   MATERIAL: ${mat}
Read the vocab from \`docs/superpowers/specs/2026-06-24-${biome}-tile-corpus-manifest.md\` (biome tokens {FOUNDATION}{DOOR}{WINDOW}{WALLPLATE} + this material's MATERIAL_FACE / MATERIAL_EDGE / MATERIAL_PHRASE).
The base OBJECT id (if any) is in \`assets/pixelab/buildings/tiles/${biome}/_pixellab_ids.json\` → materials.${mat}.base. Tiles live in \`assets/pixelab/buildings/tiles/${biome}/${mat}/\`. Check disk FIRST and only do what is MISSING (idempotent).

THROTTLE: keep your OWN concurrent PixelLab jobs LOW — fire the 3 states together (one batch), but do NOT also fire anims/gable in the same batch; another wall material is building in parallel and the shared cap is ~6 jobs.

STEPS (use the MCP pixellab tools via ToolSearch, and the repo scripts):
1. BASE — if \`ground_plain__v0.png\` is missing: create_1_direction_object (size 256, view sidescroller) from {WALLPLATE}/{MATERIAL_FACE}/{FOUNDATION}; ALSO append to the description "the wall texture runs CLEANLY and flush to all four edges with NO black outline, NO dark border/rim around the tile" (a partial help — PixelLab still bakes some edge outline, fix-tile-edges in step 3b cleans the rest). then \`node scripts/pl-await.mjs <id> .../ground_plain__v0.png --max-holes 25\`. If it prints HIGH_HOLES (exit 2), RE-ROLL the base (up to 3x) — pale walls alpha-matte; never ship >25% holes. GATE the look: it must read as ONE solid continuous wall, never a grid of window-like panels; if it does, re-roll with a tighter "one continuous wall, NOT panels" prompt. Record the new base id.
2. STATES — create_object_state of the base id x3 (fire as one batch): ground_window (the {WINDOW}, "cut ONLY the small window, do NOT repaint the wall, keep it fully opaque", + a seed), ground_door (the {DOOR}, STRONG "carve the door INTO the wall; the wall stays a COMPLETE fully-opaque rectangle filling the whole tile, only the opening shows the door; reaches the ground"), ground_left_corner ({MATERIAL_EDGE}, "clean finished FLAT wall END, not a 3D corner, flush to the eave cap"). For each: \`node scripts/pl-await.mjs <id> .../ground_<state>__v0.png\` (it de-magentas + solidifies + gates; re-roll a state >25% holes).
3. DERIVE + FLIP (Bash, no PixelLab): \`derive-upper.mjs\` ground_plain/window/left_corner -> upper_*; \`flip-h.mjs\` left->right corners (ground + upper). Convention: ground_left_corner = END on the LEFT (verify vs grassland; if the gen put the END on the right, save it as ground_right_corner and flip-h to make left).
3b. EDGE + DIM FIX (Bash, no PixelLab, MANDATORY): \`node scripts/fix-tile-edges.mjs <matDir>\` — de-outlines the baked near-black edge line off every wall tile (PixelLab bakes a dark edge outline that renders as a black BUILDING-edge / mirror seam; this extends the wall texture over it, preserving dims + the shaped edge, NEVER truncating) AND scales every window/door/corner state to the ground_plain dims (solidify can leave a state a different size → apertures don't line up). Run this BEFORE the door synth so the synth gets matched ground_door/ground_plain dims (mismatched dims are what made the synth degenerate before).
4. DOOR ANIM — CODE-SYNTH, NO PixelLab (v3 animate_object is RETIRED for doors: it bakes sparkles / scanline streaks / wall-melt into the opening frames and qa can't reliably catch them). Just run \`node scripts/door-swing-anim.mjs <matDir>\` — it locates the door by diffing ground_door vs ground_plain and synthesizes a clean swing (wall/eave/footing/frame static, leaf foreshortens into a plain dark interior, frame_000 == the shut door). Output dims already match the static tile → NO normalize/fit/freeze needed. Saves a job, zero artifacts.
5. WINDOW ANIM — this biome = ${windowAnim}: ${windowAnim === 'shutters'
  ? 'animate_object the window state ("the two board shutters swing closed meeting in the middle, wall+frame+sill stay still"), get_object → INNER anim id, pl-await --anim, then normalize+fit+freeze.'
  : 'NO moving parts → code glow-pulse (no PixelLab): `node scripts/glow-pulse-anim.mjs .../ground_window__v0.png .../anim/window`, then `fit-anim-frames <matDir> window` + `freeze-anim-band <matDir> window 0.18`.'}
6. GABLE (TILE): create_tiles_pro({description:"1).<MATERIAL_FACE clause> 2).+tie-beam 3).weathered 4).+vent", tile_type:"square_topdown", tile_view:"top-down", outline_mode:"segmentation", tile_size:64, seed}); poll get_tiles_pro; download a clean plain tile, de-magenta + solidify, place as \`gable__v0.png\`.
7. RECORD every id into _pixellab_ids.json (materials.${mat}: base/ground_window/ground_door/ground_left_corner/gable + window anim id); run \`node scripts/qa-frames.mjs <matDir>\` (window anim), \`node scripts/qa-proportions.mjs ${biome}\`, and \`node scripts/qa-edges.mjs ${biome}\`. PROPORTION GATE (hard, this material): if it FAILs "tiny door" or "door floating above the footing", the base footing is too tall and/or the door state did not cut to the ground → RE-ROLL the BASE with a LOW {FOUNDATION} (a thin footing course ~12-18% of the tile, NOT half the wall) AND regenerate the door state with "the door cuts THROUGH the footing down to the GROUND, no stone/footing course remains below the door, the door fills most of the wall height". Then re-derive + re-synth the door. EDGE GATE: if qa-edges FAILs a corner ">X% black" even after fix-tile-edges (a too-dark quoin/edge wider than the de-outline cap), RE-ROLL that material's corner state (+ base if needed) with {MATERIAL_EDGE} as a MID-grey edge ("never near-black, a cool MID grey-stone quoin, no black rim"), then re-derive/flip + re-run fix-tile-edges. Return when every tile + window anim + synth door + gable are on disk and qa-frames / qa-proportions / qa-edges all pass for this material.`;

phase('Materials');
const matResults = {};
for (const { biome, materials, window_anim } of list) {
  matResults[biome] = await mapLimit(materials, 2, (mat) =>
    agent(matPrompt(biome, mat, window_anim || 'shutters'), { label: `${biome}:${mat}`, phase: 'Materials', schema: MATERIAL_SCHEMA }));
}

phase('Roofs');
const ROOF_SCHEMA = { type: 'object', additionalProperties: false, properties: { biome: { type: 'string' }, slugsDone: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } }, required: ['biome', 'slugsDone', 'notes'] };
const roofResults = await mapLimit(list, 1, ({ biome }) => agent(
  `Autonomously generate the ROOF tiles for biome ${biome} per the building-tile-pipeline skill (roofs are TILES, create_tiles_pro segmentation). FIRST check disk: \`ls assets/pixelab/buildings/roof/${biome}/*/roof_top__v000.png\` — SKIP any roof slug that already has roof_top__v000.png (idempotent); only generate MISSING slugs. Read the 4 roof slugs + their prompts from \`docs/superpowers/specs/2026-06-24-${biome}-tile-corpus-manifest.md\`. For EACH MISSING slug: create_tiles_pro({description: the slug's roof prompt numbered as 4 subtle variants, tile_type:"square_topdown", tile_view:"top-down", outline_mode:"segmentation", tile_size:64, seed}); poll get_tiles_pro; download 4 tiles; \`solidify\` each (a holey roof shows sky/grass through); place as \`assets/pixelab/buildings/roof/${biome}/<slug>/roof_top__v000..v003.png\`. SEAM-RIB GOTCHA: if a slug's prompt describes standing-seams / ribs / corrugation / riveted strips and the tiles come back as sparse thin strips floating in transparency (low % opaque, solidify crops them narrow), segmentation mapped the "seams" to discrete strips — REFRAME the prompt as a packed FIELD of rectangular panels (the proven shingle/shake structure) with the seams demoted to shallow grooves, new seed, re-roll until 100% opaque full-bleed. Record ids in tiles/${biome}/_pixellab_ids.json roofs. THROTTLE: you are the only roof job running — fire your 4 tilesets together is fine. Do NOT ask — build all 4 slugs.`,
  { label: `roofs:${biome}`, phase: 'Roofs', schema: ROOF_SCHEMA }));

phase('Verify');
const VERIFY_SCHEMA = { type: 'object', additionalProperties: false, properties: { biome: { type: 'string' }, tracker: { type: 'string' }, issues: { type: 'array', items: { type: 'string' } }, verdict: { type: 'string', enum: ['ship', 'needs-fix'] } }, required: ['biome', 'tracker', 'verdict'] };
const verify = await parallel(list.map(({ biome }) => () => agent(
  `Verify biome ${biome} is DONE: run \`node scripts/desert-pilot-status.mjs ${biome}\` (PROGRESS + NEXT ACTIONS), \`node scripts/qa-frames.mjs assets/pixelab/buildings/tiles/${biome}\` (window anim), \`node scripts/qa-proportions.mjs ${biome}\` (door/footing proportions), and \`node scripts/qa-edges.mjs ${biome}\` (baked black edge-line + state-dim mismatch) — any FAIL is a real defect to regenerate/refix. Then make a contact-sheet montage (\`node scripts/_wall-montage.mjs ${biome}\` → tools/_wallmontage_${biome}.png) and a door-anim montage (\`node scripts/_door-montage.mjs ${biome} door\`) and READ both, plus mirror-tile each plain wall. OPINIONATED VISUAL CHECKLIST — flag (and regenerate) any of:
   • DOOR too small / floating above a tall footing — the door must be near-full wall height and cut to the GROUND (this is the #1 issue the user catches; trust qa-proportions FAILs).
   • FOUNDATION/footing is a gigantic band eating the wall so the building reads stubby — footing should be a modest course (~12-20%).
   • WALL reads as a flat regular GRID of identical panels / window-like cells instead of one solid masonry/timber surface.
   • Stray bright SPARKLES / asterisks / scanline STREAKS anywhere in a tile or a door/window anim frame.
   • see-through / blown-out / near-white-dissolved face; broken mirror seam.
  Give a verdict ship | needs-fix with the specific materials + fix. Be opinionated; only flag real problems.`,
  { label: `verify:${biome}`, phase: 'Verify', schema: VERIFY_SCHEMA })));

return { materials: matResults, roofs: roofResults.filter(Boolean), verify: verify.filter(Boolean) };
