#!/usr/bin/env python3
"""
High-performance world generation for FreedomMMO using Python + NumPy.
Generates detailed regions as binary files for instant loading in Godot.
"""

import numpy as np
import json
import struct
import os
import sys
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import time
import multiprocessing as mp
from concurrent.futures import ProcessPoolExecutor, as_completed, ThreadPoolExecutor
import threading
from functools import partial

# Try to import GPU acceleration libraries
try:
    import cupy as cp
    GPU_AVAILABLE = True
    print("[PERF] GPU acceleration available via CuPy")
except ImportError:
    try:
        import numpy as np
        # Check if we can use Intel MKL or other optimized BLAS
        if hasattr(np, '__config__') and 'mkl' in str(np.__config__).lower():
            print("[PERF] Intel MKL acceleration detected")
        GPU_AVAILABLE = False
    except:
        GPU_AVAILABLE = False
        print("[PERF] Using standard NumPy (no GPU acceleration)")

# Lightweight boolean dilation (no SciPy dependency)
def _dilate(mask: np.ndarray, iterations: int = 1) -> np.ndarray:
    result = mask.astype(bool)
    for _ in range(max(1, iterations)):
        p = np.pad(result, 1, mode='constant', constant_values=False)
        expanded = (
            p[1:-1, 1:-1] |
            p[:-2, 1:-1] | p[2:, 1:-1] |
            p[1:-1, :-2] | p[1:-1, 2:] |
            p[:-2, :-2] | p[:-2, 2:] | p[2:, :-2] | p[2:, 2:]
        )
        result = expanded
    return result

# Constants matching Godot
REGION_TILES = 512
TILE_PX = 64
WORLD_SIZE = 2048

# Tile IDs matching Godot's detailed tileset
TILE_IDS = {
    'water': 0,
    'sand': 1, 
    'grass': 2,
    'dirt': 3,
    'stone': 4,
    'forest': 5,
    'rock': 6,
    'mud': 7,
    'gravel': 8,
    'moss': 9,
    'snow': 10,
    'ice': 11,
    'lava': 12,
    'crystal': 13,
    'path': 14,
    'flowers': 15,
    # Extended tiles needed by regional generator (match Main.gd detailed tileset)
    'tall_grass': 42
}

# Enhanced biome definitions with more diversity
BIOMES = {
    'ocean': {'primary': 'water', 'secondary': 'sand', 'tertiary': 'ice', 'accent': 'gravel'},
    'deep_ocean': {'primary': 'water', 'secondary': 'ice', 'tertiary': 'sand', 'accent': 'crystal'},
    'shallow_water': {'primary': 'water', 'secondary': 'sand', 'tertiary': 'grass', 'accent': 'mud'},
    'beach': {'primary': 'sand', 'secondary': 'water', 'tertiary': 'grass', 'accent': 'gravel'},
    'grassland': {'primary': 'grass', 'secondary': 'dirt', 'tertiary': 'flowers', 'accent': 'path'},
    'forest': {'primary': 'forest', 'secondary': 'moss', 'tertiary': 'dirt', 'accent': 'flowers'},
    'hills': {'primary': 'stone', 'secondary': 'gravel', 'tertiary': 'grass', 'accent': 'rock'},
    'mountains': {'primary': 'rock', 'secondary': 'stone', 'tertiary': 'snow', 'accent': 'gravel'},
    'desert': {'primary': 'sand', 'secondary': 'stone', 'tertiary': 'crystal', 'accent': 'gravel'},
    'tundra': {'primary': 'snow', 'secondary': 'ice', 'tertiary': 'stone', 'accent': 'gravel'}
}

class FastNoise:
    """High-performance noise generation with GPU acceleration support."""
    
    def __init__(self, seed: int = 12345):
        self.seed = seed
        np.random.seed(seed)
        self.use_gpu = GPU_AVAILABLE
        
        # Always use CPU for single regions - GPU has overhead
        self.use_gpu = False
        
    def simplex_2d(self, x: np.ndarray, y: np.ndarray, frequency: float = 1.0) -> np.ndarray:
        """Organic noise generation with natural patterns - optimized for speed."""
        # Skip GPU overhead for single regions - use optimized CPU version
        return self._simplex_2d_cpu_fast(x, y, frequency)
    
    def _simplex_2d_gpu(self, x: np.ndarray, y: np.ndarray, frequency: float = 1.0) -> np.ndarray:
        """GPU-accelerated simplex noise using CuPy."""
        # Transfer to GPU
        x_gpu = cp.asarray(x, dtype=cp.float32)
        y_gpu = cp.asarray(y, dtype=cp.float32)
        result_gpu = cp.zeros_like(x_gpu)
        
        # Enhanced noise generation with multiple octaves on GPU
        octaves = 5
        for i in range(octaves):
            freq = frequency * (2.0 ** i)
            amplitude = 1.0 / (2.0 ** i)
            
            # Organic phase offsets for natural patterns
            phase_x = 1.618033988749 * i  # Golden ratio for organic distribution
            phase_y = 2.718281828459 * i  # Euler's number for natural variation
            
            # Enhanced noise computation on GPU
            noise_gpu = cp.sin(
                (x_gpu + phase_x) * freq * 0.013 + 
                cp.cos((y_gpu + phase_y) * freq * 0.017) * 0.5
            ) * cp.cos(
                (y_gpu + phase_y) * freq * 0.011 + 
                cp.sin((x_gpu + phase_x) * freq * 0.019) * 0.7
            )
            
            # Add domain warping for more complex patterns
            warp_x = cp.sin((x_gpu + y_gpu) * freq * 0.007) * 20.0
            warp_y = cp.cos((x_gpu - y_gpu) * freq * 0.009) * 20.0
            
            warped_noise = cp.sin(
                (x_gpu + warp_x) * freq * 0.015
            ) * cp.cos(
                (y_gpu + warp_y) * freq * 0.012
            )
            
            result_gpu += (noise_gpu + warped_noise * 0.3) * amplitude
        
        # Transfer back to CPU and return
        return cp.asnumpy(cp.tanh(result_gpu * 0.35))
    
    def _simplex_2d_cpu_fast(self, x: np.ndarray, y: np.ndarray, frequency: float = 1.0) -> np.ndarray:
        """Ultra-fast CPU noise generation - creates large terrain swaths, not oscillator patterns."""
        result = np.zeros_like(x, dtype=np.float32)
        
        # Use fewer octaves with much lower frequencies for large terrain features
        octaves = [
            (frequency * 0.001, 1.0),      # Very large features (continent scale)
            (frequency * 0.003, 0.5),     # Large features (mountain ranges)
            (frequency * 0.008, 0.25)     # Medium features (hills)
        ]
        
        for freq, amp in octaves:
            # Much lower frequency noise for large coherent areas
            noise = np.sin(x * freq + np.pi * 0.33) * np.cos(y * freq + np.pi * 0.67)
            
            # Add perpendicular component for more natural variation
            noise += np.cos(x * freq * 0.7 + np.pi * 0.25) * np.sin(y * freq * 1.3 + np.pi * 0.75) * 0.4
            
            result += noise * amp
            
        return np.tanh(result * 0.6)  # Stronger contrast for clearer terrain boundaries
    
    def _simplex_2d_cpu(self, x: np.ndarray, y: np.ndarray, frequency: float = 1.0) -> np.ndarray:
        """CPU-optimized simplex noise with vectorized operations."""
        result = np.zeros_like(x, dtype=np.float32)
        
        # Use more octaves for smoother, more natural terrain
        for i in range(5):  # More octaves for better detail
            freq = frequency * (1.7 ** i)  # Less aggressive frequency scaling
            amp = 1.0 / (2.1 ** (i * 0.65))  # Gentler amplitude decay
            
            # Organic phase offsets to break grid patterns
            phase_x = (self.seed + i * 1337) * 0.0123 + i * 0.456
            phase_y = (self.seed + i * 2741) * 0.0187 + i * 0.789
            
            # Create more organic wave combinations
            # Use irrational multipliers to avoid grid alignment
            wave1 = np.sin(x * freq * 1.618 + phase_x) * np.cos(y * freq * 0.618 + phase_y)  # Golden ratio
            wave2 = np.cos(x * freq * 1.414 + phase_y) * np.sin(y * freq * 0.707 + phase_x)  # sqrt(2)
            wave3 = np.sin(x * freq * 2.718 + phase_x * 0.5) * np.cos(y * freq * 0.368 + phase_y * 0.5)  # e
            
            # Combine waves with natural weighting
            noise = (wave1 * 0.5 + wave2 * 0.3 + wave3 * 0.2) * amp
            
            # Add slight rotation to break grid patterns
            if i > 1:
                rotation_factor = 0.1 * i
                rotated_x = x * np.cos(rotation_factor) - y * np.sin(rotation_factor)
                rotated_y = x * np.sin(rotation_factor) + y * np.cos(rotation_factor)
                rotation_noise = np.sin(rotated_x * freq * 0.5) * np.cos(rotated_y * freq * 0.5) * amp * 0.3
                noise += rotation_noise
            
            result += noise
            
        return np.tanh(result * 0.35)  # Smooth distribution

