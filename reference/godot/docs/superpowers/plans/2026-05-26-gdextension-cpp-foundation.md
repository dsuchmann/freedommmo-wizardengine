# GDExtension C++ Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up a GDExtension C++ build pipeline and port chunk compilation + image building hot paths from GDScript to native C++, achieving < 1ms per chunk compile.

**Architecture:** A single `NativeChunkCompiler` C++ class handles elevation, ocean mask, climate, and biome compilation in one call — no per-layer GDScript↔C++ boundary crossings. A second method `build_chunk_image` takes compiled chunk data + a pre-loaded wang tile atlas and outputs an RGBA8 Image. GDScript ChunkStreamer calls into C++ as a drop-in replacement for the existing GDScript layer pipeline.

**Tech Stack:** godot-cpp (git submodule), SCons, MSVC (Visual Studio Build Tools), Godot 4.4 GDExtension API

---

## File Structure

```
freedommmo/
├── gdextension/                        # NEW: C++ extension root
│   ├── SConstruct                      # SCons build file
│   ├── src/
│   │   ├── register_types.h            # Module registration header
│   │   ├── register_types.cpp          # Module registration impl
│   │   ├── native_chunk_compiler.h     # Main compiler class header
│   │   ├── native_chunk_compiler.cpp   # Elevation + ocean + climate + biome + image building
│   │   └── noise_sampler.h             # Inline noise helpers (FBM, ridged, warp)
│   └── godot-cpp/                      # Git submodule
├── bin/
│   └── freedommmo.gdextension          # Extension descriptor
├── scripts/core/chunk_streamer.gd      # MODIFY: use NativeChunkCompiler when available
└── scripts/core/world_compiler/
    └── tilemap_terrain_renderer.gd     # MODIFY: use native build_chunk_image when available
```

---

### Task 1: Set Up godot-cpp Submodule and Build Pipeline

**Files:**
- Create: `gdextension/SConstruct`
- Create: `gdextension/src/register_types.h`
- Create: `gdextension/src/register_types.cpp`
- Create: `bin/freedommmo.gdextension`

- [ ] **Step 1: Clone godot-cpp as a submodule**

```bash
cd C:/Users/daves/OneDrive/Documents/freedommmo
git submodule add -b 4.4 https://github.com/godotengine/godot-cpp.git gdextension/godot-cpp
```

- [ ] **Step 2: Install SCons**

```bash
pip install scons
```

- [ ] **Step 3: Create the SConstruct build file**

Create `gdextension/SConstruct`:

```python
#!/usr/bin/env python
import os
import sys

env = SConscript("godot-cpp/SConstruct")

# Add our source files
env.Append(CPPPATH=["src/"])
sources = Glob("src/*.cpp")

# Build the shared library
# Output goes to project bin/ directory
library = env.SharedLibrary(
    target="../bin/libfreedommmo{}{}".format(env["suffix"], env["SHLIBSUFFIX"]),
    source=sources,
)

Default(library)
```

- [ ] **Step 4: Create register_types.h**

Create `gdextension/src/register_types.h`:

```cpp
#ifndef FREEDOMMMO_REGISTER_TYPES_H
#define FREEDOMMMO_REGISTER_TYPES_H

#include <godot_cpp/core/class_db.hpp>

using namespace godot;

void initialize_freedommmo_module(ModuleInitializationLevel p_level);
void uninitialize_freedommmo_module(ModuleInitializationLevel p_level);

#endif // FREEDOMMMO_REGISTER_TYPES_H
```

- [ ] **Step 5: Create register_types.cpp (empty — no classes yet)**

Create `gdextension/src/register_types.cpp`:

```cpp
#include "register_types.h"

#include <gdextension_interface.h>
#include <godot_cpp/core/defs.hpp>
#include <godot_cpp/godot.hpp>

using namespace godot;

void initialize_freedommmo_module(ModuleInitializationLevel p_level) {
    if (p_level != MODULE_INITIALIZATION_LEVEL_SCENE) {
        return;
    }
    // Classes registered here in Task 3
}

void uninitialize_freedommmo_module(ModuleInitializationLevel p_level) {
    if (p_level != MODULE_INITIALIZATION_LEVEL_SCENE) {
        return;
    }
}

extern "C" {
GDExtensionBool GDE_EXPORT freedommmo_library_init(
    GDExtensionInterfaceGetProcAddress p_get_proc_address,
    const GDExtensionClassLibraryPtr p_library,
    GDExtensionInitialization *r_initialization) {

    godot::GDExtensionBinding::InitObject init_obj(p_get_proc_address, p_library, r_initialization);

    init_obj.register_initializer(initialize_freedommmo_module);
    init_obj.register_terminator(uninitialize_freedommmo_module);
    init_obj.set_minimum_library_initialization_level(MODULE_INITIALIZATION_LEVEL_SCENE);

    return init_obj.init();
}
}
```

- [ ] **Step 6: Create .gdextension descriptor**

Create `bin/freedommmo.gdextension`:

```ini
[configuration]

entry_symbol = "freedommmo_library_init"
compatibility_minimum = "4.4"
reloadable = true

[libraries]

windows.debug.x86_64 = "res://bin/libfreedommmo.windows.template_debug.x86_64.dll"
windows.release.x86_64 = "res://bin/libfreedommmo.windows.template_release.x86_64.dll"
linux.debug.x86_64 = "res://bin/libfreedommmo.linux.template_debug.x86_64.so"
linux.release.x86_64 = "res://bin/libfreedommmo.linux.template_release.x86_64.so"
```

- [ ] **Step 7: Build and verify the empty extension loads**

