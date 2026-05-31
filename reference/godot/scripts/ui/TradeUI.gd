extends Control

signal trade_completed(item_name: String, price: int, is_buying: bool)

var _panel: Panel
var _title_label: Label
var _npc_items_list: ItemList
var _player_items_list: ItemList
var _buy_button: Button
var _sell_button: Button
var _gold_label: Label
var _npc_name: String = ""
var _npc_inventory: Array = []
var _player_gold: int = 0

func _ready() -> void:
	visible = false
	_build_ui()

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE and visible:
		close()

func open_trade(npc_name: String, npc_items: Array, player_gold: int) -> void:
	_npc_name = npc_name
	_npc_inventory = npc_items
	_player_gold = player_gold
	_title_label.text = "Trading with %s" % npc_name
	_gold_label.text = "Gold: %d" % player_gold
	_refresh_lists()
	visible = true

func close() -> void:
	visible = false

func _refresh_lists() -> void:
	_npc_items_list.clear()
	for item in _npc_inventory:
		var price: int = item.get("price", 10)
		_npc_items_list.add_item("%s (%dg)" % [item.get("name", "???"), price])

func _build_ui() -> void:
	_panel = Panel.new()
	_panel.size = Vector2(500, 350)
	_panel.position = Vector2(710, 50)
	add_child(_panel)

	_title_label = Label.new()
	_title_label.text = "Trading"
	_title_label.position = Vector2(8, 4)
	_title_label.add_theme_font_size_override("font_size", 14)
	_panel.add_child(_title_label)

	var npc_label := Label.new()
	npc_label.text = "NPC Goods"
	npc_label.position = Vector2(8, 28)
	_panel.add_child(npc_label)

	_npc_items_list = ItemList.new()
	_npc_items_list.position = Vector2(8, 48)
	_npc_items_list.size = Vector2(230, 240)
	_panel.add_child(_npc_items_list)

	_buy_button = Button.new()
	_buy_button.text = "Buy <"
	_buy_button.position = Vector2(245, 140)
	_buy_button.size = Vector2(50, 30)
	_buy_button.pressed.connect(_on_buy)
	_panel.add_child(_buy_button)

	_sell_button = Button.new()
	_sell_button.text = "> Sell"
	_sell_button.position = Vector2(245, 180)
	_sell_button.size = Vector2(50, 30)
	_sell_button.pressed.connect(_on_sell)
	_panel.add_child(_sell_button)

	_gold_label = Label.new()
	_gold_label.text = "Gold: 0"
	_gold_label.position = Vector2(8, 300)
	_gold_label.add_theme_font_size_override("font_size", 12)
	_panel.add_child(_gold_label)

	var close_btn := Button.new()
	close_btn.text = "Close"
	close_btn.position = Vector2(400, 310)
	close_btn.size = Vector2(90, 28)
	close_btn.pressed.connect(close)
	_panel.add_child(close_btn)

func _on_buy() -> void:
	var selected = _npc_items_list.get_selected_items()
	if selected.is_empty():
		return
	var idx: int = selected[0]
	if idx >= _npc_inventory.size():
		return
	var item: Dictionary = _npc_inventory[idx]
	var price: int = item.get("price", 10)
	if _player_gold >= price:
		_player_gold -= price
		_gold_label.text = "Gold: %d" % _player_gold
		trade_completed.emit(item.get("name", "???"), price, true)

func _on_sell() -> void:
	trade_completed.emit("", 0, false)
