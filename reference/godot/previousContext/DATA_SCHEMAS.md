# Data Schema & Validation System

## Schema Architecture

### Versioned JSON + Protobuf Hybrid Approach

**Strategy:**
- **JSON for Configuration:** Human-readable, version-controlled, hot-reloadable
- **Protobuf for Runtime:** Binary efficiency for network/database serialization
- **Schema Validation:** Python tools ensure data integrity before deployment

---

## Core Schema Definitions

### 1. Items Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Items Database",
  "type": "object",
  "properties": {
    "version": {
      "type": "string",
      "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$",
      "description": "Semantic version for schema compatibility"
    },
    "items": {
      "type": "object",
      "patternProperties": {
        "^[a-z0-9_]+$": {
          "$ref": "#/definitions/Item"
        }
      }
    }
  },
  "definitions": {
    "Item": {
      "type": "object",
      "required": ["id", "name", "type", "stats"],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z0-9_]+$",
          "description": "Unique identifier"
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 50
        },
        "type": {
          "enum": ["weapon", "armor", "consumable", "material", "quest"]
        },
        "stats": {
          "$ref": "#/definitions/ItemStats"
        },
        "requirements": {
          "$ref": "#/definitions/Requirements"
        },
        "sprite": {
          "type": "string",
          "pattern": "^[a-zA-Z0-9_/]+\\.(png|webp)$"
        },
        "rarity": {
          "enum": ["common", "uncommon", "rare", "epic", "legendary"],
          "default": "common"
        }
      }
    },
    "ItemStats": {
      "type": "object",
      "properties": {
        "damage": {"type": "integer", "minimum": 0, "maximum": 1000},
        "defense": {"type": "integer", "minimum": 0, "maximum": 1000}, 
        "speed": {"type": "number", "minimum": 0.1, "maximum": 10.0},
        "durability": {"type": "integer", "minimum": 1, "maximum": 1000}
      }
    },
    "Requirements": {
      "type": "object",
      "properties": {
        "level": {"type": "integer", "minimum": 1, "maximum": 100},
        "strength": {"type": "integer", "minimum": 1, "maximum": 100},
        "dexterity": {"type": "integer", "minimum": 1, "maximum": 100}
      }
    }
  }
}
```

**Example Item Data:**
```json
{
  "version": "1.0.0",
  "items": {
    "iron_sword": {
      "id": "iron_sword",
      "name": "Iron Sword",
      "type": "weapon",
      "stats": {
        "damage": 25,
        "speed": 1.2,
        "durability": 100
      },
      "requirements": {
        "level": 5,
        "strength": 15
      },
      "sprite": "weapons/iron_sword.png",
      "rarity": "common"
    },
    "health_potion": {
      "id": "health_potion",
      "name": "Health Potion",
      "type": "consumable",
      "stats": {
        "heal_amount": 50
      },
      "sprite": "consumables/health_potion.png",
      "rarity": "common"
    }
  }
}
```

### 2. Abilities Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Abilities Database",
  "type": "object",
  "properties": {
    "version": {"type": "string"},
    "abilities": {
      "type": "object",
      "patternProperties": {
        "^[a-z0-9_]+$": {
          "$ref": "#/definitions/Ability"
        }
      }
    }
  },
  "definitions": {
    "Ability": {
      "type": "object",
      "required": ["id", "name", "type", "cooldown", "effects"],
      "properties": {
        "id": {"type": "string"},
        "name": {"type": "string"},
        "type": {
          "enum": ["attack", "defense", "utility", "passive"]
        },
        "cooldown": {
          "type": "number",
          "minimum": 0,
          "maximum": 300
        },
        "cost": {
          "$ref": "#/definitions/ResourceCost"
        },
        "effects": {
          "type": "array",
          "items": {"$ref": "#/definitions/Effect"}
        },
        "animation": {
          "type": "string",
          "pattern": "^[a-z0-9_]+$"
        }
      }
    },
    "ResourceCost": {
      "type": "object",
      "properties": {
        "stamina": {"type": "integer", "minimum": 0},
        "mana": {"type": "integer", "minimum": 0}
      }
    },
    "Effect": {
      "type": "object",
      "required": ["type", "value"],
      "properties": {
        "type": {
          "enum": ["damage", "heal", "buff", "debuff", "knockback"]
        },
        "value": {"type": "number"},
        "duration": {"type": "number", "minimum": 0},
        "range": {"type": "number", "minimum": 0}
      }
    }
  }
}
```

