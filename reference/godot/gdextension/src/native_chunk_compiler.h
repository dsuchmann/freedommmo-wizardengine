#ifndef NATIVE_CHUNK_COMPILER_H
#define NATIVE_CHUNK_COMPILER_H

#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/classes/image.hpp>
#include <godot_cpp/classes/fast_noise_lite.hpp>
#include <godot_cpp/variant/packed_float32_array.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/vector2.hpp>
#include <godot_cpp/variant/vector2i.hpp>
#include <godot_cpp/variant/string.hpp>
#include <godot_cpp/variant/color.hpp>
#include <godot_cpp/variant/rect2i.hpp>

#include "noise_sampler.h"

namespace godot {

class NativeChunkCompiler : public RefCounted {
    GDCLASS(NativeChunkCompiler, RefCounted);

public:
    static const int CHUNK_SIZE = 64;
    static constexpr float SEA_LEVEL = 0.38f;

    enum Biome {
        OCEAN = 0, BEACH, GRASSLAND, FOREST, DENSE_FOREST, DESERT,
        SAVANNA, STEPPE, TUNDRA, TAIGA, MOUNTAINS, SWAMP,
        TROPICAL_FOREST, VOLCANIC, ARCTIC, LAKE, RIVER, MYSTIC
    };

private:
    int _world_seed = 0;
    bool _noise_ready = false;
    freedommmo::OvermapNoise _overmap;

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

    String _get_biome_name(uint8_t biome_id) const;
    String _map_biome_fallback(const String &bname, const Dictionary &self_tilesets, const Dictionary &biome_fallback) const;

    // Pre-extracted pixel data cache: cache_key -> raw RGBA bytes
    Dictionary _pixel_cache;  // String -> PackedByteArray
    bool _pixel_cache_built = false;

    // Biome mapping caches (integer-indexed, no String lookups in hot loop)
    uint8_t _biome_to_mapped[18];  // biome_id -> mapped biome_id
    void _build_biome_mapping(const Dictionary &self_tilesets, const Dictionary &biome_fallback);

    void _ensure_pixel_cache(const Dictionary &wang_tiles, int tile_size);

protected:
    static void _bind_methods();

public:
    NativeChunkCompiler();
    ~NativeChunkCompiler();

    void set_world_seed(int seed);
    int get_world_seed() const;

    Dictionary compile_chunk(int chunk_x, int chunk_y);

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

    Dictionary build_chunk_image_with_normals(
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
    );
};

} // namespace godot

#endif // NATIVE_CHUNK_COMPILER_H
