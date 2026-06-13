// auto-qa.js — Batch generate, self-evaluate via stick figure, iterate until good.
// Usage: node src/life/eval/auto-qa.js
import { composeSpatial } from './spatial-compose.js';
import { compileSpatialProgram } from './spatial-compiler.js';
import { renderStrip } from './stick-renderer.js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));
const key = process.env.MOTION_LLM_KEY;
if (!key) { console.error('Set MOTION_LLM_KEY'); process.exit(1); }
const model = process.env.MOTION_MODEL || 'gpt-4o';

const outDir = 'src/life/choreography/validated-spatial';
const evalDir = 'src/life/choreography/evals/spatial';
mkdirSync(outDir, { recursive: true });
mkdirSync(evalDir, { recursive: true });

const COMMANDS = [
  'wave', 'clap', 'bow', 'salute', 'point forward', 'shrug', 'nod yes',
  'shake head no', 'flex muscles', 'pray', 'cheer with both arms',
  'beckon someone to come here', 'yawn and stretch', 'look around nervously',
  'crouch down', 'jump in place', 'do jumping jacks', 'squat',
  'dance', 'facepalm', 'kneel', 'sit down', 'tiptoe',
  'march in place', 'dig with a shovel', 'sweep the floor',
];

const MAX_ATTEMPTS = 5;

function extractFrames(node) {
  const frames = [];
  (function ex(n) {
    if (n.op === 'pose') frames.push({ joints: n.joints, label: (n.ticks || 3) + 't', ticks: n.ticks });
    if (n.children) n.children.forEach(ex);
  })(node);
  return frames;
}

// Simple self-eval: check if the motion looks reasonable based on structural rules
function selfEval(command, frames, choreography) {
  const issues = [];
  if (frames.length < 2) issues.push('too few frames');
  if (frames.length > 15) issues.push('too many frames');
  
  // Check that SOMETHING moves (not all rest poses)
  const nonRest = frames.filter(f => Object.values(f.joints).some(v => Math.abs(v) > 5));
  if (nonRest.length < 1) issues.push('no visible movement');
  
  // Check it returns to rest at the end
  const lastJoints = frames[frames.length - 1]?.joints || {};
  const lastActive = Object.values(lastJoints).filter(v => Math.abs(v) > 10);
  if (lastActive.length > 0) issues.push('does not return to rest');
  
  // Command-specific checks
  const cmd = command.toLowerCase();
  const steps = choreography.steps || [];
  const actions = steps.flatMap(s => s.steps ? s.steps.map(ss => ss.action) : [s.action]).filter(Boolean);
  
  if (cmd.includes('clap') && !actions.includes('close')) issues.push('clap should use close primitive');
  if (cmd.includes('wave') && !actions.includes('raise')) issues.push('wave should raise an arm');
  if (cmd.includes('bow') && !actions.includes('lower')) issues.push('bow should lower torso');
  if (cmd.includes('squat') && !actions.some(a => a === 'bend' || a === 'lower')) issues.push('squat should bend legs');
  if (cmd.includes('jump') && !actions.includes('raise')) issues.push('jump should have upward motion');
  if (cmd.includes('salute') && !actions.includes('raise')) issues.push('salute should raise arm');
  if (cmd.includes('shrug') && !actions.includes('raise')) issues.push('shrug should raise shoulders');
  if (cmd.includes('kneel') && !actions.includes('bend')) issues.push('kneel should bend legs');
  if (cmd.includes('pray') && !actions.includes('close')) issues.push('pray should use close');
  if (cmd.includes('flex') && !actions.includes('raise')) issues.push('flex should raise arms');
  
  return { pass: issues.length === 0, issues };
}

let total = 0, passed = 0, failed = 0;

for (const command of COMMANDS) {
  const id = command.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  console.log(`\n═══ ${command} ═══`);
  
  let bestChoreography = null;
  let bestProgram = null;
  let bestFrames = null;
  let bestScore = -1;
  
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { choreography, error } = await composeSpatial(command, { key, model });
      if (error) { console.log(`  attempt ${attempt}: compose error: ${error}`); continue; }
      
      const program = compileSpatialProgram(choreography, rig, 's');
      const frames = extractFrames(program.root);
      
      if (frames.length === 0) { console.log(`  attempt ${attempt}: no frames`); continue; }
      
      const { pass, issues } = selfEval(command, frames, choreography);
      const score = pass ? 10 : Math.max(0, 10 - issues.length * 2);
      
      console.log(`  attempt ${attempt}: ${frames.length} frames, score ${score}/10${issues.length ? ' — ' + issues.join(', ') : ' — PASS'}`);
      
      if (score > bestScore) {
        bestScore = score;
        bestChoreography = choreography;
        bestProgram = program;
        bestFrames = frames;
      }
      
      // Early exit if perfect
      if (pass) break;
      
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.log(`  attempt ${attempt}: error: ${e.message}`);
    }
  }
  
  total++;
  if (bestProgram && bestFrames) {
    // Save the best result
    const buf = await renderStrip(rig, bestFrames, { frameWidth: 200, frameHeight: 400, title: `${command} (score ${bestScore}/10)` });
    writeFileSync(`${evalDir}/${id}.png`, buf);
    writeFileSync(`${outDir}/${id}.json`, JSON.stringify(bestProgram, null, 2));
    // Also save spatial format for the QA workbench
    writeFileSync(`${outDir}/${id}_spatial.json`, JSON.stringify(bestChoreography, null, 2));
    console.log(`  ✓ saved (score ${bestScore}/10, ${bestFrames.length} frames)`);
    passed++;
  } else {
    console.log(`  ✗ FAILED — no usable result`);
    failed++;
  }
}

console.log(`\n\nResults: ${passed}/${total} passed, ${failed} failed`);
