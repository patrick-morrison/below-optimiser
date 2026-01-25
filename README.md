# below-optimiser
Optimises photogrammetry models for WebXR by applying 20-bit Draco mesh
compression and KTX2 texture compression. Reduces file sizes by ~30% and
GPU memory usage by ~75% for smooth VR performance on Meta Quest
headsets. For models over 1.2 million polygons, it also simplifies the mesh.

Tested on macOS and Windows Subsystem for Linux (WSL).

See https://belowjs.com/guides/optimisation.html for complete workflow details.

## Quick Install

### Make executable
```sh
chmod +x below-optimiser
```

### Install dependencies
```sh
npm install -g @gltf-transform/cli
```

## Usage

### Basic optimisation - creates input-quest.glb
```sh
./below-optimiser pack input.glb
```

### Unpack for texture editing
```sh
./below-optimiser unpack input.glb
```

### Edit textures in input_edit/ folder
```sh
./below-optimiser pack input_edit/
```

### Batch a folder of models
```sh
./below-optimiser pack models/*.glb
```

### Skip polygon reduction
```sh
./below-optimiser pack model.glb --no-simplify
```

## Test Results

Testing performed on 12 shipwreck photogrammetry models from my library, and Sketchfab.

| Model | Original Polygons | Simplified? | Final Polygons | Original Size | Final Size | Compression | Draw Call Reduction |
|-------|-------------------|-------------|----------------|---------------|------------|-------------|---------------------|
| 04 Koz VII | 819,407 | - | 819,407 | 41.51 MB | 41.51 MB | 0% | - |
| carlingford | 8,000,001 | ✓ | 1,199,992 | 279.21 MB | 27.63 MB | 90.1% | 78→1 |
| dunderberg | 8,000,000 | ✓ | 1,199,999 | 297.00 MB | 29.74 MB | 90.0% | 82→1 |
| dutch_submarine | 1,000,001 | - | 1,000,001 | 62.85 MB | 23.75 MB | 62.2% | - |
| enriquillo | 987,021 | - | 987,021 | 59.06 MB | 24.54 MB | 58.5% | - |
| flint_shipwreck | 800,002 | - | 800,002 | 102.81 MB | 36.10 MB | 64.9% | - |
| junee | 10,707,223 | ✓ | 1,199,213 | 261.26 MB | 22.76 MB | 91.3% | 1→1 |
| new_hope | 1,547,410 | ✓ | 1,199,995 | 67.09 MB | 27.48 MB | 59.0% | 16→1 |
| providence | 186,314 | - | 186,314 | 31.80 MB | 8.03 MB | 74.8% | - |
| hopkins_2018 | 4,000,000 | ✓ | 1,199,999 | 141.57 MB | 24.71 MB | 82.5% | 42→1 |
| hopkins_yr_2 | 3,965,487 | ✓ | 1,199,990 | 185.08 MB | 32.39 MB | 82.5% | 51→1 |
| jarvenkari | 6,851,347 | ✓ | 1,199,999 | 237.79 MB | 29.85 MB | 87.4% | 66→1 |
| stalker | 900,009 | - | 900,009 | 238.68 MB | 60.06 MB | 74.8% | - |
| uunihylky | 9,996,918 | ✓ | 1,199,990 | 365.39 MB | 40.03 MB | 89.0% | 100→1 |
| trial_1622 | 2,076,711 | ✓ | 1,199,994 | 94.76 MB | 27.16 MB | 71.3% | 20→1 |