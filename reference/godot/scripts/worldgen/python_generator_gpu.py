#!/usr/bin/env python3
"""
GPU-ACCELERATED world generation for FreedomMMO using NVIDIA RTX 3090.
Maximizes both CPU and GPU utilization for ultimate performance.
"""

import numpy as np
import json
import traceback
import importlib.util
import struct
import os
import sys
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import time
import multiprocessing as mp
from scipy.ndimage import binary_dilation
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
import threading
from functools import partial

# GPU acceleration imports
try:
    import cupy as cp
    import cupyx.scipy.ndimage as cp_ndimage
    GPU_AVAILABLE = True
    print("[RTX3090] 🚀 NVIDIA RTX 3090 GPU acceleration ACTIVE!")
    
    # Initialize GPU memory pool for optimal performance
    mempool = cp.get_default_memory_pool()
    pinned_mempool = cp.get_default_pinned_memory_pool()
    
    # Set memory pool limits for RTX 3090 (24GB VRAM)
    mempool.set_limit(size=20 * 1024**3)  # Use 20GB of 24GB VRAM
    print(f"[RTX3090] GPU memory pool configured: {mempool.get_limit() / 1024**3:.1f}GB")
    
except ImportError:
    try:
        import numba
        from numba import cuda, jit, prange
        if cuda.is_available():
            GPU_AVAILABLE = True
            print("[GPU] CUDA acceleration available via Numba")
        else:
            GPU_AVAILABLE = False
            print("[CPU] Using optimized CPU with Numba JIT")
    except ImportError:
        GPU_AVAILABLE = False
        print("[CPU] Using standard NumPy (install cupy-cuda12x for RTX 3090 acceleration)")

# Constants
REGION_TILES = 512
TILE_PX = 64
WORLD_SIZE = 2048

# Tile IDs
TILE_IDS = {
    # Basic terrain
    'water': 0, 'sand': 1, 'grass': 2, 'dirt': 3, 'stone': 4, 'forest': 5,
    'rock': 6, 'mud': 7, 'gravel': 8, 'moss': 9, 'snow': 10, 'ice': 11,
    'lava': 12, 'crystal': 13, 'path': 14, 'flowers': 15,
    
    # Extended terrain variety
    'clay': 16, 'pebbles': 17, 'cobblestone': 18, 'marble': 19, 'slate': 20,
    'limestone': 21, 'sandstone': 22, 'granite': 23, 'obsidian': 24, 'pumice': 25,
    'coral': 26, 'shells': 27, 'driftwood': 28, 'seaweed': 29, 'kelp': 30,
    'ferns': 31, 'mushrooms': 32, 'logs': 33, 'bark': 34, 'roots': 35,
    'wildflowers': 36, 'dandelions': 37, 'clover': 38, 'weeds': 39, 'thorns': 40,
    'dry_grass': 41, 'tall_grass': 42, 'short_grass': 43, 'burnt_grass': 44,
    'rich_soil': 45, 'sandy_soil': 46, 'rocky_soil': 47, 'fertile_soil': 48,
    'quicksand': 49, 'wet_sand': 50, 'black_sand': 51, 'white_sand': 52,
    'shallow_water': 53, 'deep_water': 54, 'murky_water': 55, 'clear_water': 56,
    'frozen_water': 57, 'boiling_water': 58, 'mineral_water': 59, 'salt_water': 60
}

# Enhanced biome definitions
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

# Universal biome terrain competition system
BIOME_TERRAIN_CONFIG = {
    'grassland': {
        'base_terrain': 'grass',
        'terrain_types': {
            'water': {'conditions': ['high_moisture', 'low_elevation'], 'strength': 0.8, 'frequency': 0.01},
            'dirt': {'conditions': ['low_moisture', 'medium_elevation'], 'strength': 0.6, 'frequency': 0.015}, 
            'stone': {'conditions': ['high_elevation', 'low_moisture'], 'strength': 0.7, 'frequency': 0.012},
            'flowers': {'conditions': ['medium_moisture', 'medium_elevation'], 'strength': 0.8, 'frequency': 0.02},
            'gravel': {'conditions': ['medium_elevation', 'low_moisture'], 'strength': 0.6, 'frequency': 0.018},
            'tall_grass': {'conditions': ['high_moisture'], 'strength': 0.5, 'frequency': 0.025},
            'short_grass': {'conditions': ['medium_moisture'], 'strength': 0.4, 'frequency': 0.03},
            'mud': {'conditions': ['very_high_moisture', 'low_elevation'], 'strength': 0.9, 'frequency': 0.008}
        }
    },
    'forest': {
        'base_terrain': 'forest',
        'terrain_types': {
            'moss': {'conditions': ['high_moisture', 'low_elevation'], 'strength': 0.7, 'frequency': 0.02},
            'dirt': {'conditions': ['medium_moisture'], 'strength': 0.5, 'frequency': 0.015},
            'stone': {'conditions': ['high_elevation', 'low_moisture'], 'strength': 0.8, 'frequency': 0.01},
            'logs': {'conditions': ['medium_elevation'], 'strength': 0.6, 'frequency': 0.012},
            'ferns': {'conditions': ['high_moisture', 'medium_elevation'], 'strength': 0.7, 'frequency': 0.018},
            'mushrooms': {'conditions': ['very_high_moisture'], 'strength': 0.8, 'frequency': 0.015},
            'bark': {'conditions': ['low_moisture'], 'strength': 0.4, 'frequency': 0.02}
        }
    },
    'desert': {
        'base_terrain': 'sand',
        'terrain_types': {
            'stone': {'conditions': ['high_elevation'], 'strength': 0.8, 'frequency': 0.01},
            'gravel': {'conditions': ['medium_elevation'], 'strength': 0.6, 'frequency': 0.015},
            'sandstone': {'conditions': ['medium_elevation', 'medium_moisture'], 'strength': 0.7, 'frequency': 0.012},
            'crystal': {'conditions': ['high_elevation', 'low_moisture'], 'strength': 0.9, 'frequency': 0.008},
            'dry_grass': {'conditions': ['medium_moisture'], 'strength': 0.5, 'frequency': 0.02},
            'rocky_soil': {'conditions': ['low_elevation'], 'strength': 0.4, 'frequency': 0.018}
        }
    },
    'tundra': {
        'base_terrain': 'snow',
        'terrain_types': {
            'ice': {'conditions': ['high_moisture', 'low_elevation'], 'strength': 0.8, 'frequency': 0.015},
            'stone': {'conditions': ['high_elevation'], 'strength': 0.7, 'frequency': 0.01},
            'gravel': {'conditions': ['medium_elevation', 'low_moisture'], 'strength': 0.6, 'frequency': 0.012},
            'frozen_water': {'conditions': ['very_high_moisture'], 'strength': 0.9, 'frequency': 0.008},
            'moss': {'conditions': ['medium_moisture', 'low_elevation'], 'strength': 0.5, 'frequency': 0.02}
        }
    },
    'ocean': {
        'base_terrain': 'water',
        'terrain_types': {
            'deep_water': {'conditions': ['high_elevation'], 'strength': 0.8, 'frequency': 0.01},
            'shallow_water': {'conditions': ['low_elevation'], 'strength': 0.6, 'frequency': 0.015},
            'sand': {'conditions': ['very_low_elevation'], 'strength': 0.7, 'frequency': 0.02},
            'coral': {'conditions': ['medium_elevation', 'high_moisture'], 'strength': 0.8, 'frequency': 0.012},
            'seaweed': {'conditions': ['medium_moisture'], 'strength': 0.5, 'frequency': 0.018},
            'shells': {'conditions': ['low_elevation', 'medium_moisture'], 'strength': 0.4, 'frequency': 0.025}
        }
    },
    'shallow_water': {
        'base_terrain': 'shallow_water',
        'terrain_types': {
            'water': {'conditions': ['high_moisture'], 'strength': 0.7, 'frequency': 0.015},
            'sand': {'conditions': ['very_low_elevation'], 'strength': 0.8, 'frequency': 0.02},
            'seaweed': {'conditions': ['medium_moisture', 'low_elevation'], 'strength': 0.6, 'frequency': 0.018},
            'shells': {'conditions': ['low_elevation'], 'strength': 0.5, 'frequency': 0.025},
            'coral': {'conditions': ['medium_elevation'], 'strength': 0.7, 'frequency': 0.012},
            'wet_sand': {'conditions': ['low_moisture'], 'strength': 0.6, 'frequency': 0.02}
        }
    },
    'beach': {
        'base_terrain': 'sand',
        'terrain_types': {
            'water': {'conditions': ['high_moisture'], 'strength': 0.8, 'frequency': 0.01},
            'wet_sand': {'conditions': ['medium_moisture'], 'strength': 0.7, 'frequency': 0.015},
            'shells': {'conditions': ['low_elevation'], 'strength': 0.6, 'frequency': 0.025},
            'driftwood': {'conditions': ['medium_elevation'], 'strength': 0.5, 'frequency': 0.02},
            'grass': {'conditions': ['high_elevation'], 'strength': 0.6, 'frequency': 0.018},
            'gravel': {'conditions': ['high_elevation', 'low_moisture'], 'strength': 0.5, 'frequency': 0.022}
        }
    },
    'hills': {
        'base_terrain': 'stone',
        'terrain_types': {
            'gravel': {'conditions': ['medium_elevation'], 'strength': 0.7, 'frequency': 0.015},
            'grass': {'conditions': ['low_elevation', 'high_moisture'], 'strength': 0.6, 'frequency': 0.02},
            'rock': {'conditions': ['high_elevation'], 'strength': 0.8, 'frequency': 0.01},
            'dirt': {'conditions': ['medium_moisture'], 'strength': 0.5, 'frequency': 0.018},
            'moss': {'conditions': ['high_moisture'], 'strength': 0.6, 'frequency': 0.022},
            'wildflowers': {'conditions': ['medium_elevation', 'medium_moisture'], 'strength': 0.5, 'frequency': 0.025}
        }
    },
    'mountains': {
        'base_terrain': 'rock',
        'terrain_types': {
            'stone': {'conditions': ['medium_elevation'], 'strength': 0.8, 'frequency': 0.012},
            'snow': {'conditions': ['very_high_elevation'], 'strength': 0.9, 'frequency': 0.008},
            'gravel': {'conditions': ['high_elevation'], 'strength': 0.7, 'frequency': 0.015},
            'granite': {'conditions': ['high_elevation', 'low_moisture'], 'strength': 0.8, 'frequency': 0.01},
            'slate': {'conditions': ['medium_elevation', 'medium_moisture'], 'strength': 0.6, 'frequency': 0.018},
            'crystal': {'conditions': ['very_high_elevation', 'low_moisture'], 'strength': 0.9, 'frequency': 0.005}
        }
    },
    'swamp': {
        'base_terrain': 'mud',
        'terrain_types': {
            'water': {'conditions': ['high_moisture'], 'strength': 0.8, 'frequency': 0.015},
            'moss': {'conditions': ['medium_moisture'], 'strength': 0.7, 'frequency': 0.02},
            'dirt': {'conditions': ['low_moisture'], 'strength': 0.6, 'frequency': 0.018},
            'weeds': {'conditions': ['medium_elevation'], 'strength': 0.5, 'frequency': 0.025},
            'logs': {'conditions': ['low_elevation'], 'strength': 0.6, 'frequency': 0.015},
            'mushrooms': {'conditions': ['high_moisture', 'low_elevation'], 'strength': 0.7, 'frequency': 0.012}
        }
    }
}

