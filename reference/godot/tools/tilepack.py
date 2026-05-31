#!/usr/bin/env python3
"""
Atlas packer for tile families with albedo/normal/height/AO channels.
Packs variants into coordinated atlases and generates metadata for Godot TileSet.
"""
import json
import pathlib
import sys
from PIL import Image
from typing import Dict, List, Tuple

print('[HB] tilepack.py ready')

def pack_channel_atlas(tiles: List[pathlib.Path], atlas_size: int = 512, tile_size: int = 16) -> Tuple[Image.Image, List[Dict]]:
    """Pack tiles into a single atlas image and return metadata"""
    tiles_per_row = atlas_size // tile_size
    atlas = Image.new('RGBA', (atlas_size, atlas_size), (0, 0, 0, 0))
    metadata = []
    
    for i, tile_path in enumerate(tiles):
        if not tile_path.exists():
            print(f"Warning: Missing tile {tile_path}")
            continue
            
        tile_img = Image.open(tile_path).convert('RGBA')
        tile_img = tile_img.resize((tile_size, tile_size), Image.NEAREST)
        
        x = (i % tiles_per_row) * tile_size
        y = (i // tiles_per_row) * tile_size
        
        atlas.paste(tile_img, (x, y))
        
        metadata.append({
            "id": i,
            "source_file": str(tile_path.name),
            "atlas_rect": [x, y, tile_size, tile_size],
            "uv_rect": [x/atlas_size, y/atlas_size, tile_size/atlas_size, tile_size/atlas_size]
        })
    
    return atlas, metadata

def pack_biome_atlases(biome: str, families: List[str], output_dir: pathlib.Path):
    """Pack all tile families for a biome into coordinated atlases"""
    output_dir.mkdir(parents=True, exist_ok=True)
    
    all_tiles = {}
    channels = ["albedo", "normal", "height", "ao"]
    
    # Collect all tiles by channel
    for channel in channels:
        all_tiles[channel] = []
        
        for family in families:
            family_dir = pathlib.Path(f"assets/Generated/{biome}/{family}")
            if family_dir.exists():
                tiles = sorted(family_dir.glob(f"{channel}_*.png"))
                all_tiles[channel].extend(tiles)
    
    # Pack each channel into its own atlas
    atlas_metadata = {"biome": biome, "channels": {}, "tiles": []}
    
    for channel in channels:
        if all_tiles[channel]:
            atlas_img, tile_metadata = pack_channel_atlas(all_tiles[channel])
            
            atlas_path = output_dir / f"{biome}_{channel}.png"
            atlas_img.save(atlas_path)
            
            atlas_metadata["channels"][channel] = {
                "atlas_file": str(atlas_path.name),
                "tile_count": len(tile_metadata)
            }
            
            # Merge tile metadata (only once, using albedo as reference)
            if channel == "albedo":
                atlas_metadata["tiles"] = tile_metadata
            
            print(f"[HB] Packed {channel} atlas: {atlas_path} ({len(tile_metadata)} tiles)")
    
    # Save metadata
    meta_path = output_dir / f"{biome}_atlas.json"
    with open(meta_path, 'w') as f:
        json.dump(atlas_metadata, f, indent=2)
    
    print(f"[HB] Atlas metadata saved: {meta_path}")
    return atlas_metadata

def generate_tileset_metadata(biomes: List[str], output_path: pathlib.Path):
    """Generate combined tileset metadata for all biomes"""
    tileset_meta = {
        "version": "1.0",
        "tile_size": 16,
        "biomes": {},
        "terrain_sets": []
    }
    
    tile_id = 0
    for biome in biomes:
        atlas_meta_path = pathlib.Path(f"assets/atlas/{biome}_atlas.json")
        if atlas_meta_path.exists():
            with open(atlas_meta_path) as f:
                biome_meta = json.load(f)
            
            # Assign global tile IDs
            biome_tiles = []
            for tile in biome_meta["tiles"]:
                tile["global_id"] = tile_id
                biome_tiles.append(tile)
                tile_id += 1
            
            tileset_meta["biomes"][biome] = {
                "atlas_files": biome_meta["channels"],
                "tiles": biome_tiles,
                "tile_count": len(biome_tiles)
            }
    
    # Define terrain sets for autotiling
    tileset_meta["terrain_sets"] = [
        {
            "name": "ground_water",
            "mode": "match_corners_and_sides",
            "terrains": [
                {"name": "water", "color": "#2d5a87"},
                {"name": "ground", "color": "#50a050"}
            ]
        },
        {
            "name": "ground_cliff", 
            "mode": "match_corners_and_sides",
            "terrains": [
                {"name": "ground", "color": "#50a050"},
                {"name": "cliff", "color": "#606060"}
            ]
        }
    ]
    
    with open(output_path, 'w') as f:
        json.dump(tileset_meta, f, indent=2)
    
    print(f"[HB] Tileset metadata saved: {output_path}")
    return tileset_meta

def main():
    if len(sys.argv) < 2:
        print("Usage: python tilepack.py <biome1,biome2,...> [families]")
        sys.exit(1)
    
    biomes = sys.argv[1].split(',')
    families = sys.argv[2].split(',') if len(sys.argv) > 2 else ["ground", "cliff", "water"]
    
    output_dir = pathlib.Path("assets/atlas")
    
    # Pack each biome
    for biome in biomes:
        print(f"[HB] Packing atlases for biome: {biome}")
        pack_biome_atlases(biome, families, output_dir)
    
    # Generate combined tileset metadata
    tileset_meta_path = output_dir / "tileset_metadata.json"
    generate_tileset_metadata(biomes, tileset_meta_path)
    
    print(f"[HB] Atlas packing completed for biomes: {', '.join(biomes)}")

if __name__ == "__main__":
    main()
