extends Control

signal character_created(entity: EntityBody)

var _panel: Panel
var _name_input: LineEdit
var _species_list: OptionButton
var _gender_list: OptionButton
var _stats_labels: Dictionary = {}
var _stat_points: int = 10
var _base_stats: Dictionary = {}
var _create_button: Button

func _ready() -> void:
	_build_ui()
	_reset_stats()

func _build_ui() -> void:
	_panel = Panel.new()
	_panel.size = Vector2(400, 500)
	_panel.position = Vector2(760, 290)
	add_child(_panel)

	var title := Label.new()
	title.text = "Create Your Character"
	title.position = Vector2(100, 10)
	title.add_theme_font_size_override("font_size", 18)
	_panel.add_child(title)

	var name_label := Label.new()
	name_label.text = "Name:"
	name_label.position = Vector2(20, 50)
	_panel.add_child(name_label)

	_name_input = LineEdit.new()
	_name_input.position = Vector2(80, 45)
	_name_input.size = Vector2(200, 28)
	_name_input.placeholder_text = "Enter name..."
	_panel.add_child(_name_input)

	var species_label := Label.new()
	species_label.text = "Species:"
	species_label.position = Vector2(20, 85)
	_panel.add_child(species_label)

	_species_list = OptionButton.new()
	_species_list.position = Vector2(80, 80)
	_species_list.size = Vector2(200, 28)
	_species_list.add_item("Human")
	_species_list.add_item("Elf")
	_species_list.add_item("Dwarf")
	_species_list.add_item("Orc")
	_species_list.add_item("Goblin")
	_panel.add_child(_species_list)

	var gender_label := Label.new()
	gender_label.text = "Gender:"
	gender_label.position = Vector2(20, 120)
	_panel.add_child(gender_label)

	_gender_list = OptionButton.new()
	_gender_list.position = Vector2(80, 115)
	_gender_list.size = Vector2(200, 28)
	_gender_list.add_item("Male")
	_gender_list.add_item("Female")
	_panel.add_child(_gender_list)

	var stats_title := Label.new()
	stats_title.text = "Distribute Points (remaining: 10)"
	stats_title.position = Vector2(20, 155)
	_panel.add_child(stats_title)

	var stat_names := ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"]
	var stat_keys := ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]
	for i in range(stat_names.size()):
		var y := 150 + i * 35
		var label := Label.new()
		label.text = stat_names[i] + ":"
		label.position = Vector2(20, y)
		_panel.add_child(label)

		var value_label := Label.new()
		value_label.text = "10"
		value_label.position = Vector2(150, y)
		_panel.add_child(value_label)
		_stats_labels[stat_keys[i]] = value_label

		var plus := Button.new()
		plus.text = "+"
		plus.position = Vector2(180, y - 3)
		plus.size = Vector2(25, 25)
		plus.pressed.connect(_on_stat_plus.bind(stat_keys[i], stats_title))
		_panel.add_child(plus)

		var minus := Button.new()
		minus.text = "-"
		minus.position = Vector2(210, y - 3)
		minus.size = Vector2(25, 25)
		minus.pressed.connect(_on_stat_minus.bind(stat_keys[i], stats_title))
		_panel.add_child(minus)

	_create_button = Button.new()
	_create_button.text = "Create Character"
	_create_button.position = Vector2(120, 450)
	_create_button.size = Vector2(160, 35)
	_create_button.pressed.connect(_on_create)
	_panel.add_child(_create_button)

func _reset_stats() -> void:
	_stat_points = 10
	_base_stats = {
		"strength": 10, "dexterity": 10, "constitution": 10,
		"intelligence": 10, "wisdom": 10, "charisma": 10,
	}

func _on_stat_plus(stat: String, title_label: Label) -> void:
	if _stat_points <= 0:
		return
	_base_stats[stat] += 1
	_stat_points -= 1
	_stats_labels[stat].text = str(_base_stats[stat])
	title_label.text = "Distribute Points (remaining: %d)" % _stat_points

func _on_stat_minus(stat: String, title_label: Label) -> void:
	if _base_stats[stat] <= 5:
		return
	_base_stats[stat] -= 1
	_stat_points += 1
	_stats_labels[stat].text = str(_base_stats[stat])
	title_label.text = "Distribute Points (remaining: %d)" % _stat_points

func _on_create() -> void:
	var name_str := _name_input.text.strip_edges()
	if name_str.is_empty():
		name_str = "Adventurer"
	var species_idx := _species_list.selected
	var species: int
	match species_idx:
		0: species = EntityBody.Species.HUMAN
		1: species = EntityBody.Species.ELF
		2: species = EntityBody.Species.DWARF
		3: species = EntityBody.Species.ORC
		4: species = EntityBody.Species.GOBLIN
		_: species = EntityBody.Species.HUMAN

	var entity := EntityBody.new(0, species)
	entity.name = name_str
	entity.gender = "female" if _gender_list.selected == 1 else "male"
	entity.age = 18.0
	for stat in _base_stats:
		entity.base_stats[stat] = float(_base_stats[stat])
	entity.base_stats["health"] = 100.0 + _base_stats["constitution"] * 5.0
	entity.base_stats["max_health"] = entity.base_stats["health"]
	entity.base_stats["stamina"] = 100.0 + _base_stats["constitution"] * 3.0
	entity.base_stats["mana"] = 50.0 + _base_stats["intelligence"] * 5.0
	entity.base_stats["attack"] = 5.0 + _base_stats["strength"] * 0.5
	entity.base_stats["defense"] = _base_stats["constitution"] * 0.3
	entity.base_stats["speed"] = 5.0 + _base_stats["dexterity"] * 0.2

	character_created.emit(entity)
	visible = false