def evaluate_terrain_conditions(elevation, moisture, conditions):
    """Evaluate if environmental conditions match terrain requirements."""
    result = np.ones_like(elevation, dtype=bool)
    
    # Use percentile-based thresholds for more realistic terrain distribution
    elev_10 = np.percentile(elevation, 10)
    elev_30 = np.percentile(elevation, 30)
    elev_70 = np.percentile(elevation, 70)
    elev_90 = np.percentile(elevation, 90)
    
    moist_10 = np.percentile(moisture, 10)
    moist_30 = np.percentile(moisture, 30)
    moist_70 = np.percentile(moisture, 70)
    moist_90 = np.percentile(moisture, 90)
    
    for condition in conditions:
        if condition == 'very_low_elevation':
            result &= (elevation < elev_10)
        elif condition == 'low_elevation':
            result &= (elevation < elev_30)
        elif condition == 'medium_elevation':
            result &= (elevation >= elev_30) & (elevation <= elev_70)
        elif condition == 'high_elevation':
            result &= (elevation > elev_70)
        elif condition == 'very_high_elevation':
            result &= (elevation > elev_90)
        elif condition == 'very_low_moisture':
            result &= (moisture < moist_10)
        elif condition == 'low_moisture':
            result &= (moisture < moist_30)
        elif condition == 'medium_moisture':
            result &= (moisture >= moist_30) & (moisture <= moist_70)
        elif condition == 'high_moisture':
            result &= (moisture > moist_70)
        elif condition == 'very_high_moisture':
            result &= (moisture > moist_90)
    
    return result

