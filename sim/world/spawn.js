import { rand, randRange } from '../kernel/rng.js';
import { DAY } from '../time/metabolism.js';

// Deterministic baseline meadow (spec §5.1). Densities are per-tile probabilities.
const DENSITY = { grass: 0.5, berry_bush: 0.05, grazer: 0.004, tree: 0.02 };
const START = {
  grass:      { R: [200, 1500],   body: [10, 60],    maxAgeDays: 50 },
  berry_bush: { R: [3000, 15000], body: [500, 3000], maxAgeDays: 600 },
  grazer:     { R: [20000, 60000], body: [2000, 8000], maxAgeDays: 1500 },
  tree:       { R: [10000, 40000], body: [5000, 30000], maxAgeDays: 3000 },
};

export function spawnMeadow(kernel, { x0, y0, w, h }) {
  kernel.graph.boot(() => {
    for (let ty = y0; ty < y0 + h; ty++) {
      for (let tx = x0; tx < x0 + w; tx++) {
        let salt = 0;
        for (const species of Object.keys(DENSITY)) {
          salt += 1000;
          if (rand(kernel.seed, tx * 31 + salt, ty * 17 + salt) < DENSITY[species]) {
            const s = START[species];
            kernel.addLiving({
              species,
              x: tx + rand(kernel.seed, tx + salt + 1, ty),
              y: ty + rand(kernel.seed, tx, ty + salt + 2),
              R: randRange(kernel.seed, tx + salt + 3, ty, s.R[0], s.R[1]),
              body: randRange(kernel.seed, tx + salt + 4, ty, s.body[0], s.body[1]),
              tick: 0,
              age: Math.floor(randRange(kernel.seed, tx + salt + 5, ty, 0, s.maxAgeDays * DAY)),
            });
          }
        }
      }
    }
  });
}