```bash
cd C:/Users/daves/OneDrive/Documents/freedommmo/gdextension
scons platform=windows target=template_debug
```

Expected: `bin/libfreedommmo.windows.template_debug.x86_64.dll` is created with no errors.

Then open Godot → Project → Project Settings → check GDExtension loads without errors in the Output panel.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/daves/OneDrive/Documents/freedommmo
git add gdextension/SConstruct gdextension/src/ bin/freedommmo.gdextension .gitmodules
git commit -m "feat: GDExtension C++ build pipeline with godot-cpp 4.4"
```

---

### Task 2: Implement NativeChunkCompiler — Noise + Elevation

**Files:**
- Create: `gdextension/src/noise_sampler.h`
- Create: `gdextension/src/native_chunk_compiler.h`
- Create: `gdextension/src/native_chunk_compiler.cpp`
- Modify: `gdextension/src/register_types.cpp`

This task implements the elevation compilation — the single most expensive layer (3 noise instances, 2 loops over 4096 tiles, ~50K noise evaluations).

- [ ] **Step 1: Create noise_sampler.h — inline Perlin noise helpers**

The GDScript code uses Godot's `FastNoiseLite`. In C++ we also use `FastNoiseLite` from godot-cpp (it's a Godot class accessible via the bindings). This header wraps the overmap sampling functions.

Create `gdextension/src/noise_sampler.h`:

```cpp
#ifndef NOISE_SAMPLER_H
#define NOISE_SAMPLER_H

#include <godot_cpp/classes/fast_noise_lite.hpp>
#include <godot_cpp/variant/vector2.hpp>
#include <cmath>

namespace freedommmo {

// Overmap noise parameters — must match OvermapGenerator.gd exactly
struct OvermapNoise {
    godot::Ref<godot::FastNoiseLite> continent;
    godot::Ref<godot::FastNoiseLite> ridge;
    godot::Ref<godot::FastNoiseLite> warp;
    godot::Ref<godot::FastNoiseLite> temp;
    godot::Ref<godot::FastNoiseLite> moist;

    void init(int world_seed) {
        continent.instantiate();
        continent->set_seed(world_seed);
        continent->set_noise_type(godot::FastNoiseLite::TYPE_PERLIN);
        continent->set_fractal_type(godot::FastNoiseLite::FRACTAL_FBM);
        continent->set_fractal_octaves(8);
        continent->set_frequency(0.008f);

        ridge.instantiate();
        ridge->set_seed(world_seed + 1000);
        ridge->set_noise_type(godot::FastNoiseLite::TYPE_PERLIN);
        ridge->set_fractal_type(godot::FastNoiseLite::FRACTAL_RIDGED);
        ridge->set_fractal_octaves(5);
        ridge->set_frequency(0.012f);

        warp.instantiate();
        warp->set_seed(world_seed + 777);
        warp->set_noise_type(godot::FastNoiseLite::TYPE_PERLIN);
        warp->set_fractal_type(godot::FastNoiseLite::FRACTAL_FBM);
        warp->set_fractal_octaves(4);
        warp->set_frequency(0.005f);

        temp.instantiate();
        temp->set_seed(world_seed + 333);
        temp->set_noise_type(godot::FastNoiseLite::TYPE_PERLIN);
        temp->set_fractal_type(godot::FastNoiseLite::FRACTAL_FBM);
        temp->set_fractal_octaves(6);
        temp->set_frequency(0.007f);

        moist.instantiate();
        moist->set_seed(world_seed + 500);
        moist->set_noise_type(godot::FastNoiseLite::TYPE_PERLIN);
        moist->set_fractal_type(godot::FastNoiseLite::FRACTAL_FBM);
        moist->set_fractal_octaves(6);
        moist->set_frequency(0.009f);
    }

    float sample_height(float px, float py) const {
        float warp_x = warp->get_noise_2d(px, py) * 25.0f;
        float warp_y = warp->get_noise_2d(px + 300.0f, py + 300.0f) * 25.0f;
        float wx = px + warp_x;
        float wy = py + warp_y;
        float c = (continent->get_noise_2d(wx, wy) + 1.0f) * 0.5f;
        float r = ridge->get_noise_2d(wx * 0.8f, wy * 0.8f);
        float h = c * 0.7f + r * 0.3f;
        return std::clamp(h, 0.0f, 1.0f);
    }

    float sample_temp(float px, float py, float h) const {
        float warp_x = warp->get_noise_2d(px, py) * 25.0f;
        float warp_y = warp->get_noise_2d(px + 300.0f, py + 300.0f) * 25.0f;
        float wx = px + warp_x;
        float wy = py + warp_y;
        float t = (temp->get_noise_2d(wx, wy) + 1.0f) * 0.5f;
        t -= h * 0.15f;
        return std::clamp(t, 0.0f, 1.0f);
    }

    float sample_moisture(float px, float py) const {
        float warp_x = warp->get_noise_2d(px, py) * 25.0f;
        float warp_y = warp->get_noise_2d(px + 300.0f, py + 300.0f) * 25.0f;
        float wx = px + warp_x;
        float wy = py + warp_y;
        float m = (moist->get_noise_2d(wx, wy) + 1.0f) * 0.5f;
        return std::clamp(m, 0.0f, 1.0f);
    }
};

} // namespace freedommmo

#endif // NOISE_SAMPLER_H
```

- [ ] **Step 2: Create native_chunk_compiler.h**

Create `gdextension/src/native_chunk_compiler.h`:

```cpp
#ifndef NATIVE_CHUNK_COMPILER_H
#define NATIVE_CHUNK_COMPILER_H

