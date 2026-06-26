#!/usr/bin/env node
/**
 * animate-f6-windsway.mjs — generate the wind_sway animation for EVERY surviving
 * F6 large-flora base sprite on disk (both the regenerated ones and the ones that
 * have been on disk all along). Resumable, fixed 10-concurrent worker pool.
 *
 * Why this exists: an audit found 1320/1320 surviving F6 bases have NO wind_sway
 * anim (the bulk_generate_f6.py anim phase never completed). This closes that gap.
 *
 * Method (confirmed against the live /v2/openapi.json + a real round-trip):
 *   submit  POST https://api.pixellab.ai/v2/animate-with-text-v3
 *           body { first_frame:{type:"base64",base64,format:"png"}, action,
 *                  frame_count, no_background:true } -> { background_job_id }
 *   poll    GET  https://api.pixellab.ai/v2/background-jobs/<job_id>
 *           -> status: processing|completed|failed; when completed,
 *              last_response.images = [9 x {type,base64,format}]
 *           (frame_count:8 returns 8 generated + 1 reference = 9 frames)
 *
 * Output (matches the F2/F4/F5 convention + the catalog regex frame_\d{3}.png):
 *   <flora>/<biome>/<species>/anim/wind_sway/vNNN/frame_000.png .. frame_008.png
 *
 * Survivors = on-disk vNNN.png bases minus the curation omit-set
 * (assets/.../large_flora/_f6_curation.json .omits). Omitted variants are never
 * rendered, so we don't waste credits animating them.
 *
 * Resumable: scripts/_f6_anim_state.json records per (biome/species/vNNN)
 *   { key, status:pending|queued|done|failed, jobId, tries }. 'done' is skipped
 *   on restart; an existing >=8-frame dir on disk is treated as already done.
 *
 * CLI:
 *   node scripts/animate-f6-windsway.mjs --list
 *   node scripts/animate-f6-windsway.mjs [--species <biome/species>] [--limit N]
 *
 * Mirrors the auth + 429/529 backoff of scripts/regen-curated.mjs.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const FLORA_DIR = path.join(REPO_ROOT, "assets", "pixelab", "landscape_v2", "micro", "large_flora");
const F6_CURATION = path.join(FLORA_DIR, "_f6_curation.json");
const F6_REGISTRY = path.join(REPO_ROOT, "scripts", "asset-corpus", "registry", "f6_trees.json");
const MCP_JSON = path.join(REPO_ROOT, ".mcp.json");
const STATE_FILE = path.join(REPO_ROOT, "scripts", "_f6_anim_state.json");

const ANIMATE_URL = "https://api.pixellab.ai/v2/animate-with-text-v3";
const jobUrl = (id) => `https://api.pixellab.ai/v2/background-jobs/${id}`;

const MAX_INFLIGHT = 10;       // HARD: fixed worker pool of 10, never exceed
const FRAME_COUNT = 8;         // v3 returns FRAME_COUNT generated + 1 reference = 9
const MIN_FRAMES = 8;          // catalog requires >=8 frames/anim
const MAX_TRIES = 3;
const POLL_INTERVAL = 12000;   // ms — anim jobs are slower than base gens
const SUBMIT_DELAY = 1500;     // ms between submissions
const JOB_TIMEOUT = 1800000;   // 30 min — requeue a stuck job (no try penalty)

// Skip a dressing prop that got misfiled under flora (not a tree).
const SKIP_SPECIES = new Set(["hills/fringed_shop_canopy"]);

// ---------------------------------------------------------------------------
// auth + backoff (mirror regen-curated.mjs)
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
      try { json = await resp.json(); } catch { /* non-json */ }
      return { json, status: resp.status };
    } catch (e) {
      console.warn(`${url}: connection error ${e.message}, retry ${attempt + 1}/4`);
      await sleep(10000 * (attempt + 1));
    }
  }
  return { json: null, status: lastCode };
}

// ---------------------------------------------------------------------------
// frame QA — a tree anim legitimately moves all over, so we only require
// >=MIN_FRAMES valid, non-blank PNG frames.
// ---------------------------------------------------------------------------
function isValidPng(buf) {
  return buf && buf.length > 200 && buf.slice(0, 8).toString("hex") === "89504e470d0a1a0a";
}

// ---------------------------------------------------------------------------
// worklist: enumerate surviving bases from disk (minus omit-set)
// ---------------------------------------------------------------------------
function loadOmits() {
  const c = JSON.parse(fs.readFileSync(F6_CURATION, "utf8"));
  const map = new Map();
  for (const [k, arr] of Object.entries(c.omits || {})) map.set(k, new Set(arr));
  return map;
}

