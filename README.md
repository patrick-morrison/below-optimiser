# below-optimiser
Optimises photogrammetry models for WebXR by applying 20-bit Draco mesh
compression and KTX2 texture compression. Reduces file sizes by ~30% and
GPU memory usage by ~75% for smooth VR performance on Meta Quest
headsets.

## Quick Install

### Make executable
chmod +x below-optimiser

### Install dependencies
npm install -g @gltf-transform/cli

Usage

## Basic optimisation - creates input-quest.glb
  ./below-optimiser pack input.glb

# Unpack for texture editing
./below-optimiser unpack input.glb
# Edit textures in input_edit/ folder
./below-optimiser pack input_edit/

Tested on macOS and Windows Subsystem for Linux (WSL).

See https://belowjs.com/guides/optimisation.html for complete workflow details.
