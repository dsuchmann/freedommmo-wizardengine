// src/life/eval/compose.js
// LLM-powered choreography composer.
//
// Instead of inventing raw joint angles, the LLM picks from the verified pose
// dictionary and specifies timing. The compiler (compile-plan.js) then resolves
// pose names to joint dicts and produces a standard DSL program.
//
// Provider auto-detection from key prefix:
//   sk-ant-*  → anthropic (claude-haiku-3-5)
//   sk-*      → openai   (gpt-4o-mini)

// ── example choreographies (pose-ref format) ──────────────────────────────────

const EXAMPLES = `
Example 1 — wave at someone:
{
  "id": "wave_hello",
  "kind": "gesture",
  "steps": [
    { "pose": "rest", "ticks": 2 },
    { "pose": "right_arm_overhead", "ticks": 6 },
    { "pose": "right_arm_wave_high", "ticks": 3 },
    { "pose": "right_arm_wave_low", "ticks": 2 },
    { "pose": "right_arm_wave_high", "ticks": 2 },
    { "pose": "right_arm_wave_low", "ticks": 2 },
    { "pose": "rest", "ticks": 4 }
  ]
}

Example 2 — bow respectfully:
{
  "id": "bow_respect",
  "kind": "gesture",
  "steps": [
    { "pose": "rest", "ticks": 3 },
    { "pose": "bow_forward", "ticks": 5 },
    { "pose": "deep_bow", "ticks": 6 },
    { "pose": "bow_forward", "ticks": 4 },
    { "pose": "rest", "ticks": 3 }
  ]
}

Example 3 — casual shrug:
{
  "id": "shrug_casual",
  "kind": "gesture",
  "steps": [
    { "pose": "rest", "ticks": 2 },
    { "pose": "shrug", "ticks": 6 },
    { "pose": "rest", "ticks": 2 }
  ]
}
`.trim();

// ── prompt builder ─────────────────────────────────────────────────────────────

/**
 * Build the system prompt for LLM choreography composition.
 *
 * @param {Array<{id: string, desc: string}>} poseSummary
 * @returns {string}
 */
export function buildComposePrompt(poseSummary) {
  const poseList = poseSummary
    .map(p => `  • ${p.id} — ${p.desc}`)
    .join('\n');

  return `\
You are a choreography composer for a 2D humanoid character in a simulation game.
Your job is to create short, expressive motion sequences using the available pose dictionary.

## Available poses
${poseList}

## Rules
1. Output a single JSON object: { "id": string, "kind": "gesture"|"idle"|"action", "steps": [{pose, ticks}] }
2. Reference poses by their exact id from the list above.
3. Always start and end with "rest" (1–4 ticks each).
4. Use 2–6 ticks per step (ticks = animation frames, ~30fps).
5. Keep sequences 4–12 steps total.
6. If a motion requires a pose not in the list, use "NEW:short description" as the pose id.
7. Output only valid JSON — no markdown, no explanation.

## Examples
${EXAMPLES}`;
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
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: userText },
      ],
      max_tokens: 600,
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
      model:      model || 'claude-haiku-3-5',
      system,
      messages:   [{ role: 'user', content: userText }],
      max_tokens: 600,
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
 * Ask an LLM to compose a choreography plan from the pose dictionary.
 *
 * @param {string} command       – natural-language motion description
 * @param {Array<{id: string, desc: string}>} poseSummary – [{id, desc}] from poses.json
 * @param {{ key: string, url?: string, model?: string, provider?: string }} cfg
 * @returns {Promise<{ plan: object|null, error: string|null }>}
 */
export async function composeChoreography(command, poseSummary, cfg = {}) {
  const { key, url, model, provider: providerOverride } = cfg;
  const apiKey   = key || process.env.MOTION_LLM_KEY || '';
  const provider = detectProvider(apiKey, providerOverride);

  if (!provider) {
    return { plan: null, error: 'No LLM key provided. Pass cfg.key or set MOTION_LLM_KEY env var.' };
  }

  const system   = buildComposePrompt(poseSummary);
  const userText = `Compose a choreography for: ${command}`;

  let rawText = '';
  try {
    if (provider === 'anthropic') {
      rawText = await callAnthropic(system, userText, apiKey, model, url);
    } else {
      rawText = await callOpenAI(system, userText, apiKey, model, url);
    }

    const plan = extractJSON(rawText);
    return { plan, error: null };
  } catch (err) {
    return { plan: null, error: err.message, raw: rawText };
  }
}
