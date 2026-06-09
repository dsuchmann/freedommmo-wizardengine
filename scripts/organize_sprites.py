import json, os, shutil, re

PROJECT = 'C:/Users/daves/AppData/Roaming/wizardgenie/projects/default'
STAGING = os.path.join(PROJECT, 'assets/pixelab/landscape_v2/micro/_review_staging')
MICRO = os.path.join(PROJECT, 'assets/pixelab/landscape_v2/micro')

# Load mapping and sizes
with open(os.path.join(PROJECT, 'scripts/object_mapping.json')) as f:
    mapping = json.load(f)

# Get sizes from actual files
sizes = {}
for uuid_dir in os.listdir(STAGING):
    full = os.path.join(STAGING, uuid_dir)
    if not os.path.isdir(full) or uuid_dir.startswith('_'):
        continue
    f0 = os.path.join(full, 'frame_0.png')
    if os.path.exists(f0):
        from PIL import Image
        img = Image.open(f0)
        w, h = img.size
        num_frames = len([x for x in os.listdir(full) if x.startswith('frame_') and x.endswith('.png')])
        sizes[uuid_dir] = {'w': w, 'h': h, 'frames': num_frames}
        img.close()

print(f"Found {len(sizes)} staging UUIDs")

# Build mapping dict
mapping_dict = {m['id']: m for m in mapping}

# Add missing UUID
missing_id = 'c00b451e-7425-4706-8ac9-cc7676f41577'
if missing_id not in mapping_dict:
    mapping_dict[missing_id] = {
        'id': missing_id,
        'description': 'top-down high fantasy pixel art, hyper-detailed, jaw-dropping beauty, rich saturated colors, Final Fantasy aesthetic, detailed shading, alpha-transparent background, majestic oak tree with full canopy, lush green leaves, thick trunk',
        'size': '1dir 64x64',
        'parsed': None
    }

