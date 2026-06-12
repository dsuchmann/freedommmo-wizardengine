// scripts/asset-corpus/lib/emit.mjs
// Pure: registry -> batch (job records the runner consumes). No I/O.
import { resolveDerived } from './enumerate.mjs';

export function emitBatch(regIn, registryById) {
  const reg = resolveDerived(regIn, registryById);
  if (reg.status === 'dormant') throw new Error(`${reg.id} is dormant — not emittable`);
  if (reg.category === 'wang') return emitWang(reg);
  return emitObject(reg);
}

function emitObject(reg) {
  const jobs = [];
  for (const a of reg.archetypes) {
    for (const biome of a.biomes) {
      const id = `${biome}/${a.name}`;
      const out = `${reg.output_root}/${biome}/${a.name}`;
      jobs.push({
        kind: 'create', id, out,
        size: reg.size, keep: reg.variants,
        calls: reg.create_calls, candidates: reg.candidates_per_call,
        prompt: reg.prompt_template.replaceAll('{desc}', a.desc),
      });
      const states = { ...reg.states, ...(a.fruit ? reg.fruit_states : {}) };
      for (const [st, edit] of Object.entries(states)) {
        jobs.push({
          kind: 'state', id: `${id}/${st}`, parent: id,
          out: `${out}/_states/${st}`, pool: reg.variants, edit,
        });
      }
      for (const animState of reg.anim?.states ?? []) {
        jobs.push({
          kind: 'anim', id: `${id}/${reg.anim.name}`, parent: id, animState,
          out: `${out}/anim/${reg.anim.name}`, action: reg.anim.action, frames: reg.anim.frames,
        });
      }
    }
  }
  return batchOf(reg, jobs);
}

function emitWang(reg) {
  const jobs = [];
  for (const m of reg.materials) {
    for (const biome of reg.biomes) {
      jobs.push({
        kind: 'wang', id: `${m.name}__${biome}`,
        out: `${reg.output_root}/${m.name}__${biome}`,
        tile_size: reg.tile_size,
        lower_biome: biome,             // runner resolves desc + base tile id
        upper_description: m.desc,
        transition_size: reg.transition_size ?? 0.5,
      });
    }
  }
  return batchOf(reg, jobs);
}

export function emitPilotBatch(regIn, registryById) {
  const reg = resolveDerived(regIn, registryById);
  if (!reg.pilot) throw new Error(`${reg.id} declares no pilot subset`);
  const sub = { ...reg, status: 'armed' };
  if (reg.category === 'wang') {
    sub.materials = reg.materials.filter((m) => reg.pilot.materials.includes(m.name));
    sub.biomes = reg.pilot.biomes;
  } else {
    sub.archetypes = reg.archetypes.filter((a) => reg.pilot.archetypes.includes(a.name));
  }
  const batch = emitBatch(sub, registryById);
  return { ...batch, burst: `${batch.burst}-pilot`, gate: 'pilot' };
}

function batchOf(reg, jobs) {
  jobs.sort((a, b) => a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
  return {
    burst: `${reg.consuming_plan.toLowerCase()}-${reg.id}`,
    registry: reg.id, gate: reg.status, jobs,
  };
}
