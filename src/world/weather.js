import { smoothNoise } from '../core/random.js';

var WIND_DAMPING = {
  dense_forest: 0.25, forest: 0.50, tropical_forest: 0.35,
  swamp: 0.40, grassland: 1.0, steppe: 1.1, desert: 0.9,
  beach: 1.0, hills: 1.1, mountains: 1.3, arctic: 1.2,
  tundra: 1.1, volcanic: 0.8, mystic: 0.6, taiga: 0.45,
  savanna: 1.0, ocean: 1.2, deep_ocean: 1.3,
  shallow_water: 1.0, river: 0.8, lake: 0.7,
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export class WeatherSystem {
  constructor(lighting) {
    this.lighting = lighting;
    this._windAngle = 0.3;
    this._windTarget = 0.3;
    this._time = 0;
    this._precipTimer = 0;
    this._precipCycle = 0;
    this._yearTime = 0;
    this._preset = -1;
    this.state = {
      wind: { direction: 0.3, intensity: 0.4, gustPhase: 0, gustIntensity: 0 },
      precipitation: { type: 'none', intensity: 0, angle: 0.3 },
      clouds: { cover: 0.3, speed: 0.5, direction: 0.3 },
      season: { current: 'summer', progress: 0, dayOfYear: 180, yearProgress: 0.49 },
      atmosphere: { fog: 0, humidity: 0.5, temperature: 0.5 },
    };
  }

  update(dt, playerTile) {
    this._time += dt;
    this._updateWind(dt, playerTile);
    this._updatePrecipitation(dt, playerTile);
    this._updateClouds(dt);
    this._updateSeason(dt);
    this._updateAtmosphere(dt, playerTile);
  }

  _updateWind(dt, playerTile) {
    var drift = smoothNoise(this._time * 10, 0, 50, 9000) - 0.5;
    this._windAngle += drift * 0.02 * dt;
    if (Math.random() < dt * 0.02) {
      this._windTarget = this._windAngle + (Math.random() - 0.5) * 1.5;
    }
    this._windAngle += (this._windTarget - this._windAngle) * dt * 0.3;
    var baseIntensity = smoothNoise(this._time * 10, 0, 70, 9100) * 0.5 + 0.35;
    var gustFreq = 0.5 + baseIntensity * 2.0;
    var gustPhase = (Math.sin(this._time * gustFreq) + 1) * 0.5;
    var gustIntensity = gustPhase > 0.7 ? (gustPhase - 0.7) / 0.3 * 0.4 : 0;
    var damping = WIND_DAMPING[playerTile ? playerTile.biome : 'grassland'] || 1.0;
    this.state.wind = {
      direction: this._windAngle,
      intensity: clamp(baseIntensity * damping, 0, 1),
      gustPhase: gustPhase,
      gustIntensity: gustIntensity * damping,
    };
  }

  _updatePrecipitation(dt, playerTile) {
    this._precipTimer += dt;
    var cycleLen = 420;
    var cyclePhase = (this._precipTimer % cycleLen) / cycleLen;
    var rawIntensity = Math.max(0, Math.sin(cyclePhase * Math.PI) * 1.2 - 0.2);
    var type = 'none';
    if (rawIntensity > 0.05 && playerTile) {
      var heat = playerTile.climate ? playerTile.climate.heat : 0.5;
      var moisture = playerTile.climate ? playerTile.climate.moisture : 0.5;
      var biome = playerTile.biome;
      var season = this.state.season.current;
      // Use season-adjusted temperature for precipitation type
      var seasonTempMod = { spring: 0.1, summer: 0.25, autumn: 0, winter: -0.15 };
      var effectiveHeat = heat + (seasonTempMod[season] || 0);
      if ((biome === 'desert' || biome === 'steppe') && this.state.wind.intensity > 0.7) {
        type = 'sandstorm';
      } else if (effectiveHeat < 0.15 || (biome === 'arctic' && season === 'winter') || (biome === 'tundra' && season === 'winter')) {
        type = 'snow';
      } else if (moisture > 0.4 && effectiveHeat > 0.1) {
        type = 'rain';
      } else if (effectiveHeat < 0.25 && moisture > 0.3) {
        type = 'sleet';
      }
    }
    this.state.precipitation = {
      type: type,
      intensity: type === 'none' ? 0 : clamp(rawIntensity, 0, 1),
      angle: this._windAngle + (Math.random() - 0.5) * 0.05,
    };
  }

  _updateClouds(dt) {
    var targetCover = this.state.precipitation.intensity * 0.6 + 0.15;
    var cover = this.state.clouds.cover;
    cover += (targetCover - cover) * dt * 0.3;
    this.state.clouds = {
      cover: clamp(cover, 0, 1),
      speed: 0.3 + this.state.wind.intensity * 0.7,
      direction: this._windAngle,
    };
  }

  _updateSeason(dt) {
    var YEAR_DURATION = 30 * 60;
    this._yearTime = (this._yearTime + dt) % YEAR_DURATION;
    var yearProgress = this._yearTime / YEAR_DURATION;
    var dayOfYear = Math.floor(yearProgress * 365);
    var current;
    if (yearProgress < 0.25) current = 'spring';
    else if (yearProgress < 0.50) current = 'summer';
    else if (yearProgress < 0.75) current = 'autumn';
    else current = 'winter';
    var seasonStart = yearProgress < 0.25 ? 0 : yearProgress < 0.5 ? 0.25 : yearProgress < 0.75 ? 0.5 : 0.75;
    var progress = (yearProgress - seasonStart) / 0.25;
    this.state.season = { current: current, progress: progress, dayOfYear: dayOfYear, yearProgress: yearProgress };
  }

  _updateAtmosphere(dt, playerTile) {
    var sun = this.lighting.sun();
    var timeLabel = sun.label;
    var moisture = playerTile && playerTile.climate ? playerTile.climate.moisture : 0.5;
    var heat = playerTile && playerTile.climate ? playerTile.climate.heat : 0.5;
    var biome = playerTile ? playerTile.biome : 'grassland';
    var baseFog = 0;
    if (biome === 'swamp') baseFog += 0.25;
    if (biome === 'lake' || biome === 'river') baseFog += 0.15;
    var dawnBonus = (timeLabel === 'dawn') ? 0.2 : 0;
    var moistureBonus = Math.max(0, moisture - 0.5) * 0.3;
    var winterBonus = this.state.season.current === 'winter' ? 0.15 : 0;
    var fog = clamp(baseFog + dawnBonus + moistureBonus + winterBonus, 0, 1);
    var seasonTempMod = { spring: 0, summer: 0.15, autumn: -0.05, winter: -0.25 };
    var temp = clamp(heat + (seasonTempMod[this.state.season.current] || 0), 0, 1);
    this.state.atmosphere = { fog: fog, humidity: moisture, temperature: temp };
  }

  wind() { return this.state.wind; }
  precipitation() { return this.state.precipitation; }
  clouds() { return this.state.clouds; }
  season() { return this.state.season; }
  atmosphere() { return this.state.atmosphere; }

  cyclePreset() {
    var presets = ['clear', 'cloudy', 'rain', 'storm', 'snow'];
    this._preset = (this._preset + 1) % presets.length;
    var p = presets[this._preset];
    if (p === 'clear') {
      this._precipTimer = 0;
      this.state.clouds.cover = 0.1;
      this.state.precipitation = { type: 'none', intensity: 0, angle: this._windAngle };
    } else if (p === 'cloudy') {
      this.state.clouds.cover = 0.6;
      this.state.precipitation = { type: 'none', intensity: 0, angle: this._windAngle };
    } else if (p === 'rain') {
      this.state.precipitation = { type: 'rain', intensity: 0.6, angle: this._windAngle };
      this.state.clouds.cover = 0.7;
    } else if (p === 'storm') {
      this.state.precipitation = { type: 'rain', intensity: 0.95, angle: this._windAngle };
      this.state.clouds.cover = 0.95;
      this.state.wind.intensity = 0.9;
    } else if (p === 'snow') {
      this.state.precipitation = { type: 'snow', intensity: 0.5, angle: this._windAngle };
      this.state.clouds.cover = 0.8;
    }
    return p;
  }
}