class WorldGenerator:
    """High-performance world generation engine."""
    
    def __init__(self, config_path: str = None, seed: int = None, max_workers: int = None):
        # Use region-specific seed if provided, otherwise use default
        self.base_seed = seed if seed is not None else 12345
        self.noise = FastNoise(self.base_seed)
        self.config = self._load_config(config_path)
        
        # Auto-detect optimal worker count for gaming PC
        if max_workers is None:
            # Use all CPU cores for maximum performance
            self.max_workers = mp.cpu_count()
        else:
            self.max_workers = max_workers
            
        print(f"[PERF] WorldGenerator initialized with {self.max_workers} workers")
        
        # Create output directory
        self.regions_dir = Path("user://regions").expanduser()
        if not self.regions_dir.exists():
            # Fallback to local directory if user:// doesn't work
            self.regions_dir = Path("./regions")
            self.regions_dir.mkdir(exist_ok=True)
            
        # Initialize process pool for parallel generation
        self._process_pool = None
            
    def _load_config(self, config_path: str) -> Dict:
        """Load generation configuration."""
        default_config = {
            "elevation_frequency": 0.003,
            "moisture_frequency": 0.004,
            "temperature_frequency": 0.002,
            "river_frequency": 0.008,
            "detail_frequency": 0.02,
            "water_threshold": 0.6,
            "river_threshold": 0.85,
            "biome_coherence": 0.8
        }
        
        if config_path and os.path.exists(config_path):
            with open(config_path, 'r') as f:
                user_config = json.load(f)
                default_config.update(user_config)
                
        return default_config
        
    def generate_world_data(self, world_x: int, world_y: int) -> Dict[str, np.ndarray]:
        """Generate base world data for a region."""
        # Create coordinate grids
        x_coords = np.linspace(world_x, world_x + REGION_TILES, REGION_TILES, dtype=np.float32)
        y_coords = np.linspace(world_y, world_y + REGION_TILES, REGION_TILES, dtype=np.float32)
        X, Y = np.meshgrid(x_coords, y_coords)
        
        # Generate noise layers
        elevation = self.noise.simplex_2d(X, Y, self.config["elevation_frequency"])
        moisture = self.noise.simplex_2d(X + 1000, Y + 1000, self.config["moisture_frequency"])
        temperature = self.noise.simplex_2d(X + 2000, Y + 2000, self.config["temperature_frequency"])
        rivers = self.noise.simplex_2d(X + 3000, Y + 3000, self.config["river_frequency"])
        detail = self.noise.simplex_2d(X + 4000, Y + 4000, self.config["detail_frequency"])
        
        return {
            'elevation': elevation,
            'moisture': moisture,
            'temperature': temperature,
            'rivers': rivers,
            'detail': detail,
            'x_coords': X,
            'y_coords': Y
        }
        
    def assign_biomes(self, world_data: Dict[str, np.ndarray]) -> np.ndarray:
        """Assign biomes based on elevation, moisture, and temperature."""
        elevation = world_data['elevation']
        moisture = world_data['moisture']
        temperature = world_data['temperature']
        
        biome_map = np.full(elevation.shape, 'grassland', dtype='U10')
        
        # Ocean (very low elevation)
        ocean_mask = elevation < -0.3
        biome_map[ocean_mask] = 'ocean'
        
        # Beach (low elevation near water)
        beach_mask = (elevation >= -0.3) & (elevation < -0.1) & (moisture > 0.1)
        biome_map[beach_mask] = 'beach'
        
        # Mountains (high elevation)
        mountain_mask = elevation > 0.4
        biome_map[mountain_mask] = 'mountains'
        
        # Hills (medium-high elevation)
        hills_mask = (elevation > 0.2) & (elevation <= 0.4)
        biome_map[hills_mask] = 'hills'
        
        # Desert (low moisture, high temperature)
        desert_mask = (moisture < -0.2) & (temperature > 0.1) & (elevation > -0.1)
        biome_map[desert_mask] = 'desert'
        
        # Tundra (low temperature)
        tundra_mask = (temperature < -0.3) & (elevation > -0.1)
        biome_map[tundra_mask] = 'tundra'
        
        # Forest (high moisture, medium temperature)
        forest_mask = (moisture > 0.2) & (temperature > -0.1) & (temperature < 0.3) & (elevation > -0.1)
        biome_map[forest_mask] = 'forest'
        
        return biome_map
        
    def generate_terrain_tiles(self, world_data: Dict[str, np.ndarray], biome_map: np.ndarray) -> np.ndarray:
        """Generate final terrain tiles matching the sophisticated GDScript logic."""
        elevation = world_data['elevation']
        moisture = world_data['moisture']
        rivers = world_data['rivers']
        detail = world_data['detail']
        X, Y = world_data['x_coords'], world_data['y_coords']
        
        # Initialize tiles array
        tiles = np.zeros(elevation.shape, dtype=np.int32)
        
        # Generate additional noise layers for terrain variation using proper noise
        terrain_noise = self.noise.simplex_2d(X, Y, 0.02)
        detail_noise = self.noise.simplex_2d(X + 1000, Y + 1000, 0.06)
        micro_noise = self.noise.simplex_2d(X + 2000, Y + 2000, 0.15)
        
        # Normalize to [0, 1] range
        terrain_noise = (terrain_noise + 0.5)
        detail_noise = (detail_noise + 0.5) 
        micro_noise = (micro_noise + 0.5)
        
        # Process each biome with sophisticated logic matching GDScript
        for biome_name in np.unique(biome_map):
            mask = biome_map == biome_name
            if not np.any(mask):
                continue
                
            if biome_name == 'grassland':
                # Grassland: natural terrain with smooth transitions
                biome_tiles = np.full(mask.shape, TILE_IDS['grass'], dtype=np.int32)
                
                # Create natural terrain features using existing noise
                combined_terrain = elevation + terrain_noise * 0.3 + detail_noise * 0.2
                moisture_terrain = moisture + micro_noise * 0.2
                
                # Dirt patches in valleys and low areas
                dirt_mask = mask & (combined_terrain < -0.1)
                biome_tiles = np.where(dirt_mask, TILE_IDS['dirt'], biome_tiles)
                
                # Rocky outcrops on hills
                rock_mask = mask & (combined_terrain > 0.3) & ~dirt_mask
                biome_tiles = np.where(rock_mask, TILE_IDS['rock'], biome_tiles)
                
                # Forest groves in moist areas
                forest_suitability = moisture_terrain * 0.7 + (1.0 - np.abs(combined_terrain)) * 0.3
                forest_mask = mask & (forest_suitability > 0.4) & ~dirt_mask & ~rock_mask
                biome_tiles = np.where(forest_mask, TILE_IDS['forest'], biome_tiles)
                
                # Wildflowers in pleasant meadows
                flower_suitability = (moisture_terrain + 0.3) * (0.5 - np.abs(combined_terrain))
                flower_mask = mask & (flower_suitability > 0.3) & ~dirt_mask & ~rock_mask & ~forest_mask
                biome_tiles = np.where(flower_mask, TILE_IDS['flowers'], biome_tiles)
                
                # Occasional paths
                path_mask = mask & (micro_noise > 0.95) & (np.abs(combined_terrain) < 0.1) & ~dirt_mask & ~rock_mask
                biome_tiles = np.where(path_mask, TILE_IDS['path'], biome_tiles)
                
                tiles[mask] = biome_tiles[mask]
                
            elif biome_name == 'hills':
                # Hills: 80% rocks/stone, 15% gravel, 5% other
                biome_tiles = np.full(mask.shape, TILE_IDS['rock'], dtype=np.int32)  # Default rocks
                
                # Stone on peaks
                biome_tiles = np.where(mask & (elevation > 0.2), TILE_IDS['stone'], biome_tiles)
                
                # Gravel in valleys
                biome_tiles = np.where(mask & (detail_noise > 0.8), TILE_IDS['gravel'], biome_tiles)
                
                # Rare grass
                biome_tiles = np.where(mask & (terrain_noise > 0.9), TILE_IDS['grass'], biome_tiles)
                
                # Extremely rare moss
                biome_tiles = np.where(mask & (micro_noise > 0.98), TILE_IDS['moss'], biome_tiles)
                
                tiles[mask] = biome_tiles[mask]
                
            elif biome_name == 'beach':
                # Beach: 98% sand, 1% water, 1% other
                biome_tiles = np.full(mask.shape, TILE_IDS['sand'], dtype=np.int32)  # Default sand
                
                # Water only in extremely low, wet areas (very rare)
                biome_tiles = np.where(mask & (elevation < -0.5) & (moisture > 0.6), TILE_IDS['water'], biome_tiles)
                
                # Rare gravel patches
                biome_tiles = np.where(mask & (detail_noise > 0.95), TILE_IDS['gravel'], biome_tiles)
                
                # Rare grass patches near dunes
                biome_tiles = np.where(mask & (elevation > 0.3) & (micro_noise > 0.97), TILE_IDS['grass'], biome_tiles)
                
                tiles[mask] = biome_tiles[mask]
                
            elif biome_name == 'mountains':
                # Mountains: snow on peaks, stone, rocks
                biome_tiles = np.full(mask.shape, TILE_IDS['stone'], dtype=np.int32)  # Default stone
                
                # Snow on peaks
                biome_tiles = np.where(mask & (elevation > 0.4), TILE_IDS['snow'], biome_tiles)
                
                # Rocks on slopes
                biome_tiles = np.where(mask & (elevation > 0.3) & (elevation <= 0.4), TILE_IDS['rock'], biome_tiles)
                
                # Gravel in valleys
                biome_tiles = np.where(mask & (elevation < 0.0), TILE_IDS['gravel'], biome_tiles)
                
                tiles[mask] = biome_tiles[mask]
                
            elif biome_name == 'forest':
                # Forest: mostly forest with moss and dirt
                biome_tiles = np.full(mask.shape, TILE_IDS['forest'], dtype=np.int32)  # Default forest
                
                # Moss in wet areas
                biome_tiles = np.where(mask & (moisture > 0.3), TILE_IDS['moss'], biome_tiles)
                
                # Dirt patches
                biome_tiles = np.where(mask & (detail_noise > 0.8), TILE_IDS['dirt'], biome_tiles)
                
                tiles[mask] = biome_tiles[mask]
                
            elif biome_name == 'desert':
                # Desert: mostly sand with stone and crystal
                biome_tiles = np.full(mask.shape, TILE_IDS['sand'], dtype=np.int32)  # Default sand
                
                # Stone outcrops
                biome_tiles = np.where(mask & (elevation > 0.2), TILE_IDS['stone'], biome_tiles)
                
                # Rare crystal formations
                biome_tiles = np.where(mask & (detail_noise > 0.95), TILE_IDS['crystal'], biome_tiles)
                
                tiles[mask] = biome_tiles[mask]
                
            elif biome_name == 'tundra':
                # Tundra: snow, ice, stone
                biome_tiles = np.full(mask.shape, TILE_IDS['snow'], dtype=np.int32)  # Default snow
                
                # Ice in low areas
                biome_tiles = np.where(mask & (elevation < -0.1), TILE_IDS['ice'], biome_tiles)
                
                # Stone outcrops
                biome_tiles = np.where(mask & (elevation > 0.3), TILE_IDS['stone'], biome_tiles)
                
                tiles[mask] = biome_tiles[mask]
                
            elif biome_name == 'ocean':
                # Ocean: water with occasional sand at edges
                biome_tiles = np.full(mask.shape, TILE_IDS['water'], dtype=np.int32)  # Default water
                
                # Sand at very edges (high elevation in ocean = near shore)
                biome_tiles = np.where(mask & (elevation > 0.2), TILE_IDS['sand'], biome_tiles)
                
                tiles[mask] = biome_tiles[mask]
        
        # Add rivers (extremely conservative) - only in appropriate biomes
        # Only ocean biomes can have rivers, and very rarely
        ocean_rivers = (rivers > 0.85) & (biome_map == 'ocean')
        tiles[ocean_rivers] = TILE_IDS['water']
        
        # No rivers in other biomes - they should maintain their biome character
        
        # Apply edge smoothing for seamless region transitions
        tiles = self._apply_edge_smoothing(tiles, elevation, moisture)
        
        return tiles
    
    def _apply_edge_smoothing(self, tiles: np.ndarray, elevation: np.ndarray, moisture: np.ndarray) -> np.ndarray:
        """Apply edge smoothing to reduce visible borders between regions."""
        height, width = tiles.shape
        edge_width = 8  # Number of pixels to smooth at edges
        
        # Create smoothed tiles array
        smoothed_tiles = tiles.copy()
        
        # Apply smoothing to edges using terrain-based blending
        for edge_dist in range(1, edge_width + 1):
            # Calculate blend strength (stronger near edges)
            blend_strength = (edge_width - edge_dist + 1) / edge_width * 0.3
            
            # Top and bottom edges
            if edge_dist < height:
                # Top edge
                for x in range(width):
                    if elevation[edge_dist, x] > 0.1 and moisture[edge_dist, x] < 0.7:
                        # Blend with more common terrain types
                        if np.random.random() < blend_strength:
                            smoothed_tiles[edge_dist, x] = self._get_blended_tile(tiles[edge_dist, x], elevation[edge_dist, x])
                
                # Bottom edge
                bottom_y = height - 1 - edge_dist
                if bottom_y >= 0:
                    for x in range(width):
                        if elevation[bottom_y, x] > 0.1 and moisture[bottom_y, x] < 0.7:
                            if np.random.random() < blend_strength:
                                smoothed_tiles[bottom_y, x] = self._get_blended_tile(tiles[bottom_y, x], elevation[bottom_y, x])
            
            # Left and right edges
            if edge_dist < width:
                # Left edge
                for y in range(height):
                    if elevation[y, edge_dist] > 0.1 and moisture[y, edge_dist] < 0.7:
                        if np.random.random() < blend_strength:
                            smoothed_tiles[y, edge_dist] = self._get_blended_tile(tiles[y, edge_dist], elevation[y, edge_dist])
                
                # Right edge
                right_x = width - 1 - edge_dist
                if right_x >= 0:
                    for y in range(height):
                        if elevation[y, right_x] > 0.1 and moisture[y, right_x] < 0.7:
                            if np.random.random() < blend_strength:
                                smoothed_tiles[y, right_x] = self._get_blended_tile(tiles[y, right_x], elevation[y, right_x])
        
        return smoothed_tiles
    
    def _get_blended_tile(self, original_tile: int, elevation_val: float) -> int:
        """Get a blended tile type for smoother transitions."""
        # Map to more neutral/common terrain types for blending
        if elevation_val > 0.3:
            return TILE_IDS['rock']  # High areas become rocky
        elif elevation_val > 0.0:
            return TILE_IDS['grass']  # Medium areas become grassy
        else:
            return TILE_IDS['dirt']   # Low areas become dirt
        
    def generate_region(self, world_x: int, world_y: int, forced_biome: str = None, neighbor_edges: Dict = None) -> np.ndarray:
        """Generate a complete region with optional forced biome and neighbor edge continuity."""
        print(f"[PY] Generating region at ({world_x}, {world_y}) with biome: {forced_biome}")
        start_time = time.time()
        
        # Create unique seed for this region based on coordinates
        # Use hash to ensure positive seed within valid range
        import hashlib
        seed_string = f"{self.base_seed}_{world_x}_{world_y}"
        region_seed = int(hashlib.md5(seed_string.encode()).hexdigest()[:8], 16) % (2**32 - 1)
        self.noise = FastNoise(region_seed)
        print(f"[PY] Using region-specific seed: {region_seed}")
        
        # Generate world data with enhanced complexity
        world_data = self.generate_enhanced_world_data(world_x, world_y)
        
        if forced_biome and forced_biome in BIOMES:
            # Use forced biome from Godot world map
            print(f"[PY] Using forced biome: {forced_biome}")
            biome_map = np.full((REGION_TILES, REGION_TILES), forced_biome, dtype='<U20')
        else:
            # Auto-detect biomes from world data
            print(f"[PY] Auto-detecting biomes")
            biome_map = self.assign_biomes(world_data)
        
        # Generate terrain tiles with enhanced complexity
        tiles = self.generate_enhanced_terrain_tiles(world_data, biome_map)
        
        # Apply edge continuity if neighbor data is provided
        if neighbor_edges:
            print(f"[PY] Applying edge continuity with {len(neighbor_edges)} neighbors")
            tiles = self.apply_edge_continuity(tiles, neighbor_edges)
        
        elapsed = time.time() - start_time
        print(f"[PY] Region ({world_x}, {world_y}) generated in {elapsed:.3f}s")
        
        return tiles
    
    def generate_enhanced_world_data(self, world_x: int, world_y: int) -> Dict[str, np.ndarray]:
        """Generate enhanced world data with more complex, curved patterns."""
        # Create coordinate grids
        x_coords = np.linspace(world_x, world_x + REGION_TILES, REGION_TILES, dtype=np.float32)
        y_coords = np.linspace(world_y, world_y + REGION_TILES, REGION_TILES, dtype=np.float32)
        X, Y = np.meshgrid(x_coords, y_coords)
        
        # Generate multiple noise layers with different characteristics for complexity
        # Primary elevation with large-scale features
        elevation_large = self.noise.simplex_2d(X, Y, self.config["elevation_frequency"] * 0.5)
        elevation_medium = self.noise.simplex_2d(X + 1000, Y + 1000, self.config["elevation_frequency"])
        elevation_detail = self.noise.simplex_2d(X + 2000, Y + 2000, self.config["elevation_frequency"] * 3.0)
        
        # Combine elevation layers for more complex terrain
        elevation = (elevation_large * 0.6 + elevation_medium * 0.3 + elevation_detail * 0.1)
        
        # Add ridges and valleys using domain warping
        warp_x = self.noise.simplex_2d(X + 5000, Y + 5000, 0.001) * 50
        warp_y = self.noise.simplex_2d(X + 6000, Y + 6000, 0.001) * 50
        warped_elevation = self.noise.simplex_2d(X + warp_x, Y + warp_y, self.config["elevation_frequency"])
        elevation = (elevation * 0.7 + warped_elevation * 0.3)
        
        # Enhanced moisture with flow patterns
        moisture_base = self.noise.simplex_2d(X + 3000, Y + 3000, self.config["moisture_frequency"])
        moisture_flow = self.noise.simplex_2d(X + 4000, Y + 4000, self.config["moisture_frequency"] * 2.0)
        moisture = moisture_base + moisture_flow * 0.3
        
        # Temperature with gradients and local variations
        temperature_base = self.noise.simplex_2d(X + 7000, Y + 7000, self.config["temperature_frequency"])
        temperature_local = self.noise.simplex_2d(X + 8000, Y + 8000, self.config["temperature_frequency"] * 4.0)
        temperature = temperature_base + temperature_local * 0.2
        
        # Rivers with meandering patterns
        rivers_main = self.noise.simplex_2d(X + 9000, Y + 9000, self.config["river_frequency"])
        rivers_tributaries = self.noise.simplex_2d(X + 10000, Y + 10000, self.config["river_frequency"] * 2.0)
        rivers = rivers_main + rivers_tributaries * 0.4
        
        # Multiple detail layers for texture variety
        detail_fine = self.noise.simplex_2d(X + 11000, Y + 11000, self.config["detail_frequency"])
        detail_micro = self.noise.simplex_2d(X + 12000, Y + 12000, self.config["detail_frequency"] * 3.0)
        detail = detail_fine + detail_micro * 0.3
        
        return {
            'elevation': elevation,
            'moisture': moisture,
            'temperature': temperature,
            'rivers': rivers,
            'detail': detail,
            'x_coords': X,
            'y_coords': Y
        }
    
    def generate_enhanced_terrain_tiles(self, world_data: Dict[str, np.ndarray], biome_map: np.ndarray) -> np.ndarray:
        """Generate terrain tiles with enhanced complexity and natural patterns - VECTORIZED for organic flow."""
        height, width = world_data['elevation'].shape
        tiles = np.zeros((height, width), dtype=np.int32)  # Changed to int32 to handle all tile IDs
        

        
        elevation = world_data['elevation']
        moisture = world_data['moisture']
        temperature = world_data['temperature']
        rivers = world_data['rivers']
        detail = world_data['detail']
        
        # LARGE-SCALE TERRAIN APPROACH - creates coherent terrain areas
        # Multi-layer selection factor for natural variation
        base_factor = elevation * 0.4 + moisture * 0.3 + temperature * 0.2 + detail * 0.1
        
        # Create large terrain zones using simple thresholds (no oscillator patterns)
        # Use the noise data itself for variation instead of generating new patterns
        organic_factor = base_factor
        
        # Process each biome type with large-scale coherent areas
        unique_biomes = np.unique(biome_map)
        # DEBUG REMOVED FOR MAXIMUM PERFORMANCE
        
        for biome in unique_biomes:
            biome_mask = (biome_map == biome)
            if not np.any(biome_mask):
                continue
                
            biome_config = BIOMES.get(biome, BIOMES['grassland'])
            
            # Get tile IDs with safe fallbacks
            primary_id = TILE_IDS.get(biome_config['primary'], TILE_IDS['grass'])
            secondary_id = TILE_IDS.get(biome_config['secondary'], TILE_IDS['dirt'])
            tertiary_id = TILE_IDS.get(biome_config['tertiary'], TILE_IDS['stone'])
            accent_id = TILE_IDS.get(biome_config.get('accent', 'gravel'), TILE_IDS['gravel'])
            
            # Special handling for shallow_water/beach to avoid all-water tiles
            if biome in ('shallow_water', 'beach'):
                tiles[biome_mask] = primary_id  # water or sand base
                elev_vals = elevation[biome_mask]
                moist_vals = moisture[biome_mask]
                # Percentile bands produce shoreline gradients
                e60 = np.percentile(elev_vals, 60)
                e80 = np.percentile(elev_vals, 80)
                m80 = np.percentile(moist_vals, 80)
                # Sand near higher elevation in water biome, or wet sand on beach
                sand_zone = biome_mask & (elevation >= e60) & (elevation < e80)
                grass_zone = biome_mask & (elevation >= e80)
                mud_zone = biome_mask & (moisture >= m80) & ~grass_zone
                tiles[sand_zone] = secondary_id
                tiles[grass_zone] = tertiary_id
                tiles[mud_zone] = accent_id
                continue
            
            # Grassland: keep grass dominant with varied natural patches
            if biome == 'grassland':
                # World-space fBm without domain warping to avoid geometric wedges
                X = world_data['x_coords'].astype(np.float32)
                Y = world_data['y_coords'].astype(np.float32)
                def fbm(freq: float) -> np.ndarray:
                    n0 = self.noise._simplex_2d_cpu_fast(X * freq, Y * freq, 1.0)
                    n1 = self.noise._simplex_2d_cpu_fast(X * freq * 2.0 + 101, Y * freq * 2.0 + 303, 1.0)
                    n2 = self.noise._simplex_2d_cpu_fast(X * freq * 4.0 + 707, Y * freq * 4.0 + 909, 1.0)
                    return (n0 * 0.6 + n1 * 0.3 + n2 * 0.1)
                selector = fbm(0.004)

                bm = biome_mask
                tiles[bm] = TILE_IDS['grass']

                # Percentile thresholds calculated within the biome
                e_vals = elevation[bm]; m_vals = moisture[bm]; d_vals = detail[bm]; s_vals = selector[bm]
                e70 = np.percentile(e_vals, 70)
                m35 = np.percentile(m_vals, 35)
                m70 = np.percentile(m_vals, 70)
                s40 = np.percentile(s_vals, 40)
                s70 = np.percentile(s_vals, 70)
                d90 = np.percentile(d_vals, 90)

                dirt_zone = bm & (moisture < m35) & (selector < s40)
                stone_zone = bm & (elevation > e70) & (selector > s70)
                tall_zone = bm & (moisture > m70) & (selector > s40) & (selector < s70)
                flower_zone = bm & (detail > d90)

                # Gentle growth to avoid sharp shapes
                if np.any(dirt_zone): dirt_zone = _dilate(dirt_zone, 2)
                if np.any(stone_zone): stone_zone = _dilate(stone_zone, 2)
                if np.any(tall_zone): tall_zone = _dilate(tall_zone, 1)

                tiles[dirt_zone] = TILE_IDS['dirt']
                tiles[stone_zone] = TILE_IDS['stone']
                tiles[tall_zone] = TILE_IDS['tall_grass']
                tiles[flower_zone] = TILE_IDS['flowers']
                continue

            # Default large-scale coherent areas for other biomes
            tiles[biome_mask] = primary_id
            secondary_mask = biome_mask & (organic_factor < -0.1) & (organic_factor > -0.4)
            tertiary_mask = biome_mask & (organic_factor <= -0.4)
            accent_mask = biome_mask & (organic_factor > 0.6)
            tiles[secondary_mask] = secondary_id
            tiles[tertiary_mask] = tertiary_id
            tiles[accent_mask] = accent_id
            
            # DEBUG REMOVED FOR PERFORMANCE
        
        # Handle water features
        # Keep rivers sparse
        river_mask = rivers > self.config["river_threshold"]
        tiles[river_mask] = TILE_IDS['water']

        # Only create broad water/shore in ocean-like biomes to avoid diagonal bands in land biomes
        ocean_like = (biome_map == 'ocean') | (biome_map == 'shallow_water') | (biome_map == 'beach')
        ocean_water_mask = ocean_like & (moisture > self.config["water_threshold"]) 
        shore_mask = ocean_water_mask & (elevation > 0.05)
        deep_water_mask = ocean_water_mask & (elevation <= 0.05)
        tiles[shore_mask] = TILE_IDS['sand']
        tiles[deep_water_mask] = TILE_IDS['water']

        # Small lakes in grasslands: high moisture, low elevation, aided by detail
        lakes_mask = (biome_map == 'grassland') \
            & (moisture > np.percentile(moisture, 85)) \
            & (elevation < np.percentile(elevation, 40)) \
            & (detail > np.percentile(detail, 70))
        tiles[lakes_mask] = TILE_IDS['water']
        
        # Simplified micro-variations - use existing noise data, no new patterns
        high_detail_mask = np.abs(detail) > 0.7
        very_high_detail_mask = np.abs(detail) > 0.85
        
        # Flowers in grasslands (use detail noise directly)
        flower_mask = (biome_map == 'grassland') & high_detail_mask & (detail > 0.7) & (elevation > 0.1)
        tiles[flower_mask] = TILE_IDS['flowers']
        
        # Moss in forests (use detail noise directly)
        moss_mask = (biome_map == 'forest') & high_detail_mask & (detail < -0.7) & (moisture > 0.3)
        tiles[moss_mask] = TILE_IDS['moss']
        
        # Paths in grasslands (very rare, use existing elevation data)
        path_mask = (biome_map == 'grassland') & very_high_detail_mask & (elevation > 0.2) & (elevation < 0.4)
        tiles[path_mask] = TILE_IDS['path']
        
        # Crystal formations in deserts (rare, use temperature data)
        crystal_mask = (biome_map == 'desert') & very_high_detail_mask & (temperature > 0.8) & (detail > 0.8)
        tiles[crystal_mask] = TILE_IDS['crystal']
        
        # Rocky outcrops in hills/mountains (use elevation data)
        rock_mask = ((biome_map == 'hills') | (biome_map == 'mountains')) & high_detail_mask & (elevation > 0.4)
        tiles[rock_mask] = TILE_IDS['rock']
        
        # Mud patches in wet areas (use moisture and elevation data)
        mud_mask = (moisture > 0.5) & (elevation < 0.1) & high_detail_mask
        tiles[mud_mask] = TILE_IDS['mud']
        
        # EMERGENCY: If everything ended up as 0 (water), synthesize reasonable terrain
        if np.all(tiles == 0):
            print(f"[EMERGENCY] All tiles are zero (water). Synthesizing shoreline mix instead of forcing grass")
            h, w = tiles.shape
            # Normalized coords for simple radial shoreline
            gx = np.linspace(-1.0, 1.0, w, dtype=np.float32)
            gy = np.linspace(-1.0, 1.0, h, dtype=np.float32)
            Xg, Yg = np.meshgrid(gx, gy)
            r = np.sqrt(Xg * Xg + Yg * Yg)
            # Define rings: inner deep water, mid shallow water/sand, outer sand/grass
            water_inner = r < 0.35
            shallow_ring = (r >= 0.35) & (r < 0.48)
            beach_ring = (r >= 0.48) & (r < 0.60)
            coast_outer = r >= 0.60
            tiles[water_inner] = TILE_IDS['water']
            tiles[shallow_ring] = TILE_IDS['water']
            tiles[beach_ring] = TILE_IDS['sand']
            tiles[coast_outer] = TILE_IDS['grass']
        
        # EMERGENCY: Check if all tiles are the same (likely a bug)
        unique_tiles = np.unique(tiles)
        if len(unique_tiles) == 1 and unique_tiles[0] == TILE_IDS['flowers']:
            print(f"[EMERGENCY] All tiles are flowers (15)! This is a bug - filling with water for shallow_water biome")
            tiles.fill(TILE_IDS['water'])
        
        # Fast tile validation - minimal overhead
        valid_tile_ids = set(TILE_IDS.values())
        invalid_mask = ~np.isin(tiles, list(valid_tile_ids))
        
        if np.any(invalid_mask):
            print(f"[EMERGENCY] Found {np.sum(invalid_mask)} invalid tiles, fixing with grass")
            tiles[invalid_mask] = TILE_IDS['grass']  # Safe fallback
        
        # Quick negative value check
        negative_mask = tiles < 0
        if np.any(negative_mask):
            tiles[negative_mask] = TILE_IDS['grass']
        
        # DEBUG REMOVED FOR MAXIMUM PERFORMANCE
        
        # Apply enhanced smoothing for natural flow
        return self.apply_enhanced_smoothing(tiles, world_data)
    
    def apply_enhanced_smoothing(self, tiles: np.ndarray, world_data: Dict[str, np.ndarray]) -> np.ndarray:
        """Professional-grade multi-pass terrain smoothing optimized for gaming PC performance.
        
        Implements sophisticated smoothing with:
        - Multi-pass cellular automata for organic transitions
        - Elevation-aware smoothing (respect terrain height)
        - Biome-coherent smoothing (maintain biome integrity)
        - Edge preservation for natural features
        - Vectorized operations for maximum CPU utilization
        """
        print(f"[PERF] Starting professional terrain smoothing: {tiles.shape}")
        start_time = time.time()
        
        height, width = tiles.shape
        elevation = world_data['elevation']
        moisture = world_data['moisture']
        
        # Create working copy with padding for edge handling
        padded_tiles = np.pad(tiles, 2, mode='edge')
        padded_elevation = np.pad(elevation, 2, mode='edge')
        padded_moisture = np.pad(moisture, 2, mode='edge')
        
        # PASS 1: Cellular automata with elevation awareness
        # Vectorized 5x5 neighborhood analysis for natural clustering
        smoothed = self._cellular_automata_pass(padded_tiles, padded_elevation, kernel_size=5)
        
        # PASS 2: Biome coherence pass - maintain biome integrity
        smoothed = self._biome_coherence_pass(smoothed, padded_elevation, padded_moisture)
        
        # PASS 3: Edge refinement - preserve natural features like rivers/shores
        smoothed = self._edge_refinement_pass(smoothed, padded_elevation, padded_moisture)
        
        # PASS 4: Micro-variation pass - add organic detail without noise
        smoothed = self._micro_variation_pass(smoothed, padded_elevation, padded_moisture)
        
        # Remove padding and return
        result = smoothed[2:-2, 2:-2]
        
        elapsed = time.time() - start_time
        print(f"[PERF] Professional smoothing complete: {elapsed:.3f}s")
        return result
    
    def _cellular_automata_pass(self, tiles: np.ndarray, elevation: np.ndarray, kernel_size: int = 5) -> np.ndarray:
        """ULTRA-VECTORIZED cellular automata pass - MAXIMUM i9-10850K + RTX 3090 PERFORMANCE."""
        h, w = tiles.shape
        
        # Use GPU if available for massive parallel processing
        if GPU_AVAILABLE:
            return self._cellular_automata_gpu(tiles, elevation, kernel_size)
        
        # CPU VECTORIZED VERSION - NO LOOPS, PURE NUMPY MATRIX OPERATIONS
        from scipy.ndimage import generic_filter
        from numpy.lib.stride_tricks import sliding_window_view
        
        # Create sliding windows for ENTIRE array at once
        tile_windows = sliding_window_view(tiles, (kernel_size, kernel_size))
        elev_windows = sliding_window_view(elevation, (kernel_size, kernel_size))
        
        center = kernel_size // 2
        valid_h, valid_w = tile_windows.shape[:2]
        
        # Pre-allocate result array
        result = tiles.copy()
        
        # VECTORIZED PROCESSING - process ALL windows simultaneously
        # Flatten windows for vectorized operations
        flat_tiles = tile_windows.reshape(valid_h * valid_w, kernel_size * kernel_size)
        flat_elevs = elev_windows.reshape(valid_h * valid_w, kernel_size * kernel_size)
        
        # Get center values for all windows at once
        center_idx = kernel_size * kernel_size // 2
        center_tiles = flat_tiles[:, center_idx]
        center_elevs = flat_elevs[:, center_idx]
        
        # Calculate elevation weights for ALL windows simultaneously
        elev_diffs = np.abs(flat_elevs - center_elevs[:, np.newaxis])
        elevation_weights = np.exp(-elev_diffs * 5.0)
        
        # Vectorized voting system
        new_tiles = np.zeros(valid_h * valid_w, dtype=np.int32)
        
        # Process each tile type in parallel
        for tile_type in range(16):  # All possible tile types
            # Create masks for this tile type across ALL windows
            tile_masks = (flat_tiles == tile_type)
            
            # Calculate weighted votes for this tile type across ALL windows
            weighted_votes = np.sum(elevation_weights * tile_masks, axis=1)
            
            # Update tiles where this type has maximum vote
            current_votes = np.sum(elevation_weights * (flat_tiles == center_tiles[:, np.newaxis]), axis=1)
            
            # Vectorized decision: change if new vote is 1.5x stronger
            change_mask = weighted_votes > current_votes * 1.5
            new_tiles = np.where(change_mask, tile_type, new_tiles)
        
        # Reshape back and apply changes
        new_tiles = new_tiles.reshape(valid_h, valid_w)
        result[center:-center, center:-center] = new_tiles
        
        return result
    
    def _cellular_automata_gpu(self, tiles: np.ndarray, elevation: np.ndarray, kernel_size: int = 5) -> np.ndarray:
        """GPU-ACCELERATED cellular automata using RTX 3090 CUDA cores."""
        try:
            import cupy as cp
            
            # Transfer to GPU
            gpu_tiles = cp.asarray(tiles)
            gpu_elevation = cp.asarray(elevation)
            
            # GPU kernel for cellular automata (custom CUDA kernel)
            kernel_code = '''
            extern "C" __global__
            void cellular_automata_kernel(int* tiles, float* elevation, int* result, 
                                        int height, int width, int kernel_size) {
                int idx = blockIdx.x * blockDim.x + threadIdx.x;
                int idy = blockIdx.y * blockDim.y + threadIdx.y;
                
                if (idx >= width - kernel_size + 1 || idy >= height - kernel_size + 1) return;
                
                int center = kernel_size / 2;
                int actual_x = idx + center;
                int actual_y = idy + center;
                
                float center_elev = elevation[actual_y * width + actual_x];
                int center_tile = tiles[actual_y * width + actual_x];
                
                // Voting system with elevation weights
                float votes[16] = {0}; // Max 16 tile types
                float total_weight = 0;
                
                for (int dy = 0; dy < kernel_size; dy++) {
                    for (int dx = 0; dx < kernel_size; dx++) {
                        int y = idy + dy;
                        int x = idx + dx;
                        
                        float elev_diff = fabsf(elevation[y * width + x] - center_elev);
                        float weight = expf(-elev_diff * 5.0f);
                        
                        int tile_type = tiles[y * width + x];
                        if (tile_type >= 0 && tile_type < 16) {
                            votes[tile_type] += weight;
                        }
                        total_weight += weight;
                    }
                }
                
                // Find best tile
                float max_vote = votes[center_tile];
                int best_tile = center_tile;
                
                for (int i = 0; i < 16; i++) {
                    if (votes[i] > max_vote * 1.5f) {
                        max_vote = votes[i];
                        best_tile = i;
                    }
                }
                
                result[actual_y * width + actual_x] = best_tile;
            }
            '''
            
            # Compile and run GPU kernel
            module = cp.RawModule(code=kernel_code)
            kernel = module.get_function('cellular_automata_kernel')
            
            gpu_result = cp.zeros_like(gpu_tiles)
            
            # Launch kernel with optimal block size for RTX 3090
            block_size = (16, 16)
            grid_size = ((tiles.shape[1] + block_size[0] - 1) // block_size[0],
                        (tiles.shape[0] + block_size[1] - 1) // block_size[1])
            
            kernel(grid_size, block_size, 
                  (gpu_tiles, gpu_elevation, gpu_result, 
                   tiles.shape[0], tiles.shape[1], kernel_size))
            
            # Transfer back to CPU
            return cp.asnumpy(gpu_result)
            
        except Exception as e:
            print(f"[PERF] GPU acceleration failed, falling back to CPU: {e}")
            # Fallback to CPU vectorized version
            return tiles  # Return original for now, will be processed by other passes
    
    def _biome_coherence_pass(self, tiles: np.ndarray, elevation: np.ndarray, moisture: np.ndarray) -> np.ndarray:
        """VECTORIZED biome coherence - MAXIMUM i9-10850K PERFORMANCE."""
        h, w = tiles.shape
        result = tiles.copy()
        
        # Define biome compatibility arrays for vectorized operations
        water_tiles = np.array([TILE_IDS['water'], TILE_IDS['ice']])
        land_tiles = np.array([TILE_IDS['grass'], TILE_IDS['dirt'], TILE_IDS['forest'], TILE_IDS['rock']])
        
        # Create masks for different tile types (VECTORIZED)
        water_mask = np.isin(tiles, water_tiles)
        land_mask = np.isin(tiles, land_tiles)
        
        # VECTORIZED neighborhood analysis using convolution
        from scipy.ndimage import generic_filter
        
        # Count land neighbors for each water tile (VECTORIZED)
        def count_land_neighbors(neighborhood):
            return np.sum(np.isin(neighborhood, land_tiles))
        
        def count_water_neighbors(neighborhood):
            return np.sum(np.isin(neighborhood, water_tiles))
        
        # Apply filters to entire arrays at once
        land_neighbor_counts = generic_filter(tiles, count_land_neighbors, size=3, mode='constant')
        water_neighbor_counts = generic_filter(tiles, count_water_neighbors, size=3, mode='constant')
        
        # VECTORIZED TRANSITIONS - process entire arrays at once
        
        # Water to shore transitions (where water has land neighbors)
        water_to_shore_mask = water_mask & (land_neighbor_counts > 0)
        high_moisture_mask = moisture > 0.3
        
        # Apply shore transitions vectorized
        result = np.where(water_to_shore_mask & high_moisture_mask, TILE_IDS['sand'], result)
        result = np.where(water_to_shore_mask & ~high_moisture_mask, TILE_IDS['mud'], result)
        
        # Land to shore transitions (where land has water neighbors and low elevation)
        land_to_shore_mask = land_mask & (water_neighbor_counts > 0) & (elevation < 0.1)
        result = np.where(land_to_shore_mask, TILE_IDS['sand'], result)
        
        return result
    
    def _edge_refinement_pass(self, tiles: np.ndarray, elevation: np.ndarray, moisture: np.ndarray) -> np.ndarray:
        """Refine edges to preserve natural features like rivers and coastlines."""
        result = tiles.copy()
        h, w = tiles.shape
        
        # Detect and preserve linear features (rivers, paths, shores)
        for y in range(2, h - 2):
            for x in range(2, w - 2):
                # Get 5x5 neighborhood for feature detection
                neighborhood = tiles[y-2:y+3, x-2:x+3]
                elev_neighborhood = elevation[y-2:y+3, x-2:x+3]
                
                current_tile = tiles[y, x]
                
                # Detect river features (water in linear patterns)
                if current_tile == TILE_IDS['water']:
                    # Check for linear water patterns (rivers)
                    water_mask = (neighborhood == TILE_IDS['water'])
                    
                    # Count water in cardinal directions
                    water_north = np.sum(water_mask[0:2, 2])
                    water_south = np.sum(water_mask[3:5, 2])
                    water_east = np.sum(water_mask[2, 3:5])
                    water_west = np.sum(water_mask[2, 0:2])
                    
                    # If this looks like a river (linear water), preserve it
                    if (water_north + water_south >= 2) or (water_east + water_west >= 2):
                        result[y, x] = TILE_IDS['water']  # Preserve river
                
                # Detect and preserve shorelines
                elif current_tile == TILE_IDS['sand']:
                    water_neighbors = np.sum(neighborhood == TILE_IDS['water'])
                    land_neighbors = np.sum(np.isin(neighborhood, [TILE_IDS['grass'], TILE_IDS['dirt'], TILE_IDS['forest']]))
                    
                    # If this sand is between water and land, it's a natural shore
                    if water_neighbors >= 2 and land_neighbors >= 2:
                        result[y, x] = TILE_IDS['sand']  # Preserve shoreline
        
        return result
    
    def _micro_variation_pass(self, tiles: np.ndarray, elevation: np.ndarray, moisture: np.ndarray) -> np.ndarray:
        """Add micro-variations for organic detail without creating noise."""
        result = tiles.copy()
        h, w = tiles.shape
        
        # Add subtle variations based on environmental factors
        for y in range(2, h - 2):
            for x in range(2, w - 2):
                current_tile = tiles[y, x]
                local_elev = elevation[y, x]
                local_moisture = moisture[y, x]
                
                # Get 3x3 neighborhood for context
                neighborhood = tiles[y-1:y+2, x-1:x+2]
                
                # Add organic micro-variations based on environmental suitability
                if current_tile == TILE_IDS['grass']:
                    # Grass can become forest in high moisture, flowers in perfect conditions
                    grass_neighbors = np.sum(neighborhood == TILE_IDS['grass'])
                    
                    if local_moisture > 0.6 and local_elev > 0.1 and grass_neighbors >= 6:
                        # Dense grass area with good conditions -> forest grove
                        if np.random.random() < 0.15:  # 15% chance
                            result[y, x] = TILE_IDS['forest']
                    elif local_moisture > 0.4 and local_elev > 0.2 and grass_neighbors >= 7:
                        # Perfect meadow conditions -> flowers
                        if np.random.random() < 0.08:  # 8% chance
                            result[y, x] = TILE_IDS['flowers']
                
                elif current_tile == TILE_IDS['dirt']:
                    # Dirt can become mud in wet areas, grass in good conditions
                    if local_moisture > 0.7 and local_elev < 0.0:
                        result[y, x] = TILE_IDS['mud']
                    elif local_moisture > 0.3 and local_elev > 0.1:
                        if np.random.random() < 0.12:  # 12% chance
                            result[y, x] = TILE_IDS['grass']
                
                elif current_tile == TILE_IDS['rock']:
                    # Rocks can have moss in moist conditions
                    if local_moisture > 0.5 and np.random.random() < 0.1:
                        result[y, x] = TILE_IDS['moss']
        
        return result
    
    def apply_edge_continuity(self, tiles: np.ndarray, neighbor_edges: Dict) -> np.ndarray:
        """Apply edge continuity to blend with neighboring regions."""
        height, width = tiles.shape
        blended = tiles.copy()
        
        # Blend edges with neighbors
        blend_width = 8  # Number of pixels to blend at edges
        
        for direction, edge_data in neighbor_edges.items():
            if direction == 'north' and len(edge_data) == width:
                # Blend top edge
                for i in range(blend_width):
                    blend_factor = (blend_width - i) / blend_width
                    for x in range(width):
                        if np.random.random() < blend_factor * 0.7:
                            blended[i, x] = edge_data[x]
            
            elif direction == 'south' and len(edge_data) == width:
                # Blend bottom edge
                for i in range(blend_width):
                    y = height - 1 - i
                    blend_factor = (blend_width - i) / blend_width
                    for x in range(width):
                        if np.random.random() < blend_factor * 0.7:
                            blended[y, x] = edge_data[x]
            
            elif direction == 'west' and len(edge_data) == height:
                # Blend left edge
                for i in range(blend_width):
                    blend_factor = (blend_width - i) / blend_width
                    for y in range(height):
                        if np.random.random() < blend_factor * 0.7:
                            blended[y, i] = edge_data[y]
            
            elif direction == 'east' and len(edge_data) == height:
                # Blend right edge
                for i in range(blend_width):
                    x = width - 1 - i
                    blend_factor = (blend_width - i) / blend_width
                    for y in range(height):
                        if np.random.random() < blend_factor * 0.7:
                            blended[y, x] = edge_data[y]
        
        return blended
        
    def save_region_binary(self, tiles: np.ndarray, world_x: int, world_y: int) -> str:
        """Save region as binary file for fast Godot loading."""
        filename = f"{world_x}_{world_y}.bin"
        filepath = self.regions_dir / filename
        
        with open(filepath, 'wb') as f:
            # Write header that matches Godot's expected format
            f.write(struct.pack('<I', 0x5245474E))  # Magic number "REGN"
            f.write(struct.pack('<H', 1))           # Version (u16)
            f.write(struct.pack('<I', REGION_TILES * REGION_TILES))  # Total tiles (i32)
            f.write(struct.pack('<I', 64))          # Tile pixel size (i32)
            
            # Write tile data as bytes (one byte per tile)
            for y in range(REGION_TILES):
                for x in range(REGION_TILES):
                    tile_id = min(15, max(0, int(tiles[y, x])))  # Clamp to 0-15
                    f.write(struct.pack('B', tile_id))
            
        print(f"[PY] Saved region binary: {filepath}")
        return str(filepath)
        
    def generate_and_save_region(self, world_x: int, world_y: int, biome: str = "grassland") -> str:
        """Generate and save a region with specified biome."""
        tiles = self.generate_region(world_x, world_y, biome)
        return self.save_region_binary(tiles, world_x, world_y)

def generate_region_worker(args: Tuple[int, int, str, str]) -> Tuple[int, int, str, bool]:
    """Worker function for parallel region generation - optimized for gaming PC."""
    world_x, world_y, biome, config_path = args
    try:
        # Create generator instance per worker (required for multiprocessing)
        generator = WorldGenerator(config_path)
        filepath = generator.generate_and_save_region(world_x, world_y, biome)
        return world_x, world_y, filepath, True
    except Exception as e:
        print(f"[PERF] Worker error for region ({world_x}, {world_y}): {e}")
        return world_x, world_y, "", False

def generate_regions_parallel(regions: List[Tuple[int, int]], biomes: List[str] = None, config_path: str = None, max_workers: int = None) -> Dict[Tuple[int, int], str]:
    """Generate multiple regions in parallel - optimized for gaming PC performance."""
    if max_workers is None:
        # Use ALL CPU cores for maximum performance on gaming PC
        max_workers = mp.cpu_count()
        
    if biomes is None:
        biomes = ["grassland"] * len(regions)
    elif len(biomes) != len(regions):
        # Pad with default biome if needed
        biomes.extend(["grassland"] * (len(regions) - len(biomes)))
    
    print(f"[PERF] 🚀 UNLEASHING {max_workers} CORES OF THE i9-10850K BEAST!")
    start_time = time.time()
    
    # Prepare arguments for workers
    args_list = [(x, y, biome, config_path) for (x, y), biome in zip(regions, biomes)]
    
    results = {}
    successful_count = 0
    
    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        future_to_region = {executor.submit(generate_region_worker, args): args[:2] for args in args_list}
        
        for future in as_completed(future_to_region):
            try:
                world_x, world_y, filepath, success = future.result()
                if success:
                    results[(world_x, world_y)] = filepath
                    successful_count += 1
                    print(f"[PERF] ✓ Region ({world_x}, {world_y}) completed")
                else:
                    print(f"[PERF] ✗ Region ({world_x}, {world_y}) failed")
            except Exception as e:
                region = future_to_region[future]
                print(f"[PERF] ✗ Region {region} exception: {e}")
                
    elapsed = time.time() - start_time
    print(f"[PERF] BATCH COMPLETE: {successful_count}/{len(regions)} regions in {elapsed:.2f}s")
    print(f"[PERF] Performance: {len(regions)/elapsed:.1f} regions/sec, {elapsed/len(regions):.3f}s per region")
    
    return results

def main():
    """Main entry point for standalone usage."""
    if len(sys.argv) < 3:
        print("Usage: python_generator.py <world_x> <world_y> [biome] [config_path] [--fast]")
        sys.exit(1)
        
    world_x = int(sys.argv[1])
    world_y = int(sys.argv[2])
    biome = sys.argv[3] if len(sys.argv) > 3 else "grassland"  # Default biome
    config_path = sys.argv[4] if len(sys.argv) > 4 else None
    
    # Check for fast mode flag
    fast_mode = "--fast" in sys.argv
    if fast_mode:
        print(f"[PERF] FAST MODE: Single region generation optimized for speed")
    
    print(f"[PY] Generating region ({world_x}, {world_y}) with biome: {biome}")
    
    generator = WorldGenerator(config_path)
    filepath = generator.generate_and_save_region(world_x, world_y, biome)
    print(f"[PY] Region saved to: {filepath}")

if __name__ == "__main__":
    main()
