#!/bin/bash
BASE="C:/Users/daves/AppData/Roaming/wizardgenie/projects/default/assets/pixelab/landscape_v2"
BB="https://backblaze.pixellab.ai/file/pixellab-tiles/0f1031f5-9eee-4df4-996f-0a4114148eba"

# Track variant counters per family
declare -A VCOUNTER

count_existing() {
    local dir="$1" family="$2" type="$3"
    local target="$BASE/$dir/$family/decals"
    [[ "$type" == "medium" || "$type" == "object" ]] && target="$BASE/$dir/$family/sprites"
    if [ ! -d "$target" ]; then echo 0; return; fi
    local prefix="${family}__${type}__v"
    ls "$target" 2>/dev/null | grep "^${prefix}" | grep '\.png$' | wc -l
}

get_next_variant() {
    local key="$1_$2_$3"
    if [ -z "${VCOUNTER[$key]}" ]; then
        VCOUNTER[$key]=$(count_existing "$1" "$2" "$3")
    fi
    local v=${VCOUNTER[$key]}
    VCOUNTER[$key]=$((v + 1))
    printf "%03d" $v
}

# Tile mapping: tile_index -> "layer family subdir type"
declare -A TMAP
TMAP[0]="surface_overlays mud_pool decals overlay"
TMAP[1]="surface_overlays mud_pool decals overlay"
TMAP[2]="surface_overlays wet_mud_shine decals overlay"
TMAP[3]="surface_overlays wet_mud_shine decals overlay"
TMAP[4]="surface_overlays algae_film decals overlay"
TMAP[5]="surface_overlays algae_film decals overlay"
TMAP[6]="surface_overlays algae_film decals overlay"
TMAP[7]="surface_overlays algae_film decals overlay"
TMAP[8]="micro dark_mud_flecks decals micro"
TMAP[9]="micro dark_mud_flecks decals micro"
TMAP[10]="micro dark_mud_flecks decals micro"
TMAP[11]="micro dark_mud_flecks decals micro"
TMAP[12]="micro moss_ground_cover decals micro"
TMAP[13]="micro moss_ground_cover decals micro"
TMAP[14]="micro reeds_grass_blades decals micro"
TMAP[15]="micro reeds_grass_blades decals micro"

JOBS=(
    "b2d1d0a4-efe0-4666-a14a-f35c4f8912ff"
    "d5068763-3ccf-46e7-b57b-4110a3760394"
    "c70cf51b-e369-47ee-9df2-66b4b9ffd988"
    "2a0df441-080d-4d2e-96a1-71a52962b998"
    "a65141d3-98ec-4f11-bf65-235d7ab0d281"
    "2acf864a-4731-4004-b451-b5323fb60862"
)

downloaded=0
failed=0

echo "===== DOWNLOADING 6 TILES_PRO BATCHES (96 tiles) ====="
for job in "${JOBS[@]}"; do
    echo "Batch: ${job:0:8}..."
    for i in $(seq 0 15); do
        read -r layer family subdir ftype <<< "${TMAP[$i]}"
        v=$(get_next_variant "$layer" "$family" "$ftype")
        filename="${family}__${ftype}__v${v}.png"
        dest="$BASE/$layer/$family/$subdir/$filename"
        url="$BB/$job/tile_${i}.png"
        
        mkdir -p "$(dirname "$dest")"
        if curl -sf -o "$dest" "$url"; then
            sz=$(stat -c%s "$dest" 2>/dev/null || wc -c < "$dest")
            echo "  OK tile_${i} -> $filename ($sz bytes)"
            downloaded=$((downloaded + 1))
        else
            echo "  FAIL tile_${i}"
            failed=$((failed + 1))
        fi
    done
done

echo ""
echo "Tiles Pro: $downloaded downloaded, $failed failed"

# Count final inventory
echo ""
echo "===== FINAL INVENTORY ====="
total=0
for layer in base surface_overlays micro medium objects transitions; do
    cnt=$(find "$BASE/$layer" -name '*.png' 2>/dev/null | wc -l)
    echo "  $layer: $cnt PNGs"
    total=$((total + cnt))
done
echo "  TOTAL: $total PNGs on disk"
