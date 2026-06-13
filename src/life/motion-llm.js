// src/life/motion-llm.js — Runtime LLM generation of choreography programs.
// Config: localStorage 'motion_llm' → {url, model, key, provider} (never committed).
// Auto-detects provider from key prefix: sk-proj-* or sk-* → openai, sk-ant-* → anthropic.
// On miss: sends DSL cheat-sheet + user command → parse → validate → repair
// loop (one retry) → cache in-memory + localStorage 'motion_cache'.

const PROVIDERS = {
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    makeHeaders: (key) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }),
    makeBody: (model, system, messages) => ({
      model, max_tokens: 2048,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
    extractText: (data) => data.choices?.[0]?.message?.content || '',
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-haiku-4-5-20251001',
    makeHeaders: (key) => ({
      'Content-Type': 'application/json', 'x-api-key': key,
      'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
    }),
    makeBody: (model, system, messages) => ({ model, max_tokens: 2048, system, messages }),
    extractText: (data) => data.content?.[0]?.text || '',
  },
};

function detectProvider(key) {
  if (key?.startsWith('sk-ant-')) return 'anthropic';
  return 'openai'; // sk-proj-*, sk-*, or anything else
}

const DSL_CHEATSHEET = `You are a motion choreography author for a 2D side-view humanoid pixel-art rig.
The character is viewed from the SIDE. Positive joint angles rotate CLOCKWISE (screen-space).

IMPORTANT ANATOMY NOTES:
- Arms hang DOWN at rest (0°). arm_u_l NEGATIVE = raise left arm UP. arm_u_r POSITIVE = raise right arm UP.
- Legs point DOWN at rest. thigh NEGATIVE = lift leg FORWARD/UP. shin POSITIVE = bend knee.
- spine NEGATIVE = lean forward. spine POSITIVE = lean back.
- head NEGATIVE = look down. head POSITIVE = look up.
- The rig is 2D side-view: "raising an arm" means rotating it AWAY from the body vertically.

PRIMITIVES (each is a JSON node with "op"):
- pose: { op:"pose", joints:{boneName: degrees}, ticks: N } — glide ALL listed joints to target angles over N ticks (10 ticks = 1 second). Joints NOT listed keep their current value.
- wait: { op:"wait", ticks: N } — hold current pose for N ticks
- sequence: { op:"sequence", children:[...] } — play children in order
- parallel: { op:"parallel", children:[...] } — play children simultaneously
- balance: { op:"balance", on: true|false } — required before/after leaving standing

JOINTS (bone names → [min, max] degrees):
spine: [-30, 30], head: [-60, 60],
arm_u_l: [-170, 50], arm_f_l: [-140, 0], hand_l: [-45, 45],
arm_u_r: [-50, 170], arm_f_r: [0, 140], hand_r: [-45, 45],
thigh_l: [-110, 30], shin_l: [0, 140], foot_l: [-30, 30],
thigh_r: [-110, 30], shin_r: [0, 140], foot_r: [-30, 30]

RULES:
1. Joint angles MUST stay within [min, max]
2. Max change between consecutive poses: 30° per joint per tick. If a joint needs to move 90°, use at least 3 ticks.
3. Programs that leave standing (lying, inverted) MUST start with {op:"balance",on:false} and end with {op:"balance",on:true}
4. The LAST pose should return to rest (all joints 0°) unless it's a terminal pose (sit, lie down)
5. Use 2-6 ticks per pose step. 10 ticks = 1 second. Make movements feel natural, not robotic.
6. Think about what EACH BODY PART does during the motion. A wave isn't just the arm — the head might tilt, the spine might shift.

EXAMPLE - wave (right arm raises, forearm waves back and forth, then lowers):
{"id":"wave","kind":"gesture","variant":{"time":[0.9,1.15],"amplitude":[0.85,1.1]},
"root":{"op":"sequence","children":[
{"op":"pose","joints":{"arm_u_r":150},"ticks":6},
{"op":"pose","joints":{"arm_u_r":150,"arm_f_r":40},"ticks":3},
{"op":"pose","joints":{"arm_u_r":150,"arm_f_r":10},"ticks":2},
{"op":"pose","joints":{"arm_u_r":150,"arm_f_r":40},"ticks":2},
{"op":"pose","joints":{"arm_u_r":150,"arm_f_r":10},"ticks":2},
{"op":"pose","joints":{"arm_u_r":0,"arm_f_r":0},"ticks":6}]}}

EXAMPLE - bow (spine leans forward, head dips, pause, then straighten):
{"id":"bow","kind":"gesture","variant":{"time":[0.9,1.1],"amplitude":[0.9,1.1]},
"root":{"op":"sequence","children":[
{"op":"pose","joints":{"spine":-25,"head":-20,"arm_u_l":-15,"arm_u_r":15},"ticks":5},
{"op":"wait","ticks":8},
{"op":"pose","joints":{"spine":0,"head":0,"arm_u_l":0,"arm_u_r":0},"ticks":5}]}}

EXAMPLE - jumping jacks (crouch, extend arms+legs, return, repeat):
{"id":"jumping_jacks","kind":"jump","variant":{"time":[0.9,1.1],"amplitude":[0.9,1.1]},
"root":{"op":"sequence","children":[
{"op":"pose","joints":{"thigh_l":-50,"thigh_r":-50,"shin_l":60,"shin_r":60},"ticks":3},
{"op":"pose","joints":{"thigh_l":0,"thigh_r":0,"shin_l":0,"shin_r":0,"arm_u_l":-150,"arm_u_r":150},"ticks":3},
{"op":"pose","joints":{"arm_u_l":0,"arm_u_r":0},"ticks":3},
{"op":"pose","joints":{"thigh_l":-50,"thigh_r":-50,"shin_l":60,"shin_r":60},"ticks":3},
{"op":"pose","joints":{"thigh_l":0,"thigh_r":0,"shin_l":0,"shin_r":0,"arm_u_l":-150,"arm_u_r":150},"ticks":3},
{"op":"pose","joints":{"arm_u_l":0,"arm_u_r":0},"ticks":3}]}}

Respond with ONLY the program JSON. No markdown, no explanation, no code fences.`;