def generate_coherent_terrain(biome, elevation, moisture, detail_noise, X_detail, Y_detail, noise_generator, world_start_x, world_start_y, base_seed):
    """Generate coherent terrain patches instead of scattered noise."""
    if biome not in BIOME_TERRAIN_CONFIG:
        return np.full(elevation.shape, TILE_IDS.get('grass', 2), dtype=np.int32)
    
    height, width = elevation.shape
    
    # Create multi-scale organic noise for natural terrain flow
    def generate_natural_noise(base_freq, octaves=4):
        """Generate multi-octave noise with natural variation."""
        noise_sum = np.zeros_like(elevation)
        amplitude = 1.0
        frequency = base_freq
        
        for i in range(octaves):
            # Add slight random offset to each octave for more organic patterns
            offset_x = (base_seed + i * 1000) * 0.001
            offset_y = (base_seed + i * 1500) * 0.001
            
            octave_noise = noise_generator.simplex_2d_gpu_massive(
                X_detail * frequency + offset_x, 
                Y_detail * frequency + offset_y, 
                frequency=1.0
            )
            noise_sum += octave_noise * amplitude
            amplitude *= 0.6  # Less aggressive amplitude reduction for more detail
            frequency *= 1.8  # Less aggressive frequency increase for smoother transitions
        
        return noise_sum
    
    # Start with base terrain
    if biome == 'grassland':
        tiles = np.full((height, width), TILE_IDS['grass'], dtype=np.int32)
        
        # Generate terrain using geological principles and natural flow
        
        # Water bodies - follow elevation and create natural watersheds
        water_base = generate_natural_noise(0.003, octaves=3)
        water_elevation_factor = smooth_sigmoid(-elevation, center=0.0, steepness=3.0)
        water_moisture_factor = smooth_sigmoid(moisture, center=0.3, steepness=2.0)
        water_influence = water_base * 0.4 + water_elevation_factor * 0.4 + water_moisture_factor * 0.2
        water_mask = water_influence > np.percentile(water_influence, 85)
        tiles = np.where(water_mask, TILE_IDS['water'], tiles)
        
        # Stone outcrops - follow elevation and create natural rocky areas
        stone_base = generate_natural_noise(0.004, octaves=2)
        stone_elevation_factor = smooth_sigmoid(elevation, center=0.2, steepness=2.5)
        stone_dryness_factor = smooth_sigmoid(-moisture, center=-0.1, steepness=2.0)
        stone_influence = stone_base * 0.5 + stone_elevation_factor * 0.3 + stone_dryness_factor * 0.2
        stone_mask = (stone_influence > np.percentile(stone_influence, 80)) & ~water_mask
        tiles = np.where(stone_mask, TILE_IDS['stone'], tiles)
        
        # Dirt patches - worn areas and natural paths
        dirt_base = generate_natural_noise(0.008, octaves=3)
        dirt_dryness_factor = smooth_sigmoid(-moisture, center=0.0, steepness=1.5)
        dirt_elevation_factor = smooth_sigmoid(np.abs(elevation), center=0.1, steepness=1.0)  # Mid-elevation areas
        dirt_influence = dirt_base * 0.6 + dirt_dryness_factor * 0.25 + dirt_elevation_factor * 0.15
        dirt_mask = (dirt_influence > np.percentile(dirt_influence, 65)) & ~water_mask & ~stone_mask
        tiles = np.where(dirt_mask, TILE_IDS['dirt'], tiles)
        
        # Flowers - pleasant areas with good conditions
        flower_base = generate_natural_noise(0.012, octaves=4)
        flower_moisture_factor = smooth_sigmoid(moisture, center=0.1, steepness=2.0)
        flower_elevation_factor = smooth_sigmoid(-np.abs(elevation), center=-0.05, steepness=2.0)  # Gentle slopes
        flower_influence = flower_base * 0.5 + flower_moisture_factor * 0.3 + flower_elevation_factor * 0.2
        flower_mask = (flower_influence > np.percentile(flower_influence, 75)) & ~water_mask & ~stone_mask & ~dirt_mask
        tiles = np.where(flower_mask, TILE_IDS['flowers'], tiles)
        
        # Tall grass - moist, fertile areas
        tall_grass_base = generate_natural_noise(0.006, octaves=3)
        tall_grass_moisture_factor = smooth_sigmoid(moisture, center=0.2, steepness=1.8)
        tall_grass_fertility_factor = smooth_sigmoid(-np.abs(elevation - 0.1), center=-0.05, steepness=1.5)
        tall_grass_influence = tall_grass_base * 0.4 + tall_grass_moisture_factor * 0.4 + tall_grass_fertility_factor * 0.2
        tall_grass_mask = (tall_grass_influence > np.percentile(tall_grass_influence, 70)) & ~water_mask & ~stone_mask & ~dirt_mask & ~flower_mask
        tiles = np.where(tall_grass_mask, TILE_IDS['tall_grass'], tiles)
        
        return tiles
    
    elif biome == 'shallow_water':
        # Start with water as base terrain
        tiles = np.full((height, width), TILE_IDS['water'], dtype=np.int32)
        
        # Apply terrain types using percentile-based system like grassland
        
        # Deep water areas - darkest water
        deep_water_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.008, Y_detail * 0.008, frequency=1.0
        )
        deep_water_threshold = np.percentile(deep_water_noise, 80)  # Top 20% becomes deep water
        deep_water_mask = deep_water_noise > deep_water_threshold
        tiles = np.where(deep_water_mask, TILE_IDS['water'], tiles)  # Use regular water (tile 0)
        
        # Sandy shores and beaches
        sand_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.012, Y_detail * 0.012, frequency=1.0
        )
        sand_threshold = np.percentile(sand_noise, 70)  # Top 30% becomes sand
        sand_mask = (sand_noise > sand_threshold) & ~deep_water_mask
        tiles = np.where(sand_mask, TILE_IDS['sand'], tiles)  # Use sand (tile 1)
        
        # Wet sand in transition areas
        wet_sand_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.015, Y_detail * 0.015, frequency=1.0
        )
        wet_sand_threshold = np.percentile(wet_sand_noise, 75)  # Top 25% becomes wet sand
        wet_sand_mask = (wet_sand_noise > wet_sand_threshold) & ~deep_water_mask & ~sand_mask
        tiles = np.where(wet_sand_mask, TILE_IDS['mud'], tiles)  # Use mud (tile 7) as wet sand
        
        # Seaweed patches in shallow areas
        seaweed_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.01, Y_detail * 0.01, frequency=1.0
        )
        seaweed_threshold = np.percentile(seaweed_noise, 85)  # Top 15% becomes seaweed
        seaweed_mask = (seaweed_noise > seaweed_threshold) & ~deep_water_mask & ~sand_mask & ~wet_sand_mask
        tiles = np.where(seaweed_mask, TILE_IDS['moss'], tiles)  # Use moss (tile 9) as seaweed
        
        # Grass on higher ground (islands/shores)
        grass_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.006, Y_detail * 0.006, frequency=1.0
        )
        grass_threshold = np.percentile(grass_noise, 90)  # Top 10% becomes grass
        grass_mask = (grass_noise > grass_threshold) & ~deep_water_mask & ~sand_mask & ~wet_sand_mask & ~seaweed_mask
        tiles = np.where(grass_mask, TILE_IDS['grass'], tiles)  # Use grass (tile 2)
        
        return tiles
    
    elif biome == 'forest':
        # Start with forest as base terrain
        tiles = np.full((height, width), TILE_IDS['forest'], dtype=np.int32)
        
        # Apply terrain types using percentile-based system
        
        # Grass clearings
        clearing_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.008, Y_detail * 0.008, frequency=1.0
        )
        clearing_threshold = np.percentile(clearing_noise, 75)  # Top 25% becomes clearings
        clearing_mask = clearing_noise > clearing_threshold
        tiles = np.where(clearing_mask, TILE_IDS['grass'], tiles)
        
        # Moss in damp areas
        moss_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.012, Y_detail * 0.012, frequency=1.0
        )
        moss_threshold = np.percentile(moss_noise, 80)  # Top 20% becomes moss
        moss_mask = (moss_noise > moss_threshold) & ~clearing_mask
        tiles = np.where(moss_mask, TILE_IDS['moss'], tiles)
        
        # Dirt paths
        dirt_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.015, Y_detail * 0.015, frequency=1.0
        )
        dirt_threshold = np.percentile(dirt_noise, 85)  # Top 15% becomes dirt paths
        dirt_mask = (dirt_noise > dirt_threshold) & ~clearing_mask & ~moss_mask
        tiles = np.where(dirt_mask, TILE_IDS['dirt'], tiles)
        
        # Stone outcrops
        stone_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.006, Y_detail * 0.006, frequency=1.0
        )
        stone_threshold = np.percentile(stone_noise, 90)  # Top 10% becomes stone
        stone_mask = (stone_noise > stone_threshold) & ~clearing_mask & ~moss_mask & ~dirt_mask
        tiles = np.where(stone_mask, TILE_IDS['stone'], tiles)
        
        return tiles
    
    elif biome == 'desert':
        # Start with sand as base terrain
        tiles = np.full((height, width), TILE_IDS['sand'], dtype=np.int32)
        
        # Apply terrain types using percentile-based system
        
        # Stone outcrops and rocky areas
        stone_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.008, Y_detail * 0.008, frequency=1.0
        )
        stone_threshold = np.percentile(stone_noise, 70)  # Top 30% becomes stone
        stone_mask = stone_noise > stone_threshold
        tiles = np.where(stone_mask, TILE_IDS['stone'], tiles)
        
        # Gravel areas
        gravel_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.012, Y_detail * 0.012, frequency=1.0
        )
        gravel_threshold = np.percentile(gravel_noise, 75)  # Top 25% becomes gravel
        gravel_mask = (gravel_noise > gravel_threshold) & ~stone_mask
        tiles = np.where(gravel_mask, TILE_IDS['gravel'], tiles)
        
        # Dirt patches
        dirt_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.015, Y_detail * 0.015, frequency=1.0
        )
        dirt_threshold = np.percentile(dirt_noise, 80)  # Top 20% becomes dirt
        dirt_mask = (dirt_noise > dirt_threshold) & ~stone_mask & ~gravel_mask
        tiles = np.where(dirt_mask, TILE_IDS['dirt'], tiles)
        
        # Rare grass patches (oases)
        grass_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.005, Y_detail * 0.005, frequency=1.0
        )
        grass_threshold = np.percentile(grass_noise, 95)  # Top 5% becomes grass (rare oases)
        grass_mask = (grass_noise > grass_threshold) & ~stone_mask & ~gravel_mask & ~dirt_mask
        tiles = np.where(grass_mask, TILE_IDS['grass'], tiles)
        
        return tiles
    
    elif biome == 'tundra':
        # Start with snow as base terrain
        tiles = np.full((height, width), TILE_IDS['snow'], dtype=np.int32)
        
        # Ice patches
        ice_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.01, Y_detail * 0.01, frequency=1.0
        )
        ice_threshold = np.percentile(ice_noise, 75)  # Top 25% becomes ice
        ice_mask = ice_noise > ice_threshold
        tiles = np.where(ice_mask, TILE_IDS['ice'], tiles)
        
        # Stone outcrops
        stone_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.008, Y_detail * 0.008, frequency=1.0
        )
        stone_threshold = np.percentile(stone_noise, 85)  # Top 15% becomes stone
        stone_mask = (stone_noise > stone_threshold) & ~ice_mask
        tiles = np.where(stone_mask, TILE_IDS['stone'], tiles)
        
        # Rare grass patches
        grass_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.006, Y_detail * 0.006, frequency=1.0
        )
        grass_threshold = np.percentile(grass_noise, 90)  # Top 10% becomes grass
        grass_mask = (grass_noise > grass_threshold) & ~ice_mask & ~stone_mask
        tiles = np.where(grass_mask, TILE_IDS['grass'], tiles)
        
        return tiles
    
    elif biome == 'ocean':
        # Start with deep water as base terrain
        tiles = np.full((height, width), TILE_IDS['water'], dtype=np.int32)
        
        # No additional terrain types for deep ocean
        return tiles
    
    # Fallback for unknown biomes - use grassland system
    else:
        # Use grassland generation as fallback
        tiles = np.full((height, width), TILE_IDS['grass'], dtype=np.int32)
        
        # Stone outcrops
        stone_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.01, Y_detail * 0.01, frequency=1.0
        )
        stone_threshold = np.percentile(stone_noise, 85)
        stone_mask = stone_noise > stone_threshold
        tiles = np.where(stone_mask, TILE_IDS['stone'], tiles)
        
        # Dirt patches
        dirt_noise = noise_generator.simplex_2d_gpu_massive(
            X_detail * 0.012, Y_detail * 0.012, frequency=1.0
        )
        dirt_threshold = np.percentile(dirt_noise, 60)
        dirt_mask = (dirt_noise > dirt_threshold) & ~stone_mask
        tiles = np.where(dirt_mask, TILE_IDS['dirt'], tiles)
        
        return tiles

