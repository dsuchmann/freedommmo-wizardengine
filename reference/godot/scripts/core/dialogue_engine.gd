class_name DialogueEngine
extends RefCounted

signal response_ready(npc_id: int, response: String)

var _pending_requests: Dictionary = {}
var causal_tracker: CausalTracker
var llm_client: LLMClient
var relationships: RelationshipSystem
var world_history: WorldHistory
var morality: MoralitySystem

func _init(p_causal: CausalTracker = null) -> void:
	causal_tracker = p_causal if p_causal else CausalTracker.new()
	llm_client = LLMClient.new()

func request_dialogue(npc: EntityBody, brain: NPCBrain, player_message: String, player_id: int = -1) -> String:
	var system_prompt := brain.generate_dialogue_context(player_id)
	var conversation := _get_conversation_history(npc.entity_id, player_id)
	conversation.append({"role": "user", "content": player_message})

	var response := ""

	# Fire LLM request async — show fallback immediately, replace when LLM responds
	if llm_client and llm_client.is_available():
		var full_prompt = _build_llm_system_prompt(npc, brain, system_prompt)
		response = "* %s is thinking... *" % npc.name
		# Send async request — response_ready signal will fire with actual reply
		var npc_id = npc.entity_id
		llm_client.request_dialogue(full_prompt, player_message, func(text):
			if not text.is_empty():
				response_ready.emit(npc_id, text)
				# Store conversation as memory
				var memory = InfoGrain.new(InfoGrainTypes.Category.NARRATIVE, InfoGrainTypes.Narrative.DIALOGUE)
				memory.intensity = 0.6
				memory.salience = 0.5
				memory.context = {"response": text.substr(0, 100), "player_said": player_message.substr(0, 50)}
				memory.decay_rate = 0.003
				npc.mind.add(memory)
				# Extract commitments from dialogue response
				_extract_commitments(npc, text)
			else:
				# LLM failed, emit fallback
				var fallback = _generate_fallback_response(npc, brain, player_message)
				response_ready.emit(npc_id, fallback)
		)
	else:
		response = _generate_fallback_response(npc, brain, player_message)

	# Record the interaction
	if causal_tracker:
		causal_tracker.record_event(player_id, npc.entity_id, "dialogue", {
			"player_said": player_message,
			"npc_said": response,
		})

	# Update NPC's mind based on interaction
	_update_mind_from_dialogue(npc, player_message)

	# Update relationship from conversation
	if relationships:
		relationships.record_interaction(player_id, npc.entity_id, "conversation")

	return response

## Generate a short ambient utterance via LLM. Returns "" if LLM unavailable.
## Calls callback with the result asynchronously.
func request_ambient_speech(npc: EntityBody, context: Dictionary, callback: Callable) -> void:
	if llm_client == null or not llm_client.is_available():
		return
	var occupation = context.get("occupation", "villager")
	var activity = context.get("activity", "idle")
	var emotion = context.get("emotion", "calm")
	var weather = context.get("weather", "clear")
	var period = context.get("period", "day")

	var prompt = "You are %s, a %s %s. " % [npc.name, _species_label(npc.species), occupation]
	prompt += "You are currently %s. You feel %s. " % [activity, emotion]
	prompt += "It is %s, weather is %s. " % [period, weather]
	prompt += "Say ONE short ambient thought or mutter aloud (max 8 words). No quotes. No narration. Just the spoken words."

	llm_client.request_dialogue(prompt, "", func(text):
		if not text.is_empty():
			# Trim to max 60 chars
			if text.length() > 60:
				text = text.substr(0, 57) + "..."
			# Remove quotes if the LLM added them
			text = text.strip_edges().trim_prefix("\"").trim_suffix("\"").trim_prefix("'").trim_suffix("'")
			callback.call(text)
	)

