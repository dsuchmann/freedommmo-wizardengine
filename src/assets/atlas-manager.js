import { ImageAtlas } from './image-atlas.js';
import { ProceduralAtlas } from './procedural-atlas.js';
import { generatedAtlasDefs } from './generated-atlas-defs.js';
import { godotTerrainDefs, godotObjectDefs } from './godot-asset-defs.js';
import { godotWangDefs } from './godot-wang-defs.js';
import { landscapeArtDefs } from './landscape-art-defs.js';

export class AtlasManager {
  constructor() {
    this.generated = new ImageAtlas([...godotWangDefs, ...godotTerrainDefs, ...godotObjectDefs, ...landscapeArtDefs, ...generatedAtlasDefs]);
    this.fallback = new ProceduralAtlas();
  }

  frame(id, frameIndex = 0) {
    return this.generated.frame(id, frameIndex) ?? this.fallback.frame(id, frameIndex);
  }

  generatedFrame(id, frameIndex = 0) {
    return this.generated.frame(id, frameIndex);
  }

  sourceForFrame(id) {
    return this.generated.sourceForFrame(id);
  }

  hasGenerated(id) {
    return this.generated.has(id);
  }

  stats() {
    return { generated: this.generated.stats(), fallback: true };
  }
}