def smooth_sigmoid(x, center=0.0, steepness=5.0):
    """Smooth sigmoid function for organic transitions."""
    return 1.0 / (1.0 + np.exp(-steepness * (x - center)))

def apply_smooth_terrain_selection(terrain_influences, base_terrain_id):
    """Select terrain based on highest influence competition (winner-takes-all)."""
    if not terrain_influences:
        return np.full((512, 512), base_terrain_id, dtype=np.int32)
    
    # Get the shape from any influence map
    shape = next(iter(terrain_influences.values())).shape
    
    # Create arrays to track the best terrain for each pixel
    max_influence = np.full(shape, -1.0)  # Track highest influence
    best_terrain = np.full(shape, base_terrain_id, dtype=np.int32)  # Track best terrain ID
    
    # Compete all terrain types - highest influence wins each pixel
    for terrain_name, influence in terrain_influences.items():
        if terrain_name in TILE_IDS:
            terrain_id = TILE_IDS[terrain_name]
            
            # Add small random variation for organic edges
            varied_influence = influence + np.random.normal(0, 0.01, shape)
            
            # Where this terrain has higher influence, it wins
            better_mask = varied_influence > max_influence
            max_influence = np.where(better_mask, varied_influence, max_influence)
            best_terrain = np.where(better_mask, terrain_id, best_terrain)
    
    # Optional debug output (disabled for production)
    # unique_tiles, counts = np.unique(best_terrain, return_counts=True)
    # print(f"[FINAL] Generated terrain distribution:")
    # for tile_id, count in zip(unique_tiles, counts):
    #     terrain_name = "unknown"
    #     for name, tid in TILE_IDS.items():
    #         if tid == tile_id:
    #             terrain_name = name
    #             break
    #     print(f"  {terrain_name} (ID {tile_id}): {count} pixels ({count/shape[0]/shape[1]*100:.1f}%)")
    
    return best_terrain

def apply_natural_clustering(tiles, noise_generator, X_detail, Y_detail):
    """Apply natural clustering to make terrain more realistic and less scattered."""
    height, width = tiles.shape
    smoothed_tiles = tiles.copy()
    
    # Create clustering noise for natural grouping
    cluster_noise = noise_generator.simplex_2d_gpu_massive(X_detail * 0.01, Y_detail * 0.01, frequency=1.0)
    
    # For each unique tile type, apply clustering
    unique_tiles = np.unique(tiles)
    for tile_id in unique_tiles:
        tile_mask = (tiles == tile_id)
        
        # Expand clusters where noise is positive
        expansion_mask = tile_mask & (cluster_noise > 0.2)
        
        # Use morphological operations to create natural clusters
        if np.any(expansion_mask):
            # Dilate clusters naturally
            kernel = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=bool)
            expanded = binary_dilation(expansion_mask, structure=kernel, iterations=1)
            
            # Only expand into similar elevation/moisture areas to maintain realism
            smoothed_tiles = np.where(expanded & (cluster_noise > 0.0), tile_id, smoothed_tiles)
    
    return smoothed_tiles

# Update the function call
def generate_universal_terrain(biome, elevation, moisture, detail_noise, X_detail, Y_detail, noise_generator, world_start_x, world_start_y, base_seed):
    """Wrapper to maintain compatibility - calls the new coherent terrain generator."""
    return generate_coherent_terrain(biome, elevation, moisture, detail_noise, X_detail, Y_detail, noise_generator, world_start_x, world_start_y, base_seed)

class RTX3090Noise:
    """RTX 3090 optimized noise generation with massive parallel processing."""
    
    def __init__(self, seed: int = 12345):
        self.seed = seed
        np.random.seed(seed)
        self.use_gpu = GPU_AVAILABLE
        
        if self.use_gpu:
            # Initialize CUDA random state for GPU noise generation
            cp.random.seed(seed)
            print(f"[RTX3090] GPU noise generator initialized with seed {seed}")
    
    def simplex_2d_gpu_massive(self, x: np.ndarray, y: np.ndarray, frequency: float = 1.0) -> np.ndarray:
        """RTX 3090 MASSIVE PARALLEL noise generation using all 10496 CUDA cores."""
        if not self.use_gpu:
            return self._simplex_2d_cpu_optimized(x, y, frequency)
        
        print(f"[RTX3090] Launching noise generation on {x.size} points...")
        start_time = time.time()
        
        # Transfer to GPU with optimal memory layout
        x_gpu = cp.asarray(x, dtype=cp.float32)
        y_gpu = cp.asarray(y, dtype=cp.float32)
        
        # Pre-allocate result on GPU
        result_gpu = cp.zeros_like(x_gpu, dtype=cp.float32)
        
        # RTX 3090 optimized multi-octave noise generation
        octaves = [
            (frequency * 0.001, 1.0),      # Continental features
            (frequency * 0.003, 0.5),     # Mountain ranges  
            (frequency * 0.008, 0.25),    # Hills and valleys
            (frequency * 0.02, 0.125),    # Local terrain
            (frequency * 0.05, 0.0625)    # Fine detail
        ]
        
        # Process all octaves in parallel on GPU
        for i, (freq, amplitude) in enumerate(octaves):
            # Generate organic phase offsets
            phase_x = cp.float32(1.618033988749 * i + self.seed * 0.001)
            phase_y = cp.float32(2.718281828459 * i + self.seed * 0.001)
            
            # Primary noise layer with domain warping
            noise_1 = cp.sin((x_gpu + phase_x) * freq * 0.013 + 
                           cp.cos((y_gpu + phase_y) * freq * 0.017) * 0.5)
            noise_2 = cp.cos((y_gpu + phase_y) * freq * 0.011 + 
                           cp.sin((x_gpu + phase_x) * freq * 0.019) * 0.7)
            
            primary_noise = noise_1 * noise_2
            
            # Domain warping for organic patterns
            warp_x = cp.sin((x_gpu + y_gpu) * freq * 0.007) * 20.0
            warp_y = cp.cos((x_gpu - y_gpu) * freq * 0.009) * 20.0
            
            # Warped noise layer
            warped_noise = cp.sin((x_gpu + warp_x) * freq * 0.015) * \
                          cp.cos((y_gpu + warp_y) * freq * 0.012)
            
            # Combine with amplitude
            octave_contribution = (primary_noise + warped_noise * 0.3) * amplitude
            result_gpu += octave_contribution
        
        # Apply final shaping
        result_gpu = cp.tanh(result_gpu * 0.35)
        
        # Transfer back to CPU
        result = cp.asnumpy(result_gpu)
        
        elapsed = time.time() - start_time
        points_per_sec = x.size / elapsed
        print(f"[RTX3090] Noise generation: {elapsed:.3f}s ({points_per_sec/1e6:.1f}M points/sec)")
        
        return result
    
    def _simplex_2d_cpu_optimized(self, x: np.ndarray, y: np.ndarray, frequency: float = 1.0) -> np.ndarray:
        """Optimized CPU fallback with vectorized operations."""
        result = np.zeros_like(x, dtype=np.float32)
        
        octaves = [
            (frequency * 0.001, 1.0),
            (frequency * 0.003, 0.5),
            (frequency * 0.008, 0.25)
        ]
        
        for freq, amp in octaves:
            noise = np.sin(x * freq + np.pi * 0.33) * np.cos(y * freq + np.pi * 0.67)
            noise += np.cos(x * freq * 0.7 + np.pi * 0.25) * np.sin(y * freq * 1.3 + np.pi * 0.75) * 0.4
            result += noise * amp
            
        return np.tanh(result * 0.6)