func _build_llm_system_prompt(npc: EntityBody, brain: NPCBrain, base_context: String) -> String:
	var p := ""

	# Identity + Occupation
	var occupation = "villager"
	if WorldManager and WorldManager.entity_spawner:
		var npc_data = WorldManager.entity_spawner._entities.get(npc.entity_id)
		if npc_data:
			occupation = npc_data.get("occupation", "villager")
	p += "You are %s, a %s %s. " % [npc.name, _species_label(npc.species), occupation]
	p += "Age %.0f. Time remaining: %.0f (time is the currency of life — when it hits 0, you die).\n" % [npc.age, npc.time_pool]
	# Occupation-specific personality
	match occupation:
		"blacksmith":
			p += "You are a skilled metalworker. You know weapons, armor, and tools intimately. You take pride in your craft.\n"
		"merchant":
			p += "You are a trader. You know prices, goods, and the value of things. You're always looking for a deal.\n"
		"guard":
			p += "You are a village guard. You take security seriously. You watch for threats and protect the village.\n"
		"farmer":
			p += "You work the land. You know crops, weather, and the rhythms of nature. You are practical and down-to-earth.\n"
		"hunter":
			p += "You track and hunt game. You know the wilderness, animal behavior, and survival skills.\n"
		"scholar":
			p += "You are learned. You study ancient texts, magic theory, and the nature of time itself.\n"

	# Physical state
	var stats = npc.get_computed_stats()
	var hp = stats.get("health", 100)
	var max_hp = stats.get("max_health", 100)
	if hp < max_hp * 0.5:
		p += "You are INJURED (%.0f/%.0f HP). You're in pain. This affects how you speak.\n" % [hp, max_hp]
	elif hp < max_hp * 0.25:
		p += "You are CRITICALLY WOUNDED. You can barely stand. You're desperate.\n"

	# Emotional state from MindStack
	var emotion = npc.mind.get_dominant_emotion()
	if emotion:
		var intensity = emotion.intensity
		var emotion_name = ""
		match emotion.info_type:
			InfoGrainTypes.Emotional.JOY: emotion_name = "joyful and warm"
			InfoGrainTypes.Emotional.SADNESS: emotion_name = "sad and melancholic"
			InfoGrainTypes.Emotional.ANGER: emotion_name = "angry and hostile"
			InfoGrainTypes.Emotional.FEAR: emotion_name = "afraid and anxious"
			InfoGrainTypes.Emotional.CONTENTMENT: emotion_name = "content and calm"
			InfoGrainTypes.Emotional.PRIDE: emotion_name = "proud and confident"
			InfoGrainTypes.Emotional.LOVE: emotion_name = "loving and affectionate"
			_: emotion_name = "emotionally complex"
		if intensity > 0.7:
			p += "You feel STRONGLY %s. This dominates your personality right now.\n" % emotion_name
		elif intensity > 0.3:
			p += "You feel somewhat %s.\n" % emotion_name

	# Motivations
	var motivation = npc.mind.get_strongest_motivation()
	if motivation:
		var motive_name = ""
		match motivation.info_type:
			InfoGrainTypes.Motivational.SURVIVAL: motive_name = "survival — finding food, water, shelter"
			InfoGrainTypes.Motivational.DESIRE: motive_name = "desire — wanting something badly"
			InfoGrainTypes.Motivational.VENGEANCE: motive_name = "vengeance — someone wronged you"
			InfoGrainTypes.Motivational.PROTECTION: motive_name = "protecting your loved ones"
			InfoGrainTypes.Motivational.GREED: motive_name = "accumulating wealth and power"
			InfoGrainTypes.Motivational.CURIOSITY: motive_name = "exploring and discovering new things"
			_: motive_name = "personal goals"
		p += "Your primary motivation: %s.\n" % motive_name

	# Grudges and bonds
	var grudges = npc.mind.get_by_type(InfoGrainTypes.Category.RELATIONAL, InfoGrainTypes.Relational.GRUDGE)
	if grudges.size() > 0:
		p += "You hold grudges. You don't easily forgive those who've wronged you.\n"
	var bonds = npc.mind.get_by_type(InfoGrainTypes.Category.RELATIONAL, InfoGrainTypes.Relational.BOND)
	if bonds.size() > 0:
		p += "You have bonds of friendship and loyalty.\n"

	# Memories
	var memories = npc.mind.get_by_type(InfoGrainTypes.Category.COGNITIVE, InfoGrainTypes.Cognitive.MEMORY)
	if memories.size() > 0:
		p += "Recent memories: "
		var mem_count = mini(memories.size(), 3)
		for i in range(mem_count):
			var ctx = memories[i].context
			if ctx is Dictionary and ctx.has("summary"):
				p += ctx["summary"] + ". "
		p += "\n"

	# Relationship with the player
	if relationships:
		var rels = relationships.get_all_relationships(npc.entity_id)
		for rel in rels:
			if rel.get("entity_id", -1) == 0:
				var strength = rel.get("strength", 0)
				var rel_type = rel.get("type", 0)
				if strength > 0.8:
					p += "You consider this person a CLOSE FRIEND. You trust them deeply and would do almost anything for them.\n"
				elif strength > 0.5:
					p += "You consider this person a friend. You like them and enjoy their company.\n"
				elif strength > 0.2:
					p += "You are acquainted with this person. You have spoken before.\n"
				elif strength < -0.5:
					p += "You HATE this person. They are your enemy.\n"
				elif strength < -0.2:
					p += "You dislike this person. You are suspicious of their intentions.\n"
				break

	# Brain context (goals, personality)
	if not base_context.is_empty():
		p += base_context + "\n"

	# Species personality traits
	match npc.species:
		EntityBody.Species.ELF:
			p += "As an elf, you are graceful, long-lived, and sometimes condescending toward shorter-lived races.\n"
		EntityBody.Species.DWARF:
			p += "As a dwarf, you are stubborn, loyal, love craftsmanship and ale.\n"
		EntityBody.Species.ORC:
			p += "As an orc, you value strength and honor above all. You speak directly.\n"
		EntityBody.Species.GOBLIN:
			p += "As a goblin, you are cunning, suspicious, and always looking for an angle.\n"

	# World context (static + dynamic)
	p += "\nWorld: medieval fantasy. Time is the fundamental resource — it can be shared, traded, stolen. "
	p += "All beings are mortal and competing for finite time. There are no inherent enemies — only living beings with their own goals.\n"
	# Time of day affects NPC mood
	if WorldManager and WorldManager.day_night:
		var hour = WorldManager.day_night.get_hour()
		if hour < 6 or hour > 22:
			p += "It is currently NIGHTTIME. You are tired and want to sleep.\n"
		elif hour < 10:
			p += "It is early morning. You are starting your day.\n"
		elif hour > 18:
			p += "It is evening. You are winding down for the day.\n"
	if WorldManager and WorldManager.weather:
		var weather_name = WorldManager.weather.get_weather_name()
		if weather_name != "Clear":
			p += "The weather is %s. This affects your mood.\n" % weather_name

	# World history context (dynamic, dimension-relevant to this NPC)
	if world_history:
		var history_ctx = world_history.query_for_entity(npc.species, "", 4)
		if not history_ctx.is_empty():
			p += "\n%s\n" % history_ctx

	# Current activity from schedule
	if WorldManager and WorldManager.npc_schedules and WorldManager.day_night:
		var hour = WorldManager.day_night.get_hour()
		var activity = WorldManager.npc_schedules.get_current_activity(npc.entity_id, hour)
		var act_name = activity.get("activity", "idle")
		var act_loc = activity.get("location", "")
		if act_name != "idle":
			p += "You are currently %s" % act_name
			if not act_loc.is_empty():
				p += " at the %s" % act_loc
			p += ". "
			if act_name == "sleep":
				p += "You are very tired and annoyed at being woken up.\n"
			elif act_name == "eat":
				p += "You are eating and in a relaxed mood.\n"
			elif act_name == "work" or act_name == "farm":
				p += "You are busy working and may be short with idle conversation.\n"
			elif act_name == "socialize":
				p += "You are relaxing and open to conversation.\n"
			elif act_name == "patrol":
				p += "You are on guard duty and alert for threats.\n"
			else:
				p += "\n"

	# Faction context
	if WorldManager and WorldManager.faction_sys:
		var npc_faction = WorldManager.faction_sys.get_faction(npc.entity_id)
		if not npc_faction.is_empty() and npc_faction != "neutral":
			p += "You belong to the %s faction.\n" % npc_faction.capitalize()
			var player_rep = WorldManager.faction_sys.get_reputation(0, npc_faction)
			if player_rep > 75:
				p += "This person is highly respected by your faction. Treat them as an honored ally.\n"
			elif player_rep < 10:
				p += "This person is an ENEMY of your faction. You distrust them deeply.\n"

	# Player reputation context
	if morality:
		var player_karma = morality.get_karma(0)
		if player_karma < -20:
			p += "\nThe person you're speaking to has a TERRIBLE reputation. They are known as a murderer and criminal. You are afraid of them or hostile.\n"
		elif player_karma < -5:
			p += "\nThe person you're speaking to has a bad reputation. They've done questionable things. You are wary.\n"
		elif player_karma > 20:
			p += "\nThe person you're speaking to is known as a hero and benefactor. You admire them.\n"
		elif player_karma > 5:
			p += "\nThe person you're speaking to has a good reputation. They seem trustworthy.\n"

	# Interaction rules
	p += "\nRules: Stay in character. Respond in 1-3 sentences. Be natural and emotionally authentic. "
	p += "React to what the player says based on your emotional state and personality. "
	p += "You can be flirtatious, aggressive, scared, warm, cold, or anything that fits your current state. "
	p += "You have free will. You can refuse, agree, negotiate, lie, or be honest. "
	p += "Never break character. Never mention being an AI or NPC.\n"

	return p

