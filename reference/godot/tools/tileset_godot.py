#!/usr/bin/env python3
"""
Godot TileSet generator with terrain rules and PBR materials.
Reads atlas metadata and generates .tres TileSet resource files.
"""
import json
import pathlib
import sys
from typing import Dict, List

print('[HB] tileset_godot.py ready')

def generate_tileset_tres(metadata: Dict, output_path: pathlib.Path):
    """Generate Godot 4 TileSet .tres file from atlas metadata"""
    
    # TileSet resource header
    tres_content = [
        '[gd_resource type="TileSet" format=3]',
        '',
        '[resource]',
        f'tile_size = Vector2i({metadata["tile_size"]}, {metadata["tile_size"]})',
    ]
    
    # Physics layers (for collision)
    tres_content.extend([
        'physics_layer_0/collision_layer = 1',
        'physics_layer_0/collision_mask = 1',
    ])
    
    # Terrain sets for autotiling
    for i, terrain_set in enumerate(metadata.get("terrain_sets", [])):
        tres_content.extend([
            f'terrain_set_{i}/mode = 0',  # TERRAIN_MODE_MATCH_CORNERS_AND_SIDES
            f'terrain_set_{i}/terrain_0/name = "{terrain_set["terrains"][0]["name"]}"',
            f'terrain_set_{i}/terrain_0/color = Color{_color_to_godot(terrain_set["terrains"][0]["color"])}',
            f'terrain_set_{i}/terrain_1/name = "{terrain_set["terrains"][1]["name"]}"', 
            f'terrain_set_{i}/terrain_1/color = Color{_color_to_godot(terrain_set["terrains"][1]["color"])}',
        ])
    
    # Sources (atlas textures)
    source_id = 0
    for biome, biome_data in metadata["biomes"].items():
        atlas_files = biome_data["atlas_files"]
        
        # Create TileSetAtlasSource for each biome
        tres_content.extend([
            f'source_{source_id} = SubResource("TileSetAtlasSource_{source_id}")',
        ])
        
        # Atlas source definition
        albedo_file = atlas_files.get("albedo", {}).get("atlas_file", "")
        normal_file = atlas_files.get("normal", {}).get("atlas_file", "")
        
        tres_content.extend([
            '',
            f'[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_{source_id}"]',
            f'texture = preload("res://assets/atlas/{albedo_file}")',
            f'texture_region_size = Vector2i({metadata["tile_size"]}, {metadata["tile_size"]})',
        ])
        
        # Add tiles to source
        for tile in biome_data["tiles"]:
            tile_id = tile["id"]
            rect = tile["atlas_rect"]
            
            tres_content.extend([
                f'{tile_id}:0/0 = 0',  # Atlas coordinates
                f'{tile_id}:0/0/texture_origin = Vector2i({rect[0]}, {rect[1]})',
            ])
            
            # Add terrain data for autotiling (simplified)
            if "ground" in tile.get("source_file", ""):
                tres_content.append(f'{tile_id}:0/0/terrain_set = 0')
                tres_content.append(f'{tile_id}:0/0/terrain = 1')  # Ground terrain
            elif "water" in tile.get("source_file", ""):
                tres_content.append(f'{tile_id}:0/0/terrain_set = 0') 
                tres_content.append(f'{tile_id}:0/0/terrain = 0')  # Water terrain
        
        source_id += 1
    
    # Write .tres file
    with open(output_path, 'w') as f:
        f.write('\n'.join(tres_content))
    
    print(f"[HB] Generated TileSet: {output_path}")

def generate_material_tres(biome: str, palette: Dict, output_dir: pathlib.Path):
    """Generate CanvasItemMaterial .tres for PBR rendering"""
    
    material_content = [
        '[gd_resource type="CanvasItemMaterial" format=3]',
        '',
        '[resource]',
        'light_mode = 1',  # LIGHT_MODE_NORMAL
        f'normal_map = preload("res://assets/atlas/{biome}_normal.png")',
    ]
    
    material_path = output_dir / f"{biome}_material.tres"
    with open(material_path, 'w') as f:
        f.write('\n'.join(material_content))
    
    print(f"[HB] Generated material: {material_path}")

def _color_to_godot(hex_color: str) -> str:
    """Convert hex color to Godot Color format"""
    hex_color = hex_color.lstrip('#')
    r = int(hex_color[0:2], 16) / 255.0
    g = int(hex_color[2:4], 16) / 255.0  
    b = int(hex_color[4:6], 16) / 255.0
    return f"({r:.3f}, {g:.3f}, {b:.3f}, 1)"

def main():
    if len(sys.argv) < 2:
        print("Usage: python tileset_godot.py <tileset_metadata.json>")
        sys.exit(1)
    
    metadata_path = pathlib.Path(sys.argv[1])
    if not metadata_path.exists():
        print(f"Error: Metadata file not found: {metadata_path}")
        sys.exit(1)
    
    with open(metadata_path) as f:
        metadata = json.load(f)
    
    output_dir = pathlib.Path("assets/tilesets")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate main TileSet
    tileset_path = output_dir / "WorldTileSet.tres"
    generate_tileset_tres(metadata, tileset_path)
    
    # Generate materials for each biome
    for biome in metadata["biomes"].keys():
        palette_path = pathlib.Path(f"data/worldgen/palette/{biome}.json")
        if palette_path.exists():
            with open(palette_path) as f:
                palette = json.load(f)
            generate_material_tres(biome, palette, output_dir)
    
    print(f"[HB] TileSet generation completed")

if __name__ == "__main__":
    main()
