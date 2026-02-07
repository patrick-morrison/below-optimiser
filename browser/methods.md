# Browser Optimisation - Technical Documentation

## Scope

This document reflects the current browser implementation in `index.html` and `browser/ktx2-encoder.js`.

---

## Runtime Dependency Map

### Import map modules (ESM)

- `three` -> `https://esm.sh/three@0.170.0`
- `belowjs` -> `./browser/belowjs.js`
- `@gltf-transform/core` -> `https://esm.sh/@gltf-transform/core@4`
- `@gltf-transform/extensions` -> `https://esm.sh/@gltf-transform/extensions@4`
- `@gltf-transform/functions` -> `https://esm.sh/@gltf-transform/functions@4`
- `meshoptimizer` -> `https://esm.sh/meshoptimizer@0.21.0`
- `three/examples/jsm/loaders/KTX2Loader.js` -> `https://unpkg.com/three@0.170.0/examples/jsm/loaders/KTX2Loader.js`
- `ktx2-encoder` -> `./browser/ktx2-encoder.js?v=20260207c`
- `ktx-parse` -> `https://unpkg.com/ktx-parse@0.7.1/dist/ktx-parse.esm.js`

### UMD globals (script tags)

- `https://unpkg.com/draco3dgltf@1.5.7/draco_encoder_gltf_nodejs.js`
- `https://unpkg.com/draco3dgltf@1.5.7/draco_decoder_gltf_nodejs.js`

These provide global `DracoEncoderModule` / `DracoDecoderModule`.

Note: `browser/draco_encoder.js` exists in the repo, but the active browser runtime path currently uses the unpkg UMD scripts above.

---

## Encoder Files Used By Browser KTX2 Path

### Basis Universal

- Local files used at runtime:
  - `browser/basis_encoder.js`
  - `browser/basis_encoder.wasm`
- Original upstream source used to fetch/update these:
  - `https://unpkg.com/ktx2-encoder@0.5.1/dist/basis/basis_encoder.js`
  - `https://unpkg.com/ktx2-encoder@0.5.1/dist/basis/basis_encoder.wasm`

### Local browser wrapper

- Active wrapper module: `browser/ktx2-encoder.js`
- Export used by app: `encodeToKTX2()`

What it does:

- Loads Basis factory via ESM `import()` first, then classic script fallback.
- Caches loaded module (`modulePromise`) across calls.
- Supports retry for failed script loads (failed script promise is evicted).
- Applies encoder options with v1/v2 method fallbacks:
  - `setKTX2SRGBTransferFunc` -> fallback `setKTX2AndBasisSRGBTransferFunc`
  - `setCompressionLevel` -> fallback `setETC1SCompressionLevel`
- Decodes input image bytes via WebGL2 + `createImageBitmap` before `setSliceSourceImage(..., RAW)`.

---

## Draco Usage

Draco is configured via glTF-Transform `draco()` and the UMD modules above.

- Encoder + decoder are registered on `WebIO`.
- `locateFile()` resolves WASM from unpkg.
- Quantization is explicitly set to 20-bit for:
  - `quantizePosition`
  - `quantizeNormal`
  - `quantizeColor`
  - `quantizeTexcoord`
  - `quantizeGeneric`
- Method is `sequential` to preserve vertex order.

---

## Browser Optimisation Pipeline (Actual Order)

Within `optimizeModel()`:

1. `dedup()`
2. `weld()`
3. `join()`
4. `simplify()` only if triangles > 1.2M
5. Optional resize transform:
   - `textureCompress({ resize: [8192, 8192] })`
   - Only added if any source texture dimension exceeds 8192
6. `draco(...)` with 20-bit quantization
7. KTX2 conversion (sequential, one texture at a time) via `encodeToKTX2(...)`
8. `io.writeBinary(...)`

Note on naming: the returned `convertedCount` field from `convertTexturesToKtx2Sequential()` is currently `candidates.length` (legacy name), while skip counts are tracked separately.

---

## Texture Policy In Browser Path

### Candidate formats for KTX2 conversion

- `image/jpeg`
- `image/png`
- `image/webp`

### Limits/policy

- Max dimension threshold for optional resize transform: `8192`
- Max per-texture texels for Basis WASM encode path: `8192 * 8192` (`67,108,864`)
- No automatic padding and no automatic WASM-cap downscale during sequential encode step.

If a texture in the KTX2 step is:

- above WASM texel cap -> skipped (left as original source image)
- not multiple-of-4 in width/height -> skipped (left as original source image)

Result: browser path preserves source texture data for those textures instead of resizing/padding in that stage.

---

## Progress / UI Behavior

- Overlay modes:
  - spinner mode (load paths)
  - progress mode (optimise + texture operations)
- Optimisation progress is shown by:
  - transform step completion
  - per-texture KTX2 `start` and `done` events
- KTX2 status now updates immediately when each texture starts encoding.
- Warning note is shown during optimise mode, including:
  - experimental/browser-limit warning
  - can take a few minutes note
  - keep tab focused note

---

## Known Caveats

- Browser memory constraints still apply; very large models/textures may fail.
- Some textures may remain uncompressed in browser mode due to WASM cap or 4x4 alignment constraints.
- Source-map 404 warnings from third-party packages do not affect runtime behavior.

---

## Updating Local Encoder Assets

To refresh local Basis files from upstream:

```bash
curl -L -o browser/basis_encoder.js "https://unpkg.com/ktx2-encoder@0.5.1/dist/basis/basis_encoder.js"
curl -L -o browser/basis_encoder.wasm "https://unpkg.com/ktx2-encoder@0.5.1/dist/basis/basis_encoder.wasm"
```

After update:

1. Validate browser optimise flow end-to-end.
2. Confirm KTX2 conversion still works for:
   - standard textures
   - skipped textures (WASM cap / non-4x4)
3. Confirm progress UI still updates through Draco -> KTX2 -> write stages.

---

## References

- glTF-Transform docs: `https://gltf-transform.dev/`
- Basis Universal: `https://github.com/BinomialLLC/basis_universal`
- Draco: `https://github.com/google/draco`
- Meshoptimizer: `https://github.com/zeux/meshoptimizer`
