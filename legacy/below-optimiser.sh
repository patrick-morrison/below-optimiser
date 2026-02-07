#!/usr/bin/env bash
# Below Optimiser v1.0.0 - GLB optimization toolkit
# Copyright (C) 2025 Patrick Morrison
# Released: August 2025
# 
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

set -euo pipefail

usage() {
    echo "Below Optimiser v1.0.0 - GLB optimization toolkit"
    echo "Copyright (C) 2025 Patrick Morrison"
    echo
    echo "Usage:"
    echo "  $0 pack <input...> [--no-simplify] [--polygon <count>] [--suffix <suffix>]  # Pack & optimize for Quest"
    echo "  $0 unpack <input.glb> [output-dir]  # Extract textures for editing"
    echo
    echo "Options:"
    echo "  --no-simplify       Skip automatic polygon reduction (models >1.2M polygons)"
    echo "  --polygon <count>   Set target polygon count (default: 1,200,000)"
    echo "  --suffix <suffix>   Set output suffix (default: '-quest')"
    echo
    echo "Examples:"
    echo "  $0 pack model.glb                      # Optimize single GLB"
    echo "  $0 pack model1.glb model2.glb          # Optimize multiple GLBs"
    echo "  $0 pack models/*.glb                   # Optimize all GLBs in folder"
    echo "  $0 pack model.glb --no-simplify        # Skip polygon reduction"
    echo "  $0 pack model.glb --polygon 800000     # Target 800k polygons"
    echo "  $0 pack model.glb --suffix '_ar'       # Output model_ar.glb"
    echo "  $0 unpack model.glb"
    echo
    echo "For detailed documentation: https://github.com/patrickmorrison/below-optimiser"
    exit 0
}

# Check dependencies
if ! command -v gltf-transform >/dev/null 2>&1; then
    echo "Error: gltf-transform CLI not found"
    echo "Install with: npm install -g @gltf-transform/cli"
    exit 1
fi


extract_textures() {
    local IN_GLB="$1"
    local ROOT=$(dirname "$(cd "$(dirname "$IN_GLB")" && pwd)/$(basename "$IN_GLB")")
    local BASE=$(basename "$IN_GLB" .glb)
    local OUT_DIR="${2:-$ROOT/${BASE}_edit}"

    # Find unique directory name
    local n=""
    local try="$OUT_DIR"
    while [[ -e "$try" ]]; do
        n=$((n+1))
        try="${OUT_DIR%_edit*}_edit$n"
    done
    OUT_DIR="$try"

    local TMP=$(mktemp -d)
    gltf-transform ktxdecompress "$IN_GLB" "$TMP/tmp.glb" 2>/dev/null || cp "$IN_GLB" "$TMP/tmp.glb"
    mkdir "$OUT_DIR"
    gltf-transform copy "$TMP/tmp.glb" "$OUT_DIR/$BASE.gltf"


    echo "Textures extracted to: $OUT_DIR/"
    rm -rf "$TMP"
}

count_polygons() {
    local GLB_FILE="$1"
    # Use gltf-transform inspect to get polygon count
    local INSPECT_OUTPUT=$(gltf-transform inspect "$GLB_FILE" 2>/dev/null || echo "")

    # Extract triangle counts from ALL meshes in the MESHES table and sum them
    # Look for the glPrimitives column (column 6) which contains the triangle count
    local TOTAL_TRIANGLES=0

    # Get all mesh rows and extract triangle counts
    while IFS= read -r line; do
        local COUNT=$(echo "$line" | awk -F'│' '{print $6}' | tr -d ' ,')
        if [[ "$COUNT" =~ ^[0-9]+$ ]]; then
            TOTAL_TRIANGLES=$((TOTAL_TRIANGLES + COUNT))
        fi
    done < <(echo "$INSPECT_OUTPUT" | grep -A 1000 "MESHES" | grep -E "^\│ [0-9]")

    echo "${TOTAL_TRIANGLES:-0}"
}

count_materials() {
    local GLB_FILE="$1"
    local INSPECT_OUTPUT=$(gltf-transform inspect "$GLB_FILE" 2>/dev/null || echo "")

    # Count materials by counting rows in MATERIALS table
    local MATERIAL_COUNT=$(echo "$INSPECT_OUTPUT" | grep -A 1000 "MATERIALS" | grep -E "^\│ [0-9]" | wc -l | tr -d ' ')
    echo "${MATERIAL_COUNT:-1}"
}