### 3. Enemies Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Enemies Database",
  "type": "object",
  "properties": {
    "version": {"type": "string"},
    "enemies": {
      "type": "object",
      "patternProperties": {
        "^[a-z0-9_]+$": {
          "$ref": "#/definitions/Enemy"
        }
      }
    }
  },
  "definitions": {
    "Enemy": {
      "type": "object",
      "required": ["id", "name", "stats", "behavior", "loot_table"],
      "properties": {
        "id": {"type": "string"},
        "name": {"type": "string"},
        "stats": {
          "$ref": "#/definitions/EnemyStats"
        },
        "behavior": {
          "$ref": "#/definitions/AIBehavior"
        },
        "loot_table": {
          "$ref": "#/definitions/LootTable"
        },
        "sprite": {"type": "string"},
        "experience_reward": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        }
      }
    },
    "EnemyStats": {
      "type": "object",
      "required": ["health", "damage", "speed"],
      "properties": {
        "health": {"type": "integer", "minimum": 1, "maximum": 10000},
        "damage": {"type": "integer", "minimum": 1, "maximum": 1000},
        "speed": {"type": "number", "minimum": 0.1, "maximum": 10.0},
        "defense": {"type": "integer", "minimum": 0, "maximum": 1000}
      }
    },
    "AIBehavior": {
      "type": "object",
      "properties": {
        "aggression": {
          "type": "number",
          "minimum": 0.0,
          "maximum": 1.0
        },
        "detection_range": {
          "type": "number",
          "minimum": 1.0,
          "maximum": 50.0
        },
        "attack_range": {
          "type": "number", 
          "minimum": 0.5,
          "maximum": 10.0
        },
        "patrol_radius": {
          "type": "number",
          "minimum": 0.0,
          "maximum": 20.0
        }
      }
    },
    "LootTable": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/LootEntry"
      }
    },
    "LootEntry": {
      "type": "object",
      "required": ["item_id", "chance"],
      "properties": {
        "item_id": {
          "type": "string",
          "pattern": "^[a-z0-9_]+$"
        },
        "chance": {
          "type": "number",
          "minimum": 0.0,
          "maximum": 1.0
        },
        "quantity": {
          "type": "object",
          "properties": {
            "min": {"type": "integer", "minimum": 1},
            "max": {"type": "integer", "minimum": 1}
          }
        }
      }
    }
  }
}
```

### 4. World Cells Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "World Cells Database",
  "type": "object",
  "properties": {
    "version": {"type": "string"},
    "cells": {
      "type": "object",
      "patternProperties": {
        "^[a-z0-9_]+$": {
          "$ref": "#/definitions/WorldCell"
        }
      }
    }
  },
  "definitions": {
    "WorldCell": {
      "type": "object",
      "required": ["id", "bounds", "biome", "spawners"],
      "properties": {
        "id": {"type": "string"},
        "bounds": {
          "$ref": "#/definitions/Bounds"
        },
        "biome": {
          "enum": ["forest", "desert", "mountain", "ocean", "tundra", "swamp"]
        },
        "spawners": {
          "type": "array",
          "items": {"$ref": "#/definitions/Spawner"}
        },
        "terrain_features": {
          "type": "array",
          "items": {"$ref": "#/definitions/TerrainFeature"}
        },
        "max_players": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50,
          "default": 25
        }
      }
    },
    "Bounds": {
      "type": "object",
      "required": ["x", "y", "width", "height"],
      "properties": {
        "x": {"type": "number"},
        "y": {"type": "number"},
        "width": {"type": "number", "minimum": 1},
        "height": {"type": "number", "minimum": 1}
      }
    },
    "Spawner": {
      "type": "object",
      "required": ["enemy_id", "position", "spawn_rate"],
      "properties": {
        "enemy_id": {"type": "string"},
        "position": {
          "$ref": "#/definitions/Position"
        },
        "spawn_rate": {
          "type": "number",
          "minimum": 0.1,
          "maximum": 60.0,
          "description": "Spawns per minute"
        },
        "max_count": {
          "type": "integer",
          "minimum": 1,
          "maximum": 20,
          "default": 3
        }
      }
    },
    "Position": {
      "type": "object",
      "required": ["x", "y"],
      "properties": {
        "x": {"type": "number"},
        "y": {"type": "number"},
        "z": {"type": "number", "default": 0}
      }
    },
    "TerrainFeature": {
      "type": "object",
      "required": ["type", "position"],
      "properties": {
        "type": {
          "enum": ["tree", "rock", "building", "water", "bridge"]
        },
        "position": {"$ref": "#/definitions/Position"},
        "rotation": {"type": "number", "minimum": 0, "maximum": 360},
        "scale": {"type": "number", "minimum": 0.1, "maximum": 5.0}
      }
    }
  }
}
```

