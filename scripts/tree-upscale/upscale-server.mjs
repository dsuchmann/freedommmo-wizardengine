#!/usr/bin/env node
// upscale-server.mjs — one-process backend for the Upscale Studio dashboard.
//
// Replaces `npx http-server` AND the three manual CLI steps in UPSCALE-STUDIO.md: it serves the repo
// root statically (so tools/upscale-studio.html + /assets/... load) and exposes a tiny JSON API the
// dashboard's control bar drives. Stdlib only — no deps (house style).
//
//   GET  /api/status              → { ok, jobRunning, job, lastExit, ... }
//   POST /api/upscale-bases {field,biome}  → spawn comfy-batch.py --base-only (ALL base variants of every
//                                            object in ONE field), then regen the preview manifest
//   POST /api/upscale-all   {biome}        → comfy-batch.py --base-only for EACH non-large_flora field in
//                                            sequence (one streamed job), then regen the preview manifest
//   GET  /api/log                 → Server-Sent Events stream of the running job (live progress)
//   POST /api/job-cancel          → kill the running job
//   POST /api/regen  {biome}      → run gen-upscale-preview-manifest.mjs; returns {ok, path, output}
//   POST /api/apply  {field,biome,decisions} → STREAMED job: run apply-upscale-decisions.mjs, which RUNS the
//                                  full comfy-batch (states+anims+all variants) for each upscale/blend winner,
//                                  then apply-mix for blends, then quarantines directs + regens the manifest
//
// One job at a time (single lock). All long jobs stream their stdout/stderr over /api/log (SSE).
// PYTHON_BIN overrides the python interpreter used for comfy-batch (default 'python').
//
// Usage:  node scripts/tree-upscale/upscale-server.mjs [--port 8131]
//         then open http://localhost:8131/tools/upscale-studio.html
//
// FIELD_ASSET_ROOT semantics differ between the child scripts (intentionally honored here):
//   • gen-upscale-preview-manifest.mjs reads it as the REPO ROOT (it joins "assets/..." under it).
//   • apply-upscale-decisions.mjs + gen-upscale-manifest.mjs read it as the MICRO base dir directly.
//   • comfy-batch.py ignores it (self-locates from __file__).
// Because this server runs IN the main checkout (where assets sit at the canonical path), we set
// FIELD_ASSET_ROOT=<repo> for the upscale (comfy-batch) + regen steps and DELETE it for apply (so apply falls
// back to its correct default <repo>/assets/pixelab/landscape_v2/micro). Setting it for apply would point the
// corpus at the repo root and break it.

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const TOOLS = path.join(REPO, 'tools');
const SCRIPTS = 'scripts/tree-upscale';

const FIELDS = JSON.parse(fs.readFileSync(path.join(HERE, 'fields.json'), 'utf8'));
const FIELD_KEYS = Object.keys(FIELDS).filter((k) => !k.startsWith('_'));
// "all bases" sweeps every object field EXCEPT large_flora (F6 — already fully upscaled), in fields.json order.
const BASE_FIELDS = FIELD_KEYS.filter((k) => k !== 'large_flora');
const BIOME_RE = /^[a-z_]+$/;
const PY = process.env.PYTHON_BIN || 'python';   // interpreter for comfy-batch (overridable for tests/venvs)

// ---- arg / port ------------------------------------------------------------
function getPort() {
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--port' && a[i + 1]) return parseInt(a[i + 1], 10);
    if (a[i].startsWith('--port=')) return parseInt(a[i].split('=')[1], 10);
  }
  return parseInt(process.env.PORT || '8131', 10);
}
const PORT = getPort();

// ---- job state + SSE log fan-out -------------------------------------------
// ONE job at a time (comfy-batch is one GPU). A job is a SEQUENCE of steps run back-to-back, all streamed
// into the same SSE log: e.g. "upscale-all" = comfy-batch --base-only per field + a final manifest regen.
const job = { running: false, kind: null, label: null, child: null, code: null, startedAt: null };
let lastExit = null; // { kind, code, at }
const logBuffer = []; // recent lines for replay to late SSE subscribers
const logClients = new Set();

function broadcast(evt) {
  const s = `data: ${JSON.stringify(evt)}\n\n`;
  for (const c of logClients) { try { c.write(s); } catch { /* client gone */ } }
}
function pushLog(line) {
  logBuffer.push(line);
  if (logBuffer.length > 4000) logBuffer.shift();
  broadcast({ type: 'line', line });
}

// Split a stream's chunks into lines and forward them to pushLog.
function lineStreamer(stream, tag) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      pushLog(tag ? `${tag} ${line}` : line);
      buf = buf.slice(nl + 1);
    }
  });
  stream.on('end', () => { if (buf.length) pushLog(tag ? `${tag} ${buf}` : buf); });
}

