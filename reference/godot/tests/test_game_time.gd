extends SceneTree

func _init() -> void:
	_run_tests()
	quit()

func _run_tests() -> void:
	test_initial_state()
	test_time_progression()
	test_pause_resume()
	test_time_scale()
	test_reset()
	test_signal_emission()
	print("All GameTime tests passed.")

func test_initial_state() -> void:
	var gt = preload("res://scripts/autoload/GameTime.gd").new()
	gt._ready()
	_assert(gt.get_time_seconds() == 0.0, "initial time should be 0")
	_assert(not gt.is_paused(), "should not be paused initially")
	_assert(gt.get_time_scale() == 1.0, "initial time scale should be 1.0")

func test_time_progression() -> void:
	var gt = preload("res://scripts/autoload/GameTime.gd").new()
	gt._ready()
	gt._process(0.1)
	_assert(absf(gt.get_time_seconds() - 0.1) < 0.001, "time should advance by 0.1")
	gt._process(0.2)
	_assert(absf(gt.get_time_seconds() - 0.3) < 0.001, "time should advance to 0.3")

func test_pause_resume() -> void:
	var gt = preload("res://scripts/autoload/GameTime.gd").new()
	gt._ready()
	gt._process(0.1)
	var paused_time := gt.get_time_seconds()
	gt.pause()
	_assert(gt.is_paused(), "should be paused")
	gt._process(0.5)
	_assert(gt.get_time_seconds() == paused_time, "time should not advance while paused")
	gt.resume()
	_assert(not gt.is_paused(), "should not be paused after resume")
	gt._process(0.2)
	_assert(gt.get_time_seconds() > paused_time, "time should advance after resume")

func test_time_scale() -> void:
	var gt = preload("res://scripts/autoload/GameTime.gd").new()
	gt._ready()
	gt.set_time_scale(2.0)
	_assert(gt.get_time_scale() == 2.0, "time scale should be 2.0")
	gt._process(0.1)
	_assert(absf(gt.get_time_seconds() - 0.2) < 0.001, "time should advance by 0.2 at 2x scale")

func test_reset() -> void:
	var gt = preload("res://scripts/autoload/GameTime.gd").new()
	gt._ready()
	gt._process(1.0)
	gt.reset()
	_assert(gt.get_time_seconds() == 0.0, "time should be 0 after reset")

func test_signal_emission() -> void:
	var gt = preload("res://scripts/autoload/GameTime.gd").new()
	gt._ready()
	var received_delta := 0.0
	var callback := func(delta: float) -> void:
		received_delta = delta
	gt.time_updated.connect(callback)
	gt._process(0.15)
	_assert(absf(received_delta - 0.15) < 0.001, "signal should emit with correct delta")

func _assert(condition: bool, message: String = "") -> void:
	if not condition:
		push_error("ASSERTION FAILED: %s" % message)
		quit(1)
