export const PALETTES = Object.freeze({
  deep_ocean: ['#0b2d56', '#123d68', '#1a4b78'],
  ocean: ['#174f83', '#1c5d8f', '#2470a4'],
  shallow_water: ['#2f83a7', '#49a7bb', '#7ccad0'],
  river: ['#287ca4', '#39a6c0', '#8fd6dc'],
  lake: ['#236f93', '#3b91aa', '#77c0c8'],
  beach: ['#cfae61', '#d8bd75', '#ead390'],
  grassland: ['#4d8d3e', '#5fa64b', '#7ec35d'],
  forest: ['#255c31', '#2f7137', '#498b47'],
  dense_forest: ['#173d25', '#1f4e2d', '#2f6536'],
  tropical_forest: ['#1d6638', '#247b3d', '#35a04b'],
  taiga: ['#294d42', '#315d4c', '#47705e'],
  savanna: ['#9c8d3f', '#b3a24c', '#d2bd61'],
  steppe: ['#7d8a47', '#8f9a54', '#a9ad64'],
  desert: ['#c98e3f', '#d7a94f', '#efc56d'],
  swamp: ['#34563f', '#42694a', '#597a51'],
  tundra: ['#839890', '#9fb0aa', '#c1cac3'],
  arctic: ['#b1d8e5', '#c9e5ee', '#eefcff'],
  hills: ['#706c4d', '#827d55', '#99905f'],
  mountains: ['#666b72', '#777b82', '#989ca1'],
  volcanic: ['#332d2f', '#4a3f3c', '#7a4a32'],
  mystic: ['#47306f', '#8a5bd6', '#49d6c5']
});

export function paletteFor(biome) {
  return PALETTES[biome] ?? PALETTES.grassland;
}
