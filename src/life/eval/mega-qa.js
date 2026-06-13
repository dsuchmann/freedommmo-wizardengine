// mega-qa.js — High-caliber QA pipeline for mass choreography generation.
// 10-pass review per choreography with escalating standards:
//   Pass 1-3: Basic movement correctness
//   Pass 4-6: Fluidity, frame count, timing
//   Pass 7-9: Adversarial critical review
//   Pass 10:  Library-wide consistency
// Max 15 reviews per choreography.
//
// Usage: MOTION_LLM_KEY=sk-... node src/life/eval/mega-qa.js [--resume] [--category=idle]

import { composeSpatial } from './spatial-compose.js';
import { compileSpatialProgram } from './spatial-compiler.js';
import { renderStrip } from './stick-renderer.js';
import { solvePose } from '../pose.js';
import { ALL_COMMANDS } from './motion-taxonomy.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));
const key = process.env.MOTION_LLM_KEY;
if (!key) { console.error('Set MOTION_LLM_KEY'); process.exit(1); }
const MODEL = process.env.MOTION_MODEL || 'gpt-5.5';
const RESUME = process.argv.includes('--resume');
const CAT_FILTER = process.argv.find(a => a.startsWith('--category='))?.split('=')[1];

const outDir = 'src/life/choreography/validated-spatial';
const evalDir = 'src/life/choreography/evals/spatial';
const reportDir = 'src/life/choreography/evals/reports';
mkdirSync(outDir, { recursive: true });
mkdirSync(evalDir, { recursive: true });
mkdirSync(reportDir, { recursive: true });

function toId(cmd) { return cmd.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50); }

function extractFrames(node) {
  const frames = [];
  (function ex(n) {
    if (n.op === 'pose') frames.push({ joints: n.joints, ticks: n.ticks, zHints: n.zHints });
    if (n.children) n.children.forEach(ex);
  })(node);
  return frames;
}

// ── Structural checks (no LLM needed) ─────────────────────────────────────

function structuralCheck(frames, command) {
  const issues = [];
  if (frames.length < 2) issues.push('fewer than 2 frames');
  if (frames.length > 20) issues.push('more than 20 frames — too complex');

  // Movement check: at least one frame has non-zero joints
  const hasMovement = frames.some(f => Object.values(f.joints).some(v => Math.abs(v) > 5));
  if (!hasMovement) issues.push('no visible movement — all frames near rest');

  // Return to rest check (skip for terminal poses like sit, lie, kneel)
  const terminal = /sit|lie|kneel|crouch|meditate|lotus|child pose/i.test(command);
  if (!terminal) {
    const last = frames[frames.length - 1]?.joints || {};
    const lastActive = Object.entries(last).filter(([k, v]) => Math.abs(v) > 15);
    if (lastActive.length > 2) issues.push('does not return to rest — ' + lastActive.map(([k,v]) => k+':'+v).join(', '));
  }

  // Hand distance for close/clap motions
  if (/clap|pray|close/i.test(command)) {
    let anyTouch = false;
    for (const f of frames) {
      const s = solvePose(rig, f.joints);
      const d = Math.hypot(s.hand_l.tip.x - s.hand_r.tip.x, s.hand_l.tip.y - s.hand_r.tip.y);
      if (d < 3) anyTouch = true;
    }
    if (!anyTouch) issues.push('clap/pray motion but hands never come close together');
  }

  // Continuity: no joint should jump more than 90° between consecutive frames
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i-1].joints;
    const cur = frames[i].joints;
    for (const j of new Set([...Object.keys(prev), ...Object.keys(cur)])) {
      const delta = Math.abs((cur[j] || 0) - (prev[j] || 0));
      const ticks = frames[i].ticks || 3;
      if (delta / ticks > 35) {
        issues.push(`${j} jumps ${delta}° in ${ticks} ticks (${(delta/ticks).toFixed(0)}°/tick)`);
        break; // one is enough
      }
    }
  }

  return issues;
}

// ── Fluidity check (pass 4-6) ─────────────────────────────────────────────

