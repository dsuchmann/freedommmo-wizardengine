// src/life/eval/spatial-compose.js
// LLM-powered spatial choreography composer.
//
// The LLM outputs spatial instructions (body parts + primitives + amounts),
// NOT joint angles. The spatial-compiler.js handles angle resolution.
//
// Provider auto-detection from key prefix:
//   sk-ant-*  → anthropic (claude-haiku-4-5-20251001)
//   sk-*      → openai   (gpt-4o)

// ── body part descriptions ────────────────────────────────────────────────────

const BODY_PARTS_DOC = `
## Body part groups (19 total)

### Individual parts
- left_shoulder  — upper-left arm pivot (shoulder joint)
- right_shoulder — upper-right arm pivot (shoulder joint)
- left_arm       — full left arm: upper arm + forearm + hand
- right_arm      — full right arm: upper arm + forearm + hand
- left_hand      — left wrist/hand rotation only
- right_hand     — right wrist/hand rotation only
- left_hip       — left thigh pivot (hip joint)
- right_hip      — right thigh pivot (hip joint)
- left_leg       — full left leg: thigh + shin + foot
- right_leg      — full right leg: thigh + shin + foot
- left_foot      — left ankle/foot rotation only
- right_foot     — right ankle/foot rotation only
- torso          — spine (torso bends forward/back)
- head           — neck/head tilt and turn

### Compound parts (expand to multiple individuals)
- both_arms      — left_arm + right_arm
- both_legs      — left_leg + right_leg
- both_shoulders — left_shoulder + right_shoulder
- both_hips      — left_hip + right_hip
- upper_body     — torso + head + left_arm + right_arm
- lower_body     — left_leg + right_leg
- full_body      — everything
`.trim();

// ── spatial primitives ────────────────────────────────────────────────────────

const PRIMITIVES_DOC = `
## Spatial primitives (8 total)

- raise      — move the part upward / lift it (arms go up, head tilts up, torso straightens)
- lower      — move the part downward / drop it (arms go down, head tilts down, torso bends)
- extend     — push the part away from the body / straighten it outward
- retract    — pull the part toward the body / fold it inward
- bend       — flex a joint (elbows, knees) — folds limb segments toward each other
- straighten — un-flex a joint — returns bent segments to straight
- turn_in    — rotate part inward toward the body centerline
- turn_out   — rotate part outward away from the body centerline
`.trim();

// ── instruction format ────────────────────────────────────────────────────────

const FORMAT_DOC = `
## Instruction format

Single instruction:
  { "part": "<group>", "action": "<primitive>", "amount": 0.0–1.0, "ticks": 2–6, "zHint"?: "front"|"behind" }

Parallel block (multiple parts move simultaneously):
  { "type": "parallel", "steps": [ ...instructions... ] }

Full choreography:
  { "id": "snake_case_id", "kind": "gesture"|"idle"|"action", "steps": [ ...instructions or parallel blocks... ] }
`.trim();

// ── rules ─────────────────────────────────────────────────────────────────────

const RULES_DOC = `
## Rules
1. Output a single JSON object matching the choreography format — no markdown, no explanation.
2. Always start and end at rest (amount 0 or a lower/retract that returns parts to neutral).
3. Use 2–6 ticks per step (ticks = animation frames at ~30 fps).
4. Keep sequences to 4–12 steps (or parallel blocks) total.
5. Use "zHint": "front" when a part reaches toward the camera (e.g., pointing forward, grabbing).
6. Prefer parallel blocks when multiple parts should move together.
7. amount is a 0.0–1.0 normalized range: 0 = no movement, 1 = full range of that primitive.
`.trim();

// ── example choreographies ────────────────────────────────────────────────────

