export const OBJECT_SCATTER_RULES = Object.freeze({
  mystic: {
    trees: { clusterScale: 9, clusterDensity: 0.42, solitaryDensity: 0.08, avoidGrid: true },
    stones: { clusterScale: 7, clusterDensity: 0.28, solitaryDensity: 0.05, avoidGrid: true },
    flowers: { clusterScale: 5, clusterDensity: 0.50, solitaryDensity: 0.12, avoidGrid: true },
    insects: { clusterScale: 11, clusterDensity: 0.38, solitaryDensity: 0.10, avoidGrid: true }
  },
  forest: {
    trees: { clusterScale: 8, clusterDensity: 0.55, solitaryDensity: 0.12, avoidGrid: true },
    shrubs: { clusterScale: 6, clusterDensity: 0.40, solitaryDensity: 0.10, avoidGrid: true },
    stones: { clusterScale: 9, clusterDensity: 0.22, solitaryDensity: 0.05, avoidGrid: true },
    flowers: { clusterScale: 7, clusterDensity: 0.26, solitaryDensity: 0.08, avoidGrid: true }
  },
  default: {
    trees: { clusterScale: 10, clusterDensity: 0.28, solitaryDensity: 0.06, avoidGrid: true },
    shrubs: { clusterScale: 8, clusterDensity: 0.28, solitaryDensity: 0.08, avoidGrid: true },
    stones: { clusterScale: 7, clusterDensity: 0.20, solitaryDensity: 0.06, avoidGrid: true },
    flowers: { clusterScale: 6, clusterDensity: 0.22, solitaryDensity: 0.08, avoidGrid: true }
  }
});

export function scatterRuleFor(biome, family) {
  return OBJECT_SCATTER_RULES[biome]?.[family] ?? OBJECT_SCATTER_RULES.default[family] ?? OBJECT_SCATTER_RULES.default.flowers;
}
