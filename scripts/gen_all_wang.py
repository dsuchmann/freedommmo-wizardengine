#!/usr/bin/env python3
"""Generate ALL 1470 wang tilesets at max quality via PixelLab direct API."""

import requests, json, sys, os, base64, time

API = "https://api.pixellab.ai/v2"
KEY = "de8bc1ce-8264-4c56-aa9f-03c9097ee45e"
HDR = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "assets", "pixelab", "landscape_v2", "transitions")

BIOMES = {
    "arctic": ("white snow and ice with subtle blue shadows", "2c8a9b01-73c4-4313-b3b3-f239f254dbca", "b6b93226-d449-4e72-a77c-7adc1efc634c"),
    "beach": ("golden sandy beach with fine grain texture", "1e408a41-65af-4a42-a719-616b764b2bdd", "9119dfca-32e0-48e7-bafb-3b4894ae531b"),
    "deep_ocean": ("dark navy ocean water with deep subtle wave patterns", "09e824f3-86b5-45b8-9e6f-2f54b8d17ce1", "14ee3566-c439-4049-b95b-04419b5c5cee"),
    "dense_forest": ("very dark dense forest floor with thick leaf litter, mushrooms, and deep moss", "7a43bd9f-a0a3-4cb1-82f2-0fa56237682c", "1f8e1133-9f18-4874-830b-088a5c050a8e"),
    "desert": ("arid desert sand with subtle wind ripples", "f51c6f4a-354e-4dff-a4b1-1ea8b0c66573", "93dc0f1e-bba3-4e12-b741-6f3b03e2a41a"),
    "forest": ("dark forest floor with fallen leaves, moss, and exposed roots", "87973039-3faa-448b-9123-4e64a7c6e932", "04e519e2-5c78-45c0-be6e-b63c8df16eaa"),
    "grassland": ("lush green grass meadow with individual blades", "3d09d189-81b3-4b62-9799-4827bb0495b5", "949429fa-32a3-4ca1-ade9-fb424ee2641f"),
    "hills": ("rocky hillside with scattered stones and sparse tough grass", "7296ae72-e61b-4f0c-bc89-d34f07c3266d", "b9919459-c795-42e3-9e10-a5faa00d1f51"),
    "lake": ("calm still blue-green water with subtle reflections", "b3c7768c-4611-43d2-92d9-c9dcb35f7fa4", "ec6cc367-df58-468d-8370-8e9b354ef050"),
    "mountains": ("grey mountain rock with snow patches and exposed stone", "1439e310-3505-47d1-b32d-79fe9391870b", "714d2999-848a-4b28-8b3c-ba5e879c61ac"),
    "mystic": ("glowing purple-pink enchanted ground with crystal fragments", "4bb937fe-e73f-403f-a06c-3a0d9a801daf", "8f7e34e1-a09f-4b05-8620-38b8a59d68a9"),
    "ocean": ("deep blue ocean water with gentle wave ripples", "cb04ad78-c894-4595-be7c-c5e847cd0e1b", "49f34c08-cee0-413b-b05b-5601812f198c"),
    "river": ("flowing blue water with gentle current lines", "818260d3-6de2-4db1-88f2-8839b44d22c9", "0627c024-7bf6-4371-bd04-4232858c3269"),
    "savanna": ("dry golden savanna grass with scattered patches of red earth", "7fd08ff7-17c4-4139-a6fb-7d014acccca3", "5e728d11-ba37-4935-9128-1760659a3ba9"),
    "shallow_water": ("light turquoise water with visible sandy bottom", "b76c4461-725a-4468-9631-e28b50b76f25", "7ef8b363-bfc5-48e3-ab70-f4d12a5ac1f7"),
    "steppe": ("short windswept dry brown-green grass with hard packed earth", "fe211bb1-4b99-4e95-a025-a04ce8883d5e", "a8aede8f-f06e-46be-8161-af9b7aa4160d"),
    "swamp": ("wet brown swamp mud with murky water patches and peat", "ebad6623-d862-49e8-9124-8a90f53e1229", "b65f815c-33eb-467d-9440-53369e6649fa"),
    "taiga": ("cold taiga floor with pine needles, frost, and sparse lichen", "aadf3e49-0212-4f21-b853-fde4cbf905f6", "f69fd602-1bcc-42a1-872b-95ee1b267015"),
    "tropical_forest": ("lush tropical forest floor with broad leaves, vines, and rich dark soil", "130e304b-a9e8-47b5-bf1d-a1cf43efd9fd", "8b0f1193-c9b8-45c8-b1e5-4b8f8d134e84"),
    "tundra": ("frozen grey-brown permafrost with sparse lichen and frost", "4d46ed0d-426d-4325-a5d6-33464ee26297", "625ca67b-3217-4a0a-824b-0dcf848051f4"),
    "volcanic": ("dark charred volcanic rock with glowing orange lava cracks", "2958e295-1974-4936-aedf-39ceb8b52517", "e14095c3-0980-4e7f-8093-44a656dac7b3"),
}

BIOME_LIST = sorted(BIOMES.keys())
MAX_CONCURRENT = 20

def gen_jobs():
    jobs = []
    for i, a in enumerate(BIOME_LIST):
        for b in BIOME_LIST[i+1:]:
            jobs.append((a, b, 0, "wang"))
            for size, vdir in [(0.25, "wang_25"), (0.5, "wang_50"), (1.0, "wang_100")]:
                jobs.append((a, b, size, vdir))
                jobs.append((b, a, size, vdir))
    return jobs

