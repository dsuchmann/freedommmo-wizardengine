shader_type canvas_item;

// Tilt-shift bokeh: blurs screen edges when player is at high elevation.
// Simulates depth-of-field looking down from a peak.

uniform sampler2D screen_texture : hint_screen_texture, repeat_disable, filter_linear;
uniform float blur_intensity : hint_range(0.0, 1.0) = 0.0;
uniform float focus_band : hint_range(0.1, 0.5) = 0.3;

void fragment() {
	if (blur_intensity < 0.01) {
		COLOR = textureLod(screen_texture, SCREEN_UV, 0.0);
		return;
	}

	// Distance from screen center (0 at center, ~1 at corners)
	vec2 center_offset = SCREEN_UV - vec2(0.5);
	float dist = length(center_offset) * 1.4;

	// Smooth falloff: sharp in center, blurred at edges
	float blur_factor = smoothstep(focus_band, focus_band + 0.35, dist) * blur_intensity;

	if (blur_factor < 0.005) {
		COLOR = textureLod(screen_texture, SCREEN_UV, 0.0);
		return;
	}

	// 13-tap Gaussian blur using screen texture
	vec2 px = SCREEN_PIXEL_SIZE * blur_factor * 5.0;
	vec4 sum = vec4(0.0);
	// Center
	sum += textureLod(screen_texture, SCREEN_UV, 0.0) * 0.2;
	// Ring 1 (4 taps)
	sum += textureLod(screen_texture, SCREEN_UV + vec2(px.x, 0.0), 0.0) * 0.12;
	sum += textureLod(screen_texture, SCREEN_UV - vec2(px.x, 0.0), 0.0) * 0.12;
	sum += textureLod(screen_texture, SCREEN_UV + vec2(0.0, px.y), 0.0) * 0.12;
	sum += textureLod(screen_texture, SCREEN_UV - vec2(0.0, px.y), 0.0) * 0.12;
	// Ring 2 (4 taps, diagonal)
	sum += textureLod(screen_texture, SCREEN_UV + vec2(px.x, px.y) * 0.7, 0.0) * 0.08;
	sum += textureLod(screen_texture, SCREEN_UV + vec2(-px.x, px.y) * 0.7, 0.0) * 0.08;
	sum += textureLod(screen_texture, SCREEN_UV + vec2(px.x, -px.y) * 0.7, 0.0) * 0.08;
	sum += textureLod(screen_texture, SCREEN_UV + vec2(-px.x, -px.y) * 0.7, 0.0) * 0.08;

	COLOR = sum;
}