// ---- http helpers ----------------------------------------------------------
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// Run a node/other command to completion, capturing combined output. Returns {code, stdout, stderr}.
function runToEnd(cmd, args, env) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd: REPO, env });
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: String(e && e.message || e) });
    }
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: stderr + String(e.message || e) }));
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// Run a SEQUENCE of steps as ONE streamed job (single lock). Each step = { label?, cmd, args, env?, cwd? }.
// Steps run back-to-back; a non-zero step does NOT abort the chain (so an "all fields" sweep still tries every
// field, and a failing field can't stop the rest) — the job's final code is the last non-zero step code.
// All stdout/stderr stream into the SSE log. onDone(code) fires once at the end (e.g. to clean up a temp file).
function startJob(kind, label, steps, onDone) {
  job.running = true; job.kind = kind; job.label = label; job.code = null; job.child = null;
  job.startedAt = new Date().toISOString();
  logBuffer.length = 0;
  pushLog(`$ ${kind}: ${label}`);
  broadcast({ type: 'start', kind, label });
  let i = 0, worst = 0;
  const finish = (code) => {
    if (!job.running) return;
    job.running = false; job.code = code; job.child = null;
    lastExit = { kind, code, at: new Date().toISOString() };
    pushLog(`[${kind} exited code ${code}]`);
    broadcast({ type: 'exit', code });
    if (onDone) { try { onDone(code); } catch { /* ignore */ } }
  };
  const runNext = (prevCode) => {
    if (prevCode) worst = prevCode;
    if (i >= steps.length) return finish(worst);
    const s = steps[i++];
    if (s.label) pushLog(s.label);
    pushLog(`$ ${s.cmd} ${s.args.join(' ')}`);
    let child;
    try { child = spawn(s.cmd, s.args, { cwd: s.cwd || REPO, env: s.env || process.env }); }
    catch (e) { pushLog(`[spawn error] ${e.message || e}`); return runNext(-1); }
    job.child = child;
    let settled = false;
    const step = (code) => { if (settled) return; settled = true; job.child = null; runNext(code); };
    child.on('error', (e) => { pushLog(`[spawn error] ${e.message || e}`); step(-1); });
    lineStreamer(child.stdout, '');
    lineStreamer(child.stderr, '');
    child.on('close', (code) => step(code));
  };
  runNext(0);
}

// ---- static file serving ---------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.map': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
function serveStatic(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end('bad url'); }
  if (urlPath === '/') urlPath = '/tools/upscale-studio.html';
  const abs = path.resolve(REPO, '.' + urlPath);
  // Path-traversal guard: resolved path must stay inside the repo root.
  if (abs !== REPO && !abs.startsWith(REPO + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(abs).pipe(res);
  });
}

// ---- api -------------------------------------------------------------------
function statusPayload() {
  return {
    ok: true,
    jobRunning: job.running,
    job: job.running ? { kind: job.kind, label: job.label, startedAt: job.startedAt } : null,
    lastExit,
    fields: FIELD_KEYS,
    baseFields: BASE_FIELDS,
    repo: REPO,
  };
}

// POST /api/upscale-bases {field,biome} — upscale ALL base variants of every object in ONE field
// (comfy-batch --base-only, NO --sample), then regen the preview manifest. Streamed.
async function handleUpscaleBases(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  const field = String(body.field || '');
  const biome = String(body.biome || '');
  if (!FIELD_KEYS.includes(field)) return sendJson(res, 400, { error: `unknown field '${field}'`, fields: FIELD_KEYS });
  if (!BIOME_RE.test(biome)) return sendJson(res, 400, { error: `invalid biome '${biome}' (must match /^[a-z_]+$/)` });
  if (job.running) return sendJson(res, 409, { error: 'a job is already running', job: statusPayload().job });

  const env = { ...process.env, FIELD_ASSET_ROOT: REPO };
  const steps = [
    { label: `▶ upscale bases — ${field} / ${biome}`, cmd: PY,
      args: [`${SCRIPTS}/comfy-batch.py`, '--field', field, '--biome', biome, '--base-only'], env },
    { label: '↻ regen preview manifest', cmd: process.execPath,
      args: [`${SCRIPTS}/gen-upscale-preview-manifest.mjs`, biome], env },
  ];
  startJob('upscale-bases', `${field} / ${biome}`, steps);
  sendJson(res, 200, { ok: true, started: true, field, biome });
}

// POST /api/upscale-all {biome} — upscale ALL base variants across ALL non-large_flora fields, sequentially,
// as ONE streamed job, then regen the preview manifest at the end.
async function handleUpscaleAll(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  const biome = String(body.biome || '');
  if (!BIOME_RE.test(biome)) return sendJson(res, 400, { error: `invalid biome '${biome}' (must match /^[a-z_]+$/)` });
  if (job.running) return sendJson(res, 409, { error: 'a job is already running', job: statusPayload().job });

  const env = { ...process.env, FIELD_ASSET_ROOT: REPO };
  const steps = [];
  for (const f of BASE_FIELDS) {
    steps.push({ label: `▶ upscale bases — ${f} / ${biome}`, cmd: PY,
      args: [`${SCRIPTS}/comfy-batch.py`, '--field', f, '--biome', biome, '--base-only'], env });
  }
  steps.push({ label: '↻ regen preview manifest', cmd: process.execPath,
    args: [`${SCRIPTS}/gen-upscale-preview-manifest.mjs`, biome], env });
  startJob('upscale-all', `all bases / ${biome}`, steps);
  sendJson(res, 200, { ok: true, started: true, biome, fields: BASE_FIELDS });
}

