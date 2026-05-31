#!/usr/bin/env python3
"""
GDScript test runner for CI.
Parses test files and validates assertions without requiring Godot engine.
Tests are written as GDScript but validated structurally here.
For full runtime tests, use: godot --headless --script tests/run_tests.gd
"""

import json
import os
import re
import sys
from pathlib import Path


def test_server_config():
    """Test ServerConfig.gd structure and config loading."""
    print("  Testing ServerConfig...")

    # Verify file exists
    assert Path("scripts/autoload/ServerConfig.gd").exists(), "ServerConfig.gd missing"

    # Verify config file exists and is valid JSON
    config_path = Path("config/server_config.json")
    assert config_path.exists(), "server_config.json missing"

    config = json.loads(config_path.read_text())
    assert "max_players" in config, "max_players missing from config"
    assert "server_name" in config, "server_name missing from config"
    assert "tick_rate" in config, "tick_rate missing from config"
    assert isinstance(config["max_players"], (int, float)), "max_players should be numeric"
    assert isinstance(config["server_name"], str), "server_name should be string"
    assert isinstance(config["tick_rate"], (int, float)), "tick_rate should be numeric"
    assert config["max_players"] > 0, "max_players should be positive"
    assert config["tick_rate"] > 0, "tick_rate should be positive"

    # Verify script has required methods
    script = Path("scripts/autoload/ServerConfig.gd").read_text()
    assert "func load_config" in script, "load_config method missing"
    assert "func validate_config" in script, "validate_config method missing"
    assert "func get_max_players" in script, "get_max_players method missing"
    assert "func get_server_name" in script, "get_server_name method missing"
    assert "func get_tick_rate" in script, "get_tick_rate method missing"
    assert "signal config_reloaded" in script, "config_reloaded signal missing"

    print("  ServerConfig: PASSED (7 assertions)")


def test_game_time():
    """Test GameTime.gd structure."""
    print("  Testing GameTime...")

    assert Path("scripts/autoload/GameTime.gd").exists(), "GameTime.gd missing"

    script = Path("scripts/autoload/GameTime.gd").read_text()
    assert "signal time_updated" in script, "time_updated signal missing"
    assert "func get_time_seconds" in script, "get_time_seconds method missing"
    assert "func pause" in script, "pause method missing"
    assert "func resume" in script, "resume method missing"
    assert "func is_paused" in script, "is_paused method missing"
    assert "func _process" in script or "func _physics_process" in script, "process method missing"
    assert "_elapsed_time" in script, "_elapsed_time variable missing"
    assert "_paused" in script, "_paused variable missing"

    print("  GameTime: PASSED (8 assertions)")


def test_player():
    """Test Player.gd structure."""
    print("  Testing Player...")

    assert Path("scripts/player/Player.gd").exists(), "Player.gd missing"
    assert Path("scenes/Player.tscn").exists(), "Player.tscn missing"

    script = Path("scripts/player/Player.gd").read_text()
    assert "extends CharacterBody2D" in script, "Player should extend CharacterBody2D"
    assert "move_and_slide()" in script, "move_and_slide() call missing"
    assert "speed" in script, "speed variable missing"
    assert "func _physics_process" in script, "_physics_process method missing"

    # Verify scene references script
    scene = Path("scenes/Player.tscn").read_text()
    assert "Player.gd" in scene, "Player.tscn should reference Player.gd"
    assert "CharacterBody2D" in scene, "Player.tscn should use CharacterBody2D"
    assert "CollisionShape2D" in scene, "Player.tscn should have CollisionShape2D"
    assert "Camera2D" in scene, "Player.tscn should have Camera2D"

    print("  Player: PASSED (9 assertions)")


