// motion-taxonomy.js — Complete taxonomy of solo entity choreographies.
// Organized by category. Each entry is a natural-language command.
// The spatial composer + compiler turns these into validated animations.

export const TAXONOMY = {
  // ── GREETINGS & SOCIAL ────────────────────────────────────────────────
  greetings: [
    'wave hello', 'wave goodbye', 'wave with both hands', 'small wave', 'big enthusiastic wave',
    'nod in greeting', 'bow slightly', 'bow deeply', 'bow formally', 'curtsy',
    'salute', 'casual salute', 'tip an imaginary hat', 'blow a kiss',
    'beckon someone over', 'beckon urgently', 'shoo someone away',
    'point at someone', 'point forward', 'point up', 'point down', 'point left', 'point right',
    'give thumbs up', 'give thumbs down', 'make okay sign',
  ],

  // ── EMOTIONS & REACTIONS ──────────────────────────────────────────────
  emotions: [
    'laugh', 'laugh hard holding belly', 'giggle covering mouth',
    'cry', 'sob with hands over face', 'wipe tears',
    'gasp in surprise', 'flinch in fear', 'cower in fear', 'tremble with fear',
    'rage fists clenched', 'stomp foot angrily', 'shake fist angrily',
    'celebrate with fist pump', 'jump for joy', 'cheer with both arms',
    'facepalm', 'double facepalm', 'sigh in disappointment',
    'shrug shoulders', 'confused head tilt', 'scratch head in confusion',
    'look shocked mouth open', 'cover mouth in shock',
    'nod yes enthusiastically', 'shake head no firmly',
    'roll eyes', 'huff impatiently', 'tap foot impatiently',
    'cringe', 'grimace in pain', 'wince',
    'beam with pride', 'puff chest proudly',
  ],

  // ── IDLE ANIMATIONS ───────────────────────────────────────────────────
  idle: [
    'breathe slowly', 'deep breath', 'sigh',
    'shift weight left', 'shift weight right', 'shift weight back and forth',
    'glance left', 'glance right', 'glance around nervously', 'look around casually',
    'look up at the sky', 'look down at feet',
    'scratch head', 'scratch chin', 'scratch arm', 'scratch back of neck',
    'rub eyes', 'rub nose', 'touch face',
    'cross arms', 'uncross arms', 'put hands on hips', 'hands behind back',
    'crack knuckles', 'crack neck', 'roll shoulders',
    'adjust collar', 'adjust sleeves', 'dust off clothes',
    'tap foot', 'bounce on heels', 'sway side to side',
    'fidget with hands', 'twiddle thumbs', 'wring hands',
    'yawn', 'yawn and stretch', 'stretch arms overhead', 'stretch neck',
    'check fingernails', 'pick at nails',
    'rest chin on hand', 'prop head on fist thinking',
    'fold arms behind head lean back',
    'hum and sway', 'whistle and look around',
    'kick at the ground', 'scuff foot on ground',
  ],

  // ── EXERCISE & FITNESS ────────────────────────────────────────────────
  exercise: [
    'jumping jacks', 'jumping jacks fast', 'jumping jacks slow',
    'pushup', 'pushup one arm', 'pushup clap',
    'situp', 'crunch', 'bicycle crunch',
    'squat', 'deep squat', 'squat pulse', 'goblet squat',
    'lunge forward', 'lunge backward', 'walking lunge',
    'plank hold', 'side plank', 'plank up down',
    'burpee', 'mountain climber',
    'high knees', 'butt kicks',
    'arm circles forward', 'arm circles backward',
    'toe touch stretch', 'hamstring stretch', 'quad stretch',
    'shoulder stretch', 'tricep stretch', 'chest stretch',
    'side bend left', 'side bend right', 'torso twist',
    'neck roll', 'hip circle',
    'jump rope', 'shadow box', 'boxer shuffle',
    'jumping jack to squat',
    'star jump', 'tuck jump',
  ],

  // ── DANCE MOVES ───────────────────────────────────────────────────────
  dance: [
    'simple dance', 'energetic dance', 'slow dance alone',
    'spin around', 'spin around twice', 'pirouette',
    'moonwalk', 'robot dance', 'wave dance arms',
    'head bob to music', 'shoulder shimmy',
    'hip sway', 'hip thrust', 'hip circle dance',
    'two step', 'side step', 'grapevine step',
    'running man', 'cabbage patch',
    'raise the roof', 'sprinkler dance',
    'dab', 'floss dance',
    'disco point', 'disco arms',
    'twist dance', 'mashed potato',
    'body roll', 'body wave',
    'snake arms', 'jazz hands',
    'kick ball change', 'step touch',
    'groove with snapping', 'bounce dance',
    'victory dance', 'silly dance',
    'elegant waltz step', 'tango step',
  ],

  // ── WORK & TOOLS ──────────────────────────────────────────────────────
  work: [
    'dig with shovel', 'dig with pickaxe', 'dig with hands',
    'hammer nail', 'hammer repeatedly', 'pound with fist',
    'chop wood', 'chop down', 'split wood',
    'sweep floor', 'sweep vigorously', 'mop floor',
    'rake leaves', 'hoe garden',
    'cast fishing line', 'reel in fish', 'pull fishing rod',
    'saw wood', 'sand surface', 'plane wood',
    'paint with brush', 'paint wall up down',
    'carry heavy box', 'set down heavy object', 'lift heavy object',
    'push something heavy', 'pull rope', 'tug rope',
    'turn crank', 'pull lever',
    'stir pot', 'pour from container', 'ladle soup',
    'knead dough', 'roll dough', 'chop vegetables',
    'scrub surface', 'wipe table', 'polish surface',
    'shovel snow', 'scatter seeds', 'water plants',
    'climb ladder', 'hammer overhead',
    'mine rock', 'chip at stone', 'forge hammer on anvil',
  ],

  // ── COMBAT & MARTIAL ──────────────────────────────────────────────────
  combat: [
    'punch right', 'punch left', 'jab jab cross',
    'uppercut', 'hook punch', 'haymaker',
    'kick front', 'kick side', 'roundhouse kick',
    'low sweep kick', 'knee strike',
    'block high', 'block low', 'block with both arms',
    'dodge left', 'dodge right', 'duck', 'dodge roll',
    'fighting stance', 'guard up',
    'slash horizontal', 'slash vertical', 'slash diagonal',
    'thrust forward', 'stab downward',
    'overhead swing', 'two handed swing',
    'parry', 'riposte',
    'shield block', 'shield bash',
    'draw weapon', 'sheathe weapon',
    'battle cry', 'taunt enemy',
    'flex intimidate', 'crack knuckles threat',
    'spin attack', 'jumping attack',
    'charge forward', 'lunge attack',
  ],

  // ── SITTING & RESTING ─────────────────────────────────────────────────
  sitting: [
    'sit down', 'sit down slowly', 'sit down quickly', 'plop down',
    'sit cross legged', 'sit with legs extended',
    'lean back while sitting', 'lean forward while sitting',
    'sit up straight', 'slouch while sitting',
    'sit and fidget', 'sit and look around',
    'sit and rest chin on hand',
    'stand up from sitting', 'stand up quickly',
  ],

  // ── LYING & GROUND ────────────────────────────────────────────────────
  ground: [
    'lie down on back', 'lie down on belly', 'lie on side',
    'roll over', 'roll left', 'roll right',
    'curl up', 'stretch out lying down',
    'get up from ground', 'get up quickly',
    'crawl forward', 'army crawl',
    'kneel', 'kneel on one knee', 'genuflect',
    'prostrate', 'grovel',
    'meditate seated', 'meditate standing',
  ],

  // ── GESTURES & COMMUNICATION ──────────────────────────────────────────
  gestures: [
    'clap', 'clap slowly', 'slow clap', 'rapid applause',
    'snap fingers', 'snap to music',
    'rub hands together', 'rub hands for warmth',
    'wring hands nervously', 'clasp hands together',
    'pray', 'pray kneeling',
    'pledge allegiance', 'hand over heart',
    'flex both arms', 'flex one arm', 'kiss bicep',
    'peace sign', 'rock on sign', 'hang loose sign',
    'finger wag no no', 'finger to lips shush',
    'hand to ear listening', 'cup ear to hear',
    'shield eyes looking', 'hand over brow looking far',
    'count on fingers', 'tick off on fingers',
    'open arms wide welcome', 'arms out questioning',
    'palms up helpless', 'palms down calm down',
    'push away gesture', 'come closer gesture',
    'stop hand', 'halt gesture',
    'air quotes', 'so-so hand wobble',
    'mind blown gesture',
  ],

  // ── MOVEMENT & LOCOMOTION ─────────────────────────────────────────────
  movement: [
    'march in place', 'march in place high knees',
    'tiptoe forward', 'tiptoe carefully',
    'sneak crouch walk', 'sneak look both ways',
    'skip happily', 'gallop',
    'hop on one foot', 'hop on other foot', 'bunny hop',
    'jump in place', 'jump high', 'broad jump',
    'hop left', 'hop right', 'hop forward', 'hop backward',
    'stumble forward', 'stumble and catch self',
    'trip and fall', 'slip and recover',
    'stagger', 'limp walk', 'hobble',
    'power walk', 'strut confidently',
    'swagger walk', 'creep forward',
  ],

  // ── EATING & DRINKING ─────────────────────────────────────────────────
  consume: [
    'eat food with hands', 'eat with utensil', 'chew food',
    'drink from cup', 'drink from bottle', 'sip carefully',
    'gulp down drink', 'wipe mouth after drinking',
    'taste something', 'spit out food', 'savor food',
    'offer food to someone', 'refuse food',
    'toast raise glass', 'clink glasses',
    'bite into apple', 'gnaw on bone',
  ],

  // ── DAILY LIFE & MISC ────────────────────────────────────────────────
  daily: [
    'open door', 'close door', 'knock on door',
    'pick up object', 'put down object', 'toss object',
    'throw overhand', 'throw underhand', 'throw sidearm',
    'catch object', 'juggle',
    'wind up throw', 'skip stone',
    'read book', 'turn page', 'hold book open',
    'write with pen', 'scribble', 'draw in air',
    'look at map', 'fold map',
    'pet an animal', 'shoo animal', 'feed animal',
    'hold baby', 'rock baby', 'cradle arms',
    'brush hair', 'tie hair back', 'shake head hair flip',
    'put on hat', 'take off hat', 'adjust hat',
    'put on gloves', 'take off gloves',
    'zip up jacket', 'button up', 'unbutton',
    'tie shoelaces', 'untie shoelaces',
    'shield from rain', 'shake off water',
    'warm hands by fire', 'blow on cold hands',
    'fan self from heat', 'wipe sweat from brow',
  ],

  // ── MAGIC & FANTASY ───────────────────────────────────────────────────
  magic: [
    'cast spell forward', 'cast spell upward', 'cast spell area',
    'channel energy', 'gather power',
    'summon gesture', 'dismiss gesture', 'banish gesture',
    'enchant object', 'bless forward',
    'ward off evil', 'protective barrier gesture',
    'mystic meditation', 'levitate pose',
    'divine prayer', 'ritual arms raised',
    'draw rune in air', 'trace circle in air',
    'absorb energy', 'release energy burst',
    'mind control gesture', 'telepathy focus',
    'transform stance', 'shapeshift crouch',
    'necromancy raise dead gesture', 'heal hands glow pose',
  ],

  // ── SPORTS & ATHLETICS ────────────────────────────────────────────────
  sports: [
    'throw ball overhand', 'throw ball underhand', 'pitch baseball',
    'swing bat', 'bunt', 'home run trot',
    'shoot basketball', 'dribble basketball', 'crossover dribble',
    'soccer kick', 'header soccer ball',
    'golf swing', 'golf putt',
    'tennis forehand', 'tennis backhand', 'tennis serve',
    'volleyball serve', 'volleyball spike', 'volleyball bump',
    'bowling release', 'bowling approach',
    'archery draw', 'archery release',
    'swimming freestyle stroke', 'swimming breaststroke',
    'wrestling grapple', 'sumo stomp',
    'karate chop', 'karate block', 'karate kick',
    'tai chi slow movement', 'tai chi ward off',
  ],

  // ── POSES & STANCES ───────────────────────────────────────────────────
  poses: [
    'hero pose', 'victory pose', 'power pose',
    'thinking pose chin on fist', 'thinking pose hand on chin',
    'model pose', 'fashion pose', 'casual lean',
    'arms crossed stern', 'arms crossed relaxed',
    'hands in pockets', 'one hand in pocket',
    'at attention military', 'at ease military', 'parade rest',
    'ready stance', 'wide stance',
    'crane stance one leg', 'tree pose yoga',
    'warrior pose yoga', 'mountain pose yoga',
    'downward dog', 'cobra pose', 'child pose',
    'lotus position', 'half lotus',
    'superhero landing', 'dramatic entrance pose',
    'exhausted hands on knees', 'catching breath',
    'lean against wall', 'lean on one arm',
    'arms akimbo defiant',
  ],

  // ── MUSIC & PERFORMANCE ───────────────────────────────────────────────
  performance: [
    'play air guitar', 'play air drums', 'play air piano',
    'conduct orchestra', 'conduct with baton',
    'sing into microphone', 'belt out a note',
    'strum guitar', 'pluck strings',
    'bow to audience', 'curtain call bow',
    'take a bow after performance',
    'dramatic monologue gesture', 'shakespearean gesture',
    'mime walking against wind', 'mime trapped in box',
    'mime pulling rope', 'mime climbing stairs',
    'juggle three objects', 'balance plate on finger',
    'acrobat handspring prep', 'backflip prep',
    'tightrope balance walk',
  ],

  // ── ANIMAL-LIKE ───────────────────────────────────────────────────────
  animal: [
    'roar like a lion', 'growl menacingly',
    'flap arms like bird', 'soar like eagle arms out',
    'slither snake movement', 'hop like frog',
    'waddle like penguin', 'strut like peacock',
    'monkey scratch', 'gorilla chest pound',
    'bear hug self', 'cat stretch',
    'dog beg', 'dog shake off water',
    'chicken dance', 'bunny hop',
  ],
};