### 5. Dialogue Trees Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Dialogue Database",
  "type": "object",
  "properties": {
    "version": {"type": "string"},
    "dialogues": {
      "type": "object",
      "patternProperties": {
        "^[a-z0-9_]+$": {
          "$ref": "#/definitions/DialogueTree"
        }
      }
    }
  },
  "definitions": {
    "DialogueTree": {
      "type": "object",
      "required": ["id", "name", "root_node"],
      "properties": {
        "id": {"type": "string"},
        "name": {"type": "string"},
        "root_node": {"type": "string"},
        "nodes": {
          "type": "object",
          "patternProperties": {
            "^[a-z0-9_]+$": {
              "$ref": "#/definitions/DialogueNode"
            }
          }
        }
      }
    },
    "DialogueNode": {
      "type": "object",
      "required": ["id", "text"],
      "properties": {
        "id": {"type": "string"},
        "text": {"type": "string"},
        "speaker": {"type": "string"},
        "choices": {
          "type": "array",
          "items": {"$ref": "#/definitions/DialogueChoice"}
        },
        "conditions": {
          "type": "array",
          "items": {"$ref": "#/definitions/Condition"}
        },
        "actions": {
          "type": "array",
          "items": {"$ref": "#/definitions/Action"}
        }
      }
    },
    "DialogueChoice": {
      "type": "object",
      "required": ["text", "next_node"],
      "properties": {
        "text": {"type": "string"},
        "next_node": {"type": "string"},
        "conditions": {
          "type": "array",
          "items": {"$ref": "#/definitions/Condition"}
        }
      }
    },
    "Condition": {
      "type": "object",
      "required": ["type", "value"],
      "properties": {
        "type": {
          "enum": ["has_item", "level_min", "quest_completed", "flag_set"]
        },
        "value": {},
        "operator": {
          "enum": ["equals", "greater", "less", "contains"],
          "default": "equals"
        }
      }
    },
    "Action": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": {
          "enum": ["give_item", "give_experience", "set_flag", "start_quest"]
        },
        "value": {}
      }
    }
  }
}
```

---

## Python Validation System

### Schema Validator Tool

```python
#!/usr/bin/env python3
"""
Content validation system for Freedom MMORPG data files.
Validates JSON schemas, cross-references, and game balance.
"""

import json
import jsonschema
from pathlib import Path
from typing import Dict, List, Set, Any
from dataclasses import dataclass
import argparse

@dataclass
class ValidationResult:
    """Result of validation check."""
    is_valid: bool
    errors: List[str]
    warnings: List[str]