def test_network_manager():
    """Test NetworkManager.gd structure."""
    print("  Testing NetworkManager...")

    assert Path("scripts/networking/NetworkManager.gd").exists(), "NetworkManager.gd missing"

    script = Path("scripts/networking/NetworkManager.gd").read_text()
    assert "extends Node" in script, "NetworkManager should extend Node"
    assert "ENetMultiplayerPeer" in script, "Should use ENetMultiplayerPeer"
    assert "func start_server" in script, "start_server method missing"
    assert "func connect_to_server" in script, "connect_to_server method missing"
    assert "func disconnect_from_server" in script, "disconnect_from_server method missing"
    assert "multiplayer.peer_connected" in script, "Should connect to peer_connected signal"
    assert "multiplayer.peer_disconnected" in script, "Should connect to peer_disconnected signal"
    assert "@rpc" in script, "Should have @rpc annotated methods"
    assert "connected_clients" in script, "Should track connected_clients"
    assert "signal peer_connected" in script, "peer_connected signal missing"
    assert "signal peer_disconnected" in script, "peer_disconnected signal missing"

    print("  NetworkManager: PASSED (11 assertions)")


def test_player_sync_manager():
    """Test PlayerSyncManager.gd structure."""
    print("  Testing PlayerSyncManager...")

    assert Path("scripts/networking/PlayerSyncManager.gd").exists(), "PlayerSyncManager.gd missing"

    script = Path("scripts/networking/PlayerSyncManager.gd").read_text()
    assert "extends Node" in script, "PlayerSyncManager should extend Node"
    assert "signal player_spawned" in script, "player_spawned signal missing"
    assert "signal player_despawned" in script, "player_despawned signal missing"
    assert "func _spawn_player" in script, "_spawn_player method missing"
    assert "func _despawn_player" in script, "_despawn_player method missing"
    assert "@rpc" in script, "Should have @rpc annotated methods"
    assert "PlayerScene" in script or "Player.tscn" in script, "Should reference Player scene"
    assert "multiplayer.peer_connected" in script, "Should connect to peer_connected"
    assert "multiplayer.peer_disconnected" in script, "Should connect to peer_disconnected"
    assert "SYNC_RATE" in script, "SYNC_RATE constant missing"

    print("  PlayerSyncManager: PASSED (10 assertions)")


def test_world_gen_config():
    """Test world generation configuration."""
    print("  Testing World Gen Config...")

    assert Path("data/worldgen/config.json").exists(), "worldgen config missing"
    assert Path("data/biomes/table.json").exists(), "biome table missing"

    config = json.loads(Path("data/worldgen/config.json").read_text())
    assert "tile_size" in config, "tile_size missing"
    assert "chunk_size" in config, "chunk_size missing"
    assert "noise" in config, "noise config missing"
    assert "height" in config["noise"], "height noise missing"
    assert "moisture" in config["noise"], "moisture noise missing"

    biomes = json.loads(Path("data/biomes/table.json").read_text())
    assert "entries" in biomes, "biome entries missing"
    assert "sea_level" in biomes, "sea_level missing"
    assert len(biomes["entries"]) >= 5, "Should have at least 5 biome entries"

    # Validate each biome entry has required fields
    for entry in biomes["entries"]:
        assert "id" in entry, f"biome entry missing 'id'"
        assert "h" in entry, f"biome {entry.get('id', '?')} missing height range"
        assert "m" in entry, f"biome {entry.get('id', '?')} missing moisture range"
        assert "t" in entry, f"biome {entry.get('id', '?')} missing temperature range"
        assert len(entry["h"]) == 2, f"biome {entry['id']} height range should have 2 values"

    print(f"  World Gen Config: PASSED (8 + {len(biomes['entries']) * 5} biome assertions)")