// ── LOOP vs ONE-SHOT classification ─────────────────────────────────────
// Loops play continuously while an input state is active (walking, running).
// One-shots play once and return to rest (wave, bow).
// Some are "hold" — play once and stay in final position (sit, kneel).
export const LOOP_COMMANDS = new Set([
  // Locomotion loops
  'march in place', 'march in place high knees',
  'tiptoe forward', 'tiptoe carefully',
  'sneak crouch walk', 'sneak look both ways',
  'skip happily', 'gallop',
  'hop on one foot', 'hop on other foot',
  'power walk', 'strut confidently', 'swagger walk', 'creep forward',
  'stagger', 'limp walk', 'hobble',
  // Exercise loops
  'high knees', 'butt kicks', 'jump rope', 'boxer shuffle',
  'mountain climber',
  // Dance loops
  'simple dance', 'energetic dance', 'slow dance alone',
  'head bob to music', 'shoulder shimmy', 'hip sway',
  'two step', 'side step', 'grapevine step',
  'running man', 'bounce dance', 'groove with snapping',
  'step touch',
  // Idle loops
  'breathe slowly', 'sway side to side', 'shift weight back and forth',
  'hum and sway', 'bounce on heels',
  // Work loops
  'sweep floor', 'sweep vigorously', 'mop floor',
  'stir pot', 'scrub surface',
  'saw wood', 'sand surface',
  // Combat loops
  'guard up', 'fighting stance', 'boxer shuffle',
]);

