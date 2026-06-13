// src/life/eval/vision-eval.js — Pass 4 L5: vision-model pose/motion evaluation.
// Builds prompts for OpenAI (gpt-4o-mini) or Anthropic (Claude) vision APIs and
// parses structured score+critique responses.
//
// Provider is auto-detected from MOTION_LLM_KEY prefix:
//   sk-ant-*  → anthropic
//   sk-*      → openai (default)

// ── system prompt fragments ────────────────────────────────────────────────────

const POSE_SYSTEM = `\
You are evaluating a stick figure pose rendered against a dark background.

Bone color key:
  • Spine:       white  (#e0e0e0)
  • Head:        yellow (#f0d060) — shown as a circle at the top
  • Left arm:    blue   (#6090e0)
  • Right arm:   dark blue (#4070c0)
  • Left leg:    green  (#50b050)
  • Right leg:   dark green (#308030)

A dashed horizontal line marks the ground plane.

Your job: evaluate how well the stick figure matches the described pose.

Score the pose 1–5:
  5 = Perfect match — immediately recognisable as the described pose
  4 = Good — mostly correct, minor discrepancy
  3 = Partial — key limb placement correct but something noticeable is off
  2 = Poor — only vaguely resembles the pose
  1 = Wrong — does not resemble the described pose at all

Respond strictly in this format:
Score: N
One or two sentences explaining your evaluation.`;

const MOTION_SYSTEM = `\
You are evaluating a motion strip — multiple stick figure frames arranged left to right, each separated by a vertical line.

Bone color key:
  • Spine:       white  (#e0e0e0)
  • Head:        yellow (#f0d060) — shown as a circle at the top
  • Left arm:    blue   (#6090e0)
  • Right arm:   dark blue (#4070c0)
  • Left leg:    green  (#50b050)
  • Right leg:   dark green (#308030)

A dashed horizontal line in each frame marks the ground plane.

Your job: evaluate how well the motion strip conveys the described movement command.

Score the motion 1–5:
  5 = Perfect — fluid, clearly depicts the commanded motion across frames
  4 = Good — correct overall arc with minor issues
  3 = Partial — motion is recognisable but choppy or incomplete
  2 = Poor — only vaguely conveys the intended motion
  1 = Wrong — does not resemble the commanded motion

Respond strictly in this format:
Score: N
One or two sentences explaining your evaluation.`;

// ── prompt builders ────────────────────────────────────────────────────────────

/**
 * Build eval prompt for a single pose.
 *
 * @param {string} poseId
 * @param {string} description
 * @returns {{ system: string, userContent: (base64: string) => Array }}
 */
export function buildPoseEvalPrompt(poseId, description) {
  const system = POSE_SYSTEM;

  const userContent = (base64Png) => [
    {
      type: 'text',
      text: `Pose ID: "${poseId}"\nExpected pose: ${description}\n\nEvaluate the stick figure in the image:`,
    },
    {
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${base64Png}` },
    },
  ];

  return { system, userContent };
}

/**
 * Build eval prompt for a motion strip.
 *
 * @param {string} command  – motion command label (e.g. "walk_cycle")
 * @param {number} frameCount
 * @returns {{ system: string, userContent: (base64: string) => Array }}
 */
export function buildMotionEvalPrompt(command, frameCount) {
  const system = MOTION_SYSTEM;

  const userContent = (base64Png) => [
    {
      type: 'text',
      text: `Motion command: "${command}"\nFrames: ${frameCount} (left to right)\n\nEvaluate the motion strip:`,
    },
    {
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${base64Png}` },
    },
  ];

  return { system, userContent };
}

// ── response parser ────────────────────────────────────────────────────────────

/**
 * Parse "Score: N\nexplanation" text from a vision model response.
 *
 * @param {string} text
 * @returns {{ score: number, critique: string }}
 */
export function parseEvalResponse(text) {
  const match = text.match(/Score:\s*([1-5])/i);
  const score = match ? parseInt(match[1], 10) : 0;

  // Critique = everything after the score line (or the full text if no score).
  const critique = text.replace(/Score:\s*[1-5]\s*/i, '').trim() || text.trim();

  return { score, critique };
}

// ── provider detection ─────────────────────────────────────────────────────────

function detectProvider(apiKey) {
  if (!apiKey) return null;
  return apiKey.startsWith('sk-ant-') ? 'anthropic' : 'openai';
}

// ── API callers ────────────────────────────────────────────────────────────────

async function callOpenAI(system, contentParts, apiKey, model = 'gpt-4o-mini') {
  const messages = [
    { role: 'system', content: system },
    { role: 'user',   content: contentParts },
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: 200 }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callAnthropic(system, contentParts, apiKey, model = 'claude-haiku-3-5') {
  // Remap OpenAI-style content parts to Anthropic format.
  const anthropicContent = contentParts.map(part => {
    if (part.type === 'text') {
      return { type: 'text', text: part.text };
    }
    if (part.type === 'image_url') {
      // data:image/png;base64,<data>
      const base64 = part.image_url.url.replace(/^data:image\/\w+;base64,/, '');
      return {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: base64 },
      };
    }
    return part;
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system,
      messages: [{ role: 'user', content: anthropicContent }],
      max_tokens: 200,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

async function callVisionAPI(system, contentParts) {
  const apiKey   = process.env.MOTION_LLM_KEY ?? '';
  const provider = detectProvider(apiKey);

  if (!provider) {
    throw new Error('MOTION_LLM_KEY not set or unrecognised. Use sk-ant-* for Anthropic or sk-* for OpenAI.');
  }

  if (provider === 'anthropic') {
    return callAnthropic(system, contentParts, apiKey);
  }
  return callOpenAI(system, contentParts, apiKey);
}

// ── convenience wrappers ───────────────────────────────────────────────────────

/**
 * Evaluate a single pose image.
 *
 * @param {string} base64Png  – raw base64 of a PNG buffer
 * @param {string} poseId
 * @param {string} description
 * @returns {Promise<{ score: number, critique: string, raw: string }>}
 */
export async function evalPose(base64Png, poseId, description) {
  const { system, userContent } = buildPoseEvalPrompt(poseId, description);
  const raw = await callVisionAPI(system, userContent(base64Png));
  const { score, critique } = parseEvalResponse(raw);
  return { score, critique, raw };
}

/**
 * Evaluate a motion strip image.
 *
 * @param {string} base64Png  – raw base64 of a PNG buffer
 * @param {string} command
 * @param {number} frameCount
 * @returns {Promise<{ score: number, critique: string, raw: string }>}
 */
export async function evalMotion(base64Png, command, frameCount) {
  const { system, userContent } = buildMotionEvalPrompt(command, frameCount);
  const raw = await callVisionAPI(system, userContent(base64Png));
  const { score, critique } = parseEvalResponse(raw);
  return { score, critique, raw };
}
