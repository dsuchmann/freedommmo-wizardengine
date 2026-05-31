extends Node

## Manages player spawning, despawning, and position synchronization
## Works alongside NetworkManager for multiplayer player management

signal player_spawned(peer_id: int)
signal player_despawned(peer_id: int)

const SYNC_RATE: float = 1.0 / 20.0  # 20 Hz position updates

var PlayerScene: PackedScene = preload("res://scenes/Player.tscn")
var players: Dictionary = {}  # peer_id -> Player node
var _sync_timer: float = 0.0

func _ready() -> void:
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)

func _physics_process(delta: float) -> void:
	if not multiplayer.has_multiplayer_peer():
		return

	# Throttle position sync to SYNC_RATE
	_sync_timer += delta
	if _sync_timer < SYNC_RATE:
		return
	_sync_timer = 0.0

	# Local player sends position to server
	var local_id := multiplayer.get_unique_id()
	if players.has(local_id):
		var local_player: CharacterBody2D = players[local_id]
		if multiplayer.is_server():
			# Server broadcasts directly
			_broadcast_position(local_id, local_player.global_position, local_player.velocity)
		else:
			# Client sends to server
			rpc_id(1, "_server_receive_position", local_player.global_position, local_player.velocity)

func _on_peer_connected(id: int) -> void:
	# Spawn player for the new peer
	_spawn_player(id)

	# If we're the server, tell the new peer about all existing players
	if multiplayer.is_server():
		for existing_id in players:
			if existing_id != id:
				rpc_id(id, "_client_spawn_player", existing_id, players[existing_id].global_position)
		# Tell all existing peers about the new player
		for existing_id in players:
			if existing_id != id and existing_id != 1:
				rpc_id(existing_id, "_client_spawn_player", id, Vector2.ZERO)

func _on_peer_disconnected(id: int) -> void:
	_despawn_player(id)
	if multiplayer.is_server():
		# Tell all clients to despawn this player
		rpc("_client_despawn_player", id)

func spawn_local_player() -> void:
	_spawn_player(multiplayer.get_unique_id())

func _spawn_player(id: int) -> void:
	if players.has(id):
		return
	var player := PlayerScene.instantiate() as CharacterBody2D
	player.name = "Player_%d" % id
	player.set_multiplayer_authority(id)
	add_child(player)
	players[id] = player
	player_spawned.emit(id)
	print("PlayerSyncManager: Spawned player %d" % id)

func _despawn_player(id: int) -> void:
	if not players.has(id):
		return
	var player: Node = players[id]
	player.queue_free()
	players.erase(id)
	player_despawned.emit(id)
	print("PlayerSyncManager: Despawned player %d" % id)

func _broadcast_position(id: int, pos: Vector2, vel: Vector2) -> void:
	# Server broadcasts position to all clients (except the owner)
	for peer_id in players:
		if peer_id != id and peer_id != 1:
			rpc_id(peer_id, "_client_receive_position", id, pos, vel)

# --- RPCs ---

@rpc("any_peer", "unreliable")
func _server_receive_position(pos: Vector2, vel: Vector2) -> void:
	# Server receives position from a client, validates and broadcasts
	var sender_id := multiplayer.get_remote_sender_id()
	if players.has(sender_id):
		var player: CharacterBody2D = players[sender_id]
		player.global_position = pos
		player.velocity = vel
		_broadcast_position(sender_id, pos, vel)

@rpc("authority", "unreliable")
func _client_receive_position(id: int, pos: Vector2, vel: Vector2) -> void:
	# Client receives another player's position from server
	if players.has(id) and id != multiplayer.get_unique_id():
		var player: CharacterBody2D = players[id]
		# Smooth interpolation to target position
		player.global_position = player.global_position.lerp(pos, 0.3)
		player.velocity = vel

@rpc("authority", "reliable")
func _client_spawn_player(id: int, pos: Vector2) -> void:
	if not players.has(id):
		_spawn_player(id)
		players[id].global_position = pos

@rpc("authority", "reliable")
func _client_despawn_player(id: int) -> void:
	_despawn_player(id)
