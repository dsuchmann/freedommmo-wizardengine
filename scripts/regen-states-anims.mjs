#!/usr/bin/env node
/**
 * regen-states-anims.mjs — resumable, 10-concurrent PixelLab generation of the
 * two MISSING F6 large-flora asset layers:
 *
 *   ANIMS  wind_sway 8-frame animations for EVERY surviving tree variant
 *          (every index in each species' LG_CATALOG.vmap; ~1,320 total).
 *          REST: POST {API_BASE}/animate-with-text-v3
 *                body { first_frame:{base64,format:"png"}, action, frame_count,
 *                       no_background:true } -> { background_job_id }
 *          poll  GET  {API_BASE}/background-jobs/{job_id}  -> status "completed",
 *                frames in last_response.frames | .images (url or base64).
 *          out   <flora>/<biome>/<species>/anim/wind_sway/v<NNN>/frame_<NNN>.png
 *                (both 3-digit zero-padded, 8 frames).
 *
 *   STATES registry 7-set lifecycle states for the ~24 species that have NONE
 *          (+3 fruit states for fruiting archetypes). Each state is a
 *          create_object_state-style edit of a GOOD survivor base (the FIRST
 *          vmap index).
 *          REST: POST {API_BASE}/edit-images-v2
 *                body { method:"edit_with_text",
 *                       edit_images:[{image:{base64},width,height}],
 *                       image_size:{width,height}, description, no_background:true }
 *                -> { background_job_id }
 *          poll  same background-jobs endpoint; output PNG in last_response.images[0].
 *          out   <flora>/<biome>/<species>/_states/<state>/v<NNN>.png
 *                (NNN = the survivor index that was edited).
 *
 * Engineering mirrors scripts/regen-curated.mjs (auth from .mcp.json, the
 * 10-worker pool, 429/529 exponential backoff, resumable state file, QA on
 * download). State edits/anims are ASYNC background jobs (unlike map-objects),
 * so each in-flight slot polls background-jobs/{id} until completed.
 *
 * Resumable: scripts/_states_anims_state.json records per job
 *   {key, kind:anim|state, status:pending|queued|done|failed, jobId, tries}.
 * Jobs already complete on disk are marked done without re-generating.
 *
 * CLI:
 *   node scripts/regen-states-anims.mjs --kind <anims|states|all> [--limit N] [--list]
 *
 * NOTE: hills/fringed_shop_canopy is a MISFILED building-dressing prop that
 * landed in the flora tree dir; it is NOT a real tree and is excluded from both
 * wind_sway anims and tree lifecycle states (honest-content / no-mock rule).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LG_CATALOG } from "../src/world/lg-catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const FLORA_DIR = path.join(REPO_ROOT, "assets", "pixelab", "landscape_v2", "micro", "large_flora");
const F6_REGISTRY = path.join(REPO_ROOT, "scripts", "asset-corpus", "registry", "f6_trees.json");
const MCP_JSON = path.join(REPO_ROOT, ".mcp.json");
const STATE_FILE = path.join(REPO_ROOT, "scripts", "_states_anims_state.json");

// REST surfaces (confirmed from scripts/bulk_generate_f6.py submit_anim/submit_state)
const API_BASE = "https://api.pixellab.ai/v2";
const ANIM_URL = `${API_BASE}/animate-with-text-v3`;
const EDIT_URL = `${API_BASE}/edit-images-v2`;
const jobUrl = (id) => `${API_BASE}/background-jobs/${id}`;

const MAX_INFLIGHT = 10;        // HARD RULE: fixed worker pool of 10, never exceed
const SIZE = 192;               // F6 large flora is 192px
const MAX_TRIES = 3;            // re-roll on QA fail, max 3 tries/item
const ANIM_FRAMES = 8;          // wind_sway: 8 frames required on disk
const POLL_INTERVAL = 15000;    // ms between scheduler ticks (anim jobs are slow)
const SUBMIT_DELAY = 1500;      // ms between create submissions
const JOB_TIMEOUT = 1800000;    // 30 min — requeue a stuck job (no try penalty)

// Excluded: a misfiled dressing prop, not a tree.
const EXCLUDE_SPECIES = new Set(["fringed_shop_canopy"]);

// ---------------------------------------------------------------------------
// auth (mirror regen-curated.mjs / bulk_generate_f6.py get_api_key)
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

// Fetch an arbitrary URL to a Buffer (for frame/image URLs in job responses).
async function fetchBytes(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (f6-states-anims)" } });
      if (resp.status === 200) return Buffer.from(await resp.arrayBuffer());
      if (resp.status === 429 || resp.status === 529) { await sleep(10000 * (attempt + 1)); continue; }
      return null;
    } catch (e) {
      console.warn(`fetch ${url}: ${e.message} retry ${attempt + 1}/3`);
      await sleep(5000);
    }
  }
  return null;
}

// Decode a job response "frame" entry (string url/base64 or {url|src|base64}) to a Buffer.
async function frameToBuffer(fr) {
  if (typeof fr === "string") {
    if (fr.startsWith("http")) return await fetchBytes(fr);
    try { return Buffer.from(fr.split("base64,").pop(), "base64"); } catch { return null; }
  }
  if (fr && typeof fr === "object") {
    const url = fr.url || fr.src;
    if (url) return await fetchBytes(url);
    const b64 = fr.base64 || fr.image?.base64;
    if (typeof b64 === "string") {
      try { return Buffer.from(b64.split("base64,").pop(), "base64"); } catch { return null; }
    }
  }
  return null;
}

// Pull the frame/image list out of a completed background-job payload.
function extractFrames(job) {
  const last = job?.last_response || {};
  let frames = last.frames || last.images || [];
  if (!frames.length) {
    for (const v of Object.values(last)) {
      if (Array.isArray(v) && v.length >= 4) { frames = v; break; }
    }
  }
  return frames;
}

// ---------------------------------------------------------------------------
// PNG decode + deterministic QA (magic bytes + alpha coverage), via @napi-rs/canvas
// ---------------------------------------------------------------------------
let _canvasMod = null;
async function canvas() {
  if (!_canvasMod) _canvasMod = await import("@napi-rs/canvas");
  return _canvasMod;
}

/**
 * Valid, non-blank PNG with non-trivial (and non-full-bleed) alpha coverage.
 * Floor 0.3% so legitimately-sparse seedling states pass; ceiling 0.98 so a
 * solid square (no transparency = a tile, not a sprite) is rejected.
 */