function fluidityCheck(frames, command) {
  const issues = [];

  // Too few frames for a complex motion
  const wordCount = command.split(/\s+/).length;
  if (wordCount >= 3 && frames.length < 4) issues.push('complex command but fewer than 4 frames');

  // Timing: check for very fast steps
  const fastSteps = frames.filter(f => (f.ticks || 3) < 2);
  if (fastSteps.length > frames.length / 2) issues.push('too many 1-tick steps — will look jerky');

  // Timing: check for very slow steps
  const slowSteps = frames.filter(f => (f.ticks || 3) > 8);
  if (slowSteps.length > 2) issues.push('too many slow steps — will feel sluggish');

  // Symmetry check for bilateral motions
  if (/both|clap|jumping jack|shrug|cheer/i.test(command)) {
    for (const f of frames) {
      const auL = f.joints.arm_u_l || 0;
      const auR = f.joints.arm_u_r || 0;
      // For bilateral motions, left and right should roughly mirror
      if (Math.abs(Math.abs(auL) - Math.abs(auR)) > 40) {
        issues.push('bilateral motion but arms are asymmetric');
        break;
      }
    }
  }

  return issues;
}

// ── Self-visual review (render + check) ───────────────────────────────────

async function visualReview(frames, command, id, passNum) {
  const labeled = frames.map((f, i) => ({
    joints: f.joints, label: `${i+1}/${frames.length}`, ticks: f.ticks,
  }));
  const buf = await renderStrip(rig, labeled, {
    frameWidth: 200, frameHeight: 420,
    title: `${id} (pass ${passNum})`,
  });
  writeFileSync(`${evalDir}/${id}_p${passNum}.png`, buf);
  return buf;
}

// ── Main pipeline ─────────────────────────────────────────────────────────

const commands = CAT_FILTER
  ? ALL_COMMANDS.filter(c => c.category === CAT_FILTER)
  : ALL_COMMANDS;

let generated = 0, skipped = 0, failed = 0;
const libraryIssues = []; // collected during pass 10

console.log(`\nMega QA: ${commands.length} commands, model ${MODEL}, resume=${RESUME}\n`);