const EXAMPLES_DOC = `
## Examples

Example 1 — wave at someone:
${JSON.stringify({
  id: 'wave',
  kind: 'gesture',
  steps: [
    { part: 'right_arm', action: 'raise',       amount: 0.88, ticks: 5 },
    { part: 'right_arm', action: 'bend',        amount: 0.3,  ticks: 2 },
    { part: 'right_arm', action: 'straighten',  amount: 1.0,  ticks: 2 },
    { part: 'right_arm', action: 'bend',        amount: 0.3,  ticks: 2 },
    { part: 'right_arm', action: 'straighten',  amount: 1.0,  ticks: 2 },
    { part: 'right_arm', action: 'lower',       amount: 1.0,  ticks: 5 },
  ],
}, null, 2)}

Example 2 — bow respectfully:
${JSON.stringify({
  id: 'bow',
  kind: 'gesture',
  steps: [
    { type: 'parallel', steps: [
      { part: 'torso', action: 'lower', amount: 0.8, ticks: 5 },
      { part: 'head',  action: 'lower', amount: 0.4, ticks: 5 },
    ]},
    { type: 'parallel', steps: [
      { part: 'torso', action: 'raise', amount: 0.0, ticks: 5 },
      { part: 'head',  action: 'raise', amount: 0.0, ticks: 5 },
    ]},
  ],
}, null, 2)}

Example 3 — point forward:
${JSON.stringify({
  id: 'point_forward',
  kind: 'gesture',
  steps: [
    { type: 'parallel', steps: [
      { part: 'right_arm',  action: 'extend',   amount: 0.7, ticks: 4, zHint: 'front' },
      { part: 'right_hand', action: 'turn_out', amount: 0.5, ticks: 4 },
    ]},
    { type: 'parallel', steps: [
      { part: 'right_arm',  action: 'lower',   amount: 1.0, ticks: 4 },
      { part: 'right_hand', action: 'turn_in', amount: 0.0, ticks: 4 },
    ]},
  ],
}, null, 2)}
`.trim();

// ── prompt builder ─────────────────────────────────────────────────────────────

/**
 * Build the system prompt for spatial choreography composition.
 *
 * @param {string[]} [rules=[]]  Optional learned rules to append.
 * @returns {string}
 */
export function buildSpatialPrompt(rules = []) {
  let prompt = `\
You are a spatial choreography composer for a 2D humanoid character in a simulation game.
Your job is to create short, expressive motion sequences using body-part spatial instructions.
You describe movement in intuitive spatial terms — the engine converts them to joint angles.

${BODY_PARTS_DOC}

${PRIMITIVES_DOC}

${FORMAT_DOC}

${RULES_DOC}

${EXAMPLES_DOC}`;

  if (rules.length > 0) {
    prompt += `\n\n## Learned rules (apply these)\n${rules.map(r => `- ${r}`).join('\n')}`;
  }

  return prompt;
}

// ── provider detection ─────────────────────────────────────────────────────────

function detectProvider(apiKey, overrideProvider) {
  if (overrideProvider) return overrideProvider;
  if (!apiKey) return null;
  return apiKey.startsWith('sk-ant-') ? 'anthropic' : 'openai';
}

// ── API callers ────────────────────────────────────────────────────────────────

async function callOpenAI(system, userText, apiKey, model, url) {
  const endpoint = url || 'https://api.openai.com/v1/chat/completions';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: userText },
      ],
      max_completion_tokens: 800,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callAnthropic(system, userText, apiKey, model, url) {
  const endpoint = url || 'https://api.anthropic.com/v1/messages';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:    model || 'claude-haiku-4-5-20251001',
      system,
      messages: [{ role: 'user', content: userText }],
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

// ── JSON extractor ─────────────────────────────────────────────────────────────

/**
 * Extract the first JSON object from an LLM response string.
 * Handles responses that wrap JSON in markdown code blocks.
 *
 * @param {string} text
 * @returns {object}
 */
function extractJSON(text) {
  // Strip markdown fences if present
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

  // Find the outermost JSON object
  const start = stripped.indexOf('{');
  const end   = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in LLM response');

  return JSON.parse(stripped.slice(start, end + 1));
}

// ── main composer ──────────────────────────────────────────────────────────────

/**
 * Compose a spatial choreography for a command using an LLM.
 *
 * @param {string} command   — natural-language motion description
 * @param {{ key: string, url?: string, model?: string, provider?: string }} cfg
 * @param {{ rules?: string[] }} [opts={}]
 * @returns {Promise<{ choreography: object|null, error: string|null }>}
 */
export async function composeSpatial(command, cfg = {}, { rules = [] } = {}) {
  const { key, url, model, provider: providerOverride } = cfg;
  const apiKey   = key || (typeof process !== 'undefined' && process.env?.MOTION_LLM_KEY) || '';
  const provider = detectProvider(apiKey, providerOverride);

  if (!provider) {
    return {
      choreography: null,
      error: 'No LLM key provided. Pass cfg.key or set MOTION_LLM_KEY env var.',
    };
  }

  const system   = buildSpatialPrompt(rules);
  const userText = `Compose a spatial choreography for: ${command}`;

  let rawText = '';
  try {
    if (provider === 'anthropic') {
      rawText = await callAnthropic(system, userText, apiKey, model, url);
    } else {
      rawText = await callOpenAI(system, userText, apiKey, model, url);
    }

    const choreography = extractJSON(rawText);
    return { choreography, error: null };
  } catch (err) {
    return { choreography: null, error: err.message, raw: rawText };
  }
}
