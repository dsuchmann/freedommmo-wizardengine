class_name DayNightCycle
extends RefCounted

signal time_of_day_changed(hour: int, period: String)

var _hour: float = 8.0
var _day: int = 1
var _time_scale: float = 60.0  # 1 real second = 1 game minute

# Time boundaries
const DAWN_START := 4.0       # Was 4.5
const DAWN_END := 8.0         # Was 7.0
const GOLDEN_START := 14.5    # Was 15.0
const SUNSET := 19.0          # Was 18.5
const DUSK_END := 21.5        # Was 20.5

var _last_period: String = "day"


func tick(delta: float) -> void:
	_hour += delta * _time_scale / 3600.0
	if _hour >= 24.0:
		_hour -= 24.0
		_day += 1
	var period = get_period()
	if period != _last_period:
		_last_period = period
		time_of_day_changed.emit(int(_hour), period)


func get_hour() -> float:
	return _hour


func get_day() -> int:
	return _day


func get_total_time() -> float:
	return (_day - 1) * 24.0 * 3600.0 + _hour * 3600.0


func get_period() -> String:
	if _hour < DAWN_START: return "night"
	if _hour < DAWN_END: return "dawn"
	if _hour < GOLDEN_START: return "day"
	if _hour < DUSK_END: return "dusk"
	return "night"


func get_light_level() -> float:
	## Smooth 0-1 value: 0 at night, 1 at midday. Used for ambient_floor interpolation.
	## Uses smoothstep for gentle transitions, no hard edges.
	if _hour >= DAWN_START and _hour <= DUSK_END:
		var mid = (DAWN_START + DUSK_END) / 2.0
		var half = mid - DAWN_START
		var dist = abs(_hour - mid) / half
		return 1.0 - smoothstep(0.7, 1.0, dist)
	return 0.0


func get_time_string() -> String:
	var h := int(_hour) % 24
	var m := int((_hour - int(_hour)) * 60)
	var ampm := "AM" if h < 12 else "PM"
	var h12 := h % 12
	if h12 == 0: h12 = 12
	return "%d:%02d %s" % [h12, m, ampm]