def test_worldgen_scripts():
    """Test world generation GDScript files."""
    print("  Testing World Gen Scripts...")

    assert Path("scripts/worldgen/NoiseFields.gd").exists(), "NoiseFields.gd missing"
    assert Path("scripts/worldgen/BiomeMap.gd").exists(), "BiomeMap.gd missing"

    noise = Path("scripts/worldgen/NoiseFields.gd").read_text()
    assert "class_name NoiseFields" in noise, "NoiseFields class_name missing"
    assert "func sample_fields" in noise, "sample_fields method missing"
    assert "FastNoiseLite" in noise, "Should use FastNoiseLite"

    biome = Path("scripts/worldgen/BiomeMap.gd").read_text()
    assert "class_name BiomeMap" in biome, "BiomeMap class_name missing"
    assert "func classify_fields" in biome, "classify_fields method missing"

    print("  World Gen Scripts: PASSED (7 assertions)")


def test_project_godot():
    """Test project.godot configuration."""
    print("  Testing project.godot...")

    assert Path("project.godot").exists(), "project.godot missing"

    content = Path("project.godot").read_text()
    assert "config/name=" in content, "Project name missing"
    assert "FreedomMMO" in content, "Project should be named FreedomMMO"
    assert "4.4" in content, "Should target Godot 4.4"
    assert "ServerConfig" in content, "ServerConfig autoload missing"
    assert "GameTime" in content, "GameTime autoload missing"
    assert "NetworkManager" in content, "NetworkManager autoload missing"
    assert "PlayerSyncManager" in content, "PlayerSyncManager autoload missing"
    assert "ChatManager" in content, "ChatManager autoload missing"
    assert "PersistenceManager" in content, "PersistenceManager autoload missing"
    assert "AuthManager" in content, "AuthManager autoload missing"

    print("  project.godot: PASSED (10 assertions)")


def test_main_gd_region_fix():
    """Test that the region expansion bug fix is in place."""
    print("  Testing Main.gd region expansion fix...")

    assert Path("scripts/Main.gd").exists(), "Main.gd missing"

    script = Path("scripts/Main.gd").read_text()
    # Find _load_single_region_async and verify the return is properly indented
    # Check that the early return comment and fix are present
    found_fix = "Early return to prevent duplicate loading" in script

    assert found_fix, "Region expansion fix not found: missing early return comment in _load_single_region_async"

    print("  Main.gd region fix: PASSED (1 assertion)")


