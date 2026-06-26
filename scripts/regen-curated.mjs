#!/usr/bin/env node
/**
 * regen-curated.mjs — resumable, 10-concurrent PixelLab regeneration of the
 * F6-tree and building-dressing CURATION worklists, using the pilot-validated
 * map-object recipe (a profile/side-view 192px sprite on transparent bg).
 *
 * The validated method (proven by the 5-object pilot, do not second-guess):
 *   create   POST https://api.pixellab.ai/v2/map-objects
 *            body { description, image_size:{width,height}, view, detail,
 *                   shading, outline }  ->  { object_id, background_job_id }
 *   download GET  https://api.pixellab.ai/mcp/map-objects/<id>/download
 *            (doubles as status: 423 + JSON "{N}% complete" while processing,
 *             200 + binary PNG when completed)
 *
 * Worklists (each: .regenWorklist = [{biome, species, replaces, ...}]):
 *   f6        assets/pixelab/landscape_v2/micro/large_flora/_f6_curation.json
 *   dressing  assets/pixelab/buildings/dressing/_dressing_curation.json
 *
 * Output slots (append after the current max — survivors are NEVER overwritten):
 *   f6        <flora>/<biome>/<species>/vNNN.png        (3-digit, zero-padded)
 *   dressing  <dress>/<biome>/<prop>/base__vN.png       (unpadded)
 *
 * Deterministic QA gate (re-roll on fail, max 3 tries/item):
 *   square_tile: opaque bbox covers whole frame AND opaque-fill of bbox >= 0.85
 *   runt/blank:  opaque pixels < 0.5% OR bbox area < 25% of a 192^2 frame
 *
 * Resumable: scripts/_regen_state.json records per item
 *   {key, status:pending|done|failed, newIndex, objectId, tries}.
 *
 * CLI:
 *   node scripts/regen-curated.mjs --field <f6|dressing|all> [--limit N] [--list]
 *
 * Mirrors the auth + 429/529 exponential-backoff of scripts/bulk_generate_f6.py.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const FLORA_DIR = path.join(REPO_ROOT, "assets", "pixelab", "landscape_v2", "micro", "large_flora");
const DRESS_DIR = path.join(REPO_ROOT, "assets", "pixelab", "buildings", "dressing");
const F6_WORKLIST = path.join(FLORA_DIR, "_f6_curation.json");
const DRESS_WORKLIST = path.join(DRESS_DIR, "_dressing_curation.json");
const F6_REGISTRY = path.join(REPO_ROOT, "scripts", "asset-corpus", "registry", "f6_trees.json");
const PROMPTS_SPEC = path.join(REPO_ROOT, "docs", "superpowers", "specs", "2026-06-25-f6-regen-eval-and-prompts.md");
const MCP_JSON = path.join(REPO_ROOT, ".mcp.json");
const STATE_FILE = path.join(REPO_ROOT, "scripts", "_regen_state.json");

// REST surfaces (confirmed from the live /v2/openapi.json + a round-trip probe)
const CREATE_URL = "https://api.pixellab.ai/v2/map-objects";
const downloadUrl = (id) => `https://api.pixellab.ai/mcp/map-objects/${id}/download`;

const MAX_INFLIGHT = 10;        // HARD RULE: fixed worker pool of 10, never exceed
const SIZE = 192;               // both F6 trees and dressing props render at 192px
const MAX_TRIES = 3;            // re-roll on QA fail, max 3 tries/item
const POLL_INTERVAL = 8000;     // ms between scheduler ticks
const SUBMIT_DELAY = 1500;      // ms between create submissions
const JOB_TIMEOUT = 1200000;    // 20 min — requeue a stuck job (no try penalty)

// Fixed create params (the pilot-proven recipe)
const VIEW = "side";          // side profile reliably kills the base ground-pad (high top-down re-bakes it)
const DETAIL = "high detail";
const SHADING = "detailed shading";
const OUTLINE = "single color outline";

// ---------------------------------------------------------------------------
// auth (mirror bulk_generate_f6.py get_api_key)
// ---------------------------------------------------------------------------
function getApiKey() {
  if (process.env.PIXELLAB_API_KEY) return process.env.PIXELLAB_API_KEY;
  if (fs.existsSync(MCP_JSON)) {
    const cfg = JSON.parse(fs.readFileSync(MCP_JSON, "utf8"));
    const auth = cfg?.mcpServers?.pixellab?.headers?.Authorization || "";
    if (auth.startsWith("Bearer ")) return auth.slice(7);
  }
  console.error("No API key. Set PIXELLAB_API_KEY or check .mcp.json");
  process.exit(1);
}
const API_KEY = getApiKey();
const authHeader = { Authorization: `Bearer ${API_KEY}` };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// HTTP with 429/529 exponential backoff (mirror api_call)
// ---------------------------------------------------------------------------
async function apiCall(method, url, body) {
  const headers = { ...authHeader };
  let data;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    data = JSON.stringify(body);
  }
  let lastCode = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await fetch(url, { method, headers, body: data });
      if (resp.status === 429 || resp.status === 529) {
        lastCode = resp.status;
        const wait = 30000 * 2 ** attempt;
        console.warn(`${url}: rate limited (${resp.status}), waiting ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      let json = null;
      try { json = await resp.json(); } catch { /* non-json body */ }
      return { json, status: resp.status };
    } catch (e) {
      console.warn(`${url}: connection error ${e.message}, retry ${attempt + 1}/4`);
      await sleep(10000 * (attempt + 1));
    }
  }
  return { json: null, status: lastCode };
}