def is_done(lower, upper, vdir):
    d = os.path.join(BASE, f"{lower}_to_{upper}", vdir)
    if not os.path.isdir(d):
        return False
    expected = 25 if vdir == "wang_100" else 16
    pngs = [f for f in os.listdir(d) if f.endswith(".png")]
    return len(pngs) >= expected

def submit(lower, upper, size):
    desc_l, lid, _ = BIOMES[lower]
    desc_u, _, uid = BIOMES[upper]
    body = {
        "lower_description": desc_l,
        "upper_description": desc_u,
        "lower_base_tile_id": lid,
        "upper_base_tile_id": uid,
        "transition_size": size,
        "tile_size": {"width": 32, "height": 32},
        "view": "high top-down",
        "outline": "lineless",
        "detail": "highly detailed",
        "shading": "highly detailed shading",
    }
    if size > 0:
        body["transition_description"] = f"{desc_l} transitioning to {desc_u}"
    try:
        r = requests.post(f"{API}/create-tileset", headers=HDR, json=body, timeout=30)
        if r.status_code in (200, 201, 202):
            d = r.json()
            return d.get("tileset_id")
    except Exception as e:
        print(f"  SUBMIT ERROR: {e}")
    return None

def save_tiles(data, lower, upper, vdir):
    d = os.path.join(BASE, f"{lower}_to_{upper}", vdir)
    os.makedirs(d, exist_ok=True)
    tiles = data.get("tileset", {}).get("tiles", [])
    for t in tiles:
        idx = t["name"].replace("wang_", "")
        img = base64.b64decode(t["image"]["base64"])
        fn = os.path.join(d, f"{lower}_to_{upper}__wang_{idx}__v000.png")
        with open(fn, "wb") as f:
            f.write(img)
    return len(tiles)

TIMEOUT_SEC = 600  # 10 min max per job

def poll_pending(pending, submit_times):
    completed = []
    expired = []
    now = time.time()
    for tid, (l, u, v) in list(pending.items()):
        # Time out stuck jobs
        if now - submit_times.get(tid, now) > TIMEOUT_SEC:
            print(f"  TIMEOUT: {l}_to_{u}/{v} (tid={tid[:8]}...) after {TIMEOUT_SEC}s", flush=True)
            expired.append(tid)
            continue
        try:
            r = requests.get(f"{API}/tilesets/{tid}", headers=HDR, timeout=30)
            if r.status_code == 200:
                data = r.json()
                status = data.get("status", "")
                if status == "error" or "error" in str(data.get("detail", "")):
                    print(f"  ERROR: {l}_to_{u}/{v} status={status}", flush=True)
                    expired.append(tid)
                    continue
                if "detail" not in data:
                    n = save_tiles(data, l, u, v)
                    if n > 0:
                        completed.append(tid)
            else:
                print(f"  POLL HTTP {r.status_code}: {l}_to_{u}/{v}", flush=True)
        except Exception as e:
            print(f"  POLL ERROR: {l}_to_{u}/{v}: {e}", flush=True)
    return completed, expired

# Main
all_jobs = gen_jobs()
total = len(all_jobs)
done = sum(1 for l, u, s, v in all_jobs if is_done(l, u, v))
print(f"Total: {total}, Already done: {done}, Remaining: {total - done}", flush=True)

pending = {}
submit_times = {}
retry_queue = []  # jobs to retry after timeout/error
submitted_count = done
job_idx = 0

while job_idx < len(all_jobs) or pending or retry_queue:
    # Poll pending
    completed, expired = poll_pending(pending, submit_times)
    for tid in completed:
        l, u, v = pending.pop(tid)
        submit_times.pop(tid, None)
        submitted_count += 1
        print(f"[{submitted_count}/{total}] {l}_to_{u}/{v} DONE", flush=True)
    for tid in expired:
        l, u, v = pending.pop(tid)
        submit_times.pop(tid, None)
        # Re-queue for retry
        size_map = {'wang': 0, 'wang_25': 0.25, 'wang_50': 0.5, 'wang_100': 1.0}
        retry_queue.append((l, u, size_map[v], v))

    # Submit new jobs to fill slots (from main queue or retry queue)
    while len(pending) < MAX_CONCURRENT and (job_idx < len(all_jobs) or retry_queue):
        if retry_queue:
            lower, upper, size, vdir = retry_queue.pop(0)
        elif job_idx < len(all_jobs):
            lower, upper, size, vdir = all_jobs[job_idx]
            job_idx += 1
            if is_done(lower, upper, vdir):
                continue
        else:
            break
        tid = submit(lower, upper, size)
        if tid:
            pending[tid] = (lower, upper, vdir)
            submit_times[tid] = time.time()
            print(f"  SUBMIT: {lower}_to_{upper}/{vdir} (tid={tid[:8]}...)", flush=True)
        else:
            print(f"  SUBMIT FAILED: {lower}_to_{upper}/{vdir}, will retry", flush=True)
            retry_queue.append((lower, upper, size, vdir))
            time.sleep(5)

    if pending:
        time.sleep(20)

print(f"=== COMPLETE: {submitted_count}/{total} ===", flush=True)
