class_name GrainProperties
extends RefCounted

## Material properties
var hardness: float = 0.5        ## 0.0 (powder) to 1.0 (diamond)
var density: float = 1.0         ## g/cm3, affects weight
var flammability: float = 0.0    ## 0.0 (fireproof) to 1.0 (explosive)
var conductivity: float = 0.0    ## thermal/electrical
var opacity: float = 1.0         ## 0.0 (transparent) to 1.0 (opaque)
var solubility: float = 0.0      ## dissolves in water
var elasticity: float = 0.0      ## bounces vs shatters

## Magical/spiritual properties
var purity: float = 1.0          ## 0.0 (corrupted) to 1.0 (pure)
var resonance: float = 0.0       ## -1.0 to 1.0, magical attunement
var stability: float = 1.0       ## 0.0 (volatile) to 1.0 (inert)
var energy_level: float = 0.0    ## stored energy

## Environmental state (mutable per tick)
var temperature: float = 20.0    ## celsius
var pressure: float = 1.0        ## atmospheres
var moisture: float = 0.0        ## 0.0 (bone dry) to 1.0 (saturated)
var magical_charge: float = 0.0  ## ambient magical energy

## Depth in stack (set by GrainStack)
var depth: float = 0.0           ## 0.0 = surface, increases downward

static func from_dict(d: Dictionary) -> GrainProperties:
	var p := GrainProperties.new()
	var valid_keys := [
		"hardness", "density", "flammability", "conductivity",
		"opacity", "solubility", "elasticity", "purity", "resonance",
		"stability", "energy_level", "temperature", "pressure",
		"moisture", "magical_charge", "depth",
	]
	for key in d:
		if key in valid_keys:
			p.set(key, float(d[key]))
	return p

func to_dict() -> Dictionary:
	return {
		"hardness": hardness, "density": density, "flammability": flammability,
		"conductivity": conductivity, "opacity": opacity, "solubility": solubility,
		"elasticity": elasticity, "purity": purity, "resonance": resonance,
		"stability": stability, "energy_level": energy_level, "temperature": temperature,
		"pressure": pressure, "moisture": moisture, "magical_charge": magical_charge,
		"depth": depth,
	}
