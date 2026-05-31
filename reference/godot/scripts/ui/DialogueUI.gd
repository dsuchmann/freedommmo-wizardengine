extends Control

signal dialogue_submitted(text: String)
signal dialogue_closed

var _panel: Panel
var _npc_name_label: Label
var _dialogue_log: RichTextLabel
var _input_field: LineEdit
var _close_button: Button
var _current_npc_id: int = -1

func _ready() -> void:
	visible = false
	_build_ui()

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed:
		if event.keycode == KEY_ESCAPE and visible:
			close()

func open_dialogue(npc_name: String, npc_id: int, greeting: String = "") -> void:
	_current_npc_id = npc_id
	_npc_name_label.text = npc_name
	_dialogue_log.clear()
	if not greeting.is_empty():
		add_npc_message(npc_name, greeting)
	visible = true
	_input_field.grab_focus()

func add_npc_message(name: String, text: String) -> void:
	_dialogue_log.append_text("[b][color=cyan]%s:[/color][/b] %s\n" % [name, text])

func add_player_message(text: String) -> void:
	_dialogue_log.append_text("[b][color=yellow]You:[/color][/b] %s\n" % text)

func add_system_message(text: String) -> void:
	_dialogue_log.append_text("[i][color=gray]%s[/color][/i]\n" % text)

func close() -> void:
	visible = false
	_current_npc_id = -1
	dialogue_closed.emit()

func get_current_npc_id() -> int:
	return _current_npc_id

func _build_ui() -> void:
	_panel = Panel.new()
	_panel.size = Vector2(500, 300)
	_panel.position = Vector2(710, 400)
	add_child(_panel)

	_npc_name_label = Label.new()
	_npc_name_label.text = "NPC Name"
	_npc_name_label.position = Vector2(8, 4)
	_npc_name_label.add_theme_font_size_override("font_size", 14)
	_panel.add_child(_npc_name_label)

	_close_button = Button.new()
	_close_button.text = "X"
	_close_button.size = Vector2(24, 24)
	_close_button.position = Vector2(468, 4)
	_close_button.pressed.connect(close)
	_panel.add_child(_close_button)

	_dialogue_log = RichTextLabel.new()
	_dialogue_log.position = Vector2(8, 28)
	_dialogue_log.size = Vector2(484, 230)
	_dialogue_log.bbcode_enabled = true
	_dialogue_log.scroll_following = true
	_panel.add_child(_dialogue_log)

	var input_box := HBoxContainer.new()
	input_box.position = Vector2(8, 265)
	input_box.size = Vector2(484, 28)
	_panel.add_child(input_box)

	_input_field = LineEdit.new()
	_input_field.placeholder_text = "Say something..."
	_input_field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_input_field.text_submitted.connect(_on_text_submitted)
	input_box.add_child(_input_field)

	var send_btn := Button.new()
	send_btn.text = "Say"
	send_btn.pressed.connect(func(): _on_text_submitted(_input_field.text))
	input_box.add_child(send_btn)

func _on_text_submitted(text: String) -> void:
	text = text.strip_edges()
	if text.is_empty():
		return
	add_player_message(text)
	_input_field.clear()
	dialogue_submitted.emit(text)