#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/classes/image.hpp>
#include <godot_cpp/classes/fast_noise_lite.hpp>
#include <godot_cpp/variant/packed_float32_array.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/vector2.hpp>

#include "noise_sampler.h"

namespace godot {

class NativeChunkCompiler : public RefCounted {
    GDCLASS(NativeChunkCompiler, RefCounted);

public:
    static const int CHUNK_SIZE = 64;
    static constexpr float SEA_LEVEL = 0.38f;

    // Biome enum — must match BiomeLayer.gd exactly
    enum Biome {
        OCEAN = 0, BEACH, GRASSLAND, FOREST, DENSE_FOREST, DESERT,
        SAVANNA, STEPPE, TUNDRA, TAIGA, MOUNTAINS, SWAMP,
        TROPICAL_FOREST, VOLCANIC, ARCTIC, LAKE, RIVER
    };

private:
    int _world_seed = 0;
    bool _noise_ready = false;
    freedommmo::OvermapNoise _overmap;

    // Detail noise for elevation (per-tile variation)
    Ref<FastNoiseLite> _detail_noise;
    Ref<FastNoiseLite> _ridge_noise;
    Ref<FastNoiseLite> _warp_noise;

    void _init_noise(int world_seed);
    void _compile_elevation(int chunk_x, int chunk_y, PackedFloat32Array &elevation, PackedFloat32Array &slope);
    void _compile_ocean_mask(const PackedFloat32Array &elevation, PackedByteArray &ocean_mask);
    void _compile_climate(int chunk_x, int chunk_y, const PackedFloat32Array &elevation, const PackedByteArray &ocean_mask, PackedFloat32Array &temperature, PackedFloat32Array &precipitation);
    void _compile_biome(const PackedFloat32Array &elevation, const PackedByteArray &ocean_mask, const PackedFloat32Array &temperature, const PackedFloat32Array &precipitation, PackedByteArray &biome_id);
    bool _near_ocean(const PackedByteArray &ocean_mask, int x, int y);
    float _eval_elevation_at(float wx, float wy);

protected:
    static void _bind_methods();

public:
    NativeChunkCompiler();
    ~NativeChunkCompiler();

    void set_world_seed(int seed);
    int get_world_seed() const;

    // Main entry point: compiles elevation, ocean, climate, biome in one call.
    // Returns a Dictionary with keys: "elevation", "slope", "ocean_mask",
    // "temperature", "precipitation", "biome_id"
    Dictionary compile_chunk(int chunk_x, int chunk_y);

    // Build chunk image from compiled data + wang tile cache.
    // wang_tiles: Dictionary of "tileset_dir/wang_idx" -> Image
    // biome_pairs: Dictionary of "biomeA|biomeB" -> tileset_dir
    // self_tilesets: Dictionary of biome_name -> tileset_dir
    Ref<Image> build_chunk_image(
        int chunk_x, int chunk_y,
        const PackedByteArray &biome_id,
        const PackedByteArray &ocean_mask,
        int world_seed,
        const Dictionary &wang_tiles,
        const Dictionary &biome_pairs,
        const Dictionary &self_tilesets,
        const Dictionary &tileset_upper,
        const Dictionary &biome_fallback,
        int tile_size
    );
};

} // namespace godot

#endif // NATIVE_CHUNK_COMPILER_H
```

- [ ] **Step 3: Create native_chunk_compiler.cpp — elevation + ocean + climate + biome**

Create `gdextension/src/native_chunk_compiler.cpp`:

```cpp
#include "native_chunk_compiler.h"
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <cmath>
#include <cstring>

using namespace godot;

NativeChunkCompiler::NativeChunkCompiler() {}
NativeChunkCompiler::~NativeChunkCompiler() {}

void NativeChunkCompiler::_bind_methods() {
    ClassDB::bind_method(D_METHOD("set_world_seed", "seed"), &NativeChunkCompiler::set_world_seed);
    ClassDB::bind_method(D_METHOD("get_world_seed"), &NativeChunkCompiler::get_world_seed);
    ClassDB::bind_method(D_METHOD("compile_chunk", "chunk_x", "chunk_y"), &NativeChunkCompiler::compile_chunk);
    ClassDB::bind_method(D_METHOD("build_chunk_image", "chunk_x", "chunk_y", "biome_id", "ocean_mask", "world_seed", "wang_tiles", "biome_pairs", "self_tilesets", "tileset_upper", "biome_fallback", "tile_size"), &NativeChunkCompiler::build_chunk_image);
}

void NativeChunkCompiler::set_world_seed(int seed) {
    _world_seed = seed;
    _noise_ready = false;
}

int NativeChunkCompiler::get_world_seed() const {
    return _world_seed;
}

void NativeChunkCompiler::_init_noise(int world_seed) {
    if (_noise_ready && _world_seed == world_seed) return;
    _world_seed = world_seed;

    _overmap.init(world_seed);

    // Detail noise — matches ElevationLayer.gd exactly
    _detail_noise.instantiate();
    _detail_noise->set_seed(world_seed + 4000);
    _detail_noise->set_noise_type(FastNoiseLite::TYPE_PERLIN);
    _detail_noise->set_fractal_type(FastNoiseLite::FRACTAL_FBM);
    _detail_noise->set_fractal_octaves(4);
    _detail_noise->set_frequency(0.03f);

    _ridge_noise.instantiate();
    _ridge_noise->set_seed(world_seed + 5000);
    _ridge_noise->set_noise_type(FastNoiseLite::TYPE_PERLIN);
    _ridge_noise->set_fractal_octaves(3);
    _ridge_noise->set_frequency(0.05f);

    _warp_noise.instantiate();
    _warp_noise->set_seed(world_seed + 6000);
    _warp_noise->set_noise_type(FastNoiseLite::TYPE_PERLIN);
    _warp_noise->set_frequency(0.02f);
    _warp_noise->set_fractal_octaves(3);

    _noise_ready = true;
}