func _queue_async_llm(npc_id: int, player_id: int, system_prompt: String, user_message: String) -> void:
	if llm_client == null or not llm_client.is_available():
		return
	llm_client.request_dialogue(system_prompt, user_message, func(text):
		if not text.is_empty():
			response_ready.emit(npc_id, text)
			# Store as narrative memory
			var summary = InfoGrain.new(InfoGrainTypes.Category.NARRATIVE, InfoGrainTypes.Narrative.DIALOGUE)
			summary.intensity = 0.6
			summary.salience = 0.5
			summary.context = {"llm_response": text.substr(0, 100), "player_id": player_id}
			summary.decay_rate = 0.003
	)

func _species_label(species: int) -> String:
	match species:
		EntityBody.Species.HUMAN: return "human"
		EntityBody.Species.ELF: return "elf"
		EntityBody.Species.DWARF: return "dwarf"
		EntityBody.Species.ORC: return "orc"
		EntityBody.Species.GOBLIN: return "goblin"
		EntityBody.Species.DRAGON: return "dragon"
		_: return "being"

func _generate_fallback_response(npc: EntityBody, brain: NPCBrain, player_message: String) -> String:
	var emotion = npc.mind.get_dominant_emotion()
	var motivation = npc.mind.get_strongest_motivation()
	var msg_lower := player_message.to_lower()

	# Greeting detection
	if "hello" in msg_lower or "hi" in msg_lower or "hey" in msg_lower:
		if emotion and emotion.info_type == InfoGrainTypes.Emotional.JOY:
			return "Well met, friend! What a fine day it is."
		elif emotion and emotion.info_type == InfoGrainTypes.Emotional.FEAR:
			return "Oh! You startled me... What do you want?"
		elif emotion and emotion.info_type == InfoGrainTypes.Emotional.ANGER:
			return "What? What do you want?"
		else:
			return "Greetings, traveler."

	# Name/identity
	if "name" in msg_lower or "who" in msg_lower:
		return "I am %s. I've lived here for %.0f years." % [npc.name, npc.age]

	# Help/quest
	if "help" in msg_lower or "need" in msg_lower or "quest" in msg_lower:
		if motivation and motivation.info_type == InfoGrainTypes.Motivational.SURVIVAL:
			return "I could use some help finding food. These lands have been sparse lately."
		elif motivation and motivation.info_type == InfoGrainTypes.Motivational.VENGEANCE:
			return "There is someone who wronged me. I seek justice."
		elif motivation and motivation.info_type == InfoGrainTypes.Motivational.PROTECTION:
			return "My family needs protection. Strange creatures roam at night."
		else:
			return "I don't need help right now, but thank you for asking."

	# Trade
	if "trade" in msg_lower or "buy" in msg_lower or "sell" in msg_lower:
		return "I don't have much to trade, but let me see what you have."

	# Feelings
	if "feel" in msg_lower or "how are" in msg_lower:
		if emotion:
			match emotion.info_type:
				InfoGrainTypes.Emotional.JOY:
					return "I feel wonderful today! The sun is warm and the harvest is good."
				InfoGrainTypes.Emotional.SADNESS:
					return "I've been better... Lost someone dear to me recently."
				InfoGrainTypes.Emotional.FEAR:
					return "Truthfully? I'm scared. Something feels wrong in these lands."
				InfoGrainTypes.Emotional.ANGER:
					return "Furious, if I'm honest. But I'd rather not talk about it."
				InfoGrainTypes.Emotional.CONTENTMENT:
					return "Content enough. Can't complain."
				_:
					return "I'm managing. Each day is a gift of time."
		return "I'm alright. Time moves forward, as it always does."

	# Goodbye
	if "bye" in msg_lower or "farewell" in msg_lower or "leave" in msg_lower:
		return "Safe travels, stranger. May your time be well spent."

	# Romance/intimacy
	if "sex" in msg_lower or "love" in msg_lower or "kiss" in msg_lower or "romance" in msg_lower or "date" in msg_lower:
		if emotion and emotion.info_type == InfoGrainTypes.Emotional.JOY:
			return "You're bold! I like that about you. But maybe buy me a drink first?"
		elif emotion and emotion.info_type == InfoGrainTypes.Emotional.ANGER:
			return "How dare you! I barely know you. Get away from me."
		elif emotion and emotion.info_type == InfoGrainTypes.Emotional.FEAR:
			return "I... that's very forward. I need to think about it."
		return "That's quite the proposition. We barely know each other, stranger."

	# Combat/fighting
	if "fight" in msg_lower or "kill" in msg_lower or "attack" in msg_lower or "battle" in msg_lower:
		if emotion and emotion.info_type == InfoGrainTypes.Emotional.ANGER:
			return "You want a fight? I'll give you one! Come at me!"
		return "Violence isn't usually my first choice, but I can defend myself if I must."

	# Location/world
	if "where" in msg_lower or "place" in msg_lower or "village" in msg_lower or "town" in msg_lower:
		return "This is our village. We've built it from nothing. The forest to the east has good hunting, but beware the mountains to the north."

	# Time/life
	if "time" in msg_lower or "old" in msg_lower or "age" in msg_lower or "life" in msg_lower:
		return "I've lived %.0f years and have %.0f time units left. Every moment is precious in this world." % [npc.age, npc.time_pool]

	# Weather
	if "weather" in msg_lower or "rain" in msg_lower or "cold" in msg_lower or "hot" in msg_lower:
		return "The weather changes often around here. Best to be prepared for anything."

	# Work/occupation
	if "work" in msg_lower or "job" in msg_lower or "do" in msg_lower:
		if motivation and motivation.info_type == InfoGrainTypes.Motivational.SURVIVAL:
			return "I work to survive. Gathering food, finding shelter. It's a simple life but it's honest."
		return "I keep busy. There's always something that needs doing in the village."

	# Default - personality-driven with more variety
	var responses := []
	if emotion and emotion.intensity > 0.6:
		match emotion.info_type:
			InfoGrainTypes.Emotional.JOY:
				responses = ["Ha! You're an interesting one.", "Life is good today. What brings you here?", "I'm in a fine mood! Ask me anything."]
			InfoGrainTypes.Emotional.FEAR:
				responses = ["I... I'm not sure about that.", "Something feels wrong lately. Be careful.", "Can we talk about something else? I'm nervous."]
			InfoGrainTypes.Emotional.ANGER:
				responses = ["Hmph. Is that so?", "I'm not in the mood for idle talk.", "Don't test my patience."]
			InfoGrainTypes.Emotional.SADNESS:
				responses = ["*sighs* It's been a hard day.", "I've seen better times, friend.", "Sorry... I'm not great company right now."]
			_:
				responses = ["Interesting. Tell me more.", "I hadn't thought about that.", "Go on..."]
	else:
		responses = [
			"Hmm, tell me more about that.",
			"That's an interesting thought. What makes you say so?",
			"I've heard stranger things. What else is on your mind?",
			"Life in the village is quiet, but there's always something happening if you look.",
			"You seem like someone with stories to tell.",
			"The world is full of mysteries. Sometimes I wonder what lies beyond the mountains.",
		]
	return responses[randi() % responses.size()]