def classify(uuid, desc, size_info):
    d = desc.lower()
    w = size_info.get('w', 0)

    # Clean the description
    clean = d
    for pfx in [
        'top-down high fantasy pixel art, hyper-detailed, jaw-dropping beauty, rich saturated colors, final fantasy aesthetic, detailed shading, alpha-transparent background, ',
        'top-down high fantasy pixel art, hyper-detailed, jaw-dropping beauty, rich saturated colors, final fantasy aesthetic, detailed shading, alpha-transparent background,',
        'top-down high fantasy pixel art ',
        'top-down pixel art ',
    ]:
        if clean.startswith(pfx):
            clean = clean[len(pfx):]
            break

    clean = re.sub(r',?\s*(hyper-detailed|rich colors|alpha-transparent background|small ground (?:detail|flora|debris) sprite|top-down (?:rpg |)pixel art.*|no shadows.*|transparent background.*|fantasy game.*)$', '', clean, flags=re.IGNORECASE)
    clean = clean.strip().rstrip(',').strip()

    if w == 64:
        field = 6; pf = 'lg'; field_dir = 'large_objects'
    elif w == 48 or w == 42:
        if w == 42:
            obj_name = re.sub(r'[^a-z0-9_]', '', re.sub(r'\s+', '_', clean[:40]))
            return {'field': 5, 'prefix': 'mo', 'dir': 'medium_objects', 'biome': '_unsorted', 'objName': obj_name or 'unknown'}
        field = 5; pf = 'mo'; field_dir = 'medium_objects'
    elif w == 32:
        field = None; pf = None; field_dir = None
    else:
        return None

    non_living_keywords = ['stone', 'rock', 'bone', 'skull', 'shell', 'debris', 'gravel', 'pebble',
                          'chip', 'shard', 'fragment', 'crystal', 'ore', 'gem', 'dust', 'sand',
                          'clay', 'earth', 'soil', 'bark chip', 'twig', 'stick', 'web', 'gold vein',
                          'char', 'crust', 'film', 'lichen', 'needle scatter', 'leaves scatter',
                          'leaf scatter', 'seed husk', 'stem scatter', 'thatch', 'ice crust', 'snow crust',
                          'fungal film', 'quartz', 'iron', 'copper', 'bubble', 'foam', 'ripple', 'dapple',
                          'shimmer', 'sparkle', 'floating debris', 'driftwood', 'dry earth', 'dry clay']

    if w == 32 and field is None:
        water_keywords = ['bubble', 'foam', 'ripple', 'dapple', 'shimmer', 'sparkle',
                         'floating debris', 'driftwood', 'ocean water', 'lake water',
                         'river water', 'water surface', 'flowing water']
        is_water = any(kw in d for kw in water_keywords)
        is_non_living = any(kw in clean for kw in non_living_keywords)

        if is_water or is_non_living:
            field = 3; pf = 'ss'; field_dir = 'small_scatter'
        else:
            field = 2; pf = 'sf'; field_dir = 'small_flora'

    biome = None
    biome_rules = [
        ('tropical_forest', ['tropical', 'jungle', 'palm nut', 'banyan', 'vine tendril', 'broad fern', 'orchid sprout']),
        ('dense_forest', ['ancient oak', 'gnarled elm', 'strangler fig', 'shade fern', 'bracket fungus', 'dark herb', 'ghost orchid', 'giant mushroom', 'hollow stump', 'rotting log', 'root mound', 'lily pad', 'calm lake']),
        ('deep_ocean', ['deep ocean', 'bioluminesc', 'underwater sparkle', 'pale bioluminescence', 'dark ocean']),
        ('shallow_water', ['shallow water', 'sand shimmer']),
        ('ocean', ['ocean', 'sea foam', 'floating debris', 'driftwood stick']),
        ('river', ['river', 'flowing water', 'flowing current']),
        ('lake', ['lake water', 'lake', 'still water', 'light dapple', 'soft ripple']),
        ('volcanic', ['volcanic', 'lava', 'magma', 'obsidian', 'basalt', 'charred', 'char crust', 'ember', 'sulfur', 'fire flower', 'ash bloom', 'black char']),
        ('arctic', ['arctic', 'frozen tree', 'ice crystal spire', 'crystal ice tower', 'frost flower', 'ice needle', 'frost-covered', 'ice crust', 'snow crust', 'crystal dust', 'thin ice']),
        ('tundra', ['tundra', 'permafrost', 'stunted pine', 'frost willow', 'ice pillar', 'dead grey lichen']),
        ('mystic', ['mystic', 'aether', 'rune', 'crystal tree', 'spirit tree', 'glow grass', 'moonpetal', 'starlight', 'arcane', 'luminescent', 'magical']),
        ('swamp', ['swamp', 'bog', 'marsh', 'cypress', 'mangrove', 'bayou', 'cattail', 'sphagnum', 'algae film', 'wet bright green moss', 'fungal film']),
        ('desert', ['desert', 'saguaro', 'sand grass', 'desert thorn', 'prickly pear', 'bleached bone', 'bleached skull', 'sun-baked', 'cracked dry clay', 'cracked dry earth', 'scorpion']),
        ('beach', ['beach', 'coastal', 'dune', 'tide pool', 'sea glass', 'seashell', 'coral fragment', 'coconut palm', 'sea oat', 'sea holly', 'wet beach sand', 'sand scatter']),
        ('mountains', ['mountain', 'alpine', 'cliff', 'rock spire', 'mountain ash', 'cliff pine', 'edelweiss', 'alpine gentian', 'ice boulder', 'frozen cairn', 'scree', 'fine gravel', 'grey lichen crust']),
        ('hills', ['hill', 'granite', 'rowan', 'scots pine', 'standing stone', 'limestone', 'quartz pebble', 'slate', 'heather', 'rock flower', 'natural quartz', 'quartz formation', 'gem deposit', 'gold vein']),
        ('savanna', ['savanna', 'acacia', 'baobab', 'termite', 'dry grass spike', 'thorn sprout', 'acacia seedling', 'bone pile', 'dry golden grass', 'dry golden thatch']),
        ('steppe', ['steppe', 'wind grass', 'sparse weed', 'dry tuft', 'twisted shrub', 'dead tree', 'stone cairn', 'wind-blown', 'dust drift', 'sparse pale grass', 'scattered seed husk', 'dried brown stem']),
        ('taiga', ['taiga', 'spruce', 'snow pine', 'frost cedar', 'pine cone', 'frozen twig', 'resin drop', 'fireweed', 'brown pine needle', 'pine needle']),
        ('forest', ['forest', 'oak', 'birch', 'maple', 'fern', 'clover', 'grass blade cluster', 'twig bundle', 'acorn', 'bark shard', 'bark chip', 'fallen autumn leaves', 'short green grass', 'soft green moss', 'poplar', 'cherry blossom', 'juniper', 'spider web', 'human skull']),
        ('grassland', ['grassland', 'meadow', 'field', 'tall grass blade', 'dandelion', 'wild herb', 'daisy', 'cornflower', 'lavender', 'meadow grass', 'dry brown moss', 'exposed flat stone']),
    ]

    for bio, keywords in biome_rules:
        if any(kw in d for kw in keywords):
            biome = bio
            break

    if not biome:
        biome = '_unsorted'

    obj_name = clean
    for bio_name in ['forest', 'dense forest', 'tropical forest', 'taiga', 'grassland', 'savanna',
                     'steppe', 'desert', 'beach', 'swamp', 'hills', 'mountains', 'volcanic',
                     'tundra', 'arctic', 'mystic', 'ocean', 'deep ocean', 'shallow water', 'river', 'lake']:
        obj_name = obj_name.replace(' for ' + bio_name + ' biome', '').replace(' ' + bio_name, '')

    obj_name = obj_name.strip().rstrip(',').strip()
    obj_name = re.sub(r'\s+', '_', obj_name)
    obj_name = re.sub(r'[^a-z0-9_]', '', obj_name)
    obj_name = obj_name.strip('_')

    if len(obj_name) > 40:
        parts = obj_name.split('_')
        obj_name = '_'.join(parts[:5])

    if not obj_name:
        obj_name = 'unknown'

    return {'field': field, 'prefix': pf, 'dir': field_dir, 'biome': biome, 'objName': obj_name}