async function qaPng(buf) {
  if (!buf || buf.length < 200 || buf.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    return { ok: false, reason: "not-a-png" };
  }
  try {
    const { loadImage, createCanvas } = await canvas();
    const img = await loadImage(buf);
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] >= 16) opaque++;
    const total = width * height;
    if (opaque < total * 0.003) return { ok: false, reason: `blank/runt (${(opaque / total * 100).toFixed(2)}%)` };
    if (opaque > total * 0.98) return { ok: false, reason: `full-bleed (${(opaque / total * 100).toFixed(1)}% — a tile, not a sprite)` };
    return { ok: true, opaque, coverage: opaque / total };
  } catch (e) {
    return { ok: false, reason: `decode-error: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// Registry: prompts for anim action + lifecycle/fruit state edit descriptions
// ---------------------------------------------------------------------------
function loadRegistry() {
  const reg = JSON.parse(fs.readFileSync(F6_REGISTRY, "utf8"));
  return {
    animAction: reg.anim.action,
    animFrames: reg.anim.frames || ANIM_FRAMES,
    states: reg.states,             // { seedling, growing, wilting, dead, stump, snag, burned }
    fruitStates: reg.fruit_states,  // { budding, fruiting, harvested }
    fruitArchetypes: new Set(reg.archetypes.filter((a) => a.fruit).map((a) => a.name)),
  };
}
const REG = loadRegistry();

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const pad3 = (n) => String(n).padStart(3, "0");
const speciesDir = (biome, species) => path.join(FLORA_DIR, biome, species);
const variantPath = (biome, species, v) => path.join(speciesDir(biome, species), `v${pad3(v)}.png`);
const animDir = (biome, species, v) => path.join(speciesDir(biome, species), "anim", "wind_sway", `v${pad3(v)}`);
const animFramePath = (biome, species, v, f) => path.join(animDir(biome, species, v), `frame_${pad3(f)}.png`);
const statePath = (biome, species, state, v) => path.join(speciesDir(biome, species), "_states", state, `v${pad3(v)}.png`);

function animDoneOnDisk(biome, species, v) {
  const d = animDir(biome, species, v);
  if (!fs.existsSync(d)) return false;
  const frames = fs.readdirSync(d).filter((f) => /^frame_\d{3}\.png$/.test(f) && fs.statSync(path.join(d, f)).size > 200);
  return frames.length >= ANIM_FRAMES;
}
function stateDoneOnDisk(biome, species, state, v) {
  const p = statePath(biome, species, state, v);
  return fs.existsSync(p) && fs.statSync(p).size > 200;
}

// ---------------------------------------------------------------------------
// Job enumeration from LG_CATALOG
// ---------------------------------------------------------------------------
function hasStates(sp) {
  return sp.states && Object.keys(sp.states).length > 0;
}

// ANIMS: one job per (species, every vmap index). key = anim:biome/species/vNNN
function enumAnimJobs() {
  const jobs = [];
  for (const biome of Object.keys(LG_CATALOG)) {
    for (const sp of LG_CATALOG[biome]) {
      if (EXCLUDE_SPECIES.has(sp.name)) continue;
      for (const v of sp.vmap || []) {
        jobs.push({
          kind: "anim",
          biome,
          species: sp.name,
          v,
          srcV: v,
          key: `anim:${biome}/${sp.name}/v${pad3(v)}`,
        });
      }
    }
  }
  return jobs;
}

// STATES: for each GAP species (no states on disk/catalog), the registry 7-set
// (+3 fruit states if fruiting), each editing the FIRST vmap survivor index.
// key = state:biome/species/<state>
function enumStateJobs() {
  const jobs = [];
  const stateNames = Object.keys(REG.states);
  const fruitNames = Object.keys(REG.fruitStates);
  for (const biome of Object.keys(LG_CATALOG)) {
    for (const sp of LG_CATALOG[biome]) {
      if (EXCLUDE_SPECIES.has(sp.name)) continue;
      if (hasStates(sp)) continue;                  // only fill the gaps
      const srcV = (sp.vmap || [])[0];
      if (srcV === undefined) continue;
      const set = [...stateNames];
      if (REG.fruitArchetypes.has(sp.name)) set.push(...fruitNames);
      for (const st of set) {
        jobs.push({
          kind: "state",
          biome,
          species: sp.name,
          state: st,
          v: srcV,
          srcV,
          desc: REG.states[st] || REG.fruitStates[st],
          key: `state:${biome}/${sp.name}/${st}`,
        });
      }
    }
  }
  return jobs;
}

function enumJobs(kind) {
  if (kind === "anims") return enumAnimJobs();
  if (kind === "states") return enumStateJobs();
  return [...enumAnimJobs(), ...enumStateJobs()];
}

// ---------------------------------------------------------------------------
// State file
// ---------------------------------------------------------------------------
function loadState() {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  return { jobs: {} };
}
let _lastSave = 0;
function saveState(state, force = false) {
  if (!force && Date.now() - _lastSave < 1500) return;
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, STATE_FILE);
  _lastSave = Date.now();
}

// Reconcile a job's record against disk: mark done if the output already exists.
function reconcile(state, job) {
  let rec = state.jobs[job.key];
  if (!rec) {
    rec = state.jobs[job.key] = { key: job.key, kind: job.kind, status: "pending", jobId: null, tries: 0 };
  }
  if (rec.status === "done") return rec;
  const onDisk = job.kind === "anim"
    ? animDoneOnDisk(job.biome, job.species, job.v)
    : stateDoneOnDisk(job.biome, job.species, job.state, job.v);
  if (onDisk) rec.status = "done";
  return rec;
}

// ---------------------------------------------------------------------------
// Submit one job (returns the create response)
// ---------------------------------------------------------------------------
function readBase64(p) {
  return fs.readFileSync(p).toString("base64");
}

async function submit(job) {
  const srcPng = variantPath(job.biome, job.species, job.srcV);
  if (!fs.existsSync(srcPng)) return { json: null, status: 404, fatal: true };
  const b64 = readBase64(srcPng);
  if (job.kind === "anim") {
    return apiCall("POST", ANIM_URL, {
      first_frame: { base64: b64, format: "png" },
      action: REG.animAction,
      frame_count: REG.animFrames,
      no_background: true,
    });
  }
  // state edit
  return apiCall("POST", EDIT_URL, {
    method: "edit_with_text",
    edit_images: [{ image: { base64: b64 }, width: SIZE, height: SIZE }],
    image_size: { width: SIZE, height: SIZE },
    description: job.desc,
    no_background: true,
  });
}

// ---------------------------------------------------------------------------
// Finalize a completed job: download + QA + save
// ---------------------------------------------------------------------------
async function finalizeAnim(job, frames) {
  if (frames.length < ANIM_FRAMES) return { ok: false, reason: `only ${frames.length} frames in payload` };
  const bufs = [];
  for (let i = 0; i < ANIM_FRAMES; i++) {
    const buf = await frameToBuffer(frames[i]);
    const qa = await qaPng(buf);
    if (!qa.ok) return { ok: false, reason: `frame ${i}: ${qa.reason}` };
    bufs.push(buf);
  }
  const dir = animDir(job.biome, job.species, job.v);
  fs.mkdirSync(dir, { recursive: true });
  // Clear any stale frames from a prior partial run so exactly ANIM_FRAMES land
  // (the v3 endpoint returns 8 sway frames + 1 reference = 9; we keep only 0-7).
  for (const f of fs.readdirSync(dir)) {
    if (/^frame_\d{3}\.png$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  }
  for (let i = 0; i < ANIM_FRAMES; i++) {
    fs.writeFileSync(animFramePath(job.biome, job.species, job.v, i), bufs[i]);
  }
  return { ok: true };
}

async function finalizeState(job, frames) {
  if (!frames.length) return { ok: false, reason: "no image in payload" };
  const buf = await frameToBuffer(frames[0]);
  const qa = await qaPng(buf);
  if (!qa.ok) return { ok: false, reason: qa.reason };
  const dest = statePath(job.biome, job.species, job.state, job.v);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return { ok: true, coverage: qa.coverage };
}

// ---------------------------------------------------------------------------
// Main worker-pool loop (<=10 in flight, resumable)
// ---------------------------------------------------------------------------
async function run(kind, limit, listOnly) {
  const allJobs = enumJobs(kind);

  if (listOnly) {
    const anims = allJobs.filter((j) => j.kind === "anim");
    const states = allJobs.filter((j) => j.kind === "state");
    const stateSpecies = new Set(states.map((j) => `${j.biome}/${j.species}`));
    // disk-done reconciliation for accurate "remaining" counts
    const st = loadState();
    let animsDone = 0, statesDone = 0;
    for (const j of anims) if (reconcile(st, j).status === "done") animsDone++;
    for (const j of states) if (reconcile(st, j).status === "done") statesDone++;
    console.log("regen-states-anims --list:");
    console.log(`  anims:  ${anims.length} total  (${animsDone} done, ${anims.length - animsDone} pending)`);
    console.log(`  states: ${states.length} total across ${stateSpecies.size} gap species  (${statesDone} done, ${states.length - statesDone} pending)`);
    console.log(`  total jobs: ${allJobs.length}`);
    console.log(`  excluded (non-tree): ${[...EXCLUDE_SPECIES].join(", ")}`);
    return;
  }

  const state = loadState();
  for (const j of allJobs) reconcile(state, j);
  saveState(state, true);

  const jobByKey = new Map(allJobs.map((j) => [j.key, j]));
  let pending = allJobs.filter((j) => {
    const s = state.jobs[j.key]?.status;
    return s !== "done" && s !== "failed";
  });
  if (typeof limit === "number") pending = pending.slice(0, limit);

  console.log(
    `regen-states-anims: kind=${kind} pending=${pending.length}` +
      (typeof limit === "number" ? ` (limited to ${limit})` : "") +
      ` | pool=${MAX_INFLIGHT}`
  );
  if (pending.length === 0) {
    console.log("Nothing to do (all selected jobs already done/failed).");
    return;
  }

  const queue = [...pending];
  const inflight = new Map(); // key -> { job, jobId, submittedAt }

  // Re-adopt jobs left 'queued' with a jobId from a prior crash.
  for (const j of queue.slice()) {
    const rec = state.jobs[j.key];
    if (rec?.status === "queued" && rec.jobId) {
      inflight.set(j.key, { job: j, jobId: rec.jobId, submittedAt: Date.now() });
      const qi = queue.indexOf(j);
      if (qi >= 0) queue.splice(qi, 1);
    }
  }

  const remaining = () => queue.length + inflight.size;

  while (remaining() > 0) {
    // ---- fill the pool (never exceed MAX_INFLIGHT) ----
    while (inflight.size < MAX_INFLIGHT && queue.length > 0) {
      const j = queue.shift();
      const rec = state.jobs[j.key];
      const { json, status, fatal } = await submit(j);
      const jobId = json?.background_job_id || json?.id;
      if (jobId) {
        rec.jobId = jobId;
        rec.status = "queued";
        rec.tries = (rec.tries || 0) + 1;
        inflight.set(j.key, { job: j, jobId, submittedAt: Date.now() });
        console.log(`submit ${j.kind} ${j.biome}/${j.species}${j.state ? "/" + j.state : "/v" + pad3(j.v)} -> job ${jobId} try ${rec.tries}`);
      } else if (fatal) {
        rec.status = "failed";
        console.error(`${j.key}: source PNG missing — cannot generate`);
      } else if (![429, 529, 0].includes(status)) {
        rec.tries = (rec.tries || 0) + 1;
        if (rec.tries >= MAX_TRIES) {
          rec.status = "failed";
          console.error(`${j.key}: create failed permanently (HTTP ${status})`);
        } else {
          queue.push(j);
        }
      } else {
        queue.unshift(j); // transient — retry without penalty
        saveState(state);
        break;            // API saturated: stop submitting, go poll
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
      const { job, jobId } = info;
      const rec = state.jobs[key];
      const { json, status } = await apiCall("GET", jobUrl(jobId));
      const jobStatus = json?.status;

      if (jobStatus === "completed") {
        inflight.delete(key);
        const frames = extractFrames(json);
        const res = job.kind === "anim"
          ? await finalizeAnim(job, frames)
          : await finalizeState(job, frames);
        if (res.ok) {
          rec.status = "done";
          const out = job.kind === "anim"
            ? path.relative(REPO_ROOT, animDir(job.biome, job.species, job.v))
            : path.relative(REPO_ROOT, statePath(job.biome, job.species, job.state, job.v));
          console.log(`DONE  ${job.kind} ${job.biome}/${job.species} -> ${out}`);
        } else {
          console.warn(`QA REJECT ${job.kind} ${job.biome}/${job.species} (${res.reason}) try ${rec.tries}/${MAX_TRIES}`);
          if ((rec.tries || 0) >= MAX_TRIES) {
            rec.status = "failed";
            console.error(`${key}: failed permanently after ${rec.tries} tries`);
          } else {
            rec.status = "pending";
            rec.jobId = null;
            queue.push(job); // re-roll (new submit)
          }
        }
      } else if (jobStatus === "failed" || [404, 410].includes(status)) {
        inflight.delete(key);
        if ((rec.tries || 0) >= MAX_TRIES) {
          rec.status = "failed";
          console.error(`${key}: job ${jobStatus || "HTTP " + status}, out of tries`);
        } else {
          rec.status = "pending";
          rec.jobId = null;
          queue.push(job);
        }
      } else if (Date.now() - info.submittedAt > JOB_TIMEOUT) {
        // stuck — requeue WITHOUT a try penalty (a slow queue isn't the job's fault)
        console.warn(`${key}: stuck ${Math.round((Date.now() - info.submittedAt) / 1000)}s -> requeue`);
        inflight.delete(key);
        rec.status = "pending";
        rec.jobId = null;
        queue.push(job);
      }
      // else "processing"/"pending"/"in_progress" — leave in flight
      saveState(state);
    }
    saveState(state);
  }

  saveState(state, true);
  const sel = pending.map((j) => state.jobs[j.key]);
  const done = sel.filter((r) => r.status === "done").length;
  const failed = sel.filter((r) => r.status === "failed").length;
  console.log(`\n=== complete: ${done} done, ${failed} failed, of ${pending.length} processed ===`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const a = { kind: null, limit: null, list: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--kind") a.kind = argv[++i];
    else if (t === "--limit") a.limit = parseInt(argv[++i], 10);
    else if (t === "--list") a.list = true;
  }
  return a;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.kind || !["anims", "states", "all"].includes(args.kind)) {
    console.error("Usage: node scripts/regen-states-anims.mjs --kind <anims|states|all> [--limit N] [--list]");
    process.exit(2);
  }
  await run(args.kind, args.list ? null : args.limit, args.list);
})();