export const HOLD_COMMANDS = new Set([
  // Terminal poses — play once, stay in position
  'sit down', 'sit down slowly', 'sit cross legged', 'sit with legs extended',
  'lie down on back', 'lie down on belly', 'lie on side',
  'kneel', 'kneel on one knee', 'genuflect',
  'crouch down', 'crouch_ready',
  'meditate seated', 'meditate standing',
  'plank hold', 'side plank',
  'lotus position', 'half lotus', 'child pose',
  'cross arms', 'hands behind back', 'put hands on hips',
  'fighting stance', 'ready stance', 'wide stance',
  'at attention military', 'at ease military', 'parade rest',
]);

// Flatten to a single array of commands with metadata
export const ALL_COMMANDS = Object.entries(TAXONOMY)
  .flatMap(([category, commands]) => commands.map(cmd => ({
    command: cmd,
    category,
    playback: LOOP_COMMANDS.has(cmd) ? 'loop' : HOLD_COMMANDS.has(cmd) ? 'hold' : 'oneshot',
  })));

export const IDLE_COMMANDS = TAXONOMY.idle;

console.log?.(`Taxonomy: ${ALL_COMMANDS.length} commands (${[...LOOP_COMMANDS].length} loops, ${[...HOLD_COMMANDS].length} holds) across ${Object.keys(TAXONOMY).length} categories`);
