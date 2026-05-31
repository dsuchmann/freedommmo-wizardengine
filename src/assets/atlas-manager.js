import { ImageAtlas } from './image-atlas.js';
import { ProceduralAtlas } from './procedural-atlas.js';
import { generatedAtlasDefs } from './generated-atlas-defs.js';
import { libraryAtlasDefs } from './library-atlas-defs.js';

export class AtlasManager {
  constructor() {
    this.generated = new ImageAtlas([...generatedAtlasDefs, ...libraryAtlasDefs]);
    this.fallback = new ProceduralAtlas();
  }

  frame(id, frameIndex = 0) {
    return this.generated.frame(id, frameIndex) ?? this.fallback.frame(id, frameIndex);
  }

  hasGenerated(id) {
    return this.generated.has(id);
  }

  stats() {
    return { generated: this.generated.stats(), fallback: true };
  }
}
