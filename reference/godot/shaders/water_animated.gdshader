shader_type canvas_item;

uniform sampler2D normal_map : hint_normal;
uniform vec2 flow_direction = vec2(0.1, 0.05);
uniform float flow_speed : hint_range(0.0, 2.0) = 0.5;
uniform float wave_strength : hint_range(0.0, 1.0) = 0.3;
uniform vec4 water_color : source_color = vec4(0.2, 0.4, 0.8, 0.8);
uniform vec4 foam_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float foam_threshold : hint_range(0.0, 1.0) = 0.7;

varying vec2 world_position;

void vertex() {
	world_position = VERTEX;
}

void fragment() {
	vec2 time_offset = TIME * flow_speed * flow_direction;
	
	// Sample normal map with flowing animation
	vec2 uv1 = UV + time_offset;
	vec2 uv2 = UV + time_offset * 0.7 + vec2(0.3, 0.1);
	
	vec3 normal1 = texture(normal_map, uv1).rgb * 2.0 - 1.0;
	vec3 normal2 = texture(normal_map, uv2).rgb * 2.0 - 1.0;
	
	vec3 combined_normal = normalize(normal1 + normal2 * 0.5);
	
	// Wave animation
	float wave = sin(world_position.x * 0.1 + TIME * 2.0) * 
	            cos(world_position.y * 0.08 + TIME * 1.5) * wave_strength;
	
	// Foam generation
	float foam_factor = smoothstep(foam_threshold, 1.0, 
		(combined_normal.r + combined_normal.g) * 0.5 + wave);
	
	// Final color mixing
	vec4 final_color = mix(water_color, foam_color, foam_factor);
	
	// Apply normal for lighting
	NORMAL_MAP = combined_normal;
	COLOR = final_color;
}
