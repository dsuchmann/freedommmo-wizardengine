#!/usr/bin/env python3
"""
Precompute height/slope/biome masks for efficient TileMap painting.
Generates intermediate data for TilePainter.gd to use.
"""
import json
import pathlib
import sys
import numpy as np
from typing import Dict, Tuple, List
from PIL import Image

print('[HB] bake_masks.py ready')

def compute_slope_mask(height_field: np.ndarray, threshold: float = 0.15) -> np.ndarray:
    """Compute slope magnitude from height field"""
    h, w = height_field.shape
    slope = np.zeros_like(height_field)
    
    for y in range(1, h-1):
        for x in range(1, w-1):
            dx = height_field[y, x+1] - height_field[y, x-1]
            dy = height_field[y+1, x] - height_field[y-1, x]
            slope[y, x] = np.sqrt(dx*dx + dy*dy) * 0.5
    
    return (slope > threshold).astype(np.uint8)

def classify_biomes(height: np.ndarray, moisture: np.ndarray, temp: np.ndarray, 
                   biome_table: Dict) -> np.ndarray:
    """Classify each cell into biome ID"""
    h, w = height.shape
    biome_ids = np.zeros((h, w), dtype=np.uint8)
    
    sea_level = biome_table["sea_level"]
    beach_band = biome_table["beach_band"]
    
    for y in range(h):
        for x in range(w):
            h_val = height[y, x]
            m_val = moisture[y, x]
            t_val = temp[y, x]
            
            if h_val < sea_level:
                biome_ids[y, x] = 0  # ocean
            elif h_val < sea_level + beach_band:
                biome_ids[y, x] = 1  # beach
            else:
                # Check biome entries
                biome_id = 2  # default grass
                for i, entry in enumerate(biome_table["entries"]):
                    h_range = entry["h"]
                    m_range = entry["m"] 
                    t_range = entry["t"]
                    
                    if (h_range[0] <= h_val <= h_range[1] and
                        m_range[0] <= m_val <= m_range[1] and
                        t_range[0] <= t_val <= t_range[1]):
                        biome_id = i + 2  # offset for ocean/beach
                        break
                
                biome_ids[y, x] = biome_id
    
    return biome_ids

def compute_flow_accumulation(height: np.ndarray) -> np.ndarray:
    """Compute flow accumulation for river detection"""
    h, w = height.shape
    flow_acc = np.ones((h, w), dtype=np.int32)
    
    # Create sorted list of cells by height (high to low)
    cells = []
    for y in range(h):
        for x in range(w):
            cells.append((height[y, x], y, x))
    cells.sort(reverse=True)
    
    # Flow accumulation
    directions = [(-1,-1), (-1,0), (-1,1), (0,-1), (0,1), (1,-1), (1,0), (1,1)]
    
    for _, y, x in cells:
        best_h = height[y, x]
        best_y, best_x = y, x
        
        # Find steepest downslope neighbor
        for dy, dx in directions:
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w:
                if height[ny, nx] < best_h:
                    best_h = height[ny, nx]
                    best_y, best_x = ny, nx
        
        # Flow to steepest neighbor
        if best_y != y or best_x != x:
            flow_acc[best_y, best_x] += flow_acc[y, x]
    
    return flow_acc

def generate_blue_noise_mask(width: int, height: int, radius: float = 3.0) -> np.ndarray:
    """Generate blue noise mask for variant placement"""
    # Simple Poisson disk sampling
    mask = np.zeros((height, width), dtype=np.uint8)
    points = []
    
    # Mitchell's best candidate algorithm (simplified)
    max_attempts = width * height // 10
    
    for _ in range(max_attempts):
        # Random candidate
        x = np.random.randint(0, width)
        y = np.random.randint(0, height)
        
        # Check distance to existing points
        valid = True
        for px, py in points:
            dist = np.sqrt((x - px)**2 + (y - py)**2)
            if dist < radius:
                valid = False
                break
        
        if valid:
            points.append((x, y))
            mask[y, x] = 1
    
    return mask