class SchemaValidator:
    """Validates game data against JSON schemas."""
    
    def __init__(self, schema_dir: Path, data_dir: Path):
        self.schema_dir = schema_dir
        self.data_dir = data_dir
        self.schemas = self._load_schemas()
        
    def _load_schemas(self) -> Dict[str, dict]:
        """Load all JSON schemas."""
        schemas = {}
        for schema_file in self.schema_dir.glob("*.json"):
            with open(schema_file) as f:
                schemas[schema_file.stem] = json.load(f)
        return schemas
    
    def validate_file(self, data_file: Path) -> ValidationResult:
        """Validate a single data file against its schema."""
        errors = []
        warnings = []
        
        try:
            with open(data_file) as f:
                data = json.load(f)
            
            # Determine schema based on filename or content
            schema_name = self._get_schema_name(data_file)
            if schema_name not in self.schemas:
                errors.append(f"No schema found for {schema_name}")
                return ValidationResult(False, errors, warnings)
            
            schema = self.schemas[schema_name]
            
            # Validate against JSON schema
            try:
                jsonschema.validate(data, schema)
            except jsonschema.ValidationError as e:
                errors.append(f"Schema validation failed: {e.message}")
            
        except json.JSONDecodeError as e:
            errors.append(f"Invalid JSON: {e}")
        except Exception as e:
            errors.append(f"Validation error: {e}")
        
        return ValidationResult(len(errors) == 0, errors, warnings)
    
    def _get_schema_name(self, data_file: Path) -> str:
        """Determine schema name from file path."""
        # Map data files to schema names
        mapping = {
            "items": "items_schema",
            "abilities": "abilities_schema", 
            "enemies": "enemies_schema",
            "world": "world_schema",
            "dialogue": "dialogue_schema"
        }
        
        for key, schema_name in mapping.items():
            if key in data_file.name:
                return schema_name
        
        return data_file.stem + "_schema"

class ReferenceChecker:
    """Validates cross-references between data files."""
    
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.data_cache = self._load_all_data()
    
    def _load_all_data(self) -> Dict[str, dict]:
        """Load all data files into memory."""
        cache = {}
        for data_file in self.data_dir.glob("**/*.json"):
            with open(data_file) as f:
                cache[data_file.stem] = json.load(f)
        return cache
    
    def check_references(self) -> ValidationResult:
        """Check all cross-references are valid."""
        errors = []
        warnings = []
        
        # Check item references in enemy loot tables
        self._check_enemy_loot_references(errors)
        
        # Check ability references in enemy behaviors
        self._check_ability_references(errors)
        
        # Check spawner references in world cells
        self._check_spawner_references(errors)
        
        # Check dialogue references
        self._check_dialogue_references(errors)
        
        return ValidationResult(len(errors) == 0, errors, warnings)
    
    def _check_enemy_loot_references(self, errors: List[str]):
        """Validate enemy loot table item references."""
        if "enemies" not in self.data_cache or "items" not in self.data_cache:
            return
        
        enemy_data = self.data_cache["enemies"]
        item_data = self.data_cache["items"]
        
        valid_item_ids = set(item_data.get("items", {}).keys())
        
        for enemy_id, enemy in enemy_data.get("enemies", {}).items():
            loot_table = enemy.get("loot_table", [])
            for loot_entry in loot_table:
                item_id = loot_entry.get("item_id")
                if item_id and item_id not in valid_item_ids:
                    errors.append(f"Enemy '{enemy_id}' references invalid item '{item_id}'")
    
    def _check_spawner_references(self, errors: List[str]):
        """Validate world cell spawner enemy references."""
        if "world" not in self.data_cache or "enemies" not in self.data_cache:
            return
        
        world_data = self.data_cache["world"]
        enemy_data = self.data_cache["enemies"]
        
        valid_enemy_ids = set(enemy_data.get("enemies", {}).keys())
        
        for cell_id, cell in world_data.get("cells", {}).items():
            spawners = cell.get("spawners", [])
            for spawner in spawners:
                enemy_id = spawner.get("enemy_id")
                if enemy_id and enemy_id not in valid_enemy_ids:
                    errors.append(f"Cell '{cell_id}' references invalid enemy '{enemy_id}'")