float NativeChunkCompiler::_eval_elevation_at(float wx, float wy) {
    float warp_x = _warp_noise->get_noise_2d(wx, wy) * 8.0f;
    float warp_y = _warp_noise->get_noise_2d(wx + 500.0f, wy + 500.0f) * 8.0f;
    float wwx = wx + warp_x;
    float wwy = wy + warp_y;
    float detail = _detail_noise->get_noise_2d(wwx, wwy) * 0.08f;
    detail += std::abs(_ridge_noise->get_noise_2d(wwx, wwy)) * 0.05f;
    return detail;
}

void NativeChunkCompiler::_compile_elevation(int chunk_x, int chunk_y, PackedFloat32Array &elevation, PackedFloat32Array &slope) {
    const int S = CHUNK_SIZE;
    int origin_x = chunk_x * S;
    int origin_y = chunk_y * S;

    // Overmap corner sampling (4 calls, not 4096)
    float px = static_cast<float>(chunk_x + 320);
    float py = static_cast<float>(chunk_y + 320);
    float h_tl = _overmap.sample_height(px - 0.5f, py - 0.5f);
    float h_tr = _overmap.sample_height(px + 0.5f, py - 0.5f);
    float h_bl = _overmap.sample_height(px - 0.5f, py + 0.5f);
    float h_br = _overmap.sample_height(px + 0.5f, py + 0.5f);

    float *elev_ptr = elevation.ptrw();
    float *slope_ptr = slope.ptrw();

    // Pass 1: elevation
    for (int y = 0; y < S; y++) {
        float ty = static_cast<float>(y) / static_cast<float>(S);
        for (int x = 0; x < S; x++) {
            float tx = static_cast<float>(x) / static_cast<float>(S);
            float wx = static_cast<float>(origin_x + x);
            float wy = static_cast<float>(origin_y + y);

            // Bilinear interpolation
            float top = h_tl + (h_tr - h_tl) * tx;
            float bot = h_bl + (h_br - h_bl) * tx;
            float local_base = top + (bot - top) * ty;

            float detail = _eval_elevation_at(wx, wy);
            float h = local_base + detail;
            elev_ptr[y * S + x] = std::clamp(h, 0.0f, 1.0f);
        }
    }

    // Pass 2: slope
    for (int y = 0; y < S; y++) {
        for (int x = 0; x < S; x++) {
            float h_left, h_right, h_up, h_down;

            if (x > 0) h_left = elev_ptr[y * S + (x - 1)];
            else h_left = std::clamp(_overmap.sample_height(px - 0.5f, py + (static_cast<float>(y) / S - 0.5f)) + _eval_elevation_at(static_cast<float>(origin_x + x - 1), static_cast<float>(origin_y + y)), 0.0f, 1.0f);

            if (x < S - 1) h_right = elev_ptr[y * S + (x + 1)];
            else h_right = std::clamp(_overmap.sample_height(px + 0.5f, py + (static_cast<float>(y) / S - 0.5f)) + _eval_elevation_at(static_cast<float>(origin_x + x + 1), static_cast<float>(origin_y + y)), 0.0f, 1.0f);

            if (y > 0) h_up = elev_ptr[(y - 1) * S + x];
            else h_up = std::clamp(_overmap.sample_height(px + (static_cast<float>(x) / S - 0.5f), py - 0.5f) + _eval_elevation_at(static_cast<float>(origin_x + x), static_cast<float>(origin_y + y - 1)), 0.0f, 1.0f);

            if (y < S - 1) h_down = elev_ptr[(y + 1) * S + x];
            else h_down = std::clamp(_overmap.sample_height(px + (static_cast<float>(x) / S - 0.5f), py + 0.5f) + _eval_elevation_at(static_cast<float>(origin_x + x), static_cast<float>(origin_y + y + 1)), 0.0f, 1.0f);

            float dx_val = h_right - h_left;
            float dy_val = h_down - h_up;
            slope_ptr[y * S + x] = std::sqrt(dx_val * dx_val + dy_val * dy_val);
        }
    }
}

void NativeChunkCompiler::_compile_ocean_mask(const PackedFloat32Array &elevation, PackedByteArray &ocean_mask) {
    const int total = CHUNK_SIZE * CHUNK_SIZE;
    const float *elev = elevation.ptr();
    uint8_t *mask = ocean_mask.ptrw();
    for (int i = 0; i < total; i++) {
        mask[i] = (elev[i] < SEA_LEVEL) ? 1 : 0;
    }
}

