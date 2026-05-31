class_name WorldMap
extends RefCounted

const BIOME_COLORS: Dictionary = {
	"deep_ocean": Color(0.1, 0.2, 0.5),
	"ocean": Color(0.15, 0.3, 0.6),
	"shallow_water": Color(0.2, 0.4, 0.7),
	"beach": Color(0.85, 0.78, 0.55),
	"grassland": Color(0.25, 0.6, 0.2),
	"forest": Color(0.1, 0.4, 0.1),
	"desert": Color(0.8, 0.7, 0.4),
	"hills": Color(0.5, 0.45, 0.3),
	"mountains": Color(0.4, 0.4, 0.45),
	"tundra": Color(0.8, 0.85, 0.9),
	"swamp": Color(0.3, 0.35, 0.2),
	"volcanic": Color(0.4, 0.15, 0.1),
}

func generate_overview(terrain_gen: TerrainGenerator, center_cx: int, center_cy: int, radius: int = 5) -> Image:
	var size := (radius * 2 + 1) * 8
	var img := Image.create(size, size, false, Image.FORMAT_RGB8)

	for cy in range(-radius, radius + 1):
		for cx in range(-radius, radius + 1):
			var base_x := (center_cx + cx) * WorldCell.CELL_SIZE
			var base_y := (center_cy + cy) * WorldCell.CELL_SIZE
			var sample_x := base_x + WorldCell.CELL_SIZE / 2
			var sample_y := base_y + WorldCell.CELL_SIZE / 2
			var height := terrain_gen._sample_height(sample_x, sample_y)
			var moisture := terrain_gen._sample_moisture(sample_x, sample_y)
			var temp := terrain_gen._sample_temperature(sample_x, sample_y, height)
			var biome := terrain_gen._classify_biome(height, moisture, temp)
			var color: Color = BIOME_COLORS.get(biome, Color.MAGENTA)

			var px := (cx + radius) * 8
			var py := (cy + radius) * 8
			for dy in range(8):
				for dx in range(8):
					if px + dx < size and py + dy < size:
						img.set_pixel(px + dx, py + dy, color)

	return img
