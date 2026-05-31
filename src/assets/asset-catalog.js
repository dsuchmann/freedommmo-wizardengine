export class AssetCatalog {
  constructor(manifests = []) {
    this.assets = new Map();
    for (const manifest of manifests) this.addManifest(manifest);
  }

  addManifest(manifest) {
    for (const asset of manifest.assets ?? []) {
      this.assets.set(asset.id, { ...asset, domain: manifest.domain, tileSize: manifest.tileSize });
    }
  }

  findByBiomeAndCategory(biome, categoryPrefix) {
    return [...this.assets.values()].filter(asset => asset.category.startsWith(categoryPrefix) && asset.biomes?.includes(biome));
  }

  terrainForBiome(biome) {
    return this.findByBiomeAndCategory(biome, 'terrain.ground')[0] ?? this.assets.get('grassland_ground');
  }

  waterForBiome(biome) {
    return this.findByBiomeAndCategory(biome, 'terrain.water')[0] ?? this.assets.get('water_surface');
  }

  objectForKind(kind, biome) {
    if (kind === 'tree') return this.findByBiomeAndCategory(biome, 'vegetation.tree')[0];
    if (kind.includes('rock')) return this.findByBiomeAndCategory(biome, 'geology.rock')[0];
    if (kind === 'cave_entrance') return this.assets.get('cave_mouth');
    return this.findByBiomeAndCategory(biome, 'vegetation.underbrush')[0];
  }

  animationFor(assetId, clip = 'idle') {
    return this.assets.get(assetId)?.animations?.[clip] ?? null;
  }

  physicsFor(assetId) {
    return this.assets.get(assetId)?.physics ?? null;
  }

  collisionFor(assetId) {
    return this.assets.get(assetId)?.collision ?? [];
  }

  renderFor(assetId) {
    return this.assets.get(assetId)?.render ?? null;
  }
}
