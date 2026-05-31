class_name TimeSystem
extends RefCounted

signal entity_died(entity_id: int, cause: String)
signal time_transferred(from_id: int, to_id: int, amount: float, method: String)

enum LifeStage {
	FETUS,
	INFANT,
	TODDLER,
	CHILD,
	ADOLESCENT,
	YOUNG_ADULT,
	ADULT,
	MIDDLE_AGED,
	SENIOR,
	ELDERLY,
}

enum TransferMethod {
	CONSUMPTION,
	SHARING,
	TRADING,
	INHERITANCE,
	TAXATION,
	CHARITY,
}

const CONSUMPTION_RATES: Dictionary = {
	LifeStage.FETUS: 0.1,
	LifeStage.INFANT: 0.2,
	LifeStage.TODDLER: 0.3,
	LifeStage.CHILD: 0.4,
	LifeStage.ADOLESCENT: 0.6,
	LifeStage.YOUNG_ADULT: 0.8,
	LifeStage.ADULT: 1.0,
	LifeStage.MIDDLE_AGED: 1.2,
	LifeStage.SENIOR: 1.5,
	LifeStage.ELDERLY: 2.0,
}

const TRANSFER_EFFICIENCY: Dictionary = {
	TransferMethod.CONSUMPTION: 0.30,
	TransferMethod.SHARING: 0.95,
	TransferMethod.TRADING: 0.85,
	TransferMethod.INHERITANCE: 0.90,
	TransferMethod.TAXATION: 0.80,
	TransferMethod.CHARITY: 0.98,
}

const GROUP_MULTIPLIERS: Dictionary = {
	"family": 2.0,
	"village": 1.5,
	"guild": 1.2,
	"culture": 1.0,
	"nation": 0.8,
}

const DEATH_ONSET_AGE: float = 70.0
const DEATH_SCALING: float = 1.15
const DEATH_MAX_MULTIPLIER: float = 10.0

var _entity_pools: Dictionary = {}
var _entity_ages: Dictionary = {}
var _entity_stages: Dictionary = {}
var _entity_groups: Dictionary = {}

func register_entity(entity_id: int, initial_time: float, age: float = 18.0) -> void:
	_entity_pools[entity_id] = initial_time
	_entity_ages[entity_id] = age
	_entity_stages[entity_id] = _age_to_stage(age)
	_entity_groups[entity_id] = []

func get_time(entity_id: int) -> float:
	return _entity_pools.get(entity_id, 0.0)

func get_age(entity_id: int) -> float:
	return _entity_ages.get(entity_id, 0.0)

func get_stage(entity_id: int) -> int:
	return _entity_stages.get(entity_id, LifeStage.ADULT)

func get_consumption_rate(entity_id: int) -> float:
	var stage: int = _entity_stages.get(entity_id, LifeStage.ADULT)
	var base_rate: float = CONSUMPTION_RATES.get(stage, 1.0)
	var age: float = _entity_ages.get(entity_id, 30.0)
	if age > DEATH_ONSET_AGE:
		var years_past := age - DEATH_ONSET_AGE
		var death_mult := minf(pow(DEATH_SCALING, years_past), DEATH_MAX_MULTIPLIER)
		base_rate *= death_mult
	return base_rate

func tick(delta: float) -> void:
	var dead: Array = []
	for entity_id in _entity_pools:
		var rate := get_consumption_rate(entity_id)
		var group_gen := _calculate_group_generation(entity_id)
		var net_consumption := (rate - group_gen) * delta
		_entity_pools[entity_id] -= net_consumption
		_entity_ages[entity_id] += delta * 0.001
		_entity_stages[entity_id] = _age_to_stage(_entity_ages[entity_id])
		if _entity_pools[entity_id] <= 0.0:
			dead.append(entity_id)
	for entity_id in dead:
		entity_died.emit(entity_id, "time_expired")
		_entity_pools.erase(entity_id)
		_entity_ages.erase(entity_id)
		_entity_stages.erase(entity_id)

func transfer_time(from_id: int, to_id: int, amount: float, method: int) -> float:
	if not _entity_pools.has(from_id) or not _entity_pools.has(to_id):
		return 0.0
	var available := minf(amount, _entity_pools[from_id])
	var efficiency: float = TRANSFER_EFFICIENCY.get(method, 0.5)
	var received := available * efficiency
	_entity_pools[from_id] -= available
	_entity_pools[to_id] += received
	time_transferred.emit(from_id, to_id, received, str(method))
	return received

func add_to_group(entity_id: int, group_type: String) -> void:
	if _entity_groups.has(entity_id):
		if not group_type in _entity_groups[entity_id]:
			_entity_groups[entity_id].append(group_type)

func entity_count() -> int:
	return _entity_pools.size()

func _calculate_group_generation(entity_id: int) -> float:
	var groups: Array = _entity_groups.get(entity_id, [])
	var total := 0.0
	for group in groups:
		total += GROUP_MULTIPLIERS.get(group, 0.0) * 0.1
	return total

func _age_to_stage(age: float) -> int:
	if age < 0.0: return LifeStage.FETUS
	if age < 2.0: return LifeStage.INFANT
	if age < 4.0: return LifeStage.TODDLER
	if age < 12.0: return LifeStage.CHILD
	if age < 18.0: return LifeStage.ADOLESCENT
	if age < 30.0: return LifeStage.YOUNG_ADULT
	if age < 50.0: return LifeStage.ADULT
	if age < 65.0: return LifeStage.MIDDLE_AGED
	if age < 80.0: return LifeStage.SENIOR
	return LifeStage.ELDERLY
