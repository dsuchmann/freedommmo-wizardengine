#!/usr/bin/env python3
"""
PixelLab MCP integration for generating tile families with albedo/normal/height/AO channels.
"""
import json
import pathlib
import sys
import os
import asyncio
from typing import Dict, List, Optional

print('[HB] pixel_fetch.py ready')

# Mock PixelLab MCP client - replace with actual MCP integration
class PixelLabClient:
    def __init__(self):
        self.base_url = os.environ.get('PIXELLAB_API_URL', 'http://localhost:8080')
        
    async def create_isometric_tile(self, description: str, size: int = 32, **kwargs) -> str:
        """Create an isometric tile and return tile_id"""
        # Mock implementation - replace with actual MCP calls
        print(f"[MOCK] Creating tile: {description}")
        return f"tile_{hash(description) % 10000}"
    
    async def get_isometric_tile(self, tile_id: str) -> Optional[Dict]:
        """Get tile data including base64 PNG"""
        # Mock implementation - replace with actual MCP calls
        print(f"[MOCK] Fetching tile: {tile_id}")
        return {
            "status": "completed",
            "image_data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",  # 1x1 transparent PNG
            "metadata": {"size": 32}
        }

async def generate_tile_family(client: PixelLabClient, biome: str, family: str, palette: Dict, count: int = 8) -> List[str]:
    """Generate a family of tile variants for a biome"""
    base_prompt = f"{biome} {family} tile, pixel art, 16x16, seamless tiling"
    
    if family == "ground":
        colors = palette["ground"]["variants"]
        style_prompt = f"ground texture with colors {', '.join(colors)}, grass tufts, subtle variation"
    elif family == "cliff":
        colors = palette["cliff"]["variants"] 
        style_prompt = f"cliff face with colors {', '.join(colors)}, rocky texture, vertical emphasis"
    elif family == "water":
        colors = [palette["water"]["base_color"]]
        style_prompt = f"water surface with color {colors[0]}, subtle ripples, animated ready"
    else:
        colors = palette["ground"]["variants"]
        style_prompt = f"generic {family} with colors {', '.join(colors)}"
    
    full_prompt = f"{base_prompt}, {style_prompt}, SNES style, crisp pixels"
    
    tile_ids = []
    for i in range(count):
        variant_prompt = f"{full_prompt}, variant {i+1}"
        tile_id = await client.create_isometric_tile(variant_prompt, size=16)
        tile_ids.append(tile_id)
    
    return tile_ids

async def fetch_and_save_tiles(tile_ids: List[str], output_dir: pathlib.Path, client: PixelLabClient):
    """Fetch tile data and save to disk"""
    output_dir.mkdir(parents=True, exist_ok=True)
    
    for i, tile_id in enumerate(tile_ids):
        tile_data = await client.get_isometric_tile(tile_id)
        if tile_data and tile_data["status"] == "completed":
            # Save albedo (base image)
            albedo_path = output_dir / f"albedo_{i:02d}.png"
            with open(albedo_path, 'wb') as f:
                import base64
                f.write(base64.b64decode(tile_data["image_data"]))
            
            # Generate mock normal/height/AO maps (replace with actual PixelLab channels)
            for channel in ["normal", "height", "ao"]:
                channel_path = output_dir / f"{channel}_{i:02d}.png"
                with open(channel_path, 'wb') as f:
                    f.write(base64.b64decode(tile_data["image_data"]))  # Mock: same as albedo
            
            print(f"[HB] Saved tile family: {output_dir}/{i:02d} (albedo/normal/height/ao)")

async def main():
    if len(sys.argv) < 2:
        print("Usage: python pixel_fetch.py <biome> [family1,family2,...]")
        sys.exit(1)
    
    biome = sys.argv[1]
    families = sys.argv[2].split(',') if len(sys.argv) > 2 else ["ground", "cliff", "water"]
    
    # Load palette
    palette_path = pathlib.Path(f"data/worldgen/palette/{biome}.json")
    if not palette_path.exists():
        print(f"Error: Palette not found: {palette_path}")
        sys.exit(1)
    
    with open(palette_path) as f:
        palette = json.load(f)
    
    client = PixelLabClient()
    
    for family in families:
        print(f"[HB] Generating {biome}/{family} tile family...")
        output_dir = pathlib.Path(f"assets/Generated/{biome}/{family}")
        
        tile_ids = await generate_tile_family(client, biome, family, palette)
        await fetch_and_save_tiles(tile_ids, output_dir, client)
    
    print(f"[HB] Completed biome asset generation for {biome}")

if __name__ == "__main__":
    asyncio.run(main())