func _update_mind_from_dialogue(npc: EntityBody, player_message: String) -> void:
	# Friendly interaction increases bond
	var msg_lower := player_message.to_lower()
	if "help" in msg_lower or "friend" in msg_lower or "thank" in msg_lower:
		var bond = InfoGrain.new(InfoGrainTypes.Category.RELATIONAL, InfoGrainTypes.Relational.BOND)
		bond.intensity = 0.2
		bond.target_entity_id = -1
		bond.salience = 0.4
		npc.mind.add(bond)

	# Threatening interaction increases grudge
	if "kill" in msg_lower or "fight" in msg_lower or "die" in msg_lower:
		var grudge = InfoGrain.new(InfoGrainTypes.Category.RELATIONAL, InfoGrainTypes.Relational.GRUDGE)
		grudge.intensity = 0.3
		grudge.target_entity_id = -1
		grudge.salience = 0.6
		npc.mind.add(grudge)

	# Add memory of conversation
	var memory = InfoGrain.new(InfoGrainTypes.Category.COGNITIVE, InfoGrainTypes.Cognitive.MEMORY)
	memory.intensity = 0.5
	memory.salience = 0.3
	memory.context = {"type": "conversation", "summary": player_message.substr(0, 50)}
	memory.decay_rate = 0.005
	npc.mind.add(memory)