class BalanceChecker:
    """Validates game balance and constraints."""
    
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.data_cache = self._load_all_data()
    
    def _load_all_data(self) -> Dict[str, dict]:
        """Load all data files."""
        cache = {}
        for data_file in self.data_dir.glob("**/*.json"):
            with open(data_file) as f:
                cache[data_file.stem] = json.load(f)
        return cache
    
    def check_balance(self) -> ValidationResult:
        """Check game balance constraints."""
        errors = []
        warnings = []
        
        # Check loot table probabilities sum to reasonable values
        self._check_loot_probabilities(errors, warnings)
        
        # Check damage/health ratios
        self._check_combat_balance(errors, warnings)
        
        # Check spawn rates don't overwhelm players
        self._check_spawn_rates(errors, warnings)
        
        return ValidationResult(len(errors) == 0, errors, warnings)
    
    def _check_loot_probabilities(self, errors: List[str], warnings: List[str]):
        """Validate loot table probabilities."""
        if "enemies" not in self.data_cache:
            return
        
        for enemy_id, enemy in self.data_cache["enemies"].get("enemies", {}).items():
            loot_table = enemy.get("loot_table", [])
            total_probability = sum(entry.get("chance", 0) for entry in loot_table)
            
            if total_probability > 1.0:
                errors.append(f"Enemy '{enemy_id}' loot table probability exceeds 1.0: {total_probability}")
            elif total_probability < 0.1:
                warnings.append(f"Enemy '{enemy_id}' has very low loot probability: {total_probability}")
    
    def _check_combat_balance(self, errors: List[str], warnings: List[str]):
        """Check combat balance between enemies and player capabilities."""
        if "enemies" not in self.data_cache:
            return
        
        # Assume player has roughly 100 HP and 20 damage at level 1
        base_player_hp = 100
        base_player_damage = 20
        
        for enemy_id, enemy in self.data_cache["enemies"].get("enemies", {}).items():
            stats = enemy.get("stats", {})
            enemy_hp = stats.get("health", 0)
            enemy_damage = stats.get("damage", 0)
            
            # Check if enemy can one-shot player (bad)
            if enemy_damage >= base_player_hp:
                errors.append(f"Enemy '{enemy_id}' can one-shot player (damage: {enemy_damage})")
            
            # Check if enemy takes too long to kill (boring)
            hits_to_kill = enemy_hp / base_player_damage
            if hits_to_kill > 20:
                warnings.append(f"Enemy '{enemy_id}' may be too tanky ({hits_to_kill:.1f} hits to kill)")

def main():
    parser = argparse.ArgumentParser(description="Validate Freedom MMORPG data files")
    parser.add_argument("--data-dir", type=Path, default="data", help="Data directory")
    parser.add_argument("--schema-dir", type=Path, default="data/schemas", help="Schema directory")
    parser.add_argument("--check-refs", action="store_true", help="Check cross-references")
    parser.add_argument("--check-balance", action="store_true", help="Check game balance")
    args = parser.parse_args()
    
    total_errors = 0
    total_warnings = 0
    
    # Schema validation
    validator = SchemaValidator(args.schema_dir, args.data_dir)
    print("🔍 Validating schemas...")
    
    for data_file in args.data_dir.glob("**/*.json"):
        if "schemas" in str(data_file):
            continue  # Skip schema files themselves
        
        result = validator.validate_file(data_file)
        if result.errors:
            print(f"❌ {data_file}: {len(result.errors)} errors")
            for error in result.errors:
                print(f"   {error}")
            total_errors += len(result.errors)
        else:
            print(f"✅ {data_file}: Valid")
        
        total_warnings += len(result.warnings)
        for warning in result.warnings:
            print(f"⚠️  {warning}")
    
    # Reference checking
    if args.check_refs:
        print("\n🔗 Checking references...")
        ref_checker = ReferenceChecker(args.data_dir)
        ref_result = ref_checker.check_references()
        
        if ref_result.errors:
            print(f"❌ Reference errors: {len(ref_result.errors)}")
            for error in ref_result.errors:
                print(f"   {error}")
            total_errors += len(ref_result.errors)
        else:
            print("✅ All references valid")
    
    # Balance checking
    if args.check_balance:
        print("\n⚖️  Checking balance...")
        balance_checker = BalanceChecker(args.data_dir)
        balance_result = balance_checker.check_balance()
        
        if balance_result.errors:
            print(f"❌ Balance errors: {len(balance_result.errors)}")
            for error in balance_result.errors:
                print(f"   {error}")
            total_errors += len(balance_result.errors)
        
        total_warnings += len(balance_result.warnings)
        for warning in balance_result.warnings:
            print(f"⚠️  {warning}")
    
    # Summary
    print(f"\n📊 Summary: {total_errors} errors, {total_warnings} warnings")
    
    if total_errors > 0:
        print("❌ Validation failed")
        exit(1)
    else:
        print("✅ Validation passed")

