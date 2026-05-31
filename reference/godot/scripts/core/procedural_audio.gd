class_name ProceduralAudio
extends Node

## Generates basic sound effects procedurally using AudioStreamGenerator.
## No external audio files needed — everything synthesized at runtime.
## Provides footsteps, combat hits, UI clicks, ambient tones.

var _player: AudioStreamPlayer
var _generator: AudioStreamGenerator
var _playback: AudioStreamGeneratorPlayback
var _queue: Array = []  # queued sound descriptors
var _playing: bool = false

func _ready() -> void:
	_player = AudioStreamPlayer.new()
	_generator = AudioStreamGenerator.new()
	_generator.mix_rate = 22050
	_generator.buffer_length = 0.5
	_player.stream = _generator
	_player.volume_db = -6
	add_child(_player)

func play_sound(type: String) -> void:
	_queue.append(type)
	if not _playing:
		_play_next()

func _play_next() -> void:
	if _queue.is_empty():
		_playing = false
		return
	_playing = true
	var type = _queue.pop_front()
	_player.play()
	_playback = _player.get_stream_playback()
	if _playback == null:
		_playing = false
		return
	_generate_sound(type)
	# Auto-stop after sound duration
	get_tree().create_timer(0.15).timeout.connect(func():
		_player.stop()
		_play_next()
	)

func _generate_sound(type: String) -> void:
	if _playback == null:
		return
	var frames = _playback.get_frames_available()
	if frames <= 0:
		return
	var rate = _generator.mix_rate

	match type:
		"footstep_grass", "footstep_default":
			_gen_noise(frames, 0.08, 0.03)  # Soft crunch
		"footstep_stone":
			_gen_click(frames, 800, 0.12, 0.02)  # Sharp tap
		"footstep_sand":
			_gen_noise(frames, 0.05, 0.05)  # Soft shuffle
		"footstep_water":
			_gen_splash(frames, 0.1)
		"footstep_wood":
			_gen_click(frames, 500, 0.1, 0.02)
		"footstep_snow":
			_gen_noise(frames, 0.04, 0.04)
		"combat_melee_hit":
			_gen_impact(frames, 200, 0.3)
		"combat_block":
			_gen_click(frames, 1200, 0.2, 0.01)
		"combat_miss":
			_gen_swoosh(frames, 0.15)
		"combat_death":
			_gen_descending(frames, 400, 100, 0.2)
		"ui_click":
			_gen_click(frames, 1000, 0.08, 0.01)
		"ui_open":
			_gen_ascending(frames, 600, 900, 0.1)
		"ui_close":
			_gen_descending(frames, 900, 600, 0.1)
		"ui_error":
			_gen_click(frames, 200, 0.15, 0.02)
		"interaction_dig":
			_gen_impact(frames, 150, 0.2)
		"interaction_pickup":
			_gen_ascending(frames, 800, 1200, 0.1)
		"interaction_craft":
			_gen_click(frames, 600, 0.15, 0.03)
		"level_up":
			_gen_fanfare(frames)
		"quest_complete":
			_gen_ascending(frames, 500, 1000, 0.15)
		_:
			_gen_click(frames, 440, 0.05, 0.02)

func _gen_noise(frames: int, volume: float, decay: float) -> void:
	for i in range(mini(frames, 3000)):
		var t = float(i) / _generator.mix_rate
		var env = maxf(0, volume * (1.0 - t / decay))
		var sample = (randf() * 2.0 - 1.0) * env
		_playback.push_frame(Vector2(sample, sample))

func _gen_click(frames: int, freq: float, volume: float, duration: float) -> void:
	for i in range(mini(frames, 3000)):
		var t = float(i) / _generator.mix_rate
		if t > duration:
			break
		var env = volume * (1.0 - t / duration)
		var sample = sin(t * freq * TAU) * env
		_playback.push_frame(Vector2(sample, sample))

func _gen_impact(frames: int, freq: float, volume: float) -> void:
	for i in range(mini(frames, 3000)):
		var t = float(i) / _generator.mix_rate
		var env = volume * exp(-t * 20)
		var tone = sin(t * freq * TAU) * 0.5
		var noise = (randf() * 2.0 - 1.0) * 0.5
		var sample = (tone + noise) * env
		_playback.push_frame(Vector2(sample, sample))

func _gen_splash(frames: int, volume: float) -> void:
	for i in range(mini(frames, 3000)):
		var t = float(i) / _generator.mix_rate
		var env = volume * exp(-t * 15)
		var sample = (randf() * 2.0 - 1.0) * env * sin(t * 200 * TAU)
		_playback.push_frame(Vector2(sample, sample))

func _gen_swoosh(frames: int, volume: float) -> void:
	for i in range(mini(frames, 3000)):
		var t = float(i) / _generator.mix_rate
		var freq = 2000 - t * 15000
		var env = volume * sin(t * PI / 0.15) if t < 0.15 else 0.0
		var sample = (randf() * 2.0 - 1.0) * env * 0.5 + sin(t * freq * TAU) * env * 0.5
		_playback.push_frame(Vector2(sample, sample))

func _gen_ascending(frames: int, freq_start: float, freq_end: float, duration: float) -> void:
	for i in range(mini(frames, 3000)):
		var t = float(i) / _generator.mix_rate
		if t > duration:
			break
		var freq = lerpf(freq_start, freq_end, t / duration)
		var env = 0.15 * (1.0 - t / duration)
		_playback.push_frame(Vector2(sin(t * freq * TAU) * env, sin(t * freq * TAU) * env))

func _gen_descending(frames: int, freq_start: float, freq_end: float, duration: float) -> void:
	_gen_ascending(frames, freq_end, freq_start, duration)

func _gen_fanfare(frames: int) -> void:
	var notes = [523, 659, 784, 1047]  # C E G C (major chord arpeggio)
	var note_dur = 0.06
	for n in range(notes.size()):
		for i in range(mini(int(note_dur * _generator.mix_rate), frames)):
			var t = float(i) / _generator.mix_rate + n * note_dur
			var env = 0.12 * (1.0 - float(i) / (note_dur * _generator.mix_rate))
			var sample = sin(t * notes[n] * TAU) * env
			_playback.push_frame(Vector2(sample, sample))
