// src/life/eval/batch-generate.js — Generate motions for a list of commands.
// Usage: MOTION_LLM_KEY=sk-... node src/life/eval/batch-generate.js
import { composeChoreography } from './compose.js';
import { compilePlan } from './compile-plan.js';
import { renderStrip } from './stick-renderer.js';
import { evalMotion } from './vision-eval.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const key = process.env.MOTION_LLM_KEY;
if (!key) { console.error('Set MOTION_LLM_KEY env var'); process.exit(1); }

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));
const poses = JSON.parse(readFileSync('src/life/choreography/poses.json', 'utf8'));
const poseSummary = poses.map(p => ({ id: p.id, desc: p.desc }));
const cfg = { key };

const validatedDir = 'src/life/choreography/validated';
const evalDir = 'src/life/choreography/evals/motions';
mkdirSync(validatedDir, { recursive: true });
mkdirSync(evalDir, { recursive: true });

const COMMANDS = [
  'wave', 'bow', 'salute', 'clap', 'cheer', 'point forward', 'beckon', 'shrug',
  'nod', 'shake head', 'facepalm', 'flex muscles', 'taunt', 'wave both hands',
  'kneel', 'pray', 'curtsy', 'blow a kiss',
  'jumping jacks', 'pushup', 'situp', 'squat', 'lunge', 'plank', 'stretch arms',
  'touch toes', 'jump in place', 'crouch', 'march in place',
  'dig', 'hammer', 'chop wood', 'sweep floor', 'cast fishing line',
  'dance', 'spin around', 'moonwalk', 'tiptoe',
  'sit down', 'lie down on back', 'crawl', 'look around', 'yawn and stretch',
];

let passed = 0, failed = 0, skipped = 0;

for (const command of COMMANDS) {
  const id = command.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

  if (existsSync(`${validatedDir}/${id}.json`)) {
    console.log(`  SKIP ${id} (already validated)`);
    skipped++;
    continue;
  }

  console.log(`\n── ${command} ──`);
  let finalProgram = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { plan, error } = await composeChoreography(
      attempt === 0 ? command : `${command} (fix: previous attempt was wrong)`,
      poseSummary, cfg
    );
    if (error || !plan?.steps) { console.log(`  compose error: ${error}`); continue; }

    let program;
    try { program = compilePlan(plan, poses); } catch (e) { console.log(`  compile: ${e.message}`); continue; }
    if (program.missingPoses) { console.log(`  missing poses: ${program.missingPoses.join(', ')}`); continue; }

    const frames = program.root.children.map((c, i) => ({ joints: c.joints, label: plan.steps[i]?.pose || '' }));
    const stripBuf = await renderStrip(rig, frames, { frameWidth: 200, frameHeight: 400, title: command });
    writeFileSync(`${evalDir}/${id}.png`, stripBuf);

    const { score, critique } = await evalMotion(stripBuf.toString('base64'), command, frames.length);
    console.log(`  attempt ${attempt + 1}: ${score}/5 — ${critique}`);

    if (score >= 4) { finalProgram = program; break; }
    await new Promise(r => setTimeout(r, 500));
  }

  if (finalProgram) {
    writeFileSync(`${validatedDir}/${id}.json`, JSON.stringify(finalProgram, null, 2));
    console.log(`  ✓ PASS`);
    passed++;
  } else {
    console.log(`  ✗ FAIL`);
    failed++;
  }

  await new Promise(r => setTimeout(r, 300));
}

console.log(`\n\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped of ${COMMANDS.length} total`);