simplify_model() {
    local INPUT_GLB="$1"
    local OUTPUT_GLB="$2"
    local TARGET_POLYGONS="$3"

    echo "High polygon count detected. Running simplification pipeline..."

    local TMP_DIR=$(mktemp -d)
    local TMP_SIMPLIFIED="$TMP_DIR/tmp-simplified.glb"
    local TMP_WORKING="$INPUT_GLB"

    # Get current polygon count and material count
    local CURRENT_POLYGONS=$(count_polygons "$INPUT_GLB")
    local INITIAL_POLYGONS=$CURRENT_POLYGONS
    local MATERIAL_COUNT=$(count_materials "$INPUT_GLB")

    # Multi-attempt simplification with increasing aggression
    local MAX_ATTEMPTS=3
    local ATTEMPT=1
    local FINAL_POLYGONS=0
    local RATIO=0

    while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
        # Calculate ratio with increasing aggression for each attempt
        # Attempt 1: target ratio, Attempt 2: 0.65x target, Attempt 3: 0.45x target
        local AGGRESSION=$(echo "scale=6; 0.65 ^ ($ATTEMPT - 1)" | bc)
        RATIO=$(echo "scale=6; ($TARGET_POLYGONS / $CURRENT_POLYGONS) * $AGGRESSION" | bc)

        # Ensure ratio doesn't go below 0.01 or above 1.0
        RATIO=$(echo "$RATIO" | awk '{if ($1 > 1.0) print 1.0; else if ($1 < 0.01) print 0.01; else print $1}')

        if [ $ATTEMPT -eq 1 ]; then
            echo "Reducing from $(printf "%'d" $INITIAL_POLYGONS) to ~$(printf "%'d" $TARGET_POLYGONS) polygons (ratio: $RATIO)..."
        else
            echo "Attempt $ATTEMPT: From $(printf "%'d" $CURRENT_POLYGONS) polygons, target $(printf "%'d" $TARGET_POLYGONS) (ratio: $RATIO)..."
        fi

        # Simplify (dedup/weld/join are handled before this function)
        gltf-transform simplify "$TMP_WORKING" "$TMP_SIMPLIFIED" \
            --ratio "$RATIO" \
            --error 0.005 \
            --lock-border true 2>/dev/null

        FINAL_POLYGONS=$(count_polygons "$TMP_SIMPLIFIED")

        # If we're under target or this is the last attempt, accept the result
        if [ "$FINAL_POLYGONS" -le "$TARGET_POLYGONS" ] || [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
            mv "$TMP_SIMPLIFIED" "$OUTPUT_GLB"
            break
        fi

        # Otherwise, use this result as input for next attempt
        TMP_WORKING="$TMP_SIMPLIFIED"
        CURRENT_POLYGONS=$FINAL_POLYGONS
        ATTEMPT=$((ATTEMPT + 1))
    done

    if [ "$FINAL_POLYGONS" -gt "$TARGET_POLYGONS" ]; then
        echo "Simplification complete: $(printf "%'d" $FINAL_POLYGONS) polygons (exceeded target after $MAX_ATTEMPTS attempts)"
    else
        echo "Simplification complete: $(printf "%'d" $FINAL_POLYGONS) polygons"
    fi

    rm -rf "$TMP_DIR"
}

pack_optimize() {
    local INPUT="$1"
    local OUTPUT="$2"
    local SKIP_SIMPLIFY="${3:-false}"
    local MAX_POLYGONS="${4:-1200000}"
    local TEMP="${OUTPUT%.glb}-temp.glb"
    local TMP_DEDUP="${OUTPUT%.glb}-dedup.glb"
    local TMP_WELD="${OUTPUT%.glb}-weld.glb"
    local TMP_JOIN="${OUTPUT%.glb}-join.glb"

    echo "Optimizing for Quest..."

    # Handle directory input (GLTF + textures)
    if [ -d "$INPUT" ]; then
        local BASE=$(basename "$INPUT" _edit)
        local GLTF_FILE="$INPUT/$BASE.gltf"

        if [ ! -f "$GLTF_FILE" ]; then
            echo "Error: No .gltf file found: $GLTF_FILE"
            exit 1
        fi

        # Smart texture format detection and analysis
        local has_jpeg=false
        local has_jpg=false
        local has_png=false
        local has_normal_maps=false

        ls "$INPUT"/*.[jJ][pP][eE][gG] >/dev/null 2>&1 && has_jpeg=true
        ls "$INPUT"/*.[jJ][pP][gG] >/dev/null 2>&1 && has_jpg=true
        ls "$INPUT"/*.[pP][nN][gG] >/dev/null 2>&1 && has_png=true

        # Check for normal maps with pattern *normal[0-9]*
        local normal_map_files=()
        for file in "$INPUT"/*normal[0-9]*.*; do
            if [ -f "$file" ]; then
                normal_map_files+=("$(basename "$file")")
                has_normal_maps=true
            fi
        done

        if $has_normal_maps; then
            echo "Normal maps detected: ${normal_map_files[*]}"
        fi

        if ($has_jpeg || $has_jpg) && ! $has_png; then
            # Only JPEG/JPG files, no PNG files
            if grep -qi '\.png"' "$GLTF_FILE" 2>/dev/null; then
                if $has_jpeg; then
                    echo "Fixing GLTF references: PNG to JPEG"
                    sed -i.bak -e 's|\.png"|.jpeg"|gi' -e 's|\.PNG"|.jpeg"|g' -e 's|image/png|image/jpeg|gi' "$GLTF_FILE" && rm "$GLTF_FILE.bak"
                else
                    echo "Fixing GLTF references: PNG to JPG"
                    sed -i.bak -e 's|\.png"|.jpg"|gi' -e 's|\.PNG"|.jpg"|g' -e 's|image/png|image/jpeg|gi' "$GLTF_FILE" && rm "$GLTF_FILE.bak"
                fi
            elif grep -qi '\.jpg"' "$GLTF_FILE" 2>/dev/null && $has_jpeg; then
                echo "Fixing GLTF references: JPG to JPEG"
                sed -i.bak -e 's|\.jpg"|.jpeg"|gi' -e 's|\.JPG"|.jpeg"|g' "$GLTF_FILE" && rm "$GLTF_FILE.bak"
            elif grep -qi '\.jpeg"' "$GLTF_FILE" 2>/dev/null && $has_jpg; then
                echo "Fixing GLTF references: JPEG to JPG"
                sed -i.bak -e 's|\.jpeg"|.jpg"|gi' -e 's|\.JPEG"|.jpg"|g' "$GLTF_FILE" && rm "$GLTF_FILE.bak"
            fi
        fi

        # Validate and potentially auto-add normal maps to GLTF
        if $has_normal_maps; then
            local normal_files_in_gltf=0
            local added_normal_maps=0

            # Check if normal maps are already referenced
            for normal_file in "${normal_map_files[@]}"; do
                if grep -q "\"$normal_file\"" "$GLTF_FILE" 2>/dev/null; then
                    normal_files_in_gltf=$((normal_files_in_gltf + 1))
                fi
            done

            if [ $normal_files_in_gltf -gt 0 ]; then
                echo "Confirmed $normal_files_in_gltf normal map(s) already referenced in GLTF"
            else
                echo "Normal maps found but not referenced in GLTF - adding to images array"

                # Add normal maps to GLTF images array so they get included in the GLB
                for normal_file in "${normal_map_files[@]}"; do
                    # Extract number from normal map filename (e.g., "Clipper_normal1.jpg" -> "1")
                    local number=$(echo "$normal_file" | grep -o 'normal[0-9]\+' | grep -o '[0-9]\+')

                    if [ -n "$number" ]; then
                        # Look for corresponding baseColor texture
                        local base_pattern="baseColor_${number}"
                        if grep -q "\"${base_pattern}" "$GLTF_FILE" 2>/dev/null; then
                            echo "Including normal map $normal_file (for material $number)"

                            # Determine correct MIME type
                            local normal_extension="${normal_file##*.}"
                            local mime_type="image/jpeg"
                            if [[ "$normal_extension" == "png" || "$normal_extension" == "PNG" ]]; then
                                mime_type="image/png"
                            fi

                            # Add normal map to images array by inserting before the closing bracket
                            sed -i.bak '/^  "images": \[/,/^  \]/ {
                                /^  \]/ i\
    ,\
    {\
      "mimeType": "'$mime_type'",\
      "uri": "'$normal_file'"\
    }
                            }' "$GLTF_FILE" && rm "$GLTF_FILE.bak"

                            added_normal_maps=$((added_normal_maps + 1))
                        fi
                    fi
                done

                if [ $added_normal_maps -gt 0 ]; then
                    echo "Added $added_normal_maps normal map(s) to GLTF - will be included in GLB"
                    echo "Note: Normal maps added as images but not linked to materials (manual linking required)"
                else
                    echo "Warning: Could not add normal maps to GLTF"
                fi
            fi
        fi

        echo "Packing directory to GLB..."
        gltf-transform copy "$GLTF_FILE" "$TEMP"
    else
        # Handle GLB input
        cp "$INPUT" "$TEMP"
    fi

    # Always dedup, weld, join to reduce redundancy and draw calls
    echo "Removing duplicates..."
    gltf-transform dedup "$TEMP" "$TMP_DEDUP" 2>/dev/null
    echo "Welding vertices..."
    gltf-transform weld "$TMP_DEDUP" "$TMP_WELD" 2>/dev/null
    echo "Joining meshes..."
    gltf-transform join "$TMP_WELD" "$TMP_JOIN" 2>/dev/null
    mv "$TMP_JOIN" "$TEMP"

    # Check polygon count and simplify if needed (before compression)
    if [ "$SKIP_SIMPLIFY" = false ]; then
        local POLYGON_COUNT=$(count_polygons "$TEMP")

        if [ "$POLYGON_COUNT" -gt "$MAX_POLYGONS" ]; then
            echo ""
            echo "Model has $(printf "%'d" $POLYGON_COUNT) polygons (exceeds $(printf "%'d" $MAX_POLYGONS) limit)"
            simplify_model "$TEMP" "${TEMP%.glb}-simplified.glb" "$MAX_POLYGONS"
            mv "${TEMP%.glb}-simplified.glb" "$TEMP"
            echo ""
        else
            echo "Polygon count: $(printf "%'d" $POLYGON_COUNT) (within limits)"
        fi
    else
        echo "Skipping automatic polygon reduction (--no-simplify flag set)"
    fi

    echo "Resizing textures for Quest (max 4096x4096)..."
    gltf-transform resize "$TEMP" "${TEMP%.glb}-resized.glb" --width 4096 --height 4096 2>/dev/null

    echo "Converting textures to KTX2..."
    npx gltf-transform etc1s "${TEMP%.glb}-resized.glb" "${TEMP%.glb}-ktx.glb" --quality 64
    
    echo "Applying 20-bit Draco compression..."
    # 20-bit quantization prevents seams in multi-texture models
    npx gltf-transform draco "${TEMP%.glb}-ktx.glb" "$OUTPUT" \
        --method sequential \
        --encode-speed 0 \
        --decode-speed 0 \
        --quantize-position 20 \
        --quantize-normal 20 \
        --quantize-color 20 \
        --quantize-texcoord 20 \
        --quantize-generic 20

    rm -f "$TEMP" "${TEMP%.glb}-resized.glb" "${TEMP%.glb}-ktx.glb" "$TMP_DEDUP" "$TMP_WELD"
    echo "Quest-optimized GLB saved as: $OUTPUT"
}


# Parse command
case "${1:-}" in
    pack)
        shift
        [[ $# -lt 1 ]] && usage

        SKIP_SIMPLIFY=false
        MAX_POLYGONS=1200000
        SUFFIX="-quest"
        INPUTS=()

        # Parse inputs and flags
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --no-simplify)
                    SKIP_SIMPLIFY=true
                    shift
                    ;;
                --polygon)
                    if [[ $# -lt 2 ]] || [[ ! "$2" =~ ^[0-9]+$ ]]; then
                        echo "Error: --polygon requires a numeric value"
                        exit 1
                    fi
                    MAX_POLYGONS="$2"
                    shift 2
                    ;;
                --suffix)
                    if [[ $# -lt 2 ]]; then
                        echo "Error: --suffix requires a value"
                        exit 1
                    fi
                    SUFFIX="$2"
                    shift 2
                    ;;
                *)
                    INPUTS+=("$1")
                    shift
                    ;;
            esac
        done

        # Check we have at least one input
        if [ ${#INPUTS[@]} -eq 0 ]; then
            echo "Error: No input files specified"
            usage
        fi

        # Process each input
        for INPUT in "${INPUTS[@]}"; do
            if [ ! -e "$INPUT" ]; then
                echo "Warning: Skipping non-existent file: $INPUT"
                continue
            fi

            # Generate output filename
            if [ -d "$INPUT" ]; then
                BASE=$(basename "$INPUT" _edit)
                OUTPUT="${BASE}${SUFFIX}.glb"
            else
                BASE=$(basename "$INPUT" .glb)
                OUTPUT="${BASE}${SUFFIX}.glb"
            fi

            echo "=================================================="
            echo "Processing: $INPUT"
            echo "=================================================="
            pack_optimize "$INPUT" "$OUTPUT" "$SKIP_SIMPLIFY" "$MAX_POLYGONS"
            echo ""
        done
        ;;
    unpack)
        shift
        [[ $# -lt 1 ]] && usage
        extract_textures "$@"
        ;;
    *)
        usage
        ;;
esac