// Download endpoint: 423 (json progress) while processing, 200 (binary png) done.
async function downloadOrStatus(id) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await fetch(downloadUrl(id), { method: "GET", headers: authHeader });
      if (resp.status === 429 || resp.status === 529) {
        const wait = 30000 * 2 ** attempt;
        console.warn(`download ${id}: rate limited (${resp.status}), waiting ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      if (resp.status === 200) {
        const buf = Buffer.from(await resp.arrayBuffer());
        return { done: true, status: 200, buf };
      }
      // 423 = still generating; 404/410 = expired/gone; anything else = error
      let detail = "";
      try { detail = (await resp.json())?.detail || ""; } catch { /* ignore */ }
      return { done: false, status: resp.status, detail };
    } catch (e) {
      console.warn(`download ${id}: connection error ${e.message}, retry ${attempt + 1}/4`);
      await sleep(10000 * (attempt + 1));
    }
  }
  return { done: false, status: 0, detail: "connection-starved" };
}

// ---------------------------------------------------------------------------
// PNG decode + deterministic QA (uses @napi-rs/canvas)
// ---------------------------------------------------------------------------
let _canvasMod = null;
async function canvas() {
  if (!_canvasMod) _canvasMod = await import("@napi-rs/canvas");
  return _canvasMod;
}

/**
 * Decode PNG and compute opaque bbox + fill. Returns null if not a valid PNG.
 * QA rubric (192^2 frame):
 *   square_tile: bbox spans the whole frame (x<=4 && y<=4 && right>=188 &&
 *                bottom>=188) AND opaque-fill of bbox >= 0.85
 *   runt/blank:  opaque pixels < 0.5% of image, OR bbox area < 25% of frame
 */
async function qaPng(buf) {
  if (!buf || buf.length < 200 || buf.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    return { ok: false, reason: "not-a-png" };
  }
  let img;
  try {
    const { loadImage, createCanvas } = await canvas();
    img = await loadImage(buf);
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
    let minx = width, miny = height, maxx = -1, maxy = -1, opaque = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] >= 16) {
          opaque++;
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
        }
      }
    }
    const total = width * height;
    if (opaque === 0) return { ok: false, reason: "blank" };
    const right = maxx, bottom = maxy; // maxx/maxy are inclusive coords
    const bboxW = maxx - minx + 1, bboxH = maxy - miny + 1;
    const bboxArea = bboxW * bboxH;
    const bboxFill = opaque / bboxArea;
    const fullFrame = minx <= 4 && miny <= 4 && right >= 188 && bottom >= 188;
    // square_tile
    if (fullFrame && bboxFill >= 0.85) {
      return { ok: false, reason: `square_tile (bboxFill=${bboxFill.toFixed(3)})` };
    }
    // runt / blank
    if (opaque < total * 0.005) {
      return { ok: false, reason: `runt (opaque=${(opaque / total * 100).toFixed(2)}%)` };
    }
    if (bboxArea < total * 0.25) {
      return { ok: false, reason: `runt-bbox (area=${(bboxArea / total * 100).toFixed(1)}%)` };
    }
    return { ok: true, opaque, bbox: [minx, miny, bboxW, bboxH], bboxFill };
  } catch (e) {
    return { ok: false, reason: `decode-error: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

// Descriptions for worklist species that are NOT in the f6 registry archetypes.
// These come verbatim from scripts/bulk_generate_f6.py PROMPT_NAME_OVERRIDE —
// the descriptions originally used to generate those species.
const F6_OVERRIDE_DESC = {
  bald_cypress: "tall bald cypress tree with hanging Spanish moss",
  ancient_oak: "massive ancient gnarled oak tree",
  hollow_elm: "large hollow elm tree with a dark opening",
  banana_palm: "tall banana palm tree with large fronds",
  palm_tree: "tall tropical palm tree with coconuts",
  driftwood_tree: "weathered silvery driftwood dead tree, sculptural",
  lone_elm: "solitary wind-bent elm tree, sparse leaves",
  wind_oak: "wind-sculpted oak tree, leaning from constant wind",
  saguaro_cactus: "tall saguaro cactus with arms, desert icon",
  joshua_tree: "twisted Joshua tree with spiky fronds",
  date_palm: "tall date palm tree with hanging fruit clusters",
  field_oak: "broad spreading field oak tree, pastoral",
  charred_trunk: "charred and blackened tree trunk, still standing, volcanic",
  lava_palm: "bizarre fire-resistant palm near lava, red-orange fronds",
  crystal_tree: "crystalline magical tree, translucent glowing branches",
  glowing_ancient: "massive ancient tree with glowing magical aura and runes",
  krummholz_pine: "stunted wind-bent krummholz pine, low and twisted",
  dwarf_willow: "tiny arctic dwarf willow, ground-hugging",
  frozen_birch: "white birch tree encased in ice and frost",
  ice_pine: "frozen pine tree covered in thick icicles and snow",
  hawthorn: "thorny hawthorn tree with blossoms and red berries",
};

// Parsed once from the spec doc: per-biome tuning sentences (Section 2,
// "Per-biome / species tuning notes"). Keyed by biome; appended after {desc}.
function loadF6Registry() {
  const reg = JSON.parse(fs.readFileSync(F6_REGISTRY, "utf8"));
  const tmpl = reg.prompt_template;
  const descByName = {};
  for (const a of reg.archetypes) descByName[a.name] = a.desc;
  return { tmpl, descByName };
}

// Per-biome tuning sentences, transcribed from
// docs/superpowers/specs/2026-06-25-f6-regen-eval-and-prompts.md Section 2.
// (Only biomes the spec audited have one; others fall back to "" = base only.)
const F6_BIOME_TUNING = {
  hills:
    "The 'hills' setting is context only and must not appear — no rolling hillside, grass field, path, cottage, stream, or wildflowers; render hawthorn blossoms/berries on the tree only, never on the ground. Fill the canopy normally, do not undersize to a small floating runt.",
  beach:
    "No sand, beach, shoreline, ocean, surf, waves, dunes, shells, or starfish. For palm_tree, show the entire curving trunk from root flare to crown in profile (tall, leaning), never the flat radial fan of fronds from above. Exactly one tree — no 2x2 grids.",
  desert:
    "Desert floor transparent right up to the trunk — no sand mound, oval base patch, or circular pedestal disc, no pebbles, dead twigs, or surrounding plants. Saguaro: standing ribbed column with arms in profile, never crown-discs seen from above. One subject, no multi-trunk groves, no contact sheets.",
  savanna:
    "Never a top-down view or a symmetric radial 'tree-of-life' mandala. Acacia: slim often-leaning trunk under a wide flat-topped umbrella crown — sky/transparency must show under the umbrella between trunk and canopy. Baobab: massive swollen bottle-trunk wider than its sparse crown, trunk at least as tall as the canopy.",
  taiga:
    "Conifers: classic upright triangular Christmas-tree cone with a visible trunk and root flare at the bottom, never a round or snowflake canopy disc with the trunk as a central dot. Birch: white papery trunk visible rising through the foliage.",
  arctic:
    "No snow drifts, ice blocks, ice-crystal rubble, snowfield, or ground/shadow disc. Frost, rime, snow load, and icicles belong ON the branches and trunk, not as a scene around it. ice_pine is an upright conifer with a clear vertical trunk and pointed top, never a flat radial snowflake from above.",
  tundra:
    "No snow disc, ice patch, rock slab, stones, lichen, or flowers. Even for the prostrate krummholz mat / wind-pinned dwarf species, show the low gnarled trunk and branch structure in profile from the side, leaning with the wind — never a top-down mat or wheel of branches.",
  volcanic:
    "No basalt field, cracked terrain, lava flows/pools, embers, sky, or horizon. The molten theme lives only ON the tree — glowing cracks in the bark, charred branches, embers on the trunk — at most a small tight scorched pad under the base no wider than the trunk. One trunk and one crown, no forked double-palms.",
  mystic:
    "No glade, mist, background haze, ground shadow ring, sparkle motes, or circular/oval scene disc behind the tree — empty transparent pixels right up to the trunk, branches, and roots. crystal_tree: an upright crystalline tree with a visible twisting trunk and a crown of crystal blossoms, never a top-down kaleidoscopic burst or snowflake.",
  grassland:
    "Single trunk rising from bottom-center with visible roots, canopy stacked above for clear height — never a circular canopy with the trunk as a star-burst of spokes at the center. Critical for apple and cherry: keep their trunks tall and visible so the round blossom canopy does not collapse into a top-down pom-pom.",
};

let _f6reg = null;
function f6Prompt(biome, species) {
  if (!_f6reg) _f6reg = loadF6Registry();
  const desc =
    _f6reg.descByName[species] ||
    F6_OVERRIDE_DESC[species] ||
    species.replace(/_/g, " ");
  let prompt = _f6reg.tmpl.replace("{desc}", desc);
  const tune = F6_BIOME_TUNING[biome];
  if (tune) prompt += " " + tune;
  return prompt.replace(/\s+/g, " ").trim();
}

const DRESS_CLAUSE =
  "high fantasy pixel art, isolated on a fully transparent background, viewed straight-on to sit flat against a building wall under a high top-down game camera; render ONLY this single wall-attachment fixture by itself — no wall, no building, no shop, no storefront, no stall, no door, no window, no ground, no scenery; not slanted, not in perspective";
function dressPrompt(_biome, prop) {
  const humanized = prop.replace(/_/g, " ");
  // Lead with the object framing so the model treats it as an isolated fixture,
  // not a scene built around the name (e.g. "shop canopy" -> a whole shop).
  return `a single isolated ${humanized} fixture only — ${DRESS_CLAUSE}`;
}

// ---------------------------------------------------------------------------
// Worklist + slot allocation
// ---------------------------------------------------------------------------
function loadWorklist(field) {
  const file = field === "f6" ? F6_WORKLIST : DRESS_WORKLIST;
  const wl = JSON.parse(fs.readFileSync(file, "utf8")).regenWorklist || [];
  return wl.map((w, i) => ({
    field,
    biome: w.biome,
    species: w.species,
    replaces: w.replaces,
    // a stable, collision-free key per worklist row (a dir may host many rows)
    key: `${field}:${w.biome}/${w.species}#${w.replaces}@${i}`,
  }));
}

function itemDir(item) {
  return item.field === "f6"
    ? path.join(FLORA_DIR, item.biome, item.species)
    : path.join(DRESS_DIR, item.biome, item.species);
}

// Current max on-disk index for an item's dir (so new slots append after it).
function diskMaxIndex(item) {
  const dir = itemDir(item);
  if (!fs.existsSync(dir)) return -1;
  const re = item.field === "f6" ? /^v(\d+)\.png$/ : /^base__v(\d+)\.png$/;
  let max = -1;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

function slotPath(item, index) {
  const dir = itemDir(item);
  const name = item.field === "f6"
    ? `v${String(index).padStart(3, "0")}.png`
    : `base__v${index}.png`;
  return path.join(dir, name);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
function loadState() {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  return { items: {} };
}
let _lastSave = 0;
function saveState(state, force = false) {
  if (!force && Date.now() - _lastSave < 1500) return;
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, STATE_FILE);
  _lastSave = Date.now();
}

/**
 * Allocate the next free index for each pending item, scanning disk + already
 * allocated state indices so concurrent rows targeting the same dir never
 * collide and never overwrite a survivor.
 */
function allocateIndices(state, items) {
  // group by dir
  const byDir = new Map();
  for (const it of items) {
    const d = itemDir(it);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(it);
  }
  for (const [, group] of byDir) {
    // start cursor at disk max
    let cursor = diskMaxIndex(group[0]);
    // account for indices already allocated in state for this dir
    for (const it of group) {
      const rec = state.items[it.key];
      if (rec && typeof rec.newIndex === "number") cursor = Math.max(cursor, rec.newIndex);
    }
    for (const it of group) {
      const rec = state.items[it.key];
      if (rec && typeof rec.newIndex === "number") continue; // already allocated
      cursor += 1;
      state.items[it.key] = {
        ...(rec || {}),
        key: it.key,
        field: it.field,
        biome: it.biome,
        species: it.species,
        replaces: it.replaces,
        status: rec?.status || "pending",
        newIndex: cursor,
        objectId: rec?.objectId || null,
        tries: rec?.tries || 0,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Submit / finalize one item (each item == one PixelLab job in flight)
// ---------------------------------------------------------------------------
function buildPrompt(item) {
  return item.field === "f6"
    ? f6Prompt(item.biome, item.species)
    : dressPrompt(item.biome, item.species);
}

async function submit(item) {
  const body = {
    description: buildPrompt(item),
    image_size: { width: SIZE, height: SIZE },
    view: VIEW,
    detail: DETAIL,
    shading: SHADING,
    outline: OUTLINE,
  };
  return apiCall("POST", CREATE_URL, body);
}

// ---------------------------------------------------------------------------
// Main worker-pool loop (<=10 in flight, resumable)
// ---------------------------------------------------------------------------
async function run(field, limit, listOnly) {
  const fields = field === "all" ? ["f6", "dressing"] : [field];
  const allItems = [];
  for (const f of fields) allItems.push(...loadWorklist(f));

  if (listOnly) {
    const counts = {};
    for (const f of fields) counts[f] = allItems.filter((i) => i.field === f).length;
    console.log("Worklist counts:");
    for (const f of fields) console.log(`  ${f}: ${counts[f]}`);
    console.log(`  total: ${allItems.length}`);
    return;
  }

  const state = loadState();
  allocateIndices(state, allItems);
  saveState(state, true);

  // pending = not done and not failed; honor --limit (first N pending)
  let pending = allItems.filter((it) => {
    const s = state.items[it.key]?.status;
    return s !== "done" && s !== "failed";
  });
  if (typeof limit === "number") pending = pending.slice(0, limit);

  console.log(
    `regen-curated: field=${field} pending=${pending.length}` +
      (typeof limit === "number" ? ` (limited to ${limit})` : "") +
      ` | pool=${MAX_INFLIGHT}`
  );
  if (pending.length === 0) {
    console.log("Nothing to do (all selected items already done/failed).");
    return;
  }

  const queue = [...pending];
  const inflight = new Map(); // key -> {item, objectId, submittedAt}

  // Re-adopt any items left 'queued' with an objectId from a prior crash.
  for (const it of queue.slice()) {
    const rec = state.items[it.key];
    if (rec?.status === "queued" && rec.objectId) {
      inflight.set(it.key, { item: it, objectId: rec.objectId, submittedAt: Date.now() });
      const qi = queue.indexOf(it);
      if (qi >= 0) queue.splice(qi, 1);
    }
  }

  const remaining = () => queue.length + inflight.size;

  while (remaining() > 0) {
    // ---- fill the pool (never exceed MAX_INFLIGHT) ----
    while (inflight.size < MAX_INFLIGHT && queue.length > 0) {
      const it = queue.shift();
      const rec = state.items[it.key];
      const { json, status } = await submit(it);
      const objectId = json?.object_id;
      if (objectId) {
        rec.objectId = objectId;
        rec.status = "queued";
        rec.tries = (rec.tries || 0) + 1;
        inflight.set(it.key, { item: it, objectId, submittedAt: Date.now() });
        console.log(`submit ${it.biome}/${it.species}#${it.replaces} -> v${rec.newIndex} (${objectId}) try ${rec.tries}`);
      } else {
        // create failed: definitive errors penalize; 429/529/connection do not
        if (![429, 529, 0].includes(status)) {
          rec.tries = (rec.tries || 0) + 1;
          if (rec.tries >= MAX_TRIES) {
            rec.status = "failed";
            console.error(`${it.key}: create failed permanently (HTTP ${status})`);
          } else {
            queue.push(it); // retry later
          }
        } else {
          queue.unshift(it); // transient — retry without penalty
          saveState(state);
          break; // API saturated: stop submitting, go poll
        }
      }
      saveState(state);
      await sleep(SUBMIT_DELAY);
    }

    if (inflight.size === 0) {
      if (queue.length === 0) break;
      await sleep(POLL_INTERVAL);
      continue;
    }

    await sleep(POLL_INTERVAL);

    // ---- poll each in-flight job ----
    for (const [key, info] of [...inflight.entries()]) {
      const { item, objectId } = info;
      const rec = state.items[key];
      const res = await downloadOrStatus(objectId);
      if (!res.done) {
        if ([404, 410].includes(res.status)) {
          // expired/gone — requeue a fresh generation if tries remain
          inflight.delete(key);
          if ((rec.tries || 0) >= MAX_TRIES) {
            rec.status = "failed";
            console.error(`${key}: object expired/gone (HTTP ${res.status}), out of tries`);
          } else {
            rec.status = "pending";
            rec.objectId = null;
            queue.push(item);
          }
        } else if (Date.now() - info.submittedAt > JOB_TIMEOUT) {
          // stuck — requeue WITHOUT a try penalty (a slow queue isn't the item's fault)
          console.warn(`${key}: stuck ${Math.round((Date.now() - info.submittedAt) / 1000)}s -> requeue`);
          inflight.delete(key);
          rec.status = "pending";
          rec.objectId = null;
          queue.push(item);
        }
        // else 423 still generating — leave in flight
        continue;
      }

      // ---- downloaded: QA gate ----
      inflight.delete(key);
      const qa = await qaPng(res.buf);
      if (qa.ok) {
        const dest = slotPath(item, rec.newIndex);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, res.buf);
        rec.status = "done";
        rec.objectId = objectId;
        console.log(`DONE  ${item.biome}/${item.species} -> ${path.relative(REPO_ROOT, dest)} (fill=${qa.bboxFill.toFixed(2)})`);
      } else {
        console.warn(`QA REJECT ${item.biome}/${item.species} (${qa.reason}) try ${rec.tries}/${MAX_TRIES}`);
        if ((rec.tries || 0) >= MAX_TRIES) {
          rec.status = "failed";
          console.error(`${key}: failed QA permanently after ${rec.tries} tries`);
        } else {
          rec.status = "pending";
          rec.objectId = null;
          queue.push(item); // re-roll (new create call)
        }
      }
      saveState(state);
    }
    saveState(state);
  }

  saveState(state, true);
  // summary
  const sel = pending.map((it) => state.items[it.key]);
  const done = sel.filter((r) => r.status === "done").length;
  const failed = sel.filter((r) => r.status === "failed").length;
  console.log(`\n=== regen complete: ${done} done, ${failed} failed, of ${pending.length} processed ===`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const a = { field: null, limit: null, list: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--field") a.field = argv[++i];
    else if (t === "--limit") a.limit = parseInt(argv[++i], 10);
    else if (t === "--list") a.list = true;
  }
  return a;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.field || !["f6", "dressing", "all"].includes(args.field)) {
    console.error("Usage: node scripts/regen-curated.mjs --field <f6|dressing|all> [--limit N] [--list]");
    process.exit(2);
  }
  await run(args.field, args.list ? null : args.limit, args.list);
})();
