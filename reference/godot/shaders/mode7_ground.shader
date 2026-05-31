shader_type canvas_item;

uniform sampler2D ground_tex : source_color;
uniform vec2 cam_pos = vec2(0.0);
uniform float cam_rot = 0.0;
uniform float cam_zoom = 1.0;
uniform float horizon = 0.35;     // 0..1
uniform float perspective = 2.0;  // depth squash
uniform sampler2D height_tex : source_color; // optional
uniform float height_amp = 0.0;   // 0..something

void fragment() {
    vec2 uv = UV;
    if (uv.y < horizon) { COLOR = vec4(0.6,0.75,1.0,1.0); return; }

    float y = (uv.y - horizon) / max(1e-4, 1.0 - horizon);
    float depth = perspective / (y * cam_zoom + 1e-3);

    float cs = cos(cam_rot), sn = sin(cam_rot);
    vec2 dir = vec2(uv.x - 0.5, 1.0);
    vec2 world = cam_pos + mat2(cs,-sn,sn,cs) * vec2(dir.x * depth, depth);

    // optional micro undulation
    if (height_amp > 0.0) {
        float h = texture(height_tex, world).r;
        world.y += (h - 0.5) * height_amp;
    }

    vec4 tex = texture(ground_tex, world);
    float fog = clamp(1.0 - y, 0.0, 1.0);
    COLOR = mix(vec4(0.7,0.8,0.9,1.0), tex, fog);
}