void NativeChunkCompiler::_compile_climate(int chunk_x, int chunk_y, const PackedFloat32Array &elevation, const PackedByteArray &ocean_mask, PackedFloat32Array &temperature, PackedFloat32Array &precipitation) {
    const int S = CHUNK_SIZE;
    float px = static_cast<float>(chunk_x + 320);
    float py = static_cast<float>(chunk_y + 320);
    float base_h = _overmap.sample_height(px, py);

    float t_tl = _overmap.sample_temp(px - 0.5f, py - 0.5f, base_h);
    float t_tr = _overmap.sample_temp(px + 0.5f, py - 0.5f, base_h);
    float t_bl = _overmap.sample_temp(px - 0.5f, py + 0.5f, base_h);
    float t_br = _overmap.sample_temp(px + 0.5f, py + 0.5f, base_h);
    float m_tl = _overmap.sample_moisture(px - 0.5f, py - 0.5f);
    float m_tr = _overmap.sample_moisture(px + 0.5f, py - 0.5f);
    float m_bl = _overmap.sample_moisture(px - 0.5f, py + 0.5f);
    float m_br = _overmap.sample_moisture(px + 0.5f, py + 0.5f);

    const float *elev = elevation.ptr();
    float *temp_ptr = temperature.ptrw();
    float *precip_ptr = precipitation.ptrw();

    for (int y = 0; y < S; y++) {
        float ty = static_cast<float>(y) / static_cast<float>(S);
        for (int x = 0; x < S; x++) {
            float tx = static_cast<float>(x) / static_cast<float>(S);
            int i = y * S + x;
            float h = elev[i];

            float t_top = t_tl + (t_tr - t_tl) * tx;
            float t_bot = t_bl + (t_br - t_bl) * tx;
            float temp = t_top + (t_bot - t_top) * ty;
            temp -= (h - base_h) * 0.3f;
            temp_ptr[i] = std::clamp(temp, 0.0f, 1.0f);

            float m_top = m_tl + (m_tr - m_tl) * tx;
            float m_bot = m_bl + (m_br - m_bl) * tx;
            float moist = m_top + (m_bot - m_top) * ty;
            // Ocean distance boost skipped — requires cross-chunk BFS
            precip_ptr[i] = std::clamp(moist, 0.0f, 1.0f);
        }
    }
}

bool NativeChunkCompiler::_near_ocean(const PackedByteArray &ocean_mask, int x, int y) {
    const int S = CHUNK_SIZE;
    const uint8_t *mask = ocean_mask.ptr();
    for (int dy = -3; dy <= 3; dy++) {
        for (int dx = -3; dx <= 3; dx++) {
            int nx = x + dx;
            int ny = y + dy;
            if (nx >= 0 && nx < S && ny >= 0 && ny < S) {
                if (mask[ny * S + nx] == 1) return true;
            }
        }
    }
    return false;
}

void NativeChunkCompiler::_compile_biome(const PackedFloat32Array &elevation, const PackedByteArray &ocean_mask, const PackedFloat32Array &temperature, const PackedFloat32Array &precipitation, PackedByteArray &biome_id) {
    const int S = CHUNK_SIZE;
    const float *elev = elevation.ptr();
    const uint8_t *mask = ocean_mask.ptr();
    const float *temp = temperature.ptr();
    const float *precip = precipitation.ptr();
    uint8_t *biome = biome_id.ptrw();

    // Whittaker rules: [temp_min, temp_max, precip_min, precip_max, biome]
    struct Rule { float t_min, t_max, p_min, p_max; uint8_t b; };
    static const Rule rules[] = {
        {0.0f, 0.15f, 0.0f, 1.0f, ARCTIC},
        {0.15f, 0.3f, 0.0f, 0.4f, TUNDRA},
        {0.15f, 0.3f, 0.4f, 1.0f, TAIGA},
        {0.6f, 1.0f, 0.0f, 0.2f, DESERT},
        {0.6f, 1.0f, 0.2f, 0.5f, SAVANNA},
        {0.6f, 1.0f, 0.5f, 1.0f, TROPICAL_FOREST},
        {0.3f, 0.6f, 0.0f, 0.3f, STEPPE},
        {0.3f, 0.6f, 0.3f, 0.55f, GRASSLAND},
        {0.3f, 0.6f, 0.55f, 0.75f, FOREST},
        {0.3f, 0.6f, 0.75f, 1.0f, DENSE_FOREST},
    };
    static const int NUM_RULES = 10;

    for (int y = 0; y < S; y++) {
        for (int x = 0; x < S; x++) {
            int i = y * S + x;

            if (mask[i] == 1) { biome[i] = OCEAN; continue; }

            float h = elev[i];
            float t = temp[i];
            float p = precip[i];

            if (h > 0.82f) { biome[i] = MOUNTAINS; continue; }
            if (h < 0.42f && _near_ocean(ocean_mask, x, y)) { biome[i] = BEACH; continue; }
            if (p > 0.8f && h < 0.5f && t > 0.3f) { biome[i] = SWAMP; continue; }

            uint8_t b = GRASSLAND;
            for (int r = 0; r < NUM_RULES; r++) {
                if (t >= rules[r].t_min && t < rules[r].t_max && p >= rules[r].p_min && p < rules[r].p_max) {
                    b = rules[r].b;
                    break;
                }
            }
            biome[i] = b;
        }
    }
}

Dictionary NativeChunkCompiler::compile_chunk(int chunk_x, int chunk_y) {
    _init_noise(_world_seed);

    const int total = CHUNK_SIZE * CHUNK_SIZE;

    PackedFloat32Array elevation;
    elevation.resize(total);
    PackedFloat32Array slope;
    slope.resize(total);
    PackedByteArray ocean_mask;
    ocean_mask.resize(total);
    PackedFloat32Array temperature;
    temperature.resize(total);
    PackedFloat32Array precipitation;
    precipitation.resize(total);
    PackedByteArray biome_id;
    biome_id.resize(total);

    _compile_elevation(chunk_x, chunk_y, elevation, slope);
    _compile_ocean_mask(elevation, ocean_mask);
    _compile_climate(chunk_x, chunk_y, elevation, ocean_mask, temperature, precipitation);
    _compile_biome(elevation, ocean_mask, temperature, precipitation, biome_id);

    Dictionary result;
    result["elevation"] = elevation;
    result["slope"] = slope;
    result["ocean_mask"] = ocean_mask;
    result["temperature"] = temperature;
    result["precipitation"] = precipitation;
    result["biome_id"] = biome_id;
    return result;
}

