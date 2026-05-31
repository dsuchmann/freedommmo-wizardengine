extends Node

signal auth_success(username: String, session_token: String)
signal auth_failed(reason: String)
signal registered(username: String)
signal logged_out

const USERS_DIR: String = "user://players/"
const SESSION_FILE: String = "user://session.json"
const MIN_USERNAME_LENGTH: int = 3
const MIN_PASSWORD_LENGTH: int = 6

var current_user: String = ""
var session_token: String = ""
var is_authenticated: bool = false

func _ready() -> void:
	DirAccess.make_dir_recursive_absolute(
		USERS_DIR.replace("user://", OS.get_user_data_dir() + "/")
	)
	_try_restore_session()

func register(username: String, password: String) -> bool:
	username = username.strip_edges().to_lower()

	if username.length() < MIN_USERNAME_LENGTH:
		auth_failed.emit("Username must be at least %d characters" % MIN_USERNAME_LENGTH)
		return false
	if password.length() < MIN_PASSWORD_LENGTH:
		auth_failed.emit("Password must be at least %d characters" % MIN_PASSWORD_LENGTH)
		return false
	if not _is_valid_username(username):
		auth_failed.emit("Username can only contain letters, numbers, and underscores")
		return false

	var user_path := _get_user_path(username)
	if FileAccess.file_exists(user_path):
		auth_failed.emit("Username already exists")
		return false

	var password_hash := _hash_password(password, username)
	var user_data := {
		"username": username,
		"password_hash": password_hash,
		"created_at": Time.get_unix_time_from_system(),
	}

	var file := FileAccess.open(user_path, FileAccess.WRITE)
	if file == null:
		auth_failed.emit("Failed to create user file")
		return false
	file.store_string(JSON.stringify(user_data, "\t"))
	file.close()

	registered.emit(username)
	print("AuthManager: Registered user '%s'" % username)
	return login(username, password)

func login(username: String, password: String) -> bool:
	username = username.strip_edges().to_lower()

	var user_path := _get_user_path(username)
	if not FileAccess.file_exists(user_path):
		auth_failed.emit("User not found")
		return false

	var json_text := FileAccess.get_file_as_string(user_path)
	var user_data = JSON.parse_string(json_text)
	if user_data == null or typeof(user_data) != TYPE_DICTIONARY:
		auth_failed.emit("Corrupted user data")
		return false

	var password_hash := _hash_password(password, username)
	if user_data.get("password_hash", "") != password_hash:
		auth_failed.emit("Invalid password")
		return false

	# Generate session token
	session_token = _generate_session_token(username)
	current_user = username
	is_authenticated = true

	_save_session(username, session_token)
	auth_success.emit(username, session_token)
	print("AuthManager: User '%s' logged in" % username)
	return true

func logout() -> void:
	current_user = ""
	session_token = ""
	is_authenticated = false
	_clear_session()
	logged_out.emit()
	print("AuthManager: Logged out")

func get_current_user() -> String:
	return current_user

func _hash_password(password: String, salt: String) -> String:
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update((salt + ":" + password).to_utf8_buffer())
	var hash_bytes := ctx.finish()
	return hash_bytes.hex_encode()

func _generate_session_token(username: String) -> String:
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	var token_input := "%s:%d:%d" % [username, Time.get_unix_time_from_system(), randi()]
	ctx.update(token_input.to_utf8_buffer())
	return ctx.finish().hex_encode()

func _is_valid_username(username: String) -> bool:
	var regex := RegEx.new()
	regex.compile("^[a-z0-9_]+$")
	return regex.search(username) != null

func _get_user_path(username: String) -> String:
	return USERS_DIR + username + ".json"

func _save_session(username: String, token: String) -> void:
	var session := {"username": username, "token": token, "timestamp": Time.get_unix_time_from_system()}
	var file := FileAccess.open(SESSION_FILE, FileAccess.WRITE)
	if file:
		file.store_string(JSON.stringify(session))
		file.close()

func _try_restore_session() -> void:
	if not FileAccess.file_exists(SESSION_FILE):
		return
	var json_text := FileAccess.get_file_as_string(SESSION_FILE)
	var session = JSON.parse_string(json_text)
	if session == null or typeof(session) != TYPE_DICTIONARY:
		return
	var username: String = session.get("username", "")
	var token: String = session.get("token", "")
	var timestamp: float = session.get("timestamp", 0.0)

	# Sessions expire after 24 hours
	if Time.get_unix_time_from_system() - timestamp > 86400:
		_clear_session()
		return

	if not username.is_empty() and not token.is_empty():
		current_user = username
		session_token = token
		is_authenticated = true
		auth_success.emit(username, token)
		print("AuthManager: Restored session for '%s'" % username)

func _clear_session() -> void:
	if FileAccess.file_exists(SESSION_FILE):
		DirAccess.remove_absolute(
			SESSION_FILE.replace("user://", OS.get_user_data_dir() + "/")
		)