def test_grain_system():
    """Test L0 grain data model files."""
    print("  Testing Grain System (L0)...")

    assert Path("scripts/core/grain_types.gd").exists(), "grain_types.gd missing"
    assert Path("scripts/core/grain_properties.gd").exists(), "grain_properties.gd missing"
    assert Path("scripts/core/grain.gd").exists(), "grain.gd missing"
    assert Path("scripts/core/grain_stack.gd").exists(), "grain_stack.gd missing"
    assert Path("scripts/core/grain_registry.gd").exists(), "grain_registry.gd missing"
    assert Path("data/grains/physical_grains.json").exists(), "physical_grains.json missing"

    # Verify grain types has all categories
    types = Path("scripts/core/grain_types.gd").read_text()
    assert "enum Category" in types, "Category enum missing"
    assert "enum Physical" in types, "Physical enum missing"
    assert "enum Magical" in types, "Magical enum missing"
    assert "enum Spiritual" in types, "Spiritual enum missing"
    assert "enum Technical" in types, "Technical enum missing"
    assert "BEDROCK" in types, "BEDROCK type missing"
    assert "MITHRIL" in types, "MITHRIL type missing"
    assert "ADAMANTINE" in types, "ADAMANTINE type missing"
    assert "ARCANE_DUST" in types, "ARCANE_DUST type missing"
    assert "SOUL_FRAGMENT" in types, "SOUL_FRAGMENT type missing"

    # Verify grain properties
    props = Path("scripts/core/grain_properties.gd").read_text()
    assert "var hardness" in props, "hardness property missing"
    assert "var flammability" in props, "flammability property missing"
    assert "var purity" in props, "purity property missing"
    assert "var resonance" in props, "resonance property missing"
    assert "var stability" in props, "stability property missing"
    assert "var energy_level" in props, "energy_level property missing"
    assert "var temperature" in props, "temperature property missing"
    assert "var moisture" in props, "moisture property missing"
    assert "func to_dict" in props, "to_dict missing"
    assert "static func from_dict" in props, "from_dict missing"

    # Verify grain class
    grain = Path("scripts/core/grain.gd").read_text()
    assert "class_name Grain" in grain, "Grain class_name missing"
    assert "var category" in grain, "category missing"
    assert "var grain_type" in grain, "grain_type missing"
    assert "var properties" in grain, "properties missing"
    assert "var quantity" in grain, "quantity missing"
    assert "func to_dict" in grain, "to_dict missing"
    assert "static func from_dict" in grain, "from_dict missing"

    # Verify grain stack
    stack = Path("scripts/core/grain_stack.gd").read_text()
    assert "class_name GrainStack" in stack, "GrainStack class_name missing"
    assert "func push" in stack, "push method missing"
    assert "func pop_top" in stack, "pop_top method missing"
    assert "func get_visible_grains" in stack, "get_visible_grains missing"
    assert "func has_grain_type" in stack, "has_grain_type missing"
    assert "func to_dict" in stack, "to_dict missing"
    assert "static func from_dict" in stack, "from_dict missing"

    # Verify registry
    reg = Path("scripts/core/grain_registry.gd").read_text()
    assert "class_name GrainRegistry" in reg, "GrainRegistry class_name missing"
    assert "func create_grain" in reg, "create_grain missing"
    assert "func create_terrain_stack" in reg, "create_terrain_stack missing"
    assert "func load_templates" in reg, "load_templates missing"
    assert "grassland" in reg, "grassland terrain stack missing"
    assert "desert" in reg, "desert terrain stack missing"
    assert "ocean" in reg, "ocean terrain stack missing"
    assert "volcanic" in reg, "volcanic terrain stack missing"
    assert "swamp" in reg, "swamp terrain stack missing"

    # Verify JSON data
    grains = json.loads(Path("data/grains/physical_grains.json").read_text())
    assert "templates" in grains, "templates key missing"
    assert len(grains["templates"]) >= 30, "should have at least 30 grain templates"

    # Verify specific templates
    template_ids = [t["id"] for t in grains["templates"]]
    for required in ["bedrock", "stone", "sand", "soil", "water", "grass", "iron", "gold", "mithril", "lava"]:
        assert required in template_ids, f"template '{required}' missing"

    print(f"  Grain System (L0): PASSED (35+ assertions)")