# Process all staging UUIDs
sorted_count = 0
skipped_count = 0
unsorted_count = 0
error_count = 0
results = []

for uuid in sorted(sizes.keys()):
    size_info = sizes[uuid]
    m = mapping_dict.get(uuid)
    if not m:
        print(f"WARNING: No mapping for {uuid}")
        error_count += 1
        continue

    desc = m.get('description', '')
    if not desc:
        print(f"WARNING: No description for {uuid}")
        error_count += 1
        continue

    parsed = classify(uuid, desc, size_info)
    if not parsed:
        print(f"WARNING: Could not classify {uuid}: size={size_info}")
        unsorted_count += 1
        continue

    if parsed['biome'] == '_unsorted':
        unsorted_count += 1

    staging_dir = os.path.join(STAGING, uuid)
    if not os.path.isdir(staging_dir):
        error_count += 1
        continue

    frame_files = sorted(
        [f for f in os.listdir(staging_dir) if f.startswith('frame_') and f.endswith('.png')],
        key=lambda x: int(re.search(r'\d+', x).group())
    )

    if not frame_files:
        error_count += 1
        continue

    target_dir = os.path.join(MICRO, parsed['dir'], parsed['biome'], parsed['objName'])

    if os.path.exists(target_dir):
        existing_files = [f for f in os.listdir(target_dir) if f.endswith('.png')]
        if len(existing_files) >= len(frame_files):
            skipped_count += 1
            continue
        version_offset = len(existing_files)
    else:
        version_offset = 0

    os.makedirs(target_dir, exist_ok=True)

    copied = 0
    for i, frame_file in enumerate(frame_files):
        v_num = f"{version_offset + i:03d}"
        dest_name = f"{parsed['prefix']}__{parsed['biome']}__{parsed['objName']}__v{v_num}.png"
        dest_path = os.path.join(target_dir, dest_name)

        if os.path.exists(dest_path):
            continue

        src_path = os.path.join(staging_dir, frame_file)

        with open(src_path, 'rb') as fh:
            magic = fh.read(4)
        if magic != b'\x89PNG':
            continue

        shutil.copy2(src_path, dest_path)
        copied += 1

    sorted_count += copied
    results.append({
        'uuid': uuid,
        'field': parsed['field'],
        'dir': parsed['dir'],
        'biome': parsed['biome'],
        'obj': parsed['objName'],
        'copied': copied,
        'total_frames': len(frame_files)
    })

print(f"\n=== RESULTS ===")
print(f"Total staging UUIDs: {len(sizes)}")
print(f"Files copied: {sorted_count}")
print(f"UUIDs skipped (already exist): {skipped_count}")
print(f"UUIDs unsorted (to _unsorted): {unsorted_count}")
print(f"Errors: {error_count}")

field_counts = {}
biome_counts = {}
for r in results:
    field_counts[r['dir']] = field_counts.get(r['dir'], 0) + r['copied']
    biome_counts[r['biome']] = biome_counts.get(r['biome'], 0) + r['copied']

print(f"\n=== BY FIELD ===")
for k, v in sorted(field_counts.items()):
    print(f"  {k}: {v} files")

print(f"\n=== BY BIOME ===")
for k, v in sorted(biome_counts.items()):
    print(f"  {k}: {v} files")

unsorted_items = [r for r in results if r['biome'] == '_unsorted']
if unsorted_items:
    print(f"\n=== UNSORTED ({len(unsorted_items)}) ===")
    for r in unsorted_items:
        m = mapping_dict.get(r['uuid'], {})
        print(f"  {r['uuid']}: obj={r['obj']} desc={m.get('description','')[:100]}")
