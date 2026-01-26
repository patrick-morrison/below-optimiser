# Browser Optimization - Technical Documentation

## WASM Dependencies

This document tracks the origin and purpose of all WASM and JavaScript encoder files used in the browser optimization pipeline.

### Basis Universal Encoder (KTX2/ETC1S Texture Compression)

**Files:**
- `basis_encoder.js` (127 KB)
- `basis_encoder.wasm` (1.4 MB)

**Source:**
```bash
curl -L -o basis_encoder.js "https://unpkg.com/@loaders.gl/textures@4.3.3/dist/libs/basis_encoder.js"
curl -L -o basis_encoder.wasm "https://unpkg.com/@loaders.gl/textures@4.3.3/dist/libs/basis_encoder.wasm"
```

**Purpose:** Encodes textures to KTX2 format with ETC1S or UASTC compression (GPU-friendly compressed textures)

**Used by:** `ktx2-encoder` npm package via `ktx2()` function in gltf-transform pipeline

**Documentation:**
- [Basis Universal on GitHub](https://github.com/BinomialLLC/basis_universal)
- [loaders.gl Textures](https://loaders.gl/docs/modules/textures)

---

### Draco Mesh Compression Encoder

**Files (CDN):**
- `draco_encoder_gltf_nodejs.js`
- `draco_encoder.wasm`

**Source:**
```text
https://unpkg.com/draco3dgltf@1.5.7/draco_encoder_gltf_nodejs.js
https://unpkg.com/draco3dgltf@1.5.7/draco_encoder.wasm
```

**Purpose:** Compresses 3D mesh geometry (vertices, normals, UVs) using Google's Draco algorithm

**Used by:** `draco()` transform via a browser‑safe Draco encoder module loaded from CDN. `locateFile()` is configured to resolve the WASM from unpkg.

**Configuration:** 20-bit quantization for all attributes (position, normal, color, texcoord, generic) to prevent seams in multi-texture models

**Documentation:**
- [Google Draco on GitHub](https://github.com/google/draco)
- [glTF-Transform Draco docs](https://gltf-transform.dev/modules/functions/functions/draco)

---

## NPM Packages (CDN via esm.sh)

### Core Libraries

**@gltf-transform/core@4**
- Purpose: Core glTF 2.0 document manipulation
- Provides: `WebIO` for browser-based I/O

**@gltf-transform/extensions@4**
- Purpose: glTF extension support (KHR_draco_mesh_compression, KHR_texture_basisu, etc.)
- Provides: `ALL_EXTENSIONS`, `KHRDracoMeshCompression`

**@gltf-transform/functions@4**
- Purpose: Optimization transforms
- Provides: `dedup`, `weld`, `join`, `simplify`, `textureCompress`, `draco`

**meshoptimizer@0.21.0**
- Purpose: Mesh simplification (polygon reduction)
- Provides: `MeshoptSimplifier`

**ktx2-encoder**
- Purpose: Browser-compatible KTX2 texture encoding
- Provides: `ktx2()` function for gltf-transform

**Draco (CDN UMD)**
- Purpose: Draco encoder module (browser-compatible)
- Loaded from unpkg with `locateFile()` pointing to `draco_encoder.wasm`

---

## Optimization Pipeline

The browser pipeline matches the shell script (`below-optimiser`) as closely as possible:

### Shell Script Pipeline:
1. **If > 1.2M triangles:** `dedup` → `weld` → `join` → `simplify`
2. **Resize textures** to max 4096x4096
3. **KTX2/ETC1S compression** with quality 64
4. **Draco compression** with 20-bit quantization (sequential method)

### Browser Pipeline:
1. **If > 1.2M triangles:** `dedup()` → `weld()` → `join()` → `simplify()`
2. **Resize textures:** `textureCompress({ resize: [4096, 4096] })`
3. **KTX2/ETC1S:** `ktx2({ isUASTC: false, quality: 64, generateMipmap: true })`
4. **Draco:** `draco({ method: 'sequential', quantizePosition: 20, ... })`

**Implementation notes:**
- Transforms execute sequentially with per‑step progress updates.
- KTX2 step has a timeout safeguard to avoid silent hangs.

---

## Known Issues

### Source Maps (404 errors)
- `ndarray-pixels.mjs.map` - Not critical, can be ignored
- These are debugging files from CDN packages and don't affect functionality

### Browser Behavior
- Dragging image files onto the viewer applies them as new textures when no matching texture name is found.
- Download button remains disabled until a model is optimized or textures are updated.
- Status note shows: “New texture”, “Optimised”, or “New texture + optimised”.

---

## File Sizes

| File | Size | Purpose |
|------|------|---------|
| basis_encoder.js | 127 KB | Basis Universal encoder JS |
| basis_encoder.wasm | 1.4 MB | Basis Universal encoder WASM |
| draco_encoder_gltf_nodejs.js | ~49 KB | Draco encoder JS loader |
| draco_encoder.wasm | 370 KB | Draco encoder WASM |
| **Total** | **~2.4 MB** | One-time download, cached by browser |

---

## Updating Dependencies

To update the WASM files in the future:

```bash
# Update Basis encoder (check latest version at unpkg.com/@loaders.gl/textures)
curl -L -o basis_encoder.js "https://unpkg.com/@loaders.gl/textures@latest/dist/libs/basis_encoder.js"
curl -L -o basis_encoder.wasm "https://unpkg.com/@loaders.gl/textures@latest/dist/libs/basis_encoder.wasm"

# Draco encoder (UMD + WASM)
curl -L -o draco_encoder_gltf_nodejs.js "https://unpkg.com/draco3dgltf@1.5.7/draco_encoder_gltf_nodejs.js"
curl -L -o draco_encoder.wasm "https://unpkg.com/draco3dgltf@1.5.7/draco_encoder.wasm"
```

**Important:** Always test after updating to ensure compatibility with gltf-transform and ktx2-encoder packages.

---

## References

- [glTF-Transform Documentation](https://gltf-transform.dev/)
- [Basis Universal](https://github.com/BinomialLLC/basis_universal)
- [Google Draco](https://github.com/google/draco)
- [loaders.gl](https://loaders.gl/)
- [Meshoptimizer](https://github.com/zeux/meshoptimizer)