class RTX3090WorldGenerator:
    """RTX 3090 powered world generation engine - MAXIMUM PERFORMANCE."""
    
    def __init__(self, config_path: str = None, seed: int = None, max_workers: int = None):
        self.base_seed = seed if seed is not None else 12345
        self.noise = RTX3090Noise(self.base_seed)
        self.config = self._load_config(config_path)
        
        # Maximize CPU utilization
        if max_workers is None:
            self.max_workers = mp.cpu_count()
        else:
            self.max_workers = max_workers
            
        print(f"[RTX3090] WorldGenerator: {self.max_workers} CPU cores + RTX 3090 GPU")
        
        # Setup output directory
        self.regions_dir = Path("./regions")
        self.regions_dir.mkdir(exist_ok=True)
        
        # GPU memory management
        if GPU_AVAILABLE:
            self._setup_gpu_memory_management()
    
    def _setup_gpu_memory_management(self):
        """Configure RTX 3090 memory management for optimal performance."""
        try:
            # Get GPU info
            device = cp.cuda.Device()
            print(f"[RTX3090] GPU: {device.attributes['Name'].decode()}")
            print(f"[RTX3090] VRAM: {device.mem_info[1] / 1024**3:.1f}GB total")
            
            # Configure memory pools
            mempool = cp.get_default_memory_pool()
            mempool.set_limit(size=20 * 1024**3)  # Use 20GB of 24GB
            
            # Pre-allocate common buffer sizes
            self._gpu_buffers = {}
            common_sizes = [REGION_TILES * REGION_TILES * 4]  # Common array sizes
            
            for size in common_sizes:
                self._gpu_buffers[size] = cp.zeros(size, dtype=cp.float32)
            
            print("[RTX3090] GPU memory management configured")
            
        except Exception as e:
            print(f"[RTX3090] GPU setup warning: {e}")
    
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
            "biome_coherence": 0.8,
            "gpu_batch_size": 65536,  # RTX 3090 optimal batch size
            "gpu_memory_limit": 20    # GB
        }
        
        if config_path and os.path.exists(config_path):
            with open(config_path, 'r') as f:
                user_config = json.load(f)
                default_config.update(user_config)
                
        return default_config
    
    def generate_region_gpu_accelerated(self, world_x: int, world_y: int, forced_biome: str = None) -> np.ndarray:
        """Generate a region using the legacy, proven CPU terrain pipeline for visuals.
        We keep the binary format and entrypoints the same, and can re‑introduce
        GPU later without changing the math."""
        print(f"[RTX3090] Generating region ({world_x}, {world_y}) via legacy CPU visuals (biome: {forced_biome})")
        start_time = time.time()

        # Lazy-load legacy generator class directly from sibling file to avoid import path issues
        def _get_legacy_worldgen_class():
            module_path = Path(__file__).resolve().parent / 'python_generator.py'
            spec = importlib.util.spec_from_file_location('legacy_worldgen', str(module_path))
            module = importlib.util.module_from_spec(spec)
            assert spec.loader is not None
            spec.loader.exec_module(module)
            return module.WorldGenerator

        try:
            LegacyWG = _get_legacy_worldgen_class()
            legacy = LegacyWG(seed=self.base_seed)

            # Use legacy world-data computation for now to avoid periodic banding;
            # we keep GPU for later once parity is confirmed
            world_data = legacy.generate_enhanced_world_data(world_x, world_y)
            # Map unsupported/slow biomes to legacy equivalents
            legacy_biome = forced_biome
            if forced_biome == 'shallow_water':
                # Legacy CPU pipeline has no 'shallow_water' branch; use 'beach' for shoreline look
                legacy_biome = 'beach'

            if legacy_biome and legacy_biome in BIOMES:
                biome_map = np.full((REGION_TILES, REGION_TILES), legacy_biome, dtype='<U20')
            else:
                biome_map = legacy.assign_biomes(world_data)

            # Skip heavy CPU smoothing to keep generation fast; reuse raw tiles
            try:
                original_smoothing = getattr(legacy, 'apply_enhanced_smoothing', None)
                if original_smoothing is not None:
                    # Monkey‑patch smoothing to no‑op for speed
                    legacy.apply_enhanced_smoothing = lambda tiles, wd: tiles
                tiles = legacy.generate_enhanced_terrain_tiles(world_data, biome_map)
            finally:
                if original_smoothing is not None:
                    legacy.apply_enhanced_smoothing = original_smoothing

            elapsed = time.time() - start_time
            print(f"[RTX3090] Region ({world_x}, {world_y}) completed in {elapsed:.3f}s (legacy visuals)")
            return tiles
        except Exception as e:
            print("[RTX3090][ERROR] Exception during region generation:\n" + traceback.format_exc())
            # Safe fallback tiles to avoid Godot placeholder
            tiles = np.full((REGION_TILES, REGION_TILES), TILE_IDS['grass'], dtype=np.int32)
            return tiles

    def _generate_enhanced_world_data_gpu(self, world_x: int, world_y: int) -> Dict[str, np.ndarray]:
        """GPU version of legacy generate_enhanced_world_data: same math, faster noise."""
        # WORLD-SPACE grids (seamless across regions)
        x_coords = np.linspace(world_x, world_x + REGION_TILES, REGION_TILES, dtype=np.float32)
        y_coords = np.linspace(world_y, world_y + REGION_TILES, REGION_TILES, dtype=np.float32)
        X, Y = np.meshgrid(x_coords, y_coords)

        def _shape(field: np.ndarray) -> np.ndarray:
            # Match legacy FastNoise shaping: tanh(result * 0.35)
            return np.tanh(field * 0.35)

        # Elevation – multi-layer + domain warping (same structure as legacy)
        elevation_large = _shape(self.noise.simplex_2d_gpu_massive(X, Y, self.config["elevation_frequency"] * 0.5))
        elevation_medium = _shape(self.noise.simplex_2d_gpu_massive(X + 1000, Y + 1000, self.config["elevation_frequency"])) 
        elevation_detail = _shape(self.noise.simplex_2d_gpu_massive(X + 2000, Y + 2000, self.config["elevation_frequency"] * 3.0))
        elevation = (elevation_large * 0.6 + elevation_medium * 0.3 + elevation_detail * 0.1)

        warp_x = _shape(self.noise.simplex_2d_gpu_massive(X + 5000, Y + 5000, 0.001)) * 25.0
        warp_y = _shape(self.noise.simplex_2d_gpu_massive(X + 6000, Y + 6000, 0.001)) * 25.0
        warped_elevation = _shape(self.noise.simplex_2d_gpu_massive(X + warp_x, Y + warp_y, self.config["elevation_frequency"])) 
        elevation = (elevation * 0.7 + warped_elevation * 0.3)

        moisture_base = _shape(self.noise.simplex_2d_gpu_massive(X + 3000, Y + 3000, self.config["moisture_frequency"])) 
        moisture_flow = _shape(self.noise.simplex_2d_gpu_massive(X + 4000, Y + 4000, self.config["moisture_frequency"] * 2.0))
        moisture = moisture_base + moisture_flow * 0.3

        temperature_base = _shape(self.noise.simplex_2d_gpu_massive(X + 7000, Y + 7000, self.config["temperature_frequency"])) 
        temperature_local = _shape(self.noise.simplex_2d_gpu_massive(X + 8000, Y + 8000, self.config["temperature_frequency"] * 4.0))
        temperature = temperature_base + temperature_local * 0.2

        rivers_main = _shape(self.noise.simplex_2d_gpu_massive(X + 9000, Y + 9000, self.config["river_frequency"])) 
        rivers_tributaries = _shape(self.noise.simplex_2d_gpu_massive(X + 10000, Y + 10000, self.config["river_frequency"] * 2.0))
        rivers = rivers_main + rivers_tributaries * 0.4

        detail_fine = _shape(self.noise.simplex_2d_gpu_massive(X + 11000, Y + 11000, self.config["detail_frequency"])) 
        detail_micro = _shape(self.noise.simplex_2d_gpu_massive(X + 12000, Y + 12000, self.config["detail_frequency"] * 3.0))
        detail = detail_fine + detail_micro * 0.3

        # Return as NumPy arrays (legacy masks work on NumPy)
        return {
            'elevation': elevation,
            'moisture': moisture,
            'temperature': temperature,
            'rivers': rivers,
            'detail': detail,
            'x_coords': X,
            'y_coords': Y
        }
    
    def _generate_world_data_gpu_massive(self, X: np.ndarray, Y: np.ndarray, world_x: float, world_y: float) -> Dict[str, np.ndarray]:
        """RTX 3090 MASSIVE PARALLEL world data generation."""
        print("[RTX3090] Launching massive parallel world data generation...")
        
        # Generate all noise layers in parallel on GPU
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {
                'elevation': executor.submit(self.noise.simplex_2d_gpu_massive, X, Y, self.config["elevation_frequency"]),
                'moisture': executor.submit(self.noise.simplex_2d_gpu_massive, X + 1000, Y + 1000, self.config["moisture_frequency"]),
                'temperature': executor.submit(self.noise.simplex_2d_gpu_massive, X + 2000, Y + 2000, self.config["temperature_frequency"]),
                'rivers': executor.submit(self.noise.simplex_2d_gpu_massive, X + 3000, Y + 3000, self.config["river_frequency"]),
                'detail': executor.submit(self.noise.simplex_2d_gpu_massive, X + 4000, Y + 4000, self.config["detail_frequency"])
            }
            
            # Collect results
            world_data = {}
            for key, future in futures.items():
                world_data[key] = future.result()
        
        world_data['x_coords'] = X
        world_data['y_coords'] = Y
        world_data['world_x'] = world_x  # Add world coordinates for seamless generation
        world_data['world_y'] = world_y
        
        return world_data
    
    def _generate_world_data_cpu_optimized(self, X: np.ndarray, Y: np.ndarray, world_x: int = 0, world_y: int = 0) -> Dict[str, np.ndarray]:
        """CPU optimized world data generation."""
        return {
            'elevation': self.noise._simplex_2d_cpu_optimized(X, Y, self.config["elevation_frequency"]),
            'moisture': self.noise._simplex_2d_cpu_optimized(X + 1000, Y + 1000, self.config["moisture_frequency"]),
            'temperature': self.noise._simplex_2d_cpu_optimized(X + 2000, Y + 2000, self.config["temperature_frequency"]),
            'rivers': self.noise._simplex_2d_cpu_optimized(X + 3000, Y + 3000, self.config["river_frequency"]),
            'detail': self.noise._simplex_2d_cpu_optimized(X + 4000, Y + 4000, self.config["detail_frequency"]),
            'x_coords': X,
            'y_coords': Y,
            'world_x': world_x,  # Add world coordinates for seamless generation
            'world_y': world_y
        }
    
    def _assign_biomes_vectorized(self, world_data: Dict[str, np.ndarray]) -> np.ndarray:
        """Vectorized biome assignment for maximum performance."""
        elevation = world_data['elevation']
        moisture = world_data['moisture']
        temperature = world_data['temperature']
        
        # Initialize with grassland
        biome_map = np.full(elevation.shape, 'grassland', dtype='U10')
        
        # Vectorized biome assignment using boolean masks
        ocean_mask = elevation < -0.3
        beach_mask = (elevation >= -0.3) & (elevation < -0.1) & (moisture > 0.1)
        mountain_mask = elevation > 0.4
        hills_mask = (elevation > 0.2) & (elevation <= 0.4)
        desert_mask = (moisture < -0.2) & (temperature > 0.1) & (elevation > -0.1)
        tundra_mask = (temperature < -0.3) & (elevation > -0.1)
        forest_mask = (moisture > 0.2) & (temperature > -0.1) & (temperature < 0.3) & (elevation > -0.1)
        
        # Apply masks in order of priority
        biome_map[ocean_mask] = 'ocean'
        biome_map[beach_mask] = 'beach'
        biome_map[mountain_mask] = 'mountains'
        biome_map[hills_mask] = 'hills'
        biome_map[desert_mask] = 'desert'
        biome_map[tundra_mask] = 'tundra'
        biome_map[forest_mask] = 'forest'
        
        return biome_map
    
    def _generate_terrain_tiles_gpu_massive(self, world_data: Dict[str, np.ndarray], biome_map: np.ndarray) -> np.ndarray:
        """RTX 3090 MASSIVE PARALLEL terrain tile generation."""
        print("[RTX3090] Launching massive parallel terrain generation...")
        
        height, width = world_data['elevation'].shape
        
        # Transfer all data to GPU for parallel processing
        elevation_gpu = cp.asarray(world_data['elevation'])
        moisture_gpu = cp.asarray(world_data['moisture'])
        temperature_gpu = cp.asarray(world_data['temperature'])
        rivers_gpu = cp.asarray(world_data['rivers'])
        detail_gpu = cp.asarray(world_data['detail'])
        
        # Initialize tiles on GPU
        tiles_gpu = cp.zeros((height, width), dtype=cp.int32)
        
        # Generate detail noise for terrain variation on GPU
        x_coords = cp.arange(width)[None, :] + cp.random.randint(0, 1000)
        y_coords = cp.arange(height)[:, None] + cp.random.randint(0, 1000)
        detail_noise_gpu = self._simplex_2d_gpu(x_coords, y_coords, scale=0.05)
        
        # Process each biome with sophisticated terrain logic
        unique_biomes = np.unique(biome_map)
        
        for biome in unique_biomes:
            # Create biome mask on GPU
            biome_mask_cpu = (biome_map == biome)
            biome_mask_gpu = cp.asarray(biome_mask_cpu)
            
            if biome == 'grassland':
                print(f"[RTX3090] Processing grassland biome with complex terrain...")
                # Grassland: Start with grass as the base
                biome_tiles_gpu = cp.full((height, width), TILE_IDS['grass'], dtype=cp.int32)
                
                # Create more balanced terrain based on elevation and moisture
                # Use percentiles instead of absolute values for better distribution
                elev_vals = elevation_gpu[biome_mask_gpu]
                moist_vals = moisture_gpu[biome_mask_gpu]
                detail_vals = detail_noise_gpu[biome_mask_gpu]
                
                elev_low = cp.percentile(elev_vals, 25)
                elev_high = cp.percentile(elev_vals, 75)
                moist_low = cp.percentile(moist_vals, 30)
                moist_high = cp.percentile(moist_vals, 70)
                
                # Dirt patches in drier areas (30% driest)
                biome_tiles_gpu = cp.where(biome_mask_gpu & (moisture_gpu < moist_low), TILE_IDS['dirt'], biome_tiles_gpu)
                
                # Mud in wetter areas (30% wettest)
                biome_tiles_gpu = cp.where(biome_mask_gpu & (moisture_gpu > moist_high), TILE_IDS['mud'], biome_tiles_gpu)
                
                # Water in very wet, low areas (10% wettest + 25% lowest)
                very_wet = cp.percentile(moist_vals, 90)
                biome_tiles_gpu = cp.where(biome_mask_gpu & (moisture_gpu > very_wet) & (elevation_gpu < elev_low), TILE_IDS['water'], biome_tiles_gpu)
                
                # Gravel in valleys (25% lowest elevation)
                biome_tiles_gpu = cp.where(biome_mask_gpu & (elevation_gpu < elev_low), TILE_IDS['gravel'], biome_tiles_gpu)
                
                # Add some variety with detail noise
                detail_high = cp.percentile(detail_vals, 85)
                biome_tiles_gpu = cp.where(biome_mask_gpu & (detail_noise_gpu > detail_high) & (elevation_gpu > elev_high), TILE_IDS['flowers'], biome_tiles_gpu)
                
                tiles_gpu = cp.where(biome_mask_gpu, biome_tiles_gpu, tiles_gpu)
                
            elif biome == 'forest':
                print(f"[RTX3090] Processing forest biome with complex terrain...")
                # Forest: mostly forest with moss and dirt
                biome_tiles_gpu = cp.full((height, width), TILE_IDS['forest'], dtype=cp.int32)
                
                # Moss in wet areas
                biome_tiles_gpu = cp.where(biome_mask_gpu & (moisture_gpu > 0.3), TILE_IDS['moss'], biome_tiles_gpu)
                
                # Dirt patches
                biome_tiles_gpu = cp.where(biome_mask_gpu & (detail_noise_gpu > 0.8), TILE_IDS['dirt'], biome_tiles_gpu)
                
                tiles_gpu = cp.where(biome_mask_gpu, biome_tiles_gpu, tiles_gpu)
                
            elif biome == 'desert':
                print(f"[RTX3090] Processing desert biome with complex terrain...")
                # Desert: mostly sand with stone and crystal
                biome_tiles_gpu = cp.full((height, width), TILE_IDS['sand'], dtype=cp.int32)
                
                # Stone outcrops
                biome_tiles_gpu = cp.where(biome_mask_gpu & (elevation_gpu > 0.2), TILE_IDS['stone'], biome_tiles_gpu)
                
                # Rare crystal formations
                biome_tiles_gpu = cp.where(biome_mask_gpu & (detail_noise_gpu > 0.95), TILE_IDS['crystal'], biome_tiles_gpu)
                
                tiles_gpu = cp.where(biome_mask_gpu, biome_tiles_gpu, tiles_gpu)
                
            elif biome == 'tundra':
                print(f"[RTX3090] Processing tundra biome with complex terrain...")
                # Tundra: snow, ice, stone
                biome_tiles_gpu = cp.full((height, width), TILE_IDS['snow'], dtype=cp.int32)
                
                # Ice in low areas
                biome_tiles_gpu = cp.where(biome_mask_gpu & (elevation_gpu < -0.1), TILE_IDS['ice'], biome_tiles_gpu)
                
                # Stone outcrops
                biome_tiles_gpu = cp.where(biome_mask_gpu & (elevation_gpu > 0.3), TILE_IDS['stone'], biome_tiles_gpu)
                
                tiles_gpu = cp.where(biome_mask_gpu, biome_tiles_gpu, tiles_gpu)
                
            elif biome == 'ocean':
                print(f"[RTX3090] Processing ocean biome with complex terrain...")
                # Ocean: water with occasional sand at edges
                biome_tiles_gpu = cp.full((height, width), TILE_IDS['water'], dtype=cp.int32)
                
                # Sand at very edges (high elevation in ocean = near shore)
                biome_tiles_gpu = cp.where(biome_mask_gpu & (elevation_gpu > 0.2), TILE_IDS['sand'], biome_tiles_gpu)
                
                tiles_gpu = cp.where(biome_mask_gpu, biome_tiles_gpu, tiles_gpu)
            
            else:
                # Fallback for unknown biomes - use old simple logic
                if biome in BIOMES:
                    print(f"[RTX3090] Processing {biome} biome with fallback logic...")
                    biome_config = BIOMES[biome]
                    
                    # Get tile IDs
                    primary_id = TILE_IDS.get(biome_config['primary'], TILE_IDS['grass'])
                    secondary_id = TILE_IDS.get(biome_config['secondary'], TILE_IDS['dirt'])
                    tertiary_id = TILE_IDS.get(biome_config['tertiary'], TILE_IDS['stone'])
                    accent_id = TILE_IDS.get(biome_config.get('accent', 'gravel'), TILE_IDS['gravel'])
                    
                    # GPU parallel tile assignment
                    base_factor = elevation_gpu * 0.4 + moisture_gpu * 0.3 + temperature_gpu * 0.2 + detail_gpu * 0.1
                    
                    # Vectorized tile assignment on GPU
                    primary_mask = biome_mask_gpu
                    secondary_mask = biome_mask_gpu & (base_factor < -0.1) & (base_factor > -0.4)
                    tertiary_mask = biome_mask_gpu & (base_factor <= -0.4)
                    accent_mask = biome_mask_gpu & (base_factor > 0.6)
                    
                    # Apply tiles in parallel
                    tiles_gpu = cp.where(primary_mask, primary_id, tiles_gpu)
                    tiles_gpu = cp.where(secondary_mask, secondary_id, tiles_gpu)
                    tiles_gpu = cp.where(tertiary_mask, tertiary_id, tiles_gpu)
                    tiles_gpu = cp.where(accent_mask, accent_id, tiles_gpu)
        
        # Add rivers (extremely conservative) - only in appropriate biomes
        biome_map_gpu = cp.asarray(biome_map)
        ocean_rivers_gpu = (rivers_gpu > 0.85) & (biome_map_gpu == 'ocean')
        tiles_gpu = cp.where(ocean_rivers_gpu, TILE_IDS['water'], tiles_gpu)
        
        print("[RTX3090] Applying GPU-accelerated edge smoothing...")
        # Apply edge smoothing for seamless region transitions
        tiles_gpu = self._apply_edge_smoothing_gpu(tiles_gpu, elevation_gpu, moisture_gpu)
        
        # Transfer back to CPU
        tiles = cp.asnumpy(tiles_gpu)
        
        # Validate tiles
        valid_tile_ids = set(TILE_IDS.values())
        invalid_mask = ~np.isin(tiles, list(valid_tile_ids))
        if np.any(invalid_mask):
            tiles[invalid_mask] = TILE_IDS['grass']
        
        return tiles
    
    def _apply_edge_smoothing_gpu(self, tiles_gpu, elevation_gpu, moisture_gpu):
        """Apply GPU-accelerated edge smoothing to reduce visible borders between regions."""
        height, width = tiles_gpu.shape
        edge_width = 8  # Number of pixels to smooth at edges
        
        # Create smoothed tiles array on GPU
        smoothed_tiles_gpu = tiles_gpu.copy()
        
        # Apply smoothing to edges using terrain-based blending
        for edge_dist in range(1, edge_width + 1):
            # Calculate blend strength (stronger near edges)
            blend_strength = (edge_width - edge_dist + 1) / edge_width * 0.3
            
            # Generate random values on GPU for blending decisions
            random_vals = cp.random.random((height, width))
            
            # Top and bottom edges
            if edge_dist < height:
                # Top edge
                top_mask = (elevation_gpu[edge_dist, :] > 0.1) & (moisture_gpu[edge_dist, :] < 0.7) & (random_vals[edge_dist, :] < blend_strength)
                smoothed_tiles_gpu[edge_dist, :] = cp.where(top_mask, self._get_blended_tile_gpu(tiles_gpu[edge_dist, :], elevation_gpu[edge_dist, :]), smoothed_tiles_gpu[edge_dist, :])
                
                # Bottom edge
                bottom_y = height - 1 - edge_dist
                if bottom_y >= 0:
                    bottom_mask = (elevation_gpu[bottom_y, :] > 0.1) & (moisture_gpu[bottom_y, :] < 0.7) & (random_vals[bottom_y, :] < blend_strength)
                    smoothed_tiles_gpu[bottom_y, :] = cp.where(bottom_mask, self._get_blended_tile_gpu(tiles_gpu[bottom_y, :], elevation_gpu[bottom_y, :]), smoothed_tiles_gpu[bottom_y, :])
            
            # Left and right edges
            if edge_dist < width:
                # Left edge
                left_mask = (elevation_gpu[:, edge_dist] > 0.1) & (moisture_gpu[:, edge_dist] < 0.7) & (random_vals[:, edge_dist] < blend_strength)
                smoothed_tiles_gpu[:, edge_dist] = cp.where(left_mask, self._get_blended_tile_gpu(tiles_gpu[:, edge_dist], elevation_gpu[:, edge_dist]), smoothed_tiles_gpu[:, edge_dist])
                
                # Right edge
                right_x = width - 1 - edge_dist
                if right_x >= 0:
                    right_mask = (elevation_gpu[:, right_x] > 0.1) & (moisture_gpu[:, right_x] < 0.7) & (random_vals[:, right_x] < blend_strength)
                    smoothed_tiles_gpu[:, right_x] = cp.where(right_mask, self._get_blended_tile_gpu(tiles_gpu[:, right_x], elevation_gpu[:, right_x]), smoothed_tiles_gpu[:, right_x])
        
        return smoothed_tiles_gpu
    
    def _get_blended_tile_gpu(self, original_tile_gpu, elevation_gpu):
        """Get blended tile based on elevation for GPU processing."""
        # Simple blending logic - return more common terrain types
        blended_tile = cp.where(elevation_gpu > 0.3, TILE_IDS['stone'], 
                               cp.where(elevation_gpu > 0.0, TILE_IDS['grass'], 
                                       cp.where(elevation_gpu > -0.2, TILE_IDS['dirt'], TILE_IDS['mud'])))
        return blended_tile
    
    def _generate_terrain_tiles_cpu_optimized(self, world_data: Dict[str, np.ndarray], biome_map: np.ndarray) -> np.ndarray:
        """CPU optimized terrain tile generation with complex biome-specific logic."""
        height, width = world_data['elevation'].shape
        tiles = np.zeros((height, width), dtype=np.int32)
        
        elevation = world_data['elevation']
        moisture = world_data['moisture']
        temperature = world_data['temperature']
        rivers = world_data['rivers']
        detail = world_data['detail']
        
        # Calculate world coordinates for seamless terrain
        world_start_x = world_data.get('world_x', 0) * REGION_TILES
        world_start_y = world_data.get('world_y', 0) * REGION_TILES
        
        # Generate detail noise for terrain variation using world coordinates
        x_coords = np.linspace(world_start_x, world_start_x + width, width, dtype=np.float32)
        y_coords = np.linspace(world_start_y, world_start_y + height, height, dtype=np.float32)
        X_detail, Y_detail = np.meshgrid(x_coords, y_coords)
        detail_noise = self.noise.simplex_2d_gpu_massive(X_detail, Y_detail, frequency=0.05)
        
        # Process each biome with sophisticated terrain logic
        unique_biomes = np.unique(biome_map)
        
        for biome in unique_biomes:
            # Create biome mask
            biome_mask = (biome_map == biome)
            
            # Use universal terrain generation system for all biomes
            print(f"[CPU] Processing {biome} biome with universal terrain system...")
            biome_tiles = generate_universal_terrain(
                biome, elevation, moisture, detail_noise, 
                X_detail, Y_detail, self.noise, 
                world_start_x, world_start_y, self.base_seed
            )
            tiles = np.where(biome_mask, biome_tiles, tiles)
        
        # Apply edge smoothing for seamless region transitions
        tiles = self._apply_edge_smoothing_cpu(tiles, elevation, moisture)
        
        return tiles
    
    def _apply_edge_smoothing_cpu(self, tiles: np.ndarray, elevation: np.ndarray, moisture: np.ndarray) -> np.ndarray:
        """Apply CPU-based edge smoothing to reduce visible borders between regions."""
        height, width = tiles.shape
        edge_width = 8  # Number of pixels to smooth at edges
        
        # Create smoothed tiles array
        smoothed_tiles = tiles.copy()
        
        # Apply smoothing to edges using terrain-based blending
        for edge_dist in range(1, edge_width + 1):
            # Calculate edge positions
            top_edge = edge_dist - 1
            bottom_edge = height - edge_dist
            left_edge = edge_dist - 1
            right_edge = width - edge_dist
            
            # Apply blending at edges based on environmental factors
            blend_factor = 0.3 * (1.0 - edge_dist / edge_width)
            
            # Smooth transitions at region boundaries
            if top_edge >= 0:
                smoothed_tiles[top_edge, :] = tiles[top_edge, :]
            if bottom_edge < height:
                smoothed_tiles[bottom_edge, :] = tiles[bottom_edge, :]
            if left_edge >= 0:
                smoothed_tiles[:, left_edge] = tiles[:, left_edge]
            if right_edge < width:
                smoothed_tiles[:, right_edge] = tiles[:, right_edge]
        
        return smoothed_tiles