Ref<Image> NativeChunkCompiler::build_chunk_image(
    int chunk_x, int chunk_y,
    const PackedByteArray &biome_id,
    const PackedByteArray &ocean_mask,
    int world_seed,
    const Dictionary &wang_tiles,
    const Dictionary &biome_pairs,
    const Dictionary &self_tilesets,
    const Dictionary &tileset_upper,
    const Dictionary &biome_fallback,
    int tile_size
) {
    const int S = CHUNK_SIZE;
    int px_size = S * tile_size;
    Ref<Image> img = Image::create_empty(px_size, px_size, false, Image::FORMAT_RGBA8);
    img->fill(Color(0.2f, 0.2f, 0.2f, 1.0f));

    // Biome name lookup
    static const char* BIOME_NAMES[] = {
        "ocean", "beach", "grassland", "forest", "dense_forest", "desert",
        "savanna", "steppe", "tundra", "taiga", "mountains", "swamp",
        "tropical_forest", "volcanic", "arctic", "lake", "river"
    };

    const uint8_t *biome_ptr = biome_id.ptr();
    const uint8_t *ocean_ptr = ocean_mask.ptr();
    Rect2i tile_rect(0, 0, tile_size, tile_size);

    for (int y = 0; y < S; y++) {
        for (int x = 0; x < S; x++) {
            int i = y * S + x;
            uint8_t b = biome_ptr[i];
            String bname = BIOME_NAMES[b < 17 ? b : 2]; // default grassland

            // Map biome to visual equivalent via fallback
            String mapped = bname;
            if (!self_tilesets.has(mapped)) {
                if (biome_fallback.has(mapped)) {
                    mapped = String(biome_fallback[mapped]);
                }
            }

            Vector2i dest_pos(x * tile_size, y * tile_size);
            Ref<Image> tile_img;

            // Check for neighbor biome transitions
            bool has_transition = false;
            // Sample 4 cardinal neighbors
            for (int d = 0; d < 4 && !has_transition; d++) {
                static const int dx[] = {-1, 1, 0, 0};
                static const int dy[] = {0, 0, -1, 1};
                int nx = x + dx[d];
                int ny = y + dy[d];
                if (nx < 0 || nx >= S || ny < 0 || ny >= S) continue;
                uint8_t nb = biome_ptr[ny * S + nx];
                String nb_name = BIOME_NAMES[nb < 17 ? nb : 2];
                String nb_mapped = nb_name;
                if (!self_tilesets.has(nb_mapped) && biome_fallback.has(nb_mapped)) {
                    nb_mapped = String(biome_fallback[nb_mapped]);
                }
                if (nb_mapped != mapped) {
                    // Try to find transition tileset
                    String pair_key = mapped + "|" + nb_mapped;
                    if (biome_pairs.has(pair_key)) {
                        String tileset_dir = String(biome_pairs[pair_key]);
                        String upper = tileset_upper.has(tileset_dir) ? String(tileset_upper[tileset_dir]) : "";

                        // Compute Wang index from 4 corners
                        auto is_upper = [&](int cx, int cy) -> bool {
                            if (cx < 0 || cx >= S || cy < 0 || cy >= S) return false;
                            uint8_t cb = biome_ptr[cy * S + cx];
                            String cn = BIOME_NAMES[cb < 17 ? cb : 2];
                            if (!self_tilesets.has(cn) && biome_fallback.has(cn)) cn = String(biome_fallback[cn]);
                            return cn == upper;
                        };
                        int wang_idx = 0;
                        if (is_upper(x - 1, y - 1)) wang_idx += 8;
                        if (is_upper(x, y - 1)) wang_idx += 4;
                        if (is_upper(x - 1, y)) wang_idx += 2;
                        if (is_upper(x, y)) wang_idx += 1;

                        String cache_key = tileset_dir + "/" + String::num_int64(wang_idx);
                        if (wang_tiles.has(cache_key)) {
                            tile_img = Object::cast_to<Image>(wang_tiles[cache_key]);
                        }
                        has_transition = true;
                    }
                }
            }

            if (!has_transition) {
                // Self-tileset
                if (self_tilesets.has(mapped)) {
                    String self_dir = String(self_tilesets[mapped]);
                    int wx = chunk_x * S + x;
                    int wy = chunk_y * S + y;
                    int hv = ((wx * 73856093) ^ (wy * 19349663) ^ world_seed) & 0x7FFFFFFF;
                    int wang_idx = (hv % 10 == 0) ? 15 : 0;
                    String cache_key = self_dir + "/" + String::num_int64(wang_idx);
                    if (wang_tiles.has(cache_key)) {
                        tile_img = Object::cast_to<Image>(wang_tiles[cache_key]);
                    }
                }
            }

            if (tile_img.is_valid()) {
                img->blit_rect(tile_img, tile_rect, dest_pos);
            }

            // Water overlay
            if (ocean_ptr[i] == 1) {
                String ocean_dir = self_tilesets.has("ocean") ? String(self_tilesets["ocean"]) : "";
                if (ocean_dir != "") {
                    String cache_key = ocean_dir + "/0";
                    if (wang_tiles.has(cache_key)) {
                        Ref<Image> water_img = Object::cast_to<Image>(wang_tiles[cache_key]);
                        if (water_img.is_valid()) {
                            img->blend_rect(water_img, tile_rect, dest_pos);
                        }
                    }
                }
            }
        }
    }

    return img;
}
```

- [ ] **Step 4: Register the class in register_types.cpp**

Modify `gdextension/src/register_types.cpp` — add include and register call:

```cpp
#include "register_types.h"
#include "native_chunk_compiler.h"

