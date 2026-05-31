extends Node

signal message_received(sender_name: String, message: String, channel: String)
signal system_message(message: String)

const MAX_MESSAGE_LENGTH: int = 256
const MAX_HISTORY: int = 100

var chat_history: Array[Dictionary] = []  # [{sender, message, channel, timestamp}]
var player_names: Dictionary = {}  # peer_id -> display_name

func _ready() -> void:
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)

func set_player_name(name: String) -> void:
	var my_id := multiplayer.get_unique_id()
	player_names[my_id] = name
	if multiplayer.has_multiplayer_peer():
		rpc("_sync_player_name", my_id, name)

func send_message(text: String, channel: String = "global") -> void:
	if text.strip_edges().is_empty():
		return
	if text.length() > MAX_MESSAGE_LENGTH:
		text = text.substr(0, MAX_MESSAGE_LENGTH)

	var sender_id := multiplayer.get_unique_id()
	var sender_name: String = player_names.get(sender_id, "Player_%d" % sender_id)

	if multiplayer.is_server():
		_broadcast_message(sender_name, text, channel)
	else:
		rpc_id(1, "_server_receive_message", text, channel)

func _broadcast_message(sender_name: String, text: String, channel: String) -> void:
	_add_to_history(sender_name, text, channel)
	message_received.emit(sender_name, text, channel)
	rpc("_client_receive_message", sender_name, text, channel)

func _add_to_history(sender_name: String, text: String, channel: String) -> void:
	chat_history.append({
		"sender": sender_name,
		"message": text,
		"channel": channel,
		"timestamp": Time.get_unix_time_from_system(),
	})
	if chat_history.size() > MAX_HISTORY:
		chat_history.pop_front()

func _on_peer_connected(id: int) -> void:
	var name: String = player_names.get(multiplayer.get_unique_id(), "")
	if not name.is_empty():
		rpc_id(id, "_sync_player_name", multiplayer.get_unique_id(), name)
	if multiplayer.is_server():
		_broadcast_message("System", "Player %d joined" % id, "global")

func _on_peer_disconnected(id: int) -> void:
	var name: String = player_names.get(id, "Player_%d" % id)
	player_names.erase(id)
	if multiplayer.is_server():
		_broadcast_message("System", "%s left" % name, "global")

# --- RPCs ---

@rpc("any_peer", "reliable")
func _server_receive_message(text: String, channel: String) -> void:
	var sender_id := multiplayer.get_remote_sender_id()
	var sender_name: String = player_names.get(sender_id, "Player_%d" % sender_id)
	if text.length() > MAX_MESSAGE_LENGTH:
		text = text.substr(0, MAX_MESSAGE_LENGTH)
	_broadcast_message(sender_name, text, channel)

@rpc("authority", "reliable")
func _client_receive_message(sender_name: String, text: String, channel: String) -> void:
	_add_to_history(sender_name, text, channel)
	message_received.emit(sender_name, text, channel)

@rpc("any_peer", "reliable")
func _sync_player_name(peer_id: int, name: String) -> void:
	player_names[peer_id] = name