func smoothstep(edge0: float, edge1: float, x: float) -> float:
	var t = clampf((x - edge0) / (edge1 - edge0), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


func _smoothlerp(a: Color, b: Color, t: float) -> Color:
	var st = t * t * (3.0 - 2.0 * t)
	return a.lerp(b, st)


# === Sun/Moon Direction ===

func get_sun_angle() -> float:
	## Continuous 360° rotation over 24 hours — no snaps.
	## 6:00 = east (0°), 12:00 = south (90°), 18:00 = west (180°), 0:00 = north (270°)
	var angle_deg = fmod((_hour - 6.0) * 15.0 + 360.0, 360.0)  # 15°/hour, offset so 6AM = 0°
	return deg_to_rad(angle_deg)


func get_sun_height() -> float:
	## Smooth curve: low at dawn/dusk (long shadows), high at noon (short shadows).
	## Smooth transition into night (no snap).
	if _hour >= DAWN_START and _hour <= DUSK_END:
		var mid = (DAWN_START + DUSK_END) / 2.0
		var half = mid - DAWN_START
		var dist = abs(_hour - mid) / half
		# Smoothly goes from 1.0 (noon) to 0.15 (dawn/dusk edges)
		return lerpf(1.0, 0.15, smoothstep(0.0, 1.0, dist))
	else:
		return 0.15  # Moon: same as dawn/dusk edge — no snap


# === Directional Light Energy ===

func get_sun_energy() -> float:
	## Smooth energy curve. Night is very dim, day is full.
	## Uses the same smooth transition logic as light_level.
	var level = get_light_level()
	# Day: 1.0, Night: 0.12. Smooth interpolation.
	return lerpf(0.12, 1.0, level)


# === Directional Light Color ===

func get_sun_color() -> Color:
	var night_color := Color(0.35, 0.4, 0.65)
	var dawn_color := Color(1.0, 0.55, 0.3)
	var day_color := Color(1.0, 0.98, 0.92)
	var golden_color := Color(1.0, 0.6, 0.2)
	var dusk_color := Color(0.95, 0.35, 0.12)

	if _hour < DAWN_START:
		return night_color
	elif _hour < DAWN_END:
		var t = (_hour - DAWN_START) / (DAWN_END - DAWN_START)
		if t < 0.5:
			return _smoothlerp(night_color, dawn_color, t * 2.0)
		else:
			return _smoothlerp(dawn_color, day_color, (t - 0.5) * 2.0)
	elif _hour < GOLDEN_START:
		return day_color
	elif _hour < DUSK_END:
		var t = (_hour - GOLDEN_START) / (DUSK_END - GOLDEN_START)
		if t < 0.35:
			return _smoothlerp(day_color, golden_color, t / 0.35)
		elif t < 0.65:
			return _smoothlerp(golden_color, dusk_color, (t - 0.35) / 0.3)
		else:
			return _smoothlerp(dusk_color, night_color, (t - 0.65) / 0.35)
	else:
		return night_color


# === Ambient Tint (applied in shader fragment()) ===

func get_ambient_color() -> Color:
	var night_tint := Color(0.2, 0.25, 0.6)
	var dawn_tint := Color(0.9, 0.5, 0.25)
	var day_tint := Color(1.0, 1.0, 0.93)
	var golden_tint := Color(1.0, 0.7, 0.2)
	var sunset_tint := Color(0.9, 0.4, 0.15)
	var blue_dusk := Color(0.35, 0.3, 0.6)

	if _hour < DAWN_START:
		return night_tint
	elif _hour < DAWN_END:
		var t = (_hour - DAWN_START) / (DAWN_END - DAWN_START)
		if t < 0.5:
			return _smoothlerp(night_tint, dawn_tint, t * 2.0)
		else:
			return _smoothlerp(dawn_tint, day_tint, (t - 0.5) * 2.0)
	elif _hour < GOLDEN_START:
		return day_tint
	elif _hour < DUSK_END:
		var t = (_hour - GOLDEN_START) / (DUSK_END - GOLDEN_START)
		if t < 0.3:
			return _smoothlerp(day_tint, golden_tint, t / 0.3)
		elif t < 0.55:
			return _smoothlerp(golden_tint, sunset_tint, (t - 0.3) / 0.25)
		elif t < 0.75:
			return _smoothlerp(sunset_tint, blue_dusk, (t - 0.55) / 0.2)
		else:
			return _smoothlerp(blue_dusk, night_tint, (t - 0.75) / 0.25)
	else:
		return night_tint


func get_tint_strength() -> float:
	if _hour < DAWN_START:
		return 0.65
	elif _hour < DAWN_END:
		var t = (_hour - DAWN_START) / (DAWN_END - DAWN_START)
		var st = t * t * (3.0 - 2.0 * t)
		return lerpf(0.65, 0.0, st)
	elif _hour < GOLDEN_START:
		return 0.0
	elif _hour < DUSK_END:
		var t = (_hour - GOLDEN_START) / (DUSK_END - GOLDEN_START)
		var st = t * t * (3.0 - 2.0 * t)
		return lerpf(0.0, 0.65, st)
	else:
		return 0.65


func get_scene_brightness() -> float:
	## Overall brightness multiplier. 1.0 = full day/golden. 0.6 = night (visible).
	## This is the ONLY dimming factor. Shade (0.5-1.0) adds directional contrast.
	if _hour >= DAWN_END and _hour <= SUNSET:
		return 1.0
	elif _hour >= DAWN_START and _hour < DAWN_END:
		var t = (_hour - DAWN_START) / (DAWN_END - DAWN_START)
		return lerpf(0.6, 1.0, t)
	elif _hour > SUNSET and _hour <= DUSK_END:
		var t = (_hour - SUNSET) / (DUSK_END - SUNSET)
		return lerpf(1.0, 0.6, t)
	else:
		return 0.6


# === Moonlight Spotlight ===

func get_moonlight_energy() -> float:
	## Smooth crossfade with sun. Strong at night, zero during day.
	var level = get_light_level()
	# Inverse of light level: 1.5 at night, 0 at day
	return lerpf(1.5, 0.0, level)


func set_time(hour: float) -> void:
	_hour = fmod(hour, 24.0)
	if _hour < 0:
		_hour += 24.0


func set_time_scale(scale: float) -> void:
	_time_scale = scale
