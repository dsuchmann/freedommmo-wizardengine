extends Control

signal item_equipped(slot: String, item: Dictionary)
signal item_unequipped(slot: String)

const SLOT_SIZE := 36
const SLOT_PADDING := 3

var _entity: EntityBody
var _slot_buttons: Dictionary = {}
var _panel: Panel
var _title_label: Label
var _stats_label: Label

var _slot_positions: Dictionary = {
	"head": Vector2(90, 10),
	"face": Vector2(90, 50),
	"neck": Vector2(90, 90),
	"shoulders": Vector2(40, 50),
	"chest": Vector2(90, 130),
	"back": Vector2(140, 130),
	"upper_arms": Vector2(30, 110),
	"lower_arms": Vector2(30, 150),
	"hands": Vector2(30, 190),
	"waist": Vector2(90, 170),
	"upper_legs": Vector2(70, 210),
	"lower_legs": Vector2(70, 250),
	"feet": Vector2(70, 290),
	"main_hand": Vector2(160, 170),
	"off_hand": Vector2(160, 210),
	"ears": Vector2(140, 50),
	"fingers": Vector2(160, 250),
	"accessories": Vector2(160, 290),
}

func _ready() -> void:
	visible = false
	_build_ui()

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed:
		if event.keycode == KEY_U:
			visible = !visible
			if visible:
				refresh()

func set_entity(entity: EntityBody) -> void:
	_entity = entity
	refresh()

func refresh() -> void:
	if _entity == null or _stats_label == null:
		return
	for slot in _slot_buttons:
		var btn: Button = _slot_buttons[slot]
		var item = _entity.get_equipped(slot)
		if item and item is Dictionary:
			btn.text = str(item.get("name", "?")).substr(0, 3)
			btn.tooltip_text = "%s\n%s" % [item.get("name", ""), item.get("description", "")]
			btn.modulate = Color(1, 1, 0.7)
		else:
			btn.text = ""
			btn.tooltip_text = slot
			btn.modulate = Color(0.4, 0.4, 0.4)

	var stats = _entity.get_computed_stats()
	_stats_label.text = "HP: %.0f/%.0f\nATK: %.0f DEF: %.0f\nSTR: %.0f DEX: %.0f\nINT: %.0f WIS: %.0f\nSPD: %.1f" % [
		stats.get("health", 0), stats.get("max_health", 100),
		stats.get("attack", 0), stats.get("defense", 0),
		stats.get("strength", 0), stats.get("dexterity", 0),
		stats.get("intelligence", 0), stats.get("wisdom", 0),
		stats.get("speed", 0),
	]
	_title_label.text = "%s (Lv.1)" % _entity.name

func _build_ui() -> void:
	_panel = Panel.new()
	_panel.size = Vector2(220, 380)
	_panel.position = Vector2(1680, 20)
	add_child(_panel)

	_title_label = Label.new()
	_title_label.text = "Equipment"
	_title_label.position = Vector2(8, -20)
	_title_label.add_theme_font_size_override("font_size", 12)
	_panel.add_child(_title_label)

	for slot in _slot_positions:
		var pos: Vector2 = _slot_positions[slot]
		var btn := Button.new()
		btn.size = Vector2(SLOT_SIZE, SLOT_SIZE)
		btn.position = pos
		btn.text = ""
		btn.tooltip_text = slot
		btn.modulate = Color(0.4, 0.4, 0.4)
		btn.pressed.connect(_on_slot_pressed.bind(slot))
		_panel.add_child(btn)
		_slot_buttons[slot] = btn

	_stats_label = Label.new()
	_stats_label.position = Vector2(8, 330)
	_stats_label.add_theme_font_size_override("font_size", 9)
	_panel.add_child(_stats_label)

func _on_slot_pressed(slot: String) -> void:
	if _entity == null:
		return
	var item = _entity.get_equipped(slot)
	if item:
		_entity.unequip(slot)
		item_unequipped.emit(slot)
		# Return item to inventory via signal — handled by GrainWorldDemo
	refresh()
