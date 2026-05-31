extends CharacterBody2D

@export var speed: float = 300.0
@export var camera_smoothing: float = 5.0

@onready var camera: Camera2D = $Camera2D
@onready var sprite: Sprite2D = $Sprite2D

var facing_direction: Vector2 = Vector2.DOWN

func _ready() -> void:
	camera.make_current()
	_create_placeholder_texture()

func _physics_process(delta: float) -> void:
	var input_dir := Vector2.ZERO
	if Input.is_action_pressed("ui_right"):
		input_dir.x += 1
	if Input.is_action_pressed("ui_left"):
		input_dir.x -= 1
	if Input.is_action_pressed("ui_down"):
		input_dir.y += 1
	if Input.is_action_pressed("ui_up"):
		input_dir.y -= 1

	if input_dir.length() > 0:
		input_dir = input_dir.normalized()
		facing_direction = input_dir

	velocity = input_dir * speed
	move_and_slide()

	# Smooth camera follow
	camera.global_position = camera.global_position.lerp(global_position, camera_smoothing * delta)

func _create_placeholder_texture() -> void:
	# Generate a 32x32 placeholder character sprite
	var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)

	# Body (blue)
	for y in range(8, 28):
		for x in range(8, 24):
			img.set_pixel(x, y, Color(0.2, 0.4, 0.8))

	# Head (skin tone)
	for y in range(2, 10):
		for x in range(10, 22):
			img.set_pixel(x, y, Color(0.9, 0.75, 0.6))

	# Eyes
	img.set_pixel(13, 5, Color.BLACK)
	img.set_pixel(18, 5, Color.BLACK)

	# Feet (brown)
	for y in range(28, 32):
		for x in range(8, 14):
			img.set_pixel(x, y, Color(0.4, 0.25, 0.1))
		for x in range(18, 24):
			img.set_pixel(x, y, Color(0.4, 0.25, 0.1))

	var tex := ImageTexture.create_from_image(img)
	sprite.texture = tex
