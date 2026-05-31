class_name EconomySystem
extends RefCounted

signal trade_completed(seller_id: int, buyer_id: int, item: Dictionary, price: int)
signal price_updated(item_name: String, new_price: int)

var _market_prices: Dictionary = {}
var _entity_wealth: Dictionary = {}
var _trade_history: Array = []
var _supply: Dictionary = {}
var _demand: Dictionary = {}

func _init() -> void:
	_init_base_prices()

func get_price(item_name: String) -> int:
	return _market_prices.get(item_name, 10)

func get_wealth(entity_id: int) -> int:
	return _entity_wealth.get(entity_id, 0)

func add_wealth(entity_id: int, amount: int) -> void:
	_entity_wealth[entity_id] = get_wealth(entity_id) + amount

func trade(seller_id: int, buyer_id: int, item: Dictionary) -> Dictionary:
	var item_name: String = item.get("name", "Unknown")
	var price := get_price(item_name)

	if get_wealth(buyer_id) < price:
		return {"success": false, "reason": "insufficient_funds", "price": price}

	_entity_wealth[buyer_id] -= price
	_entity_wealth[seller_id] = get_wealth(seller_id) + price

	_supply[item_name] = _supply.get(item_name, 0) + 1
	_update_price(item_name)

	_trade_history.append({
		"seller": seller_id, "buyer": buyer_id,
		"item": item_name, "price": price,
		"timestamp": Time.get_unix_time_from_system(),
	})

	trade_completed.emit(seller_id, buyer_id, item, price)
	return {"success": true, "price": price}

var _event_timer: float = 0.0

func tick(delta: float) -> void:
	# Prices drift toward base over time
	for item in _market_prices:
		var base: int = _get_base_price(item)
		var current: int = _market_prices[item]
		if current > base:
			_market_prices[item] = maxi(base, current - 1)
		elif current < base:
			_market_prices[item] = mini(base, current + 1)

	# Random economic events
	_event_timer += delta
	if _event_timer > 60.0:
		_event_timer = 0.0
		_random_economic_event()

func _random_economic_event() -> void:
	var roll = randf()
	if roll < 0.1:
		# Raid — weapons prices spike
		_market_prices["Iron Sword"] = _get_base_price("Iron Sword") * 2
		_market_prices["Steel Sword"] = _get_base_price("Steel Sword") * 2
		price_updated.emit("Iron Sword", _market_prices["Iron Sword"])
	elif roll < 0.2:
		# Good harvest — food prices drop
		_market_prices["Bread"] = maxi(1, _get_base_price("Bread") / 2)
		price_updated.emit("Bread", _market_prices["Bread"])
	elif roll < 0.3:
		# Ore discovery — metal prices drop
		_market_prices["Iron Nugget"] = maxi(5, _get_base_price("Iron Nugget") - 10)
		price_updated.emit("Iron Nugget", _market_prices["Iron Nugget"])

func _update_price(item_name: String) -> void:
	var supply_count: int = _supply.get(item_name, 0)
	var base: int = _get_base_price(item_name)
	# More supply = lower price
	var modifier := 1.0 - (supply_count * 0.02)
	modifier = clampf(modifier, 0.3, 2.0)
	_market_prices[item_name] = maxi(1, int(base * modifier))
	price_updated.emit(item_name, _market_prices[item_name])

func _get_base_price(item_name: String) -> int:
	match item_name:
		"Bread": return 5
		"Copper Coin": return 1
		"Raw Meat": return 8
		"Mushroom": return 3
		"Cloth Scrap": return 7
		"Iron Nugget": return 25
		"Tusk Fragment": return 15
		"Shiny Trinket": return 10
		"Ale Flask": return 12
		"Bone Club": return 30
		"Rusty Dagger": return 20
		"Simple Ring": return 40
		"Steel Gauntlets": return 80
		"Stone Pick": return 15
		"Torch": return 8
		"Healing Potion": return 35
		"Time Shard": return 100
		"Strange Stone": return 20
		_: return 10

func get_merchant_inventory(_entity_id: int) -> Array:
	var stock: Array = []
	var merchant_items := ["Bread", "Healing Potion", "Stone Pick", "Torch",
		"Ale Flask", "Simple Ring", "Cloth Scrap"]
	for item_name in merchant_items:
		stock.append({"name": item_name, "price": get_price(item_name)})
	return stock

func _init_base_prices() -> void:
	var items := ["Bread", "Copper Coin", "Raw Meat", "Mushroom", "Cloth Scrap",
		"Iron Nugget", "Tusk Fragment", "Shiny Trinket", "Ale Flask",
		"Bone Club", "Rusty Dagger", "Simple Ring", "Steel Gauntlets",
		"Stone Pick", "Torch", "Healing Potion", "Time Shard", "Strange Stone"]
	for item in items:
		_market_prices[item] = _get_base_price(item)