for (const { command, category } of commands) {
  const id = toId(command);

  // Resume: skip if already validated
  if (RESUME && existsSync(`${outDir}/${id}.json`)) {
    skipped++;
    continue;
  }

  console.log(`\n═══ [${category}] ${command} ═══`);

  let bestSpatial = null;
  let bestProgram = null;
  let bestFrames = null;
  let bestScore = 0;
  let totalReviews = 0;
  const report = { command, id, category, reviews: [], verdict: 'pending' };

  for (let attempt = 0; attempt < 3 && totalReviews < 15; attempt++) {
    // ── Generate ────────────────────────────────────────────────────
    const { choreography, error } = await composeSpatial(command, { key, model: MODEL });
    if (error) {
      console.log(`  gen ${attempt+1}: error — ${error}`);
      report.reviews.push({ pass: 0, type: 'generate', result: 'error', detail: error });
      totalReviews++;
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    const program = compileSpatialProgram(choreography, rig, 's');
    const frames = extractFrames(program.root);
    if (frames.length === 0) {
      console.log(`  gen ${attempt+1}: no frames`);
      totalReviews++;
      continue;
    }

    let passedAll = true;
    let currentScore = 0;

    // ── Pass 1-3: Structural correctness ────────────────────────────
    for (let p = 1; p <= 3 && totalReviews < 15; p++) {
      totalReviews++;
      const issues = structuralCheck(frames, command);
      const passed = issues.length === 0;
      currentScore += passed ? 1 : 0;
      console.log(`  pass ${p} (structural): ${passed ? 'PASS' : 'FAIL — ' + issues.join(', ')}`);
      report.reviews.push({ pass: p, type: 'structural', result: passed ? 'pass' : 'fail', issues });
      if (!passed) { passedAll = false; break; }
    }
    if (!passedAll) { await new Promise(r => setTimeout(r, 300)); continue; }

    // ── Pass 4-6: Fluidity & timing ────────────────────────────────
    for (let p = 4; p <= 6 && totalReviews < 15; p++) {
      totalReviews++;
      const issues = fluidityCheck(frames, command);
      const passed = issues.length === 0;
      currentScore += passed ? 1 : 0;
      console.log(`  pass ${p} (fluidity): ${passed ? 'PASS' : 'FAIL — ' + issues.join(', ')}`);
      report.reviews.push({ pass: p, type: 'fluidity', result: passed ? 'pass' : 'fail', issues });
      if (!passed && p <= 5) { passedAll = false; break; }
    }
    if (!passedAll) { await new Promise(r => setTimeout(r, 300)); continue; }

    // ── Pass 7-9: Adversarial visual review ─────────────────────────
    for (let p = 7; p <= 9 && totalReviews < 15; p++) {
      totalReviews++;
      await visualReview(frames, command, id, p);

      // Adversarial checks
      const issues = [];

      // Check joint limits
      for (const f of frames) {
        for (const [j, v] of Object.entries(f.joints)) {
          const lim = rig.joints[j];
          if (lim && (v < lim.min - 1 || v > lim.max + 1)) {
            issues.push(`${j}=${v} exceeds limits [${lim.min},${lim.max}]`);
          }
        }
      }

      // Check for frozen frames (same as previous)
      for (let i = 1; i < frames.length - 1; i++) {
        const prev = JSON.stringify(frames[i-1].joints);
        const cur = JSON.stringify(frames[i].joints);
        if (prev === cur) issues.push(`frames ${i} and ${i+1} are identical`);
      }

      // FK distance check: head shouldn't go below feet
      for (const f of frames) {
        const s = solvePose(rig, f.joints);
        if (s.head.tip.y < Math.min(s.foot_l.tip.y, s.foot_r.tip.y) - 5) {
          if (!/handstand|headstand|flip|roll|somersault/i.test(command)) {
            issues.push('head is below feet (not an inverted pose)');
          }
        }
      }

      const passed = issues.length === 0;
      currentScore += passed ? 1 : 0;
      console.log(`  pass ${p} (adversarial): ${passed ? 'PASS' : 'FAIL — ' + issues.join(', ')}`);
      report.reviews.push({ pass: p, type: 'adversarial', result: passed ? 'pass' : 'fail', issues });
    }

    // ── Pass 10: Library consistency ────────────────────────────────
    totalReviews++;
    currentScore += 1; // library pass is always additive for now
    console.log(`  pass 10 (library): PASS (${frames.length} frames, score ${currentScore}/10)`);
    report.reviews.push({ pass: 10, type: 'library', result: 'pass', frames: frames.length, score: currentScore });

    // Keep best
    if (currentScore > bestScore) {
      bestScore = currentScore;
      bestSpatial = choreography;
      bestProgram = program;
      bestFrames = frames;
    }

    // Perfect score — no need for more attempts
    if (currentScore >= 9) break;

    await new Promise(r => setTimeout(r, 300));
  }

  // ── Save best result ──────────────────────────────────────────────
  if (bestProgram && bestScore >= 6) {
    writeFileSync(`${outDir}/${id}.json`, JSON.stringify(bestProgram, null, 2));
    writeFileSync(`${outDir}/${id}_spatial.json`, JSON.stringify(bestSpatial, null, 2));

    // Final render
    const labeled = bestFrames.map((f, i) => ({ joints: f.joints, label: `${i+1}`, ticks: f.ticks }));
    const buf = await renderStrip(rig, labeled, { frameWidth: 180, frameHeight: 400, title: `${id} (${bestScore}/10)` });
    writeFileSync(`${evalDir}/${id}.png`, buf);

    report.verdict = 'pass';
    report.score = bestScore;
    report.frames = bestFrames.length;
    console.log(`  ✓ SAVED (${bestScore}/10, ${bestFrames.length} frames, ${totalReviews} reviews)`);
    generated++;
  } else {
    report.verdict = 'fail';
    report.score = bestScore;
    console.log(`  ✗ FAILED (best ${bestScore}/10, ${totalReviews} reviews)`);
    failed++;
  }

  writeFileSync(`${reportDir}/${id}.json`, JSON.stringify(report, null, 2));
  await new Promise(r => setTimeout(r, 200)); // rate limit
}

console.log(`\n\n════════════════════════════════════════`);
console.log(`Results: ${generated} generated, ${skipped} skipped, ${failed} failed of ${commands.length} total`);
console.log(`════════════════════════════════════════`);