function handleLog(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
    'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*',
  });
  res.write('retry: 3000\n\n');
  // replay what's buffered so a late subscriber sees the whole job
  for (const line of logBuffer) res.write(`data: ${JSON.stringify({ type: 'line', line })}\n\n`);
  if (!job.running && job.code != null) res.write(`data: ${JSON.stringify({ type: 'exit', code: job.code })}\n\n`);
  logClients.add(res);
  req.on('close', () => logClients.delete(res));
}

function handleJobCancel(req, res) {
  if (!job.running || !job.child) return sendJson(res, 200, { ok: true, cancelled: false, note: 'no job running' });
  try { job.child.kill(); } catch { /* ignore */ }
  return sendJson(res, 200, { ok: true, cancelled: true });
}

async function handleRegen(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  const biome = String(body.biome || '');
  if (!BIOME_RE.test(biome)) return sendJson(res, 400, { error: `invalid biome '${biome}' (must match /^[a-z_]+$/)` });
  // gen-upscale-preview-manifest.mjs wants FIELD_ASSET_ROOT = repo root.
  const env = { ...process.env, FIELD_ASSET_ROOT: REPO };
  const r = await runToEnd(process.execPath, [`${SCRIPTS}/gen-upscale-preview-manifest.mjs`, biome], env);
  const manifest = `tools/upscale-preview.${biome}.json`;
  sendJson(res, r.code === 0 ? 200 : 500, {
    ok: r.code === 0, biome, code: r.code,
    path: manifest, manifestUrl: `/${manifest}`,
    output: (r.stdout || '') + (r.stderr ? '\n' + r.stderr : ''),
  });
}

async function handleApply(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  const field = String(body.field || '');
  if (!FIELD_KEYS.includes(field)) return sendJson(res, 400, { error: `unknown field '${field}'`, fields: FIELD_KEYS });
  if (!body.decisions || typeof body.decisions !== 'object' || Array.isArray(body.decisions)) {
    return sendJson(res, 400, { error: 'decisions must be an object { "biome/object": {mode,...} }' });
  }
  // Validate each decision key shape so we never feed garbage to the applier.
  for (const [k, v] of Object.entries(body.decisions)) {
    if (!/^[a-z_]+\/[a-z0-9_]+$/.test(k)) return sendJson(res, 400, { error: `invalid decision key '${k}'` });
    if (!v || typeof v !== 'object') return sendJson(res, 400, { error: `decision '${k}' must be an object` });
    if (v.mode && !['upscale', 'blend', 'direct'].includes(v.mode)) return sendJson(res, 400, { error: `decision '${k}' has invalid mode '${v.mode}'` });
  }
  if (job.running) return sendJson(res, 409, { error: 'a job is already running', job: statusPayload().job });

  const payload = { field, biome: body.biome || null, savedAt: new Date().toISOString(), decisions: body.decisions };
  fs.mkdirSync(TOOLS, { recursive: true });
  const tmp = path.join(TOOLS, `_upscale_apply_${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 1));
  // apply-upscale-decisions.mjs reads FIELD_ASSET_ROOT as the MICRO dir; in the main checkout its default
  // (<repo>/assets/.../micro) is correct, so we DELETE the env var rather than inherit the repo-root value.
  // It now RUNS the full comfy-batch (states+anims+all variants) per upscale/blend winner — a long GPU job —
  // so apply is STREAMED like the other jobs. The temp decisions file is removed when the job finishes.
  const env = { ...process.env };
  delete env.FIELD_ASSET_ROOT;
  const steps = [{ label: `✓ apply decisions — ${field}`, cmd: process.execPath,
    args: [`${SCRIPTS}/apply-upscale-decisions.mjs`, '--decisions', tmp], env }];
  startJob('apply', `${field}`, steps, () => { try { fs.unlinkSync(tmp); } catch { /* keep going */ } });
  sendJson(res, 200, { ok: true, started: true, field });
}

// ---- router ----------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && p === '/api/status') return sendJson(res, 200, statusPayload());
    if (req.method === 'GET' && p === '/api/log') return handleLog(req, res);
    if (req.method === 'POST' && p === '/api/upscale-bases') return await handleUpscaleBases(req, res);
    if (req.method === 'POST' && p === '/api/upscale-all') return await handleUpscaleAll(req, res);
    if (req.method === 'POST' && p === '/api/job-cancel') return handleJobCancel(req, res);
    if (req.method === 'POST' && p === '/api/regen') return await handleRegen(req, res);
    if (req.method === 'POST' && p === '/api/apply') return await handleApply(req, res);
    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'no such endpoint' });
    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(405); res.end('method not allowed');
  } catch (e) {
    sendJson(res, 500, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`upscale-server listening on http://localhost:${PORT}`);
  console.log(`  repo root:   ${REPO}`);
  console.log(`  dashboard:   http://localhost:${PORT}/tools/upscale-studio.html`);
  console.log(`  fields:      ${FIELD_KEYS.join(', ')}`);
});
