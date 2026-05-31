#!/usr/bin/env python3
"""
Background region generation service for FreedomMMO.
Runs continuously to pre-generate regions around the player.
"""

import time
import json
import sys
import os
from pathlib import Path
from typing import Set, Tuple, List
import threading
import queue
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed

# Add the worldgen directory to path
sys.path.append(str(Path(__file__).parent))

try:
    from python_generator import WorldGenerator
except ImportError:
    print("[BG] Error: Could not import python_generator")
    sys.exit(1)

class BackgroundRegionGenerator:
    """Continuously generates regions in the background."""
    
    def __init__(self, config_path: str = None):
        self.generator = WorldGenerator(config_path)
        self.generated_regions: Set[Tuple[int, int]] = set()
        self.generation_queue = queue.Queue()
        self.running = True
        self.worker_threads = []
        self.max_workers = min(4, os.cpu_count())  # Use up to 4 cores
        
        # Load existing regions
        self._scan_existing_regions()
        
        print(f"[BG] Background generator started with {self.max_workers} workers")
        print(f"[BG] Found {len(self.generated_regions)} existing regions")
        
    def _scan_existing_regions(self):
        """Scan for existing region files."""
        regions_dir = Path("./regions")
        if not regions_dir.exists():
            return
            
        for bin_file in regions_dir.glob("*.bin"):
            try:
                parts = bin_file.stem.split('_')
                if len(parts) == 2:
                    x, y = int(parts[0]), int(parts[1])
                    self.generated_regions.add((x, y))
            except ValueError:
                continue
                
    def get_adjacent_regions(self, center_x: int, center_y: int, radius: int = 1) -> List[Tuple[int, int]]:
        """Get all regions within radius of center."""
        regions = []
        step = 512  # Region size in world coordinates
        
        for dx in range(-radius, radius + 1):
            for dy in range(-radius, radius + 1):
                if dx == 0 and dy == 0:
                    continue  # Skip center
                    
                region_x = center_x + dx * step
                region_y = center_y + dy * step
                regions.append((region_x, region_y))
                
        return regions
        
    def request_regions(self, center_x: int, center_y: int, radius: int = 2):
        """Request generation of regions around a center point."""
        needed_regions = self.get_adjacent_regions(center_x, center_y, radius)
        
        for region_x, region_y in needed_regions:
            if (region_x, region_y) not in self.generated_regions:
                try:
                    self.generation_queue.put((region_x, region_y), block=False)
                    print(f"[BG] Queued region ({region_x}, {region_y}) for generation")
                except queue.Full:
                    pass  # Queue full, skip
                    
    def _worker_thread(self, worker_id: int):
        """Worker thread that generates regions."""
        print(f"[BG] Worker {worker_id} started")
        
        while self.running:
            try:
                # Get next region to generate
                region_x, region_y = self.generation_queue.get(timeout=1.0)
                
                # Skip if already generated
                if (region_x, region_y) in self.generated_regions:
                    self.generation_queue.task_done()
                    continue
                    
                print(f"[BG] Worker {worker_id} generating region ({region_x}, {region_y})")
                start_time = time.time()
                
                # Generate region
                try:
                    filepath = self.generator.generate_and_save_region(region_x, region_y)
                    self.generated_regions.add((region_x, region_y))
                    
                    elapsed = time.time() - start_time
                    print(f"[BG] Worker {worker_id} completed region ({region_x}, {region_y}) in {elapsed:.2f}s")
                    
                except Exception as e:
                    print(f"[BG] Worker {worker_id} failed to generate region ({region_x}, {region_y}): {e}")
                
                self.generation_queue.task_done()
                
            except queue.Empty:
                continue  # Timeout, check if still running
            except Exception as e:
                print(f"[BG] Worker {worker_id} error: {e}")
                
        print(f"[BG] Worker {worker_id} stopped")
        
    def start_workers(self):
        """Start background worker threads."""
        for i in range(self.max_workers):
            worker = threading.Thread(target=self._worker_thread, args=(i,))
            worker.daemon = True
            worker.start()
            self.worker_threads.append(worker)
            
    def stop(self):
        """Stop all workers."""
        print("[BG] Stopping background generation...")
        self.running = False
        
        # Wait for workers to finish
        for worker in self.worker_threads:
            worker.join(timeout=2.0)
            
        print("[BG] Background generation stopped")
        
    def get_stats(self) -> dict:
        """Get generation statistics."""
        return {
            'generated_regions': len(self.generated_regions),
            'queue_size': self.generation_queue.qsize(),
            'workers': len(self.worker_threads),
            'running': self.running
        }

def main():
    """Main entry point for standalone background generation."""
    if len(sys.argv) < 3:
        print("Usage: background_generator.py <center_x> <center_y> [radius] [config_path]")
        print("Example: background_generator.py 0 0 3")
        sys.exit(1)
        
    center_x = int(sys.argv[1])
    center_y = int(sys.argv[2])
    radius = int(sys.argv[3]) if len(sys.argv) > 3 else 2
    config_path = sys.argv[4] if len(sys.argv) > 4 else None
    
    print(f"[BG] Starting background generation around ({center_x}, {center_y}) radius {radius}")
    
    # Create generator
    bg_gen = BackgroundRegionGenerator(config_path)
    bg_gen.start_workers()
    
    # Request initial regions
    bg_gen.request_regions(center_x, center_y, radius)
    
    try:
        # Keep running and show stats
        while True:
            time.sleep(5)
            stats = bg_gen.get_stats()
            print(f"[BG] Stats: {stats['generated_regions']} regions, {stats['queue_size']} queued")
            
            if stats['queue_size'] == 0:
                print("[BG] All regions generated, stopping...")
                break
                
    except KeyboardInterrupt:
        print("\n[BG] Interrupted by user")
    finally:
        bg_gen.stop()

if __name__ == "__main__":
    main()