#include <gdextension_interface.h>
#include <godot_cpp/core/defs.hpp>
#include <godot_cpp/godot.hpp>

using namespace godot;

void initialize_freedommmo_module(ModuleInitializationLevel p_level) {
    if (p_level != MODULE_INITIALIZATION_LEVEL_SCENE) {
        return;
    }
    GDREGISTER_CLASS(NativeChunkCompiler);
}

void uninitialize_freedommmo_module(ModuleInitializationLevel p_level) {
    if (p_level != MODULE_INITIALIZATION_LEVEL_SCENE) {
        return;
    }
}

extern "C" {
GDExtensionBool GDE_EXPORT freedommmo_library_init(
    GDExtensionInterfaceGetProcAddress p_get_proc_address,
    const GDExtensionClassLibraryPtr p_library,
    GDExtensionInitialization *r_initialization) {

    godot::GDExtensionBinding::InitObject init_obj(p_get_proc_address, p_library, r_initialization);

    init_obj.register_initializer(initialize_freedommmo_module);
    init_obj.register_terminator(uninitialize_freedommmo_module);
    init_obj.set_minimum_library_initialization_level(MODULE_INITIALIZATION_LEVEL_SCENE);

    return init_obj.init();
}
}
```

- [ ] **Step 5: Build**

```bash
cd C:/Users/daves/OneDrive/Documents/freedommmo/gdextension
scons platform=windows target=template_debug
```

Expected: Compiles with no errors. DLL produced in `bin/`.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/daves/OneDrive/Documents/freedommmo
git add gdextension/src/noise_sampler.h gdextension/src/native_chunk_compiler.h gdextension/src/native_chunk_compiler.cpp gdextension/src/register_types.cpp gdextension/src/register_types.h
git commit -m "feat: NativeChunkCompiler C++ — elevation, ocean, climate, biome compilation"
```

---

### Task 3: Wire GDScript to Use NativeChunkCompiler

**Files:**
- Modify: `scripts/core/chunk_streamer.gd:190-224` (the `_compile_chunk_data` method)
- Modify: `scripts/core/chunk_streamer.gd:178-187` (the `_thread_compile_batch` method)

The integration point is `ChunkStreamer._compile_chunk_data()`. When `NativeChunkCompiler` is available (DLL loaded), use it for the heavy layers. Otherwise fall back to GDScript (graceful degradation).

- [ ] **Step 1: Add native compiler initialization to ChunkStreamer**

Add these members and helper to `scripts/core/chunk_streamer.gd` after the existing member variables (around line 21):

```gdscript
var _native_compiler = null  # NativeChunkCompiler (C++) if available

func _try_init_native():
	if ClassDB.class_exists("NativeChunkCompiler"):
		_native_compiler = ClassDB.instantiate("NativeChunkCompiler")
		_native_compiler.set_world_seed(_world_seed)
		print("[ChunkStreamer] Native C++ compiler available — using accelerated path")
	else:
		print("[ChunkStreamer] Native compiler not found — using GDScript fallback")
```

- [ ] **Step 2: Call _try_init_native from setup()**

In the `setup()` function (line 24), add the init call after setting `_world_seed`:

```gdscript
func setup(renderer: TileMapTerrainRenderer, phase1: WorldCompiler, phase2: WorldCompiler, seed_val: int) -> void:
	_renderer = renderer
	_phase1_compiler = phase1
	_phase2_compiler = phase2
	_world_seed = seed_val
	_try_init_native()
```

- [ ] **Step 3: Add native compilation path to _compile_chunk_data**

Replace the compilation section in `_compile_chunk_data()` (currently lines 206-219) with a native-or-fallback branch:

```gdscript
func _compile_chunk_data(pos: Vector2i) -> ChunkData:
	# Check memory cache
	if _chunk_dict.has(pos):
		return _chunk_dict[pos]

	# Check disk cache
	var cached = ChunkCache.load_chunk(pos.x, pos.y, _world_seed)
	if cached != null:
		_mutex.lock()
		_chunk_dict[pos] = cached
		_cached_from_disk[pos] = true
		_mutex.unlock()
		return cached

	# Compile fresh
	var chunk = ChunkData.new()
	chunk.chunk_x = pos.x
	chunk.chunk_y = pos.y
	chunk.world_seed = _world_seed

	if _native_compiler != null:
		# Fast path: C++ compiles elevation + ocean + climate + biome in one call
		var result = _native_compiler.compile_chunk(pos.x, pos.y)
		chunk.elevation = result["elevation"]
		chunk.slope = result["slope"]
		chunk.ocean_mask = result["ocean_mask"]
		chunk.temperature = result["temperature"]
		chunk.precipitation = result["precipitation"]
		chunk.biome_id = result["biome_id"]
		# Still need GDScript for ocean_distance BFS, drainage, rivers, etc.
		_phase1_compiler._compute_ocean_distance(chunk)
	else:
		# GDScript fallback
		for layer in _phase1_compiler.layers:
			var layer_seed = SeedHasher.hash_seed(_world_seed, pos.x, pos.y, layer.layer_id)
			layer.compile(chunk, layer_seed)
			if layer.layer_name == "ocean_mask":
				_phase1_compiler._compute_ocean_distance(chunk)

	_mutex.lock()
	_chunk_dict[pos] = chunk
	_mutex.unlock()

	_propagate_single_chunk_edges(chunk)
	_compile_phase2(chunk)
	ChunkCache.save_chunk(chunk)
	return chunk
```

- [ ] **Step 4: Verify in Godot**

