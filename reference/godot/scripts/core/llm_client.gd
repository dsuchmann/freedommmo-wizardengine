class_name LLMClient
extends RefCounted

signal response_received(request_id: String, text: String)
signal request_failed(request_id: String, error: String)

enum Provider { OPENAI, ANTHROPIC }

var _provider: int = Provider.OPENAI
var _api_key: String = ""
var _model: String = "gpt-4o-mini"
var _max_tokens: int = 200
var _rate_limit_interval: float = 1.0
var _last_request_time: float = 0.0
var _cache: Dictionary = {}
var _cache_ttl: float = 300.0
var _pending_requests: Dictionary = {}
var _http_node: Node = null
var _next_request_id: int = 0

func _init() -> void:
	_load_api_key()

func set_http_node(node: Node) -> void:
	_http_node = node

func request_dialogue(system_prompt: String, user_message: String, callback: Callable) -> String:
	var request_id = "llm_%d" % _next_request_id
	_next_request_id += 1

	var cache_key = _hash_prompt(system_prompt, user_message)
	if _cache.has(cache_key):
		var cached = _cache[cache_key]
		if Time.get_unix_time_from_system() - cached["time"] < _cache_ttl:
			callback.call(cached["response"])
			return request_id

	var now = Time.get_unix_time_from_system()
	if now - _last_request_time < _rate_limit_interval:
		request_failed.emit(request_id, "rate_limited")
		return request_id

	_last_request_time = now

	if _api_key.is_empty() or _http_node == null:
		request_failed.emit(request_id, "no_api_key_or_http_node")
		return request_id

	_pending_requests[request_id] = {
		"callback": callback,
		"cache_key": cache_key,
	}

	var http = HTTPRequest.new()
	_http_node.add_child(http)
	http.request_completed.connect(_on_response.bind(request_id, http))

	var headers: Array
	var body: String
	var url: String

	if _provider == Provider.OPENAI:
		url = "https://api.openai.com/v1/chat/completions"
		headers = [
			"Content-Type: application/json",
			"Authorization: Bearer %s" % _api_key,
		]
		body = JSON.stringify({
			"model": _model,
			"max_tokens": _max_tokens,
			"temperature": 0.9,
			"messages": [
				{"role": "system", "content": system_prompt},
				{"role": "user", "content": user_message},
			],
		})
	else:
		url = "https://api.anthropic.com/v1/messages"
		headers = [
			"Content-Type: application/json",
			"x-api-key: %s" % _api_key,
			"anthropic-version: 2023-06-01",
		]
		body = JSON.stringify({
			"model": _model,
			"max_tokens": _max_tokens,
			"system": system_prompt,
			"messages": [{"role": "user", "content": user_message}],
		})

	var err = http.request(url, headers, HTTPClient.METHOD_POST, body)
	if err != OK:
		http.queue_free()
		_pending_requests.erase(request_id)
		request_failed.emit(request_id, "http_error_%d" % err)

	return request_id

func _on_response(result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray, request_id: String, http_node: HTTPRequest) -> void:
	http_node.queue_free()

	if not _pending_requests.has(request_id):
		return

	var req = _pending_requests[request_id]
	_pending_requests.erase(request_id)

	if result != HTTPRequest.RESULT_SUCCESS or response_code != 200:
		var err_body = body.get_string_from_utf8()
		push_warning("LLM API error %d: %s" % [response_code, err_body.substr(0, 200)])
		request_failed.emit(request_id, "http_%d_status_%d" % [result, response_code])
		req["callback"].call("")
		return

	var json = JSON.parse_string(body.get_string_from_utf8())
	if json == null:
		request_failed.emit(request_id, "json_parse_error")
		req["callback"].call("")
		return

	var text = _extract_response_text(json)

	_cache[req["cache_key"]] = {
		"response": text,
		"time": Time.get_unix_time_from_system(),
	}

	response_received.emit(request_id, text)
	req["callback"].call(text)

func _extract_response_text(json: Dictionary) -> String:
	if _provider == Provider.OPENAI:
		var choices = json.get("choices", [])
		if choices is Array and choices.size() > 0:
			var message = choices[0].get("message", {})
			if message is Dictionary:
				return message.get("content", "")
	else:
		var content = json.get("content", [])
		if content is Array and content.size() > 0:
			return content[0].get("text", "")
	return ""

func _hash_prompt(system: String, user: String) -> String:
	return str(system.hash()) + "_" + str(user.hash())

func _load_api_key() -> void:
	var config_path = "res://data/api_keys.json"
	if FileAccess.file_exists(config_path):
		var file = FileAccess.open(config_path, FileAccess.READ)
		if file:
			var json = JSON.parse_string(file.get_as_text())
			if json and json is Dictionary:
				# Try OpenAI first
				var oai_key = json.get("openai_api_key", "")
				if not oai_key.is_empty():
					_api_key = oai_key
					_provider = Provider.OPENAI
					_model = json.get("openai_model", "gpt-4o-mini")
					print("LLM: OpenAI configured (%s)" % _model)
					file.close()
					return
				# Try Anthropic
				var ant_key = json.get("anthropic_api_key", "")
				if not ant_key.is_empty():
					_api_key = ant_key
					_provider = Provider.ANTHROPIC
					_model = json.get("anthropic_model", "claude-haiku-4-5-20251001")
					print("LLM: Anthropic configured (%s)" % _model)
					file.close()
					return
			file.close()

	# Try environment variables
	var oai_env = OS.get_environment("OPENAI_API_KEY")
	if not oai_env.is_empty():
		_api_key = oai_env
		_provider = Provider.OPENAI
		_model = "gpt-4o-mini"
		print("LLM: OpenAI from env")
		return

	var ant_env = OS.get_environment("ANTHROPIC_API_KEY")
	if not ant_env.is_empty():
		_api_key = ant_env
		_provider = Provider.ANTHROPIC
		_model = "claude-haiku-4-5-20251001"
		print("LLM: Anthropic from env")
		return

	push_warning("LLM: No API key found. NPC dialogue will use rule-based fallback.")

func set_api_key(key: String) -> void:
	_api_key = key

func is_available() -> bool:
	return not _api_key.is_empty() and _http_node != null

func get_provider_name() -> String:
	return "OpenAI" if _provider == Provider.OPENAI else "Anthropic"

func clear_cache() -> void:
	_cache.clear()

func get_cache_size() -> int:
	return _cache.size()