function getConfig() {
  try {
    const raw = localStorage.getItem('motion_llm');
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function isLLMConfigured() {
  const cfg = getConfig();
  return Boolean(cfg?.key);
}

// In-memory cache (also backed by localStorage 'motion_cache')
const _cache = new Map();
function loadCache() {
  try {
    const raw = localStorage.getItem('motion_cache');
    if (raw) {
      for (const [k, v] of Object.entries(JSON.parse(raw))) _cache.set(k, v);
    }
  } catch {}
}
function saveCache() {
  try {
    localStorage.setItem('motion_cache', JSON.stringify(Object.fromEntries(_cache)));
  } catch {}
}
loadCache();

export function getCachedProgram(id) { return _cache.get(id) ?? null; }

/** Clear the motion cache (useful during QA iteration). */
export function clearMotionCache() {
  _cache.clear();
  try { localStorage.removeItem('motion_cache'); } catch {}
}

/** Generate a choreography program via LLM. Returns { program, error }. */
export async function generateMotion(command) {
  const cfg = getConfig();
  if (!cfg?.key) return { program: null, error: 'No LLM configured. Set localStorage "motion_llm" to {"key":"sk-..."}' };

  const providerName = cfg.provider || detectProvider(cfg.key);
  const provider = PROVIDERS[providerName];
  if (!provider) return { program: null, error: `Unknown provider: ${providerName}` };

  const url = cfg.url || provider.url;
  const model = cfg.model || provider.model;
  const id = command.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

  // Check cache first
  if (_cache.has(id)) return { program: _cache.get(id), error: null };

  const userPrompt = `Create a choreography program for: "${command}"\nThe program id should be "${id}".`;

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const messages = [{ role: 'user', content: attempt === 0
        ? userPrompt
        : `${userPrompt}\n\nYour previous attempt had these validation errors:\n${lastError}\n\nFix them and respond with ONLY the corrected JSON.` }];

      const res = await fetch(url, {
        method: 'POST',
        headers: provider.makeHeaders(cfg.key),
        body: JSON.stringify(provider.makeBody(model, DSL_CHEATSHEET, messages)),
      });

      if (!res.ok) {
        const body = await res.text();
        return { program: null, error: `API ${res.status}: ${body.slice(0, 200)}` };
      }

      const data = await res.json();
      const text = provider.extractText(data);
      // Strip any markdown fences the LLM might add despite instructions
      const jsonStr = text.replace(/^```json?\s*/m, '').replace(/\s*```$/m, '').trim();

      let program;
      try { program = JSON.parse(jsonStr); }
      catch (e) { lastError = `JSON parse error: ${e.message}`; continue; }

      // Validate structure
      const violations = validateProgramBasic(program);
      if (violations.length) {
        lastError = violations.join('; ');
        continue;
      }

      // Success — cache it
      _cache.set(id, program);
      saveCache();
      return { program, error: null };

    } catch (e) {
      return { program: null, error: `Network error: ${e.message}` };
    }
  }

  return { program: null, error: `Validation failed after repair: ${lastError}` };
}

/** Basic structural validation (browser-safe, no node imports). */
function validateProgramBasic(program) {
  const v = [];
  if (!program?.id) v.push('missing id');
  if (!program?.kind) v.push('missing kind');
  if (!program?.root) { v.push('missing root'); return v; }
  walkValidate(program.root, 'root', v);
  return v;
}

const JOINT_LIMITS = {
  spine: [-30, 30], head: [-60, 60],
  arm_u_l: [-170, 50], arm_f_l: [-140, 0], hand_l: [-45, 45],
  arm_u_r: [-50, 170], arm_f_r: [0, 140], hand_r: [-45, 45],
  thigh_l: [-110, 30], shin_l: [0, 140], foot_l: [-30, 30],
  thigh_r: [-110, 30], shin_r: [0, 140], foot_r: [-30, 30],
};

function walkValidate(node, path, v) {
  if (!node?.op) { v.push(`${path}: missing op`); return; }
  if (node.op === 'pose') {
    if (!node.joints || typeof node.joints !== 'object') v.push(`${path}: pose missing joints`);
    if (!(node.ticks > 0)) v.push(`${path}: pose ticks must be > 0`);
    for (const [j, deg] of Object.entries(node.joints || {})) {
      const lim = JOINT_LIMITS[j];
      if (!lim) { v.push(`${path}: unknown joint ${j}`); continue; }
      if (deg < lim[0] || deg > lim[1]) v.push(`${path}: ${j}=${deg} out of [${lim[0]},${lim[1]}]`);
    }
  }
  if (node.op === 'sequence' || node.op === 'parallel') {
    if (!Array.isArray(node.children)) v.push(`${path}: ${node.op} missing children array`);
    else node.children.forEach((c, i) => walkValidate(c, `${path}[${i}]`, v));
  }
}