func _get_conversation_history(npc_id: int, player_id: int) -> Array:
	if causal_tracker == null:
		return []
	var events = causal_tracker.get_events_between(player_id, npc_id)
	var history: Array = []
	for e in events:
		if e["action"] == "dialogue":
			var details: Dictionary = e.get("details", {})
			if details.has("player_said"):
				history.append({"role": "user", "content": details["player_said"]})
			if details.has("npc_said"):
				history.append({"role": "assistant", "content": details["npc_said"]})
	return history

## Extract commitments from NPC dialogue and create goals.
## Looks for intent signals in the response text that indicate the NPC
## is making a promise, invitation, or commitment that should be tracked.
func _extract_commitments(npc: EntityBody, response: String) -> void:
	if WorldManager == null or WorldManager.npc_goal_system == null:
		return
	var lower = response.to_lower()
	# Commitment patterns — signals that the NPC intends to do something
	var commitment_signals = [
		["meet me", "meet you"], ["come to", "come by"],
		["i'll be at", "i will be at", "i'll wait"],
		["tonight", "tomorrow", "later today"],
		["i promise", "you have my word"],
		["let's meet", "shall we meet", "we should meet"],
		["i'll bring", "i will bring", "i'll get"],
		["i'll help", "i will help"],
	]
	var found_commitment = false
	var commitment_text = ""
	for signals in commitment_signals:
		for signal_phrase in signals:
			if signal_phrase in lower:
				found_commitment = true
				# Extract a short commitment description from the sentence containing the signal
				var idx = lower.find(signal_phrase)
				var start = maxi(0, lower.rfind(".", idx - 1) + 1)
				var end = lower.find(".", idx)
				if end < 0:
					end = mini(lower.length(), idx + 60)
				commitment_text = response.substr(start, end - start).strip_edges()
				if commitment_text.length() > 50:
					commitment_text = commitment_text.substr(0, 50) + "..."
				break
		if found_commitment:
			break

	if found_commitment and commitment_text != "":
		# Create a commitment goal for the NPC
		var npc_data = WorldManager.entity_spawner._entities.get(npc.entity_id)
		var target_x = npc_data.get("home_x", -1) if npc_data else -1
		var target_y = npc_data.get("home_y", -1) if npc_data else -1
		# Determine time based on keywords
		var target_time = 0.0
		if WorldManager.day_night:
			target_time = WorldManager.day_night.get_total_time()
			if "tonight" in lower:
				target_time += 6 * 3600  # ~6 hours from now
			elif "tomorrow" in lower:
				target_time += 24 * 3600
			else:
				target_time += 2 * 3600  # default: 2 hours
		WorldManager.npc_goal_system.add_commitment(
			npc.entity_id, commitment_text, target_x, target_y, target_time)
		# Store commitment as a high-salience memory
		var commitment_grain = InfoGrain.new(InfoGrainTypes.Category.COGNITIVE, InfoGrainTypes.Cognitive.PLAN)
		commitment_grain.intensity = 0.8
		commitment_grain.salience = 0.9
		commitment_grain.context = {"type": "dialogue_commitment", "text": commitment_text}
		commitment_grain.decay_rate = 0.001
		npc.mind.add(commitment_grain)
