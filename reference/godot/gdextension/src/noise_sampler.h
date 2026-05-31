#ifndef NOISE_SAMPLER_H
#define NOISE_SAMPLER_H

#include <godot_cpp/classes/fast_noise_lite.hpp>
#include <godot_cpp/variant/vector2.hpp>
#include <cmath>
#include <algorithm>

namespace freedommmo {

// Overmap noise parameters — must match OvermapGenerator.gd exactly
struct OvermapNoise {
    godot::Ref<godot::FastNoiseLite> continent;
    godot::Ref<godot::FastNoiseLite> ridge;
    godot::Ref<godot::FastNoiseLite> warp;
    godot::Ref<godot::FastNoiseLite> temp;
    godot::Ref<godot::FastNoiseLite> moist;
    godot::Ref<godot::FastNoiseLite> magic;

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

        magic.instantiate();
        magic->set_seed(world_seed + 888);
        magic->set_noise_type(godot::FastNoiseLite::TYPE_PERLIN);
        magic->set_fractal_type(godot::FastNoiseLite::FRACTAL_FBM);
        magic->set_fractal_octaves(4);
        magic->set_frequency(0.004f);
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
        // Threshold penalty: no cooling near sea level, strong at altitude
        t -= std::max(0.0f, h - 0.45f) * 1.0f;
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

    float sample_magic(float px, float py) const {
        float warp_x = warp->get_noise_2d(px, py) * 25.0f;
        float warp_y = warp->get_noise_2d(px + 300.0f, py + 300.0f) * 25.0f;
        float wx = px + warp_x;
        float wy = py + warp_y;
        float m = (magic->get_noise_2d(wx, wy) + 1.0f) * 0.5f;
        return std::clamp(m, 0.0f, 1.0f);
    }
};

} // namespace freedommmo

#endif // NOISE_SAMPLER_H