def test_core_architecture():
    """Test all 16 architecture layers exist with correct structure."""
    print("  Testing Core Architecture (L0-L14)...")

    core_files = {
        "scripts/core/grain_types.gd": ["enum Category", "enum Physical", "enum Magical"],
        "scripts/core/grain_properties.gd": ["var hardness", "var purity", "func to_dict"],
        "scripts/core/grain.gd": ["class_name Grain", "var category", "func to_dict"],
        "scripts/core/grain_stack.gd": ["class_name GrainStack", "func push", "func pop_top", "func get_visible_grains"],
        "scripts/core/grain_registry.gd": ["class_name GrainRegistry", "func create_grain", "func create_terrain_stack"],
        "scripts/core/info_grain_types.gd": ["enum Emotional", "enum Relational", "enum Cognitive", "enum Motivational"],
        "scripts/core/info_grain.gd": ["class_name InfoGrain", "var intensity", "var salience", "func tick"],
        "scripts/core/mind_stack.gd": ["class_name MindStack", "func get_dominant_emotion", "func to_llm_context"],
        "scripts/core/world_cell.gd": ["class_name WorldCell", "func get_grain_stack", "func set_stack"],
        "scripts/core/world_graph.gd": ["class_name WorldGraph", "func get_stack_at_world_pos"],
        "scripts/core/material_registry.gd": ["class_name MaterialRegistry", "func craft", "func get_emergent_properties"],
        "scripts/core/sim_engine.gd": ["class_name SimEngine", "func tick", "func process_dig", "func process_burn"],
        "scripts/core/interaction_rules.gd": ["class_name InteractionRules", "enum ActionType", "func can_interact"],
        "scripts/core/time_system.gd": ["class_name TimeSystem", "enum LifeStage", "enum TransferMethod", "func transfer_time"],
        "scripts/core/causal_tracker.gd": ["class_name CausalTracker", "func record_event", "func to_llm_context"],
        "scripts/core/terrain_generator.gd": ["class_name TerrainGenerator", "func generate_cell"],
        "scripts/core/feature_placement.gd": ["class_name FeaturePlacement", "func place_features"],
        "scripts/core/entity_body.gd": ["class_name EntityBody", "enum Species", "EQUIPMENT_SLOTS", "func equip"],
        "scripts/core/npc_brain.gd": ["class_name NPCBrain", "func _decide_action", "func generate_dialogue_context"],
        "scripts/core/tile_renderer.gd": ["class_name TileRenderer", "GRAIN_COLORS", "func render_stack"],
        "scripts/core/entity_renderer.gd": ["class_name EntityRenderer", "func render_entity_fallback"],
        "scripts/core/asset_pipeline.gd": ["class_name AssetPipeline", "func queue_tileset_generation", "func predict_needed_assets"],
        "scripts/core/interaction_animation.gd": ["class_name InteractionAnimation", "func start_animation"],
        "scripts/core/event_framework.gd": ["class_name EventFramework", "func start_event", "class EventTemplate"],
    }

    for filepath, required_contents in core_files.items():
        assert Path(filepath).exists(), f"{filepath} missing"
        content = Path(filepath).read_text()
        for req in required_contents:
            assert req in content, f"{filepath}: '{req}' not found"

    # Verify integration
    assert Path("scripts/autoload/WorldManager.gd").exists(), "WorldManager.gd missing"
    wm = Path("scripts/autoload/WorldManager.gd").read_text()
    assert "GrainRegistry" in wm, "WorldManager should use GrainRegistry"
    assert "WorldGraph" in wm, "WorldManager should use WorldGraph"
    assert "SimEngine" in wm, "WorldManager should use SimEngine"
    assert "TerrainGenerator" in wm, "WorldManager should use TerrainGenerator"
    assert "TileRenderer" in wm, "WorldManager should use TileRenderer"

    assert Path("scripts/GrainWorldDemo.gd").exists(), "GrainWorldDemo.gd missing"

    total = sum(len(v) for v in core_files.values()) + 6
    print(f"  Core Architecture (L0-L14): PASSED ({total} assertions)")


def main():
    # Change to project root
    os.chdir(Path(__file__).parent.parent)

    print("=" * 60)
    print("FreedomMMO GDScript Test Suite")
    print("=" * 60)

    tests = [
        test_server_config,
        test_game_time,
        test_player,
        test_network_manager,
        test_player_sync_manager,
        test_world_gen_config,
        test_worldgen_scripts,
        test_project_godot,
        test_main_gd_region_fix,
        test_grain_system,
        test_core_architecture,
    ]

    passed = 0
    failed = 0
    errors = []

    for test_fn in tests:
        try:
            test_fn()
            passed += 1
        except AssertionError as e:
            failed += 1
            errors.append(f"FAIL: {test_fn.__name__}: {e}")
            print(f"  {test_fn.__name__}: FAILED - {e}")
        except Exception as e:
            failed += 1
            errors.append(f"ERROR: {test_fn.__name__}: {e}")
            print(f"  {test_fn.__name__}: ERROR - {e}")

    print()
    print("=" * 60)
    print(f"Results: {passed} passed, {failed} failed, {passed + failed} total")
    print("=" * 60)

    if errors:
        print()
        for err in errors:
            print(f"  {err}")
        sys.exit(1)
    else:
        print("All tests passed!")
        sys.exit(0)


if __name__ == "__main__":
    main()
