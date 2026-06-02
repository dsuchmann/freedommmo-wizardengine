shader_type canvas_item;

// Shadow diffusion: fades from solid at the base to transparent at the tip.
// The sprite is oriented with pivot at bottom-center, so UV.y=1 is the base
// (closest to object) and UV.y=0 is the tip (furthest from object).

uniform float fade_power : hint_range(0.5, 4.0) = 1.5;

void fragment() {
    vec4 tex_color = texture(TEXTURE, UV);
    // UV.y = 1 at bottom (base/pivot), 0 at top (tip)
    float dist_from_base = 1.0 - UV.y;
    // Exponential falloff: shadow is solid near base, fades to nothing at tip
    float fade = pow(1.0 - dist_from_base, fade_power);
    COLOR = vec4(tex_color.rgb, tex_color.a * fade);
}