if __name__ == "__main__":
    main()
```

---

## Engine Integration & Hot-Reload

### Unity Data Importer

```csharp
// Tools/DataImporter.cs
using UnityEngine;
using UnityEditor;
using System.IO;
using Newtonsoft.Json;

public class DataImporter : AssetPostprocessor
{
    private static void OnPostprocessAllAssets(
        string[] importedAssets,
        string[] deletedAssets, 
        string[] movedAssets,
        string[] movedFromAssetPaths)
    {
        foreach (string asset in importedAssets)
        {
            if (asset.StartsWith("Assets/Data/") && asset.EndsWith(".json"))
            {
                ProcessDataFile(asset);
            }
        }
    }
    
    private static void ProcessDataFile(string assetPath)
    {
        string jsonContent = File.ReadAllText(assetPath);
        
        if (assetPath.Contains("items"))
        {
            var itemData = JsonConvert.DeserializeObject<ItemDatabase>(jsonContent);
            CreateScriptableObject(itemData, "ItemDatabase");
        }
        else if (assetPath.Contains("enemies"))
        {
            var enemyData = JsonConvert.DeserializeObject<EnemyDatabase>(jsonContent);
            CreateScriptableObject(enemyData, "EnemyDatabase");
        }
        // Handle other data types...
    }
    
    private static void CreateScriptableObject<T>(T data, string typeName) where T : class
    {
        var scriptableObject = ScriptableObject.CreateInstance<DataContainer<T>>();
        scriptableObject.Data = data;
        
        string outputPath = $"Assets/GeneratedData/{typeName}.asset";
        AssetDatabase.CreateAsset(scriptableObject, outputPath);
        AssetDatabase.SaveAssets();
        
        Debug.Log($"✅ Generated {typeName} from JSON data");
    }
}

[System.Serializable]
public class DataContainer<T> : ScriptableObject where T : class
{
    public T Data;
}
```

### Server-Side Hot Reload

```csharp
// Server/DataManager.cs
using System.IO;
using Microsoft.Extensions.Hosting;
using Newtonsoft.Json;

public class DataManager : BackgroundService
{
    private readonly ILogger<DataManager> _logger;
    private readonly FileSystemWatcher _watcher;
    private readonly string _dataDirectory;
    
    public ItemDatabase Items { get; private set; }
    public EnemyDatabase Enemies { get; private set; }
    public WorldDatabase World { get; private set; }
    
    public event Action<string> OnDataReloaded;
    
    public DataManager(ILogger<DataManager> logger)
    {
        _logger = logger;
        _dataDirectory = Path.Combine(Environment.CurrentDirectory, "data");
        
        // Set up file watcher for hot reload
        _watcher = new FileSystemWatcher(_dataDirectory, "*.json")
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.CreationTime
        };
        
        _watcher.Changed += OnDataFileChanged;
        _watcher.EnableRaisingEvents = true;
        
