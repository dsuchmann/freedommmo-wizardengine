# Performance Infrastructure Spec

> Established 2026-05-26. Three-layer performance foundation for FreedomMMO.

## Problem

GDScript is interpreted (~100x slower than native). A simple 4096-tile loop takes 30-50ms. The RTX 3090 sits idle. This blocks every future system — terrain, NPCs, combat, lighting, particles. Must fix now before building more.

## Three Stages (each independently valuable)

### Stage 1: GDExtension C++ Foundation

**Goal:** Move chunk compilation and image building to C++. Establish the build pipeline that all future native code uses.

**Scope:**
- Set up GDExtension project structure (SCons/CMake, godot-cpp bindings)
- Port `ElevationLayer.compile()` to C++ (noise evaluation loop — biggest bottleneck)
- Port `build_chunk_image()` to C++ (4096 tile blits)
- Port `BiomeLayer.compile()` and `ClimateLayer.compile()` to C++
- GDScript calls the C++ class the same way it calls the GDScript class (drop-in replacement)
- Verify: chunk compilation < 1ms, image building < 1ms

**Deliverable:** Chunks compile and render with zero perceptible cost. Walking and teleporting are butter smooth.

**Validation:** Walk across 20+ chunk boundaries with FPS counter visible. No drops below 55fps.

---

### Stage 2: Python GPU Batch Pipeline

**Goal:** Adapt the existing `python_generator_gpu.py` (CuPy/CUDA on RTX 3090) for batch terrain pre-generation.

**Scope:**
- Adapt the Python GPU generator to output our ChunkCache binary format (not the old 512x512 region format)
- Accept overmap noise parameters so generated chunks match the overmap
- Generate overmap itself on GPU (41M pixels in seconds, not 30 seconds)
- Batch mode: pre-generate a spiral of chunks around a position (e.g., 100x100 = 10K chunks)
- Godot calls Python as a background process, polls for completion, loads results from ChunkCache

**Deliverable:** `python tools/generate_world.py --seed 42 --center 0,0 --radius 50` pre-generates 10K chunks in under 60 seconds. Godot loads them instantly from cache.

**Validation:** Teleport anywhere in pre-generated area. Instant terrain, no compilation needed.

---

### Stage 3: Compute Shader Framework

**Goal:** Set up Godot RenderingDevice compute shaders for real-time GPU work. Start with terrain, extend to lighting/particles later.

**Scope:**
- Create compute shader framework (load GLSL, create pipeline, dispatch, read results)
- Port terrain noise evaluation to GLSL compute shader (64x64 tiles = 4096 GPU threads)
- Port chunk image building to compute shader (read tile atlas, write chunk image)
- Framework for future shaders: lighting accumulation, water simulation, particle fields, fog density

**Deliverable:** Real-time chunk generation on GPU. Compile + render a chunk in < 0.5ms.

**Validation:** Disable ChunkCache, walk continuously. Chunks generate and render in real-time with no frame drops.

---

## Execution Order

```
Stage 1 (GDExtension C++)
  ↓ validates: smooth streaming, build pipeline works
Stage 2 (Python GPU batch)
  ↓ validates: pre-generation, overmap consistency
Stage 3 (Compute shaders)
  ↓ validates: real-time GPU generation, framework for lighting/particles
```

Each stage is a separate session. Each produces a working, testable improvement. No stage depends on the others being complete — they're complementary, not sequential.

## What NOT to Build

- Don't port game logic (NPC AI, dialogue, quests) to C++ yet — GDScript is fine for logic that runs once per frame
- Don't build the lighting/particle shaders yet — just the framework
- Don't optimize the overmap generator yet — it runs once and caches
- Don't pre-generate the entire 41M chunk world — just the tools to do it incrementally