const ACTION = (() => {
  try {
    const reg = JSON.parse(fs.readFileSync(F6_REGISTRY, "utf8"));
    return reg.anim?.action || "canopy swaying gently in wind, branches flexing naturally, trunk steady, rooted";
  } catch {
    return "canopy swaying gently in wind, branches flexing naturally, trunk steady, rooted";
  }
})();

function animDir(biome, species, v) {
  return path.join(FLORA_DIR, biome, species, "anim", "wind_sway", `v${String(v).padStart(3, "0")}`);
}
function basePath(biome, species, v) {
  return path.join(FLORA_DIR, biome, species, `v${String(v).padStart(3, "0")}.png`);
}
function animDone(biome, species, v) {
  const d = animDir(biome, species, v);
  if (!fs.existsSync(d)) return false;
  const frames = fs.readdirSync(d).filter((f) => /^frame_\d{3}\.png$/.test(f));
  return frames.length >= MIN_FRAMES && frames.every((f) => fs.statSync(path.join(d, f)).size > 200);
}

function enumerateSurvivors(onlySpecies) {
  const omits = loadOmits();
  const items = [];
  for (const biome of fs.readdirSync(FLORA_DIR)) {
    const bdir = path.join(FLORA_DIR, biome);
    if (!fs.statSync(bdir).isDirectory() || biome.startsWith("_")) continue;
    for (const species of fs.readdirSync(bdir)) {
      const sdir = path.join(bdir, species);
      if (!fs.statSync(sdir).isDirectory()) continue;
      const key = `${biome}/${species}`;
      if (SKIP_SPECIES.has(key)) continue;
      if (onlySpecies && key !== onlySpecies) continue;
      const omit = omits.get(key) || new Set();
      const bases = fs.readdirSync(sdir)
        .map((f) => f.match(/^v(\d{3})\.png$/))
        .filter(Boolean)
        .map((m) => parseInt(m[1], 10))
        .filter((v) => !omit.has(v))
        .sort((a, b) => a - b);
      for (const v of bases) {
        items.push({ biome, species, v, key: `${biome}/${species}/v${String(v).padStart(3, "0")}` });
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// state
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

// ---------------------------------------------------------------------------
// submit / finalize
// ---------------------------------------------------------------------------
async function submit(item) {
  const p = basePath(item.biome, item.species, item.v);
  if (!fs.existsSync(p)) return { json: null, status: 400 };
  const b64 = fs.readFileSync(p).toString("base64");
  const body = {
    first_frame: { type: "base64", base64: b64, format: "png" },
    action: ACTION,
    frame_count: FRAME_COUNT,
    no_background: true,
  };
  return apiCall("POST", ANIMATE_URL, body);
}

function saveFrames(item, images) {
  const d = animDir(item.biome, item.species, item.v);
  fs.mkdirSync(d, { recursive: true });
  let n = 0;
  for (let i = 0; i < images.length; i++) {
    const im = images[i];
    const b64 = typeof im === "string" ? im : im.base64;
    if (!b64) continue;
    const buf = Buffer.from(b64.split("base64,").pop(), "base64");
    if (!isValidPng(buf)) continue;
    fs.writeFileSync(path.join(d, `frame_${String(i).padStart(3, "0")}.png`), buf);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// main pool loop
// ---------------------------------------------------------------------------
async function run({ onlySpecies, limit, listOnly }) {
  let items = enumerateSurvivors(onlySpecies);

  if (listOnly) {
    const byKey = {};
    for (const it of items) {
      const k = `${it.biome}/${it.species}`;
      byKey[k] = byKey[k] || { total: 0, done: 0 };
      byKey[k].total++;
      if (animDone(it.biome, it.species, it.v)) byKey[k].done++;
    }
    let total = 0, done = 0;
    console.log("F6 wind_sway coverage (survivors):");
    for (const k of Object.keys(byKey).sort()) {
      const { total: t, done: d } = byKey[k];
      total += t; done += d;
      console.log(`  ${k}: ${d}/${t}` + (d < t ? `  (${t - d} missing)` : "  [complete]"));
    }
    console.log(`\n  TOTAL: ${done}/${total} animated, ${total - done} missing`);
    return;
  }

  const state = loadState();
  // mark already-on-disk anims as done; seed records
  for (const it of items) {
    const rec = state.items[it.key] || {};
    if (rec.status !== "done" && animDone(it.biome, it.species, it.v)) {
      state.items[it.key] = { ...rec, key: it.key, status: "done", tries: rec.tries || 0 };
    } else if (!state.items[it.key]) {
      state.items[it.key] = { key: it.key, status: "pending", jobId: null, tries: 0 };
    }
  }
  saveState(state, true);

  let pending = items.filter((it) => state.items[it.key].status !== "done" && state.items[it.key].status !== "failed");
  if (typeof limit === "number") pending = pending.slice(0, limit);

  console.log(
    `animate-f6-windsway: survivors=${items.length} pending=${pending.length}` +
      (typeof limit === "number" ? ` (limited ${limit})` : "") +
      ` | pool=${MAX_INFLIGHT} | ~$0.044/job`
  );
  if (!pending.length) { console.log("Nothing to do — all survivors already animated."); return; }

  const queue = [...pending];
  const inflight = new Map(); // key -> {item, jobId, submittedAt}

  // re-adopt queued jobs from a prior crash
  for (const it of queue.slice()) {
    const rec = state.items[it.key];
    if (rec.status === "queued" && rec.jobId) {
      inflight.set(it.key, { item: it, jobId: rec.jobId, submittedAt: Date.now() });
      queue.splice(queue.indexOf(it), 1);
    }
  }

  const remaining = () => queue.length + inflight.size;

  while (remaining() > 0) {
    // fill pool
    while (inflight.size < MAX_INFLIGHT && queue.length > 0) {
      const it = queue.shift();
      const rec = state.items[it.key];
      const { json, status } = await submit(it);
      const jobId = json?.background_job_id;
      if (jobId) {
        rec.jobId = jobId;
        rec.status = "queued";
        rec.tries = (rec.tries || 0) + 1;
        inflight.set(it.key, { item: it, jobId, submittedAt: Date.now() });
        console.log(`submit ${it.key} -> ${jobId} try ${rec.tries}`);
      } else if (![429, 529, 0].includes(status)) {
        rec.tries = (rec.tries || 0) + 1;
        if (rec.tries >= MAX_TRIES) { rec.status = "failed"; console.error(`${it.key}: submit failed (HTTP ${status})`); }
        else queue.push(it);
      } else {
        queue.unshift(it); // transient — no penalty
        saveState(state);
        break;             // API saturated — go poll
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

    // poll
    for (const [key, info] of [...inflight.entries()]) {
      const { item, jobId } = info;
      const rec = state.items[key];
      const { json, status } = await apiCall("GET", jobUrl(jobId));
      const jobStatus = json?.status;
      if (jobStatus === "completed") {
        inflight.delete(key);
        const images = json?.last_response?.images || [];
        const n = saveFrames(item, images);
        if (n >= MIN_FRAMES) {
          rec.status = "done";
          console.log(`DONE  ${key} (${n} frames)`);
        } else {
          console.warn(`REJECT ${key}: only ${n} valid frames try ${rec.tries}/${MAX_TRIES}`);
          if ((rec.tries || 0) >= MAX_TRIES) { rec.status = "failed"; console.error(`${key}: failed permanently`); }
          else { rec.status = "pending"; rec.jobId = null; queue.push(item); }
        }
      } else if (jobStatus === "failed") {
        inflight.delete(key);
        if ((rec.tries || 0) >= MAX_TRIES) { rec.status = "failed"; console.error(`${key}: job failed permanently`); }
        else { rec.status = "pending"; rec.jobId = null; queue.push(item); }
      } else if (status === 404) {
        inflight.delete(key);
        rec.status = "pending"; rec.jobId = null; queue.push(item);
      } else if (Date.now() - info.submittedAt > JOB_TIMEOUT) {
        console.warn(`${key}: stuck ${Math.round((Date.now() - info.submittedAt) / 1000)}s -> requeue`);
        inflight.delete(key);
        rec.status = "pending"; rec.jobId = null; queue.push(item);
      }
      // else processing — leave in flight
      saveState(state);
    }
    saveState(state);
  }

  saveState(state, true);
  const sel = pending.map((it) => state.items[it.key]);
  const done = sel.filter((r) => r.status === "done").length;
  const failed = sel.filter((r) => r.status === "failed").length;
  console.log(`\n=== wind_sway complete: ${done} done, ${failed} failed, of ${pending.length} processed ===`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const a = { onlySpecies: null, limit: null, listOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--species") a.onlySpecies = argv[++i];
    else if (t === "--limit") a.limit = parseInt(argv[++i], 10);
    else if (t === "--list") a.listOnly = true;
  }
  return a;
}

(async () => {
  await run(parseArgs(process.argv.slice(2)));
})();