def bake_chunk_masks(chunk_x: int, chunk_y: int, chunk_size: int, seed: int, 
                    config: Dict, biome_table: Dict, output_dir: pathlib.Path):
    """Bake all masks for a single chunk"""
    np.random.seed(seed + chunk_x * 1000 + chunk_y)
    
    # Generate noise fields (simplified - would use actual NoiseFields.gd output)
    height = np.random.random((chunk_size, chunk_size)) * 0.5 + 0.3
    moisture = np.random.random((chunk_size, chunk_size))
    temp = 1.0 - height * 0.35  # altitude lapse
    
    # Compute derived masks
    slope_mask = compute_slope_mask(height, config.get("cliff_threshold", 0.15))
    biome_mask = classify_biomes(height, moisture, temp, biome_table)
    flow_acc = compute_flow_accumulation(height)
    river_mask = (flow_acc > config["hydro"]["flow_threshold"]).astype(np.uint8)
    blue_noise = generate_blue_noise_mask(chunk_size, chunk_size)
    
    # Save masks
    chunk_dir = output_dir / f"chunk_{chunk_x}_{chunk_y}"
    chunk_dir.mkdir(parents=True, exist_ok=True)
    
    masks = {
        "height": height,
        "slope": slope_mask, 
        "biome": biome_mask,
        "river": river_mask,
        "blue_noise": blue_noise
    }
    
    for name, mask in masks.items():
        mask_path = chunk_dir / f"{name}.npy"
        np.save(mask_path, mask)
        # Also write PNGs so Godot can read masks without numpy
        if name in ("slope", "river", "blue_noise"):
            img = Image.fromarray((mask * 255).astype(np.uint8), mode='L')
            img.save(chunk_dir / f"{name}.png")
        elif name == "biome":
            img = Image.fromarray(mask.astype(np.uint8), mode='L')
            img.save(chunk_dir / "biome.png")
        elif name == "height":
            # Normalize height to 0..255
            h_norm = np.clip((mask - mask.min()) / max(1e-6, (mask.max() - mask.min())), 0.0, 1.0)
            img = Image.fromarray((h_norm * 255).astype(np.uint8), mode='L')
            img.save(chunk_dir / "height.png")
    
    # Save metadata
    metadata = {
        "chunk_pos": [chunk_x, chunk_y],
        "chunk_size": chunk_size,
        "seed": seed,
        "masks": list(masks.keys()),
        "biome_counts": {int(i): int(np.sum(biome_mask == i)) for i in np.unique(biome_mask)}
    }
    
    meta_path = chunk_dir / "metadata.json"
    with open(meta_path, 'w') as f:
        json.dump(metadata, f, indent=2)

    # Save color preview PNG for quick visual check
    palette = {
        0: (30, 80, 160),   # ocean
        1: (240, 220, 120), # beach
        2: (80, 160, 80),   # grass
        3: (220, 200, 120), # desert
        4: (40, 110, 50),   # forest
        5: (140, 140, 140), # rock
        6: (200, 220, 230)  # tundra
    }
    color_img = Image.new('RGB', (chunk_size, chunk_size))
    for y in range(chunk_size):
        for x in range(chunk_size):
            bid = int(biome_mask[y, x])
            color_img.putpixel((x, y), palette.get(bid, (255, 0, 255)))
    # rivers overlay in blue
    for y in range(chunk_size):
        for x in range(chunk_size):
            if river_mask[y, x] == 1:
                color_img.putpixel((x, y), (30, 110, 190))
    color_img = color_img.transpose(Image.FLIP_TOP_BOTTOM)
    color_img.save(chunk_dir / "preview.png")
    
    print(f"[HB] Baked masks for chunk ({chunk_x}, {chunk_y}): {chunk_dir}")
    return metadata

def main():
    if len(sys.argv) < 4:
        print("Usage: python bake_masks.py <chunk_x> <chunk_y> <seed> [config.json] [biome_table.json]")
        sys.exit(1)
    
    chunk_x = int(sys.argv[1])
    chunk_y = int(sys.argv[2]) 
    seed = int(sys.argv[3])
    
    config_path = sys.argv[4] if len(sys.argv) > 4 else "data/worldgen/config.json"
    biome_path = sys.argv[5] if len(sys.argv) > 5 else "data/biomes/table.json"
    
    # Load configuration
    with open(config_path) as f:
        config = json.load(f)
    
    with open(biome_path) as f:
        biome_table = json.load(f)
    
    output_dir = pathlib.Path("generated/masks")
    
    # Bake masks for the chunk
    metadata = bake_chunk_masks(chunk_x, chunk_y, config["chunk_size"], seed, 
                               config, biome_table, output_dir)
    
    print(f"[HB] Mask baking completed for chunk ({chunk_x}, {chunk_y})")

if __name__ == "__main__":
    main()