Run the game (F6). Check Output panel for:
- `[ChunkStreamer] Native C++ compiler available — using accelerated path`
- Terrain renders identically to before
- No crashes or visual differences

If the native compiler isn't found, it should print the fallback message and work exactly as before.

- [ ] **Step 5: Commit**

```bash
git add scripts/core/chunk_streamer.gd
git commit -m "feat: wire ChunkStreamer to use NativeChunkCompiler with GDScript fallback"
```

---

### Task 4: Wire Native build_chunk_image

**Files:**
- Modify: `scripts/core/chunk_streamer.gd:178-187` (`_thread_compile_batch`)
- Modify: `scripts/core/world_compiler/tilemap_terrain_renderer.gd` (add `get_wang_cache()` helper)

- [ ] **Step 1: Add wang tile cache accessor to TileMapTerrainRenderer**

Add this method to `tilemap_terrain_renderer.gd` (after the existing `_wang_tile_cache` dict around line 498):

```gdscript
func get_wang_cache() -> Dictionary:
	## Returns the pre-loaded wang tile cache for native image building.
	return _wang_tile_cache

func get_biome_pairs() -> Dictionary:
	return _biome_pairs

func get_self_tilesets() -> Dictionary:
	return _self_tilesets

func get_tileset_upper() -> Dictionary:
	return _tileset_upper

func get_biome_fallback() -> Dictionary:
	return _biome_fallback
```

- [ ] **Step 2: Use native build_chunk_image in _thread_compile_batch**

In `chunk_streamer.gd`, modify `_thread_compile_batch()` (line 178):

```gdscript
func _thread_compile_batch(batch: Array) -> void:
	## Runs on background thread. Compiles chunks AND builds images.
	for pos in batch:
		var chunk = _compile_chunk_data(pos)
		var img: Image
		if _native_compiler != null:
			img = _native_compiler.build_chunk_image(
				chunk.chunk_x, chunk.chunk_y,
				chunk.biome_id, chunk.ocean_mask,
				chunk.world_seed,
				_renderer.get_wang_cache(),
				_renderer.get_biome_pairs(),
				_renderer.get_self_tilesets(),
				_renderer.get_tileset_upper(),
				_renderer.get_biome_fallback(),
				_renderer._world_scale
			)
		else:
			img = _renderer.build_chunk_image(chunk)
		_mutex.lock()
		_compiled_queue.append({"chunk": chunk, "pos": pos, "image": img})
		_mutex.unlock()
	_thread_busy = false
```

- [ ] **Step 3: Build and test**

```bash
cd C:/Users/daves/OneDrive/Documents/freedommmo/gdextension
scons platform=windows target=template_debug
```

Run game. Walk around. Verify terrain looks identical.

- [ ] **Step 4: Commit**

```bash
git add scripts/core/chunk_streamer.gd scripts/core/world_compiler/tilemap_terrain_renderer.gd
git commit -m "feat: native build_chunk_image — full chunk render pipeline in C++"
```

---

### Task 5: Performance Benchmark and Validation

**Files:**
- Modify: `scripts/core/chunk_streamer.gd` (add timing)

- [ ] **Step 1: Add timing instrumentation to _compile_chunk_data**

Add microsecond timing around the native vs GDScript paths:

```gdscript
# In _compile_chunk_data, around the compilation section:
	var t0 = Time.get_ticks_usec()

	if _native_compiler != null:
		var result = _native_compiler.compile_chunk(pos.x, pos.y)
		# ... (copy arrays to chunk)
	else:
		# ... (GDScript layers)

	var t1 = Time.get_ticks_usec()
	print("[ChunkStreamer] Compile (%d,%d): %d us" % [pos.x, pos.y, t1 - t0])
```

Do the same for image building in `_thread_compile_batch`.

- [ ] **Step 2: Run benchmark — walk across 20+ chunk boundaries**

Run the game. Walk in one direction. Check Output panel for timing.

Expected:
- **Native compile_chunk**: < 1000 us (1ms)
- **Native build_chunk_image**: < 1000 us (1ms)
- **GDScript compile** (for comparison): 30,000-50,000 us (30-50ms)
- **FPS**: steady 60fps, no drops below 55fps during chunk transitions

- [ ] **Step 3: Verify visual correctness**

Compare terrain at the same seed between native and GDScript paths:
1. Run with native compiler, take screenshot at spawn
2. Temporarily disable native (`_native_compiler = null` in setup), take screenshot at spawn
3. Images should be pixel-identical (or near-identical due to float precision)

- [ ] **Step 4: Remove timing instrumentation (or gate behind a debug flag)**

```gdscript
const DEBUG_TIMING: bool = false

# Wrap timing prints:
if DEBUG_TIMING:
	print("[ChunkStreamer] Compile (%d,%d): %d us" % [pos.x, pos.y, t1 - t0])
```

- [ ] **Step 5: Commit**

```bash
git add scripts/core/chunk_streamer.gd
git commit -m "perf: benchmark native vs GDScript chunk compilation"
```

---

## Post-Plan Notes

- **Rivers, drainage, roads, settlements** remain in GDScript — they're not hot-path (run once, cached to disk). Port them later only if profiling shows they matter.
- **Ocean distance BFS** remains in GDScript — it's a flood fill that's harder to port and only runs once per chunk.
- **The `.gitmodules` entry for godot-cpp will make the repo larger.** Consider adding `gdextension/godot-cpp/` to a shallow clone or documenting the setup.
- **Hot-reload**: The `.gdextension` has `reloadable = true`. During development, rebuilding the DLL and reloading the project should pick up changes without restarting Godot.
