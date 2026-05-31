extends Control

@onready var chat_log: RichTextLabel = $VBox/ChatLog
@onready var message_input: LineEdit = $VBox/InputBox/MessageInput
@onready var send_button: Button = $VBox/InputBox/SendButton

var chat_manager: Node

func _ready() -> void:
	chat_manager = get_node_or_null("/root/ChatManager")
	if chat_manager:
		chat_manager.message_received.connect(_on_message_received)
		chat_manager.system_message.connect(_on_system_message)

	send_button.pressed.connect(_on_send_pressed)
	message_input.text_submitted.connect(_on_text_submitted)

	visible = false  # Hidden by default, toggle with Tab or /chat

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_TAB:
		visible = !visible
		if visible:
			message_input.grab_focus()

func _on_send_pressed() -> void:
	_send_message()

func _on_text_submitted(_text: String) -> void:
	_send_message()

func _send_message() -> void:
	var text := message_input.text.strip_edges()
	if text.is_empty():
		return
	if chat_manager:
		chat_manager.send_message(text)
	message_input.clear()

func _on_message_received(sender_name: String, message: String, _channel: String) -> void:
	chat_log.append_text("[b]%s:[/b] %s\n" % [sender_name, message])

func _on_system_message(message: String) -> void:
	chat_log.append_text("[i][color=yellow]%s[/color][/i]\n" % message)
