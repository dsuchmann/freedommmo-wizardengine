extends Control

signal item_crafted(recipe_id: String, result: Dictionary)

var _panel: Panel
var _title_label: Label
var _recipe_list: ItemList
var _craft_button: Button
var _info_label: RichTextLabel
var _recipes: Array = []

func _ready() -> void:
	visible = false
	_build_ui()
	_load_recipes()

## Keybind handled by GrainWorldDemo (KEY_K)

func _build_ui() -> void:
	_panel = Panel.new()
	_panel.size = Vector2(350, 300)
	_panel.position = Vector2(780, 20)
	add_child(_panel)

	_title_label = Label.new()
	_title_label.text = "Crafting"
	_title_label.position = Vector2(8, 4)
	_title_label.add_theme_font_size_override("font_size", 14)
	_panel.add_child(_title_label)

	_recipe_list = ItemList.new()
	_recipe_list.position = Vector2(8, 28)
	_recipe_list.size = Vector2(160, 230)
	_recipe_list.item_selected.connect(_on_recipe_selected)
	_panel.add_child(_recipe_list)

	_info_label = RichTextLabel.new()
	_info_label.position = Vector2(176, 28)
	_info_label.size = Vector2(166, 200)
	_info_label.bbcode_enabled = true
	_panel.add_child(_info_label)

	_craft_button = Button.new()
	_craft_button.text = "Craft"
	_craft_button.position = Vector2(176, 240)
	_craft_button.size = Vector2(166, 28)
	_craft_button.pressed.connect(_on_craft_pressed)
	_panel.add_child(_craft_button)

	_add_experiment_button()

func _load_recipes() -> void:
	# Pull recipes from ItemSystem if available
	if WorldManager and WorldManager.item_system:
		var real_recipes = WorldManager.item_system.get_recipes()
		for r in real_recipes:
			var mats = r.get("materials", {})
			var mat_str = ""
			for mat in mats:
				mat_str += "%dx %s + " % [mats[mat], mat.capitalize()]
			mat_str = mat_str.trim_suffix(" + ")
			_recipes.append({
				"id": r["name"].to_lower().replace(" ", "_"),
				"name": r["name"],
				"inputs": mat_str,
				"description": "Requires %s skill (level %d)" % [r.get("skill", "crafting"), r.get("level", 1)],
				"requires": r.get("skill", "crafting").capitalize(),
				"real_recipe": r,
			})
	else:
		_recipes = [
			{"id": "torch", "name": "Torch", "inputs": "1x Wood + 1x Coal", "description": "Provides light", "requires": "None"},
		]
	for recipe in _recipes:
		_recipe_list.add_item(recipe["name"])

func _on_recipe_selected(index: int) -> void:
	if index < 0 or index >= _recipes.size():
		return
	var recipe: Dictionary = _recipes[index]
	_info_label.clear()
	_info_label.append_text("[b]%s[/b]\n\n" % recipe["name"])
	_info_label.append_text("[color=gray]Inputs:[/color] %s\n\n" % recipe["inputs"])
	_info_label.append_text("%s\n\n" % recipe["description"])
	_info_label.append_text("[color=yellow]Requires:[/color] %s" % recipe["requires"])

var _experiment_button: Button

func _add_experiment_button() -> void:
	_experiment_button = Button.new()
	_experiment_button.text = "Experiment"
	_experiment_button.position = Vector2(8, 265)
	_experiment_button.size = Vector2(160, 28)
	_experiment_button.tooltip_text = "Combine materials to discover new items"
	_experiment_button.pressed.connect(_on_experiment_pressed)
	_panel.add_child(_experiment_button)

func _on_craft_pressed() -> void:
	var selected = _recipe_list.get_selected_items()
	if selected.is_empty():
		return
	var recipe: Dictionary = _recipes[selected[0]]
	print("Crafting: %s" % recipe["name"])
	item_crafted.emit(recipe["id"], recipe)

signal experiment_requested()

func _on_experiment_pressed() -> void:
	experiment_requested.emit()
