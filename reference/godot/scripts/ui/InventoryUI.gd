extends Control

signal item_selected(slot_index: int)
signal item_used(item: Dictionary, slot_index: int)
signal item_dropped(slot_index: int)

const SLOT_SIZE := 40
const SLOTS_PER_ROW := 5
const MAX_SLOTS := 20
const PADDING := 4

var _slots: Array = []
var _items: Array = []
var _selected_slot: int = -1
var _panel: Panel
var _title_label: Label
var _grid: Control

func _ready() -> void:
	visible = false
	_build_ui()
	_items.resize(MAX_SLOTS)
	for i in range(MAX_SLOTS):
		_items[i] = null

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed:
		if event.keycode == KEY_TAB:  # KEY_I handled centrally by GrainWorldDemo
			visible = !visible
			if visible:
				refresh()

func _build_ui() -> void:
	var rows := MAX_SLOTS / SLOTS_PER_ROW
	var panel_w := SLOTS_PER_ROW * (SLOT_SIZE + PADDING) + PADDING + 16
	var panel_h := rows * (SLOT_SIZE + PADDING) + PADDING + 40

	_panel = Panel.new()
	_panel.size = Vector2(panel_w, panel_h)
	_panel.position = Vector2(20, 200)
	add_child(_panel)

	_title_label = Label.new()
	_title_label.text = "Inventory"
	_title_label.position = Vector2(8, 4)
	_title_label.add_theme_font_size_override("font_size", 12)
	_panel.add_child(_title_label)

	_grid = Control.new()
	_grid.position = Vector2(8, 28)
	_panel.add_child(_grid)

	for i in range(MAX_SLOTS):
		var row := i / SLOTS_PER_ROW
		var col := i % SLOTS_PER_ROW
		var slot := Button.new()
		slot.size = Vector2(SLOT_SIZE, SLOT_SIZE)
		slot.position = Vector2(col * (SLOT_SIZE + PADDING), row * (SLOT_SIZE + PADDING))
		slot.text = ""
		slot.tooltip_text = "Empty"
		slot.pressed.connect(_on_slot_pressed.bind(i))
		_grid.add_child(slot)
		_slots.append(slot)

func add_item(item: Dictionary) -> int:
	for i in range(MAX_SLOTS):
		if _items[i] == null:
			_items[i] = item
			_update_slot(i)
			return i
	return -1

func remove_item(slot_index: int) -> Dictionary:
	if slot_index < 0 or slot_index >= MAX_SLOTS:
		return {}
	var item = _items[slot_index]
	_items[slot_index] = null
	_update_slot(slot_index)
	return item if item else {}

func get_item(slot_index: int):
	if slot_index < 0 or slot_index >= MAX_SLOTS:
		return null
	return _items[slot_index]

func count_material(material_name: String) -> int:
	var count := 0
	for item in _items:
		if item != null:
			var name_lower = str(item.get("name", "")).to_lower()
			if name_lower.find(material_name.to_lower()) >= 0:
				count += 1
	return count

func has_materials(required: Dictionary) -> bool:
	for mat in required:
		if count_material(mat) < required[mat]:
			return false
	return true

func consume_material(material_name: String, amount: int) -> int:
	var consumed := 0
	for i in range(MAX_SLOTS):
		if consumed >= amount:
			break
		if _items[i] != null:
			var name_lower = str(_items[i].get("name", "")).to_lower()
			if name_lower.find(material_name.to_lower()) >= 0:
				_items[i] = null
				_update_slot(i)
				consumed += 1
	return consumed

func get_all_items() -> Array:
	var result: Array = []
	for item in _items:
		if item != null:
			result.append(item)
	return result

func get_item_count() -> int:
	var count := 0
	for item in _items:
		if item != null:
			count += 1
	return count

func refresh() -> void:
	if _title_label == null:
		return
	for i in range(MAX_SLOTS):
		_update_slot(i)
	_title_label.text = "Inventory (%d/%d)" % [get_item_count(), MAX_SLOTS]

func _update_slot(index: int) -> void:
	if index < 0 or index >= _slots.size():
		return
	var slot: Button = _slots[index]
	var item = _items[index]
	if item == null:
		slot.text = ""
		slot.tooltip_text = "Empty"
		slot.modulate = Color(0.5, 0.5, 0.5)
	else:
		var name: String = item.get("name", "???")
		slot.text = name.substr(0, 3)
		slot.tooltip_text = "%s\n%s" % [name, item.get("description", "")]
		slot.modulate = Color(1, 1, 1)
	if index == _selected_slot:
		slot.modulate = Color(1, 1, 0.5)

func _on_slot_pressed(index: int) -> void:
	var item = _items[index]
	if item != null and item is Dictionary:
		var item_type = item.get("type", "misc")
		if item_type == "consumable":
			item_used.emit(item, index)
			_items[index] = null
			_update_slot(index)
			return
		elif item_type in ["weapon", "armor", "accessory"]:
			item_used.emit(item, index)
			_items[index] = null
			_update_slot(index)
			return
	if _selected_slot == index:
		_selected_slot = -1
	else:
		_selected_slot = index
	item_selected.emit(index)
	refresh()
