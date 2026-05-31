extends Node

signal peer_connected(id: int)
signal peer_disconnected(id: int)
signal connection_failed
signal server_disconnected

@export var default_port: int = 7777
@export var max_clients: int = 32

var is_server: bool = false
var connected_clients: Dictionary = {}  # peer_id -> { ready, last_ping_ms, join_time }

func _ready() -> void:
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connected_to_server.connect(_on_connected_to_server)
	multiplayer.connection_failed.connect(_on_connection_failed)
	multiplayer.server_disconnected.connect(_on_server_disconnected)

func start_server(port: int = -1, max_players: int = -1) -> Error:
	if port < 0:
		port = default_port
	if max_players < 0:
		max_players = max_clients

	var peer := ENetMultiplayerPeer.new()
	var err := peer.create_server(port, max_players)
	if err != OK:
		push_error("NetworkManager: Failed to create server on port %d: %s" % [port, error_string(err)])
		return err

	multiplayer.multiplayer_peer = peer
	is_server = true
	print("NetworkManager: Server started on port %d (max %d clients)" % [port, max_players])
	return OK

func connect_to_server(address: String, port: int = -1) -> Error:
	if port < 0:
		port = default_port

	var peer := ENetMultiplayerPeer.new()
	var err := peer.create_client(address, port)
	if err != OK:
		push_error("NetworkManager: Failed to connect to %s:%d: %s" % [address, port, error_string(err)])
		return err

	multiplayer.multiplayer_peer = peer
	is_server = false
	print("NetworkManager: Connecting to %s:%d..." % [address, port])
	return OK

func disconnect_from_server() -> void:
	multiplayer.multiplayer_peer = null
	connected_clients.clear()
	is_server = false
	print("NetworkManager: Disconnected")

func get_peer_id() -> int:
	return multiplayer.get_unique_id()

func get_client_count() -> int:
	return connected_clients.size()

func is_client_ready(peer_id: int) -> bool:
	if connected_clients.has(peer_id):
		return connected_clients[peer_id].get("ready", false)
	return false

# --- Signal handlers ---

func _on_peer_connected(id: int) -> void:
	print("NetworkManager: Peer connected: %d" % id)
	if is_server:
		connected_clients[id] = {
			"ready": false,
			"last_ping_ms": Time.get_ticks_msec(),
			"join_time": Time.get_ticks_msec(),
		}
	peer_connected.emit(id)

func _on_peer_disconnected(id: int) -> void:
	print("NetworkManager: Peer disconnected: %d" % id)
	if is_server:
		connected_clients.erase(id)
	peer_disconnected.emit(id)

func _on_connected_to_server() -> void:
	print("NetworkManager: Connected to server (my id: %d)" % multiplayer.get_unique_id())

func _on_connection_failed() -> void:
	print("NetworkManager: Connection failed")
	connection_failed.emit()

func _on_server_disconnected() -> void:
	print("NetworkManager: Server disconnected")
	connected_clients.clear()
	server_disconnected.emit()

# --- RPCs ---

@rpc("any_peer", "reliable")
func rpc_set_ready(ready: bool) -> void:
	var sender_id := multiplayer.get_remote_sender_id()
	if is_server and connected_clients.has(sender_id):
		connected_clients[sender_id]["ready"] = ready
		print("NetworkManager: Client %d ready = %s" % [sender_id, str(ready)])

@rpc("any_peer", "unreliable")
func rpc_ping() -> void:
	var sender_id := multiplayer.get_remote_sender_id()
	if is_server and connected_clients.has(sender_id):
		connected_clients[sender_id]["last_ping_ms"] = Time.get_ticks_msec()
		rpc_id(sender_id, "rpc_pong")

@rpc("authority", "unreliable")
func rpc_pong() -> void:
	# Client receives pong from server - can measure round-trip time
	pass