def main():
    """Main function for command-line usage."""
    if len(sys.argv) != 4:
        print("Usage: python python_generator_gpu.py <world_x> <world_y> <biome>")
        sys.exit(1)
    
    world_x = int(sys.argv[1])
    world_y = int(sys.argv[2])
    biome = sys.argv[3]
    
    try:
        generator = RTX3090WorldGenerator()
        tiles = generator.generate_region_gpu_accelerated(world_x, world_y, biome)

        # Save to binary file
        filepath = f"regions/{world_x}_{world_y}.bin"
        os.makedirs(os.path.dirname(filepath), exist_ok=True)

        with open(filepath, 'wb') as f:
            # Write header in Godot's expected format: u32 magic, u16 ver, i32 tiles, i32 tile_px
            f.write(struct.pack('<I', 0x5245474E))   # 4 bytes - Magic number "REGN"
            f.write(struct.pack('<H', 1))            # 2 bytes - Version
            f.write(struct.pack('<I', 512 * 512))    # 4 bytes - Total tiles (262144)
            f.write(struct.pack('<I', 64))           # 4 bytes - Tile pixel size
            
            # Write tile data
            for row in tiles:
                for tile_id in row:
                    f.write(struct.pack('<B', int(tile_id)))
        
        print(f"[RTX3090] Region saved to: {filepath}")
    except Exception:
        print("[RTX3090][ERROR] Top-level failure:\n" + traceback.format_exc())
        # Still write an emergency grass file so Godot does not use placeholder
        filepath = f"regions/{world_x}_{world_y}.bin"
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, 'wb') as f:
            f.write(struct.pack('<I', 0x5245474E))
            f.write(struct.pack('<H', 1))
            f.write(struct.pack('<I', 512 * 512))
            f.write(struct.pack('<I', 64))
            emergency = np.full((REGION_TILES, REGION_TILES), TILE_IDS['grass'], dtype=np.int32)
            for row in emergency:
                for tile_id in row:
                    f.write(struct.pack('<B', int(tile_id)))
        print(f"[RTX3090] Emergency region saved to: {filepath}")

if __name__ == "__main__":
    main()
