extends Control

signal command_submitted(text: String)

var _panel: Panel
var _line_edit: LineEdit
var _log: RichTextLabel
var _visible_toggle: bool = false

func _ready() -> void:
	visible = false
	_build_ui()

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed:
		if event.keycode == KEY_ENTER or event.keycode == KEY_KP_ENTER:
			if not visible:
				_show_input()
			elif _line_edit.text.strip_edges() != "":
				_submit()
			else:
				_hide_input()
		elif event.keycode == KEY_ESCAPE and visible:
			_hide_input()

func _show_input() -> void:
	visible = true
	_line_edit.text = ""
	_line_edit.grab_focus()

func _hide_input() -> void:
	visible = false
	_line_edit.release_focus()

func _submit() -> void:
	var text = _line_edit.text.strip_edges()
	if text.is_empty():
		return
	_add_log_entry("[color=cyan]> %s[/color]" % text)
	command_submitted.emit(text)
	_line_edit.text = ""
	_line_edit.grab_focus()

func add_response(text: String, color: Color = Color.WHITE) -> void:
	var hex = color.to_html(false)
	_add_log_entry("[color=#%s]%s[/color]" % [hex, text])

func add_action_log(action_name: String, target: String, success: bool) -> void:
	var icon = "[color=green]OK[/color]" if success else "[color=red]FAIL[/color]"
	var msg = "%s %s(%s)" % [icon, action_name, target]
	_add_log_entry(msg)

func _add_log_entry(bbcode: String) -> void:
	_log.append_text(bbcode + "\n")
	# Auto-scroll to bottom
	_log.scroll_to_line(_log.get_line_count() - 1)

func _build_ui() -> void:
	_panel = Panel.new()
	_panel.size = Vector2(500, 180)
	_panel.position = Vector2(710, 880)
	_panel.modulate = Color(1, 1, 1, 0.9)
	add_child(_panel)

	_log = RichTextLabel.new()
	_log.position = Vector2(8, 4)
	_log.size = Vector2(484, 135)
	_log.bbcode_enabled = true
	_log.scroll_following = true
	_log.add_theme_font_size_override("normal_font_size", 11)
	_panel.add_child(_log)

	_line_edit = LineEdit.new()
	_line_edit.position = Vector2(8, 145)
	_line_edit.size = Vector2(484, 28)
	_line_edit.placeholder_text = "Type a command... (Enter to open, Esc to close)"
	_line_edit.text_submitted.connect(func(_t): _submit())
	_panel.add_child(_line_edit)

	_add_log_entry("[color=gray]Press Enter to type commands.[/color]")
	_add_log_entry("[color=gray]Try: 'go to the villager and talk' or 'attack nearest orc'[/color]")
