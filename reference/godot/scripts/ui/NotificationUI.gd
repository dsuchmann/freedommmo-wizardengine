extends Control

const MAX_NOTIFICATIONS := 5
const FADE_TIME := 4.0

var _notifications: Array = []
var _container: VBoxContainer

func _ready() -> void:
	_container = VBoxContainer.new()
	_container.position = Vector2(600, 20)
	_container.size = Vector2(400, 200)
	add_child(_container)

func _process(delta: float) -> void:
	var to_remove: Array = []
	for notif in _notifications:
		notif["time"] -= delta
		if notif["time"] <= 0:
			to_remove.append(notif)
		elif notif["time"] < 1.0:
			notif["label"].modulate.a = notif["time"]
	for notif in to_remove:
		notif["label"].queue_free()
		_notifications.erase(notif)

func show_notification(text: String, color: Color = Color.WHITE, duration: float = FADE_TIME) -> void:
	if _container == null:
		return
	if _notifications.size() >= MAX_NOTIFICATIONS:
		var oldest = _notifications[0]
		oldest["label"].queue_free()
		_notifications.remove_at(0)

	var label := RichTextLabel.new()
	label.bbcode_enabled = true
	label.fit_content = true
	label.size = Vector2(400, 30)
	label.append_text("[color=#%s]%s[/color]" % [color.to_html(false), text])
	_container.add_child(label)

	_notifications.append({"label": label, "time": duration})

func show_combat_notification(attacker: String, defender: String, damage: float) -> void:
	show_notification("%s hits %s for %.0f damage!" % [attacker, defender, damage], Color(1, 0.3, 0.3))

func show_loot_notification(item_name: String) -> void:
	show_notification("Picked up: %s" % item_name, Color(1, 0.9, 0.3))

func show_quest_notification(text: String) -> void:
	show_notification(text, Color(0.3, 0.8, 1.0), 6.0)

func show_system_notification(text: String) -> void:
	show_notification(text, Color(0.7, 0.7, 0.7))

func show_weather_notification(weather: String) -> void:
	show_notification("Weather: %s" % weather, Color(0.6, 0.8, 1.0))
