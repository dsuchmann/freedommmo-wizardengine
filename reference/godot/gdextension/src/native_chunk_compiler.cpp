#include "native_chunk_compiler.h"
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <cmath>
#include <cstring>
#include <algorithm>

using namespace godot;

NativeChunkCompiler::NativeChunkCompiler() {}
NativeChunkCompiler::~NativeChunkCompiler() {}

void NativeChunkCompiler::_bind_methods() {
    ClassDB::bind_method(D_METHOD("set_world_seed", "seed"), &NativeChunkCompiler::set_world_seed);
    ClassDB::bind_method(D_METHOD("get_world_seed"), &NativeChunkCompiler::get_world_seed);
    ClassDB::bind_method(D_METHOD("compile_chunk", "chunk_x", "chunk_y"), &NativeChunkCompiler::compile_chunk);
    ClassDB::bind_method(D_METHOD("build_chunk_image", "chunk_x", "chunk_y", "biome_id", "ocean_mask", "world_seed", "wang_tiles", "biome_pairs", "self_tilesets", "tileset_upper", "biome_fallback", "tile_size"), &NativeChunkCompiler::build_chunk_image);
    ClassDB::bind_method(D_METHOD("build_chunk_image_with_normals", "chunk_x", "chunk_y", "elevation", "slope", "biome_id", "ocean_mask", "world_seed", "wang_tiles", "biome_pairs", "self_tilesets", "tileset_upper", "biome_fallback", "tile_size"), &NativeChunkCompiler::build_chunk_image_with_normals);
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

    float px = static_cast<float>(chunk_x + 320);
    float py = static_cast<float>(chunk_y + 320);
    float h_tl = _overmap.sample_height(px - 0.5f, py - 0.5f);
    float h_tr = _overmap.sample_height(px + 0.5f, py - 0.5f);
    float h_bl = _overmap.sample_height(px - 0.5f, py + 0.5f);
    float h_br = _overmap.sample_height(px + 0.5f, py + 0.5f);

    float *elev_ptr = elevation.ptrw();
    float *slope_ptr = slope.ptrw();

    for (int y = 0; y < S; y++) {
        float ty = static_cast<float>(y) / static_cast<float>(S);
        for (int x = 0; x < S; x++) {
            float tx = static_cast<float>(x) / static_cast<float>(S);
            float wx = static_cast<float>(origin_x + x);
            float wy = static_cast<float>(origin_y + y);

            float top = h_tl + (h_tr - h_tl) * tx;
            float bot = h_bl + (h_br - h_bl) * tx;
            float local_base = top + (bot - top) * ty;

            float detail = _eval_elevation_at(wx, wy);
            float h = local_base + detail;
            elev_ptr[y * S + x] = std::clamp(h, 0.0f, 1.0f);
        }
    }

    for (int y = 0; y < S; y++) {
        for (int x = 0; x < S; x++) {
            float h_left, h_right, h_up, h_down;

            if (x > 0) h_left = elev_ptr[y * S + (x - 1)];
            else h_left = std::clamp(
                _overmap.sample_height(px - 0.5f, py + (static_cast<float>(y) / S - 0.5f))
                + _eval_elevation_at(static_cast<float>(origin_x + x - 1), static_cast<float>(origin_y + y)),
                0.0f, 1.0f);

            if (x < S - 1) h_right = elev_ptr[y * S + (x + 1)];
            else h_right = std::clamp(
                _overmap.sample_height(px + 0.5f, py + (static_cast<float>(y) / S - 0.5f))
                + _eval_elevation_at(static_cast<float>(origin_x + x + 1), static_cast<float>(origin_y + y)),
                0.0f, 1.0f);

            if (y > 0) h_up = elev_ptr[(y - 1) * S + x];
            else h_up = std::clamp(
                _overmap.sample_height(px + (static_cast<float>(x) / S - 0.5f), py - 0.5f)
                + _eval_elevation_at(static_cast<float>(origin_x + x), static_cast<float>(origin_y + y - 1)),
                0.0f, 1.0f);

            if (y < S - 1) h_down = elev_ptr[(y + 1) * S + x];
            else h_down = std::clamp(
                _overmap.sample_height(px + (static_cast<float>(x) / S - 0.5f), py + 0.5f)
                + _eval_elevation_at(static_cast<float>(origin_x + x), static_cast<float>(origin_y + y + 1)),
                0.0f, 1.0f);

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
            float temp_val = t_top + (t_bot - t_top) * ty;
            temp_val -= (h - base_h) * 0.3f;  // Local elevation adjustment within chunk
            temp_ptr[i] = std::clamp(temp_val, 0.0f, 1.0f);

            float m_top = m_tl + (m_tr - m_tl) * tx;
            float m_bot = m_bl + (m_br - m_bl) * tx;
            float moist = m_top + (m_bot - m_top) * ty;
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

    struct Rule { float t_min, t_max, p_min, p_max; uint8_t b; };
    static const Rule rules[] = {
        {0.0f, 0.2f, 0.0f, 1.0f, ARCTIC},
        {0.2f, 0.35f, 0.0f, 0.5f, TUNDRA},
        {0.2f, 0.35f, 0.5f, 1.0f, TAIGA},
        {0.55f, 1.0f, 0.0f, 0.3f, DESERT},
        {0.55f, 1.0f, 0.3f, 0.55f, SAVANNA},
        {0.55f, 1.0f, 0.55f, 1.0f, TROPICAL_FOREST},
        {0.35f, 0.55f, 0.0f, 0.35f, STEPPE},
        {0.35f, 0.55f, 0.35f, 0.5f, GRASSLAND},
        {0.35f, 0.55f, 0.5f, 0.65f, FOREST},
        {0.35f, 0.55f, 0.65f, 1.0f, DENSE_FOREST},
    };
    static const int NUM_RULES = 10;

    for (int y = 0; y < S; y++) {
        for (int x = 0; x < S; x++) {
            int i = y * S + x;

            if (mask[i] == 1) { biome[i] = OCEAN; continue; }

            float h = elev[i];
            float t = temp[i];
            float p = precip[i];

            if (h > 0.75f) { biome[i] = MOUNTAINS; continue; }
            if (h < 0.44f && _near_ocean(ocean_mask, x, y)) { biome[i] = BEACH; continue; }
            if (p > 0.7f && h < 0.55f && t > 0.25f) { biome[i] = SWAMP; continue; }

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

String NativeChunkCompiler::_get_biome_name(uint8_t b) const {
    static const char* BIOME_NAMES[] = {
        "ocean", "beach", "grassland", "forest", "dense_forest", "desert",
        "savanna", "steppe", "tundra", "taiga", "mountains", "swamp",
        "tropical_forest", "volcanic", "arctic", "lake", "river", "mystic"
    };
    if (b < 18) return String(BIOME_NAMES[b]);
    return String("grassland");
}

String NativeChunkCompiler::_map_biome_fallback(const String &bname, const Dictionary &self_tilesets, const Dictionary &biome_fallback) const {
    if (self_tilesets.has(bname)) return bname;
    if (biome_fallback.has(bname)) return String(biome_fallback[bname]);
    return bname;
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

void NativeChunkCompiler::_ensure_pixel_cache(const Dictionary &wang_tiles, int tile_size) {
    if (_pixel_cache_built) return;

    // Pre-extract raw RGBA pixel bytes from every cached wang tile Image.
    // This turns Dictionary<String, Image> into Dictionary<String, PackedByteArray>
    // so the hot loop can memcpy instead of calling blit_rect.
    Array keys = wang_tiles.keys();
    for (int i = 0; i < keys.size(); i++) {
        String key = String(keys[i]);
        Variant v = wang_tiles[key];
        Image *img_ptr = Object::cast_to<Image>(v);
        if (img_ptr) {
            Ref<Image> tile_img(img_ptr);
            if (tile_img.is_valid()) {
                _pixel_cache[key] = tile_img->get_data();
            }
        }
    }
    _pixel_cache_built = true;
}

void NativeChunkCompiler::_build_biome_mapping(const Dictionary &self_tilesets, const Dictionary &biome_fallback) {
    // Pre-compute integer biome ID -> mapped biome ID (avoids String lookups in hot loop)
    static const char* BIOME_NAMES[] = {
        "ocean", "beach", "grassland", "forest", "dense_forest", "desert",
        "savanna", "steppe", "tundra", "taiga", "mountains", "swamp",
        "tropical_forest", "volcanic", "arctic", "lake", "river", "mystic"
    };
    for (int i = 0; i < 18; i++) {
        String bname(BIOME_NAMES[i]);
        if (self_tilesets.has(bname)) {
            _biome_to_mapped[i] = i; // Has own tileset
        } else if (biome_fallback.has(bname)) {
            String fb = String(biome_fallback[bname]);
            // Find the biome ID for the fallback name
            _biome_to_mapped[i] = i; // default to self
            for (int j = 0; j < 18; j++) {
                if (fb == BIOME_NAMES[j]) {
                    _biome_to_mapped[i] = j;
                    break;
                }
            }
        } else {
            _biome_to_mapped[i] = i;
        }
    }
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
    const int px_size = S * tile_size;
    const int tile_bytes = tile_size * tile_size * 4; // RGBA8
    const int row_bytes = px_size * 4;
    const int tile_row_bytes = tile_size * 4;

    // One-time setup: extract pixel data and build biome mapping
    _ensure_pixel_cache(wang_tiles, tile_size);
    _build_biome_mapping(self_tilesets, biome_fallback);

    // Allocate output buffer
    PackedByteArray buffer;
    buffer.resize(px_size * px_size * 4);
    uint8_t *out = buffer.ptrw();
    // Fill with dark gray (0.2, 0.2, 0.2, 1.0) = (51, 51, 51, 255)
    for (int i = 0; i < px_size * px_size; i++) {
        out[i * 4 + 0] = 51;
        out[i * 4 + 1] = 51;
        out[i * 4 + 2] = 51;
        out[i * 4 + 3] = 255;
    }

    const uint8_t *biome_ptr = biome_id.ptr();
    const uint8_t *ocean_ptr = ocean_mask.ptr();

    // Biome name table for Dictionary lookups (still needed for pair keys)
    static const char* BIOME_NAMES[] = {
        "ocean", "beach", "grassland", "forest", "dense_forest", "desert",
        "savanna", "steppe", "tundra", "taiga", "mountains", "swamp",
        "tropical_forest", "volcanic", "arctic", "lake", "river", "mystic"
    };

    // Pre-compute mapped biome for each cell (avoids redundant lookups)
    uint8_t mapped_biomes[CHUNK_SIZE * CHUNK_SIZE];
    for (int i = 0; i < S * S; i++) {
        uint8_t b = biome_ptr[i];
        mapped_biomes[i] = (b < 18) ? _biome_to_mapped[b] : 2; // default grassland
    }

    for (int y = 0; y < S; y++) {
        for (int x = 0; x < S; x++) {
            int i = y * S + x;
            uint8_t mapped = mapped_biomes[i];
            String mapped_name(BIOME_NAMES[mapped]);

            const uint8_t *tile_pixels = nullptr;
            bool has_transition = false;

            // Check cardinal neighbors for biome transitions
            static const int ndx[] = {-1, 1, 0, 0};
            static const int ndy[] = {0, 0, -1, 1};
            for (int d = 0; d < 4 && !has_transition; d++) {
                int nx = x + ndx[d];
                int ny = y + ndy[d];
                if (nx < 0 || nx >= S || ny < 0 || ny >= S) continue;
                uint8_t nb_mapped = mapped_biomes[ny * S + nx];
                if (nb_mapped != mapped) {
                    String nb_name(BIOME_NAMES[nb_mapped]);
                    String pair_key = mapped_name + "|" + nb_name;
                    if (biome_pairs.has(pair_key)) {
                        String tileset_dir = String(biome_pairs[pair_key]);
                        String upper = tileset_upper.has(tileset_dir) ? String(tileset_upper[tileset_dir]) : "";

                        // Compute upper biome ID once for wang index
                        uint8_t upper_id = 255;
                        for (int j = 0; j < 18; j++) {
                            if (upper == BIOME_NAMES[j]) {
                                upper_id = (uint8_t)_biome_to_mapped[j];
                                break;
                            }
                        }

                        auto is_upper = [&](int cx, int cy) -> bool {
                            if (cx < 0 || cx >= S || cy < 0 || cy >= S) return false;
                            return mapped_biomes[cy * S + cx] == upper_id;
                        };
                        int wang_idx = 0;
                        if (is_upper(x - 1, y - 1)) wang_idx += 8;
                        if (is_upper(x, y - 1)) wang_idx += 4;
                        if (is_upper(x - 1, y)) wang_idx += 2;
                        if (is_upper(x, y)) wang_idx += 1;

                        String cache_key = tileset_dir + "/" + String::num_int64(wang_idx);
                        if (_pixel_cache.has(cache_key)) {
                            PackedByteArray pba = PackedByteArray(_pixel_cache[cache_key]);
                            tile_pixels = pba.ptr();
                        }
                        has_transition = true;
                    }
                }
            }

            if (!has_transition) {
                if (self_tilesets.has(mapped_name)) {
                    String self_dir = String(self_tilesets[mapped_name]);
                    int wx = chunk_x * S + x;
                    int wy = chunk_y * S + y;
                    int hv = ((wx * 73856093) ^ (wy * 19349663) ^ world_seed) & 0x7FFFFFFF;
                    int wang_idx = (hv % 10 == 0) ? 15 : 0;
                    String cache_key = self_dir + "/" + String::num_int64(wang_idx);
                    if (_pixel_cache.has(cache_key)) {
                        PackedByteArray pba = PackedByteArray(_pixel_cache[cache_key]);
                        tile_pixels = pba.ptr();
                    }
                }
            }

            // Direct memcpy of tile pixels into output buffer (replaces blit_rect)
            if (tile_pixels) {
                int dest_x = x * tile_size;
                int dest_y = y * tile_size;
                for (int ty = 0; ty < tile_size; ty++) {
                    memcpy(
                        out + (dest_y + ty) * row_bytes + dest_x * 4,
                        tile_pixels + ty * tile_row_bytes,
                        tile_row_bytes
                    );
                }
            }

            // Water overlay with alpha blending (replaces blend_rect)
            if (ocean_ptr[i] == 1) {
                String ocean_dir = self_tilesets.has("ocean") ? String(self_tilesets["ocean"]) : "";
                if (ocean_dir != "") {
                    String cache_key = ocean_dir + "/0";
                    if (_pixel_cache.has(cache_key)) {
                        PackedByteArray water_pba = PackedByteArray(_pixel_cache[cache_key]);
                        const uint8_t *water_pixels = water_pba.ptr();
                        int dest_x = x * tile_size;
                        int dest_y = y * tile_size;
                        for (int ty = 0; ty < tile_size; ty++) {
                            for (int tx = 0; tx < tile_size; tx++) {
                                int src_off = (ty * tile_size + tx) * 4;
                                int dst_off = (dest_y + ty) * row_bytes + (dest_x + tx) * 4;
                                uint8_t sa = water_pixels[src_off + 3];
                                if (sa == 0) continue;
                                if (sa == 255) {
                                    memcpy(out + dst_off, water_pixels + src_off, 4);
                                } else {
                                    // Alpha blend: dst = src * sa/255 + dst * (255-sa)/255
                                    uint8_t da = 255 - sa;
                                    out[dst_off + 0] = (water_pixels[src_off + 0] * sa + out[dst_off + 0] * da) / 255;
                                    out[dst_off + 1] = (water_pixels[src_off + 1] * sa + out[dst_off + 1] * da) / 255;
                                    out[dst_off + 2] = (water_pixels[src_off + 2] * sa + out[dst_off + 2] * da) / 255;
                                    out[dst_off + 3] = 255;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Create Image from raw buffer (single call, no per-tile API overhead)
    Ref<Image> img = Image::create_from_data(px_size, px_size, false, Image::FORMAT_RGBA8, buffer);
    return img;
}

Dictionary NativeChunkCompiler::build_chunk_image_with_normals(
    int chunk_x, int chunk_y,
    const PackedFloat32Array &elevation,
    const PackedFloat32Array &slope,
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
    const int px_size = S * tile_size;

    // Step 1: Build the base terrain image via existing method
    Ref<Image> terrain_img = build_chunk_image(
        chunk_x, chunk_y, biome_id, ocean_mask, world_seed,
        wang_tiles, biome_pairs, self_tilesets, tileset_upper, biome_fallback, tile_size
    );

    // Get raw pixel data from the terrain image for AO modification
    PackedByteArray terrain_data = terrain_img->get_data();
    uint8_t *pixels = terrain_data.ptrw();
    const int row_bytes = px_size * 4;

    const float *elev = elevation.ptr();

    // Step 2: Bake ambient occlusion into terrain image
    for (int ty = 0; ty < S; ty++) {
        for (int tx = 0; tx < S; tx++) {
            int tile_idx = ty * S + tx;
            float center_h = elev[tile_idx];

            // Compute average elevation of 8 neighbors
            float neighbor_sum = 0.0f;
            int neighbor_count = 0;
            for (int dy = -1; dy <= 1; dy++) {
                for (int dx = -1; dx <= 1; dx++) {
                    if (dx == 0 && dy == 0) continue;
                    int nx = tx + dx;
                    int ny = ty + dy;
                    if (nx >= 0 && nx < S && ny >= 0 && ny < S) {
                        neighbor_sum += elev[ny * S + nx];
                        neighbor_count++;
                    }
                }
            }

            if (neighbor_count == 0) continue;
            float avg_h = neighbor_sum / static_cast<float>(neighbor_count);
            float diff = center_h - avg_h;

            // Valley (lower than neighbors): darken up to 15%
            // Ridge (higher than neighbors): lighten up to 8%
            float ao_factor;
            if (diff < 0.0f) {
                ao_factor = 1.0f + std::max(diff * 3.0f, -0.15f);
            } else {
                ao_factor = 1.0f + std::min(diff * 2.0f, 0.08f);
            }

            // Apply AO factor to all pixels in this tile's block
            int dest_x = tx * tile_size;
            int dest_y = ty * tile_size;
            for (int py = 0; py < tile_size; py++) {
                for (int px_x = 0; px_x < tile_size; px_x++) {
                    int off = (dest_y + py) * row_bytes + (dest_x + px_x) * 4;
                    pixels[off + 0] = static_cast<uint8_t>(std::clamp(static_cast<int>(pixels[off + 0] * ao_factor), 0, 255));
                    pixels[off + 1] = static_cast<uint8_t>(std::clamp(static_cast<int>(pixels[off + 1] * ao_factor), 0, 255));
                    pixels[off + 2] = static_cast<uint8_t>(std::clamp(static_cast<int>(pixels[off + 2] * ao_factor), 0, 255));
                    // Alpha unchanged
                }
            }
        }
    }

    // Create AO-applied terrain image from modified buffer
    Ref<Image> ao_img = Image::create_from_data(px_size, px_size, false, Image::FORMAT_RGBA8, terrain_data);

    // Step 3: Generate normal map from elevation data
    PackedByteArray normal_data;
    normal_data.resize(px_size * px_size * 4);
    uint8_t *nmap = normal_data.ptrw();

    const float normal_scale = 14.0f;  // Higher = more dramatic hillshading

    for (int ty = 0; ty < S; ty++) {
        for (int tx = 0; tx < S; tx++) {
            // Sample elevation at cardinal neighbors (clamp at edges)
            float h_left  = elev[ty * S + std::max(tx - 1, 0)];
            float h_right = elev[ty * S + std::min(tx + 1, S - 1)];
            float h_up    = elev[std::max(ty - 1, 0) * S + tx];
            float h_down  = elev[std::min(ty + 1, S - 1) * S + tx];

            float nx_val = (h_left - h_right) * normal_scale;
            float ny_val = (h_up - h_down) * normal_scale;
            float nz_val = 1.0f;

            // Normalize the vector
            float len = std::sqrt(nx_val * nx_val + ny_val * ny_val + nz_val * nz_val);
            if (len > 0.0f) {
                nx_val /= len;
                ny_val /= len;
                nz_val /= len;
            }

            // Encode to RGB [0,255]
            uint8_t r = static_cast<uint8_t>(std::clamp(static_cast<int>((nx_val * 0.5f + 0.5f) * 255.0f), 0, 255));
            uint8_t g = static_cast<uint8_t>(std::clamp(static_cast<int>((ny_val * 0.5f + 0.5f) * 255.0f), 0, 255));
            uint8_t b = static_cast<uint8_t>(std::clamp(static_cast<int>((nz_val * 0.5f + 0.5f) * 255.0f), 0, 255));

            // Fill all pixels in this tile's block with the same normal
            int dest_x = tx * tile_size;
            int dest_y = ty * tile_size;
            for (int py = 0; py < tile_size; py++) {
                for (int px_x = 0; px_x < tile_size; px_x++) {
                    int off = (dest_y + py) * row_bytes + (dest_x + px_x) * 4;
                    nmap[off + 0] = r;
                    nmap[off + 1] = g;
                    nmap[off + 2] = b;
                    nmap[off + 3] = 255;
                }
            }
        }
    }

    Ref<Image> normal_map = Image::create_from_data(px_size, px_size, false, Image::FORMAT_RGBA8, normal_data);

    // Step 4: Return dictionary with both images
    Dictionary result;
    result["image"] = ao_img;
    result["normal_map"] = normal_map;
    return result;
}
