#version 450

// RTX 3090 optimized compute shader for tile painting
// Processes tiles in parallel using GPU cores

layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;

// Input buffers
layout(set = 0, binding = 0, std430) restrict readonly buffer BiomeBuffer {
	uint biome_data[];
};

layout(set = 0, binding = 1, std430) restrict readonly buffer SlopeBuffer {
	uint slope_data[];
};

layout(set = 0, binding = 2, std430) restrict readonly buffer RiverBuffer {
	uint river_data[];
};

layout(set = 0, binding = 3, std430) restrict readonly buffer NoiseBuffer {
	uint noise_data[];
};

// Output buffer for tile IDs
layout(set = 0, binding = 4, std430) restrict writeonly buffer TileBuffer {
	uint tile_data[];
};

// Uniform parameters
layout(set = 0, binding = 5, std430) restrict readonly buffer ParamsBuffer {
	uint chunk_size;
	uint tile_types[16];  // Tile ID mapping
	float biome_weights[8];  // Biome influence weights
};

// Biome to tile mapping (optimized lookup)
const uint BIOME_OCEAN = 0u;
const uint BIOME_BEACH = 1u;
const uint BIOME_GRASS = 2u;
const uint BIOME_DESERT = 3u;
const uint BIOME_FOREST = 4u;
const uint BIOME_ROCK = 5u;
const uint BIOME_TUNDRA = 6u;

// Tile IDs
const uint TILE_WATER = 0u;
const uint TILE_SAND = 1u;
const uint TILE_GRASS = 2u;
const uint TILE_DIRT = 3u;
const uint TILE_STONE = 4u;
const uint TILE_FOREST = 5u;
const uint TILE_ROCK = 6u;
const uint TILE_MUD = 7u;
const uint TILE_GRAVEL = 8u;
const uint TILE_MOSS = 9u;
const uint TILE_SNOW = 10u;
const uint TILE_ICE = 11u;
const uint TILE_LAVA = 12u;
const uint TILE_CRYSTAL = 13u;
const uint TILE_PATH = 14u;
const uint TILE_FLOWERS = 15u;

uint get_tile_for_biome(uint biome_id, uint slope, uint river, uint noise) {
	switch(biome_id) {
		case BIOME_OCEAN:
			return river > 128u ? TILE_WATER : (slope > 200u ? TILE_SAND : TILE_WATER);
			
		case BIOME_BEACH:
			return slope > 180u ? TILE_GRAVEL : TILE_SAND;
			
		case BIOME_GRASS:
			if (river > 200u) return TILE_WATER;
			if (slope > 220u) return TILE_ROCK;
			if (noise > 240u) return TILE_FLOWERS;
			if (noise > 200u) return TILE_FOREST;
			return TILE_GRASS;
			
		case BIOME_DESERT:
			if (slope > 200u) return TILE_STONE;
			if (noise > 250u) return TILE_CRYSTAL;
			return TILE_SAND;
			
		case BIOME_FOREST:
			if (river > 200u) return TILE_WATER;
			if (slope > 230u) return TILE_ROCK;
			if (noise > 220u) return TILE_MOSS;
			if (noise > 180u) return TILE_DIRT;
			return TILE_FOREST;
			
		case BIOME_ROCK:
			if (slope > 180u) return TILE_STONE;
			if (noise > 240u) return TILE_GRAVEL;
			return TILE_ROCK;
			
		case BIOME_TUNDRA:
			if (river > 200u) return TILE_ICE;
			if (slope > 200u) return TILE_STONE;
			return TILE_SNOW;
			
		default:
			return TILE_GRASS;
	}
}

void main() {
	uvec2 coord = gl_GlobalInvocationID.xy;
	uint chunk_size_val = chunk_size;
	
	// Bounds check
	if (coord.x >= chunk_size_val || coord.y >= chunk_size_val) {
		return;
	}
	
	uint index = coord.y * chunk_size_val + coord.x;
	
	// Sample input data
	uint biome = biome_data[index];
	uint slope = slope_data[index];
	uint river = river_data[index];
	uint noise = noise_data[index];
	
	// Determine tile type using optimized lookup
	uint tile_id = get_tile_for_biome(biome, slope, river, noise);
	
	// Write result
	tile_data[index] = tile_id;
}