        // Initial load
        LoadAllData();
    }
    
    private void OnDataFileChanged(object sender, FileSystemEventArgs e)
    {
        // Debounce file changes
        Task.Delay(1000).ContinueWith(_ => ReloadDataFile(e.FullPath));
    }
    
    private void ReloadDataFile(string filePath)
    {
        try
        {
            string fileName = Path.GetFileNameWithoutExtension(filePath);
            string content = File.ReadAllText(filePath);
            
            switch (fileName)
            {
                case "items":
                    Items = JsonConvert.DeserializeObject<ItemDatabase>(content);
                    _logger.LogInformation("🔄 Reloaded items database");
                    break;
                case "enemies":
                    Enemies = JsonConvert.DeserializeObject<EnemyDatabase>(content);
                    _logger.LogInformation("🔄 Reloaded enemies database");
                    break;
                case "world":
                    World = JsonConvert.DeserializeObject<WorldDatabase>(content);
                    _logger.LogInformation("🔄 Reloaded world database");
                    break;
            }
            
            OnDataReloaded?.Invoke(fileName);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Failed to reload data file: {FilePath}", filePath);
        }
    }
    
    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        return Task.CompletedTask;
    }
    
    private void LoadAllData()
    {
        // Load all data files on startup
        ReloadDataFile(Path.Combine(_dataDirectory, "items.json"));
        ReloadDataFile(Path.Combine(_dataDirectory, "enemies.json"));
        ReloadDataFile(Path.Combine(_dataDirectory, "world.json"));
    }
}
```

---

## Example Dataset

### Sample Items Data

```json
{
  "version": "1.0.0",
  "items": {
    "wooden_sword": {
      "id": "wooden_sword",
      "name": "Wooden Sword",
      "type": "weapon",
      "stats": {
        "damage": 10,
        "speed": 1.0,
        "durability": 50
      },
      "requirements": {
        "level": 1
      },
      "sprite": "weapons/wooden_sword.png",
      "rarity": "common"
    },
    "iron_sword": {
      "id": "iron_sword", 
      "name": "Iron Sword",
      "type": "weapon",
      "stats": {
        "damage": 25,
        "speed": 1.2,
        "durability": 100
      },
      "requirements": {
        "level": 5,
        "strength": 15
      },
      "sprite": "weapons/iron_sword.png",
      "rarity": "common"
    },
    "leather_armor": {
      "id": "leather_armor",
      "name": "Leather Armor", 
      "type": "armor",
      "stats": {
        "defense": 15,
        "durability": 80
      },
      "requirements": {
        "level": 3
      },
      "sprite": "armor/leather_armor.png",
      "rarity": "common"
    },
    "health_potion": {
      "id": "health_potion",
      "name": "Health Potion",
      "type": "consumable",
      "stats": {
        "heal_amount": 50
      },
      "sprite": "consumables/health_potion.png",
      "rarity": "common"
    }
  }
}
```

### Sample Enemies Data

```json
{
  "version": "1.0.0",
  "enemies": {
    "forest_goblin": {
      "id": "forest_goblin",
      "name": "Forest Goblin",
      "stats": {
        "health": 50,
        "damage": 15,
        "speed": 2.0,
        "defense": 5
      },
      "behavior": {
        "aggression": 0.8,
        "detection_range": 10.0,
        "attack_range": 2.0,
        "patrol_radius": 5.0
      },
      "loot_table": [
        {
          "item_id": "copper_coin",
          "chance": 0.8,
          "quantity": {"min": 1, "max": 3}
        },
        {
          "item_id": "health_potion", 
          "chance": 0.15
        },
        {
          "item_id": "wooden_sword",
          "chance": 0.05
        }
      ],
      "sprite": "enemies/forest_goblin.png",
      "experience_reward": 25
    }
  }
}
```

---

## Build Integration

### Makefile for Validation

```makefile
# Makefile for data validation and build pipeline

.PHONY: validate-data build-server build-client deploy

# Data validation
validate-data:
	@echo "🔍 Validating game data..."
	python tools/content_validation/schema_validator.py \
		--data-dir data \
		--schema-dir data/schemas \
		--check-refs \
		--check-balance

# Server build with data validation
build-server: validate-data
	@echo "🏗️ Building server..."
	cd server && dotnet build --configuration Release
	
# Client build with data import
build-client: validate-data
	@echo "🎮 Building client..."
	# Unity command line build would go here
	
# Full deployment
deploy: build-server build-client
	@echo "🚀 Deploying..."
	docker-compose up -d

# Development workflow
dev: validate-data
	@echo "🔧 Starting development environment..."
	docker-compose -f docker-compose.dev.yml up
```

---

**Next Document:** Local & cloud DevOps runbook with deployment automation.
