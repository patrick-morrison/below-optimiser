import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, join, simplify, draco } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { spawn } from 'child_process';
import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join as pathJoin, basename } from 'path';
import { randomUUID } from 'crypto';
import { getFileSize } from './inspect.js';

/**
 * Run a shell command and return a promise
 */
function exec(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'pipe', ...options });
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data; });
    proc.stderr?.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Check if a command exists
 */
async function commandExists(command) {
  try {
    await exec('which', [command]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check for KTX-Software and fail with helpful instructions if missing
 */
async function requireKtxSoftware() {
  const hasKtx = await commandExists('ktx');
  if (!hasKtx) {
    const platform = process.platform;
    let installInstructions = '';

    if (platform === 'darwin') {
      installInstructions = `
  Install using Homebrew:
    brew install ktx-software

  Or download from GitHub:
    https://github.com/KhronosGroup/KTX-Software/releases`;
    } else if (platform === 'win32') {
      installInstructions = `
  Download from GitHub:
    https://github.com/KhronosGroup/KTX-Software/releases

  Run the installer and ensure 'ktx' is added to your PATH.`;
    } else {
      installInstructions = `
  Download from GitHub:
    https://github.com/KhronosGroup/KTX-Software/releases

  Or install via your package manager (e.g., apt, yum).`;
    }

    throw new Error(`KTX-Software is required but 'ktx' command was not found.

KTX2 texture compression reduces GPU memory usage by ~75% - this is essential
for smooth VR performance on Meta Quest headsets.
${installInstructions}

After installing, restart your terminal and try again.`);
  }
}

/**
 * Create NodeIO with all extensions and dependencies registered
 */
async function createIO() {
  const io = new NodeIO()
    .registerExtensions(KHRONOS_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });
  return io;
}

/**
 * Detect actual image format from magic bytes
 * Returns 'png', 'jpeg', 'webp', 'ktx2', or null
 */
function detectImageFormat(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const bytes = new Uint8Array(buffer.slice(0, 12));

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return 'png';
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'jpeg';
  }
  // WebP: RIFF....WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'webp';
  }
  // KTX2: AB 4B 54 58 20 32 30 BB 0D 0A 1A 0A
  if (bytes[0] === 0xAB && bytes[1] === 0x4B && bytes[2] === 0x54 && bytes[3] === 0x58) {
    return 'ktx2';
  }
  return null;
}

/**
 * Resize all textures in a document to max dimensions
 * Uses sharp for high-quality Lanczos3 resizing
 * Also fixes incorrect MIME types based on actual data
 */
async function resizeTextures(document, maxWidth, maxHeight) {
  const textures = document.getRoot().listTextures();

  for (const texture of textures) {
    const image = texture.getImage();
    if (!image) continue;

    // Detect actual format from bytes (handles malformed files)
    const actualFormat = detectImageFormat(image);
    if (!actualFormat || actualFormat === 'ktx2') {
      // Skip actual KTX2 textures or unknown formats
      continue;
    }

    // Fix MIME type if it's wrong (e.g., marked as ktx2 but actually png)
    const correctMime = actualFormat === 'png' ? 'image/png' :
                        actualFormat === 'webp' ? 'image/webp' : 'image/jpeg';
    if (texture.getMimeType() !== correctMime) {
      texture.setMimeType(correctMime);
    }

    try {
      const metadata = await sharp(image).metadata();
      if (!metadata.width || !metadata.height) continue;

      // Only resize if larger than max dimensions
      if (metadata.width <= maxWidth && metadata.height <= maxHeight) continue;

      // Calculate new dimensions preserving aspect ratio
      const scale = Math.min(maxWidth / metadata.width, maxHeight / metadata.height);
      const newWidth = Math.round(metadata.width * scale);
      const newHeight = Math.round(metadata.height * scale);

      // Resize with Lanczos3 (high quality), preserve format
      const format = metadata.format === 'png' ? 'png' : 'jpeg';
      const resized = await sharp(image)
        .resize(newWidth, newHeight, { kernel: 'lanczos3' })
        .toFormat(format, format === 'jpeg' ? { quality: 90 } : {})
        .toBuffer();

      texture.setImage(resized);
    } catch {
      // Skip textures that sharp can't process
      continue;
    }
  }
}

/**
 * Count polygons from a document
 */
function countPolygonsFromDocument(document) {
  let total = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (indices) {
        total += indices.getCount() / 3;
      } else {
        const position = prim.getAttribute('POSITION');
        if (position) {
          total += position.getCount() / 3;
        }
      }
    }
  }
  return Math.round(total);
}

/**
 * Apply uniform scaling to all scene roots without touching mesh data.
 * Creates a scale wrapper node per scene so existing hierarchy stays intact.
 */
function applyUniformScale(document, factor) {
  if (factor === 1) return;

  const root = document.getRoot();
  const scenes = root.listScenes();

  scenes.forEach((scene, i) => {
    const sceneChildren = [...scene.listChildren()];
    if (sceneChildren.length === 0) return;

    const scaleNode = document
      .createNode(`belowjs_scale_${i + 1}`)
      .setScale([factor, factor, factor]);

    scene.addChild(scaleNode);
    for (const child of sceneChildren) {
      scaleNode.addChild(child);
    }
  });
}

/**
 * Simplify a document to target polygon count
 * Uses multi-attempt approach with increasing aggression
 */
async function simplifyDocument(document, targetPolygons, onProgress) {
  // Ensure MeshoptSimplifier is ready
  await MeshoptSimplifier.ready;

  let currentPolygons = countPolygonsFromDocument(document);
  const initialPolygons = currentPolygons;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (currentPolygons <= targetPolygons) {
      break;
    }

    // Calculate ratio with increasing aggression (0.65^n)
    const aggression = Math.pow(0.65, attempt - 1);
    let ratio = (targetPolygons / currentPolygons) * aggression;
    ratio = Math.max(0.01, Math.min(1.0, ratio));

    if (onProgress) {
      onProgress('simplify', `Simplifying (attempt ${attempt}/${maxAttempts}, ratio: ${ratio.toFixed(3)})...`);
    }

    // Run simplification pipeline
    await document.transform(
      dedup(),
      weld(),
      join(),
      simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.005, lockBorder: true })
    );

    currentPolygons = countPolygonsFromDocument(document);

    if (currentPolygons <= targetPolygons) {
      break;
    }
  }

  return { before: initialPolygons, after: currentPolygons };
}

/**
 * Pack and optimise a GLB file for Quest
 * Uses programmatic API for mesh operations, CLI for KTX2 compression
 *
 * @param {string} inputPath - Path to GLB file or directory
 * @param {Object} options - Pack options
 * @returns {Promise<Object>} - Result with stats
 */
export async function pack(inputPath, options = {}) {
  const {
    output,
    simplify: shouldSimplify = true,
    targetPolygons = 1200000,
    scale = 1,
    onProgress = () => {},
    onStep = () => {}
  } = options;

  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`Invalid scale "${scale}". Scale must be a positive number.`);
  }

  // Check KTX-Software is installed before starting
  await requireKtxSoftware();

  const isDir = statSync(inputPath).isDirectory();
  const tempDir = pathJoin(tmpdir(), `belowjs-optimiser-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    onProgress('load', 'Loading model...');

    const io = await createIO();
    let document;
    let inputSize;

    if (isDir) {
      // Handle directory input (GLTF + textures)
      const baseName = basename(inputPath).replace(/_edit\d*$/, '');
      const gltfPath = pathJoin(inputPath, `${baseName}.gltf`);

      if (!existsSync(gltfPath)) {
        throw new Error(`No .gltf file found: ${gltfPath}`);
      }

      // Handle texture format mismatches and normal maps
      await fixTextureReferences(gltfPath, inputPath, onStep);

      document = await io.read(gltfPath);
      inputSize = 0; // Directory input
    } else {
      document = await io.read(inputPath);
      inputSize = getFileSize(inputPath);
    }

    onStep('load', true, 'Model loaded');

    // Step 1b: Optional uniform scene scaling
    if (scale !== 1) {
      applyUniformScale(document, scale);
      onStep('scale', true, `Scaled scene uniformly by ${scale}x`);
    } else {
      onStep('scale', true, 'Scale: unchanged (1x)');
    }

    // Get initial polygon count
    const polygonsBefore = countPolygonsFromDocument(document);
    let polygonsAfter = polygonsBefore;

    // Step 2: Simplify if needed
    if (shouldSimplify && polygonsBefore > targetPolygons) {
      onProgress('simplify', `Simplifying ${polygonsBefore.toLocaleString()} polygons...`);

      const result = await simplifyDocument(document, targetPolygons, onProgress);
      polygonsAfter = result.after;

      onStep('simplify', true, `Simplified: ${result.before.toLocaleString()} → ${result.after.toLocaleString()} polygons`);
    } else if (shouldSimplify) {
      onStep('simplify', true, `Polygons: ${polygonsBefore.toLocaleString()} (within limits)`);
    } else {
      onStep('simplify', true, 'Simplification skipped');
    }

    // Step 3: Resize textures using sharp
    onProgress('resize', 'Resizing textures (max 4096x4096)...');
    await resizeTextures(document, 4096, 4096);
    onStep('resize', true, 'Textures resized');

    // Write intermediate file for KTX2 compression
    const tempResized = pathJoin(tempDir, 'resized.glb');
    await io.write(tempResized, document);

    // Step 4: KTX2 compression (requires ktx CLI - no pure JS encoder available)
    const tempKtx = pathJoin(tempDir, 'ktx.glb');
    onProgress('ktx2', 'Converting textures to KTX2...');
    await exec('npx', ['gltf-transform', 'etc1s', tempResized, tempKtx, '--quality', '64']);
    onStep('ktx2', true, 'Textures compressed to KTX2');

    // Reload document with KTX2 textures
    document = await io.read(tempKtx);

    // Step 5: Draco compression
    onProgress('draco', 'Applying Draco compression...');
    await document.transform(
      draco({
        method: 'sequential',
        encodeSpeed: 0,
        decodeSpeed: 0,
        quantizePosition: 20,
        quantizeNormal: 20,
        quantizeColor: 20,
        quantizeTexcoord: 20,
        quantizeGeneric: 20
      })
    );
    onStep('draco', true, 'Draco compression applied (20-bit)');

    // Write final output
    await io.write(output, document);
    const outputSize = getFileSize(output);

    return {
      inputPath,
      outputPath: output,
      inputSize,
      outputSize,
      scale,
      polygonsBefore,
      polygonsAfter
    };

  } finally {
    // Cleanup temp files
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Fix texture references in GLTF file and handle normal maps
 * This matches the bash script behavior exactly
 */
async function fixTextureReferences(gltfPath, inputDir, onStep = () => {}) {
  let content = readFileSync(gltfPath, 'utf8');
  let modified = false;

  // Get all files in directory for texture detection
  const files = readdirSync(inputDir);

  // Smart texture format detection (case-insensitive like bash script)
  const hasJpeg = files.some(f => /\.(jpeg)$/i.test(f));
  const hasJpg = files.some(f => /\.(jpg)$/i.test(f) && !/\.(jpeg)$/i.test(f));
  const hasPng = files.some(f => /\.(png)$/i.test(f));

  // Check for normal maps with pattern *normal[0-9]*
  const normalMapFiles = files.filter(f => /normal\d+\./i.test(f));
  const hasNormalMaps = normalMapFiles.length > 0;

  if (hasNormalMaps) {
    onStep('normal', true, `Normal maps detected: ${normalMapFiles.join(', ')}`);
  }

  // Fix mismatched references (PNG to JPEG/JPG)
  if ((hasJpeg || hasJpg) && !hasPng) {
    if (content.includes('.png"')) {
      if (hasJpeg) {
        content = content.replace(/\.png"/gi, '.jpeg"').replace(/\.PNG"/g, '.jpeg"').replace(/image\/png/gi, 'image/jpeg');
        onStep('fix', true, 'Fixed GLTF references: PNG → JPEG');
      } else {
        content = content.replace(/\.png"/gi, '.jpg"').replace(/\.PNG"/g, '.jpg"').replace(/image\/png/gi, 'image/jpeg');
        onStep('fix', true, 'Fixed GLTF references: PNG → JPG');
      }
      modified = true;
    }
  }

  // Fix JPG/JPEG mismatches
  if (hasJpeg && content.includes('.jpg"') && !hasJpg) {
    content = content.replace(/\.jpg"/gi, '.jpeg"').replace(/\.JPG"/g, '.jpeg"');
    onStep('fix', true, 'Fixed GLTF references: JPG → JPEG');
    modified = true;
  }

  if (hasJpg && content.includes('.jpeg"') && !hasJpeg) {
    content = content.replace(/\.jpeg"/gi, '.jpg"').replace(/\.JPEG"/g, '.jpg"');
    onStep('fix', true, 'Fixed GLTF references: JPEG → JPG');
    modified = true;
  }

  // Handle normal maps - add to GLTF if not already referenced
  if (hasNormalMaps) {
    let addedNormalMaps = 0;

    for (const normalFile of normalMapFiles) {
      // Check if already referenced
      if (content.includes(`"${normalFile}"`)) {
        continue;
      }

      // Extract number from normal map filename (e.g., "model_normal1.jpg" -> "1")
      const numberMatch = normalFile.match(/normal(\d+)/i);
      if (!numberMatch) continue;

      const number = numberMatch[1];

      // Look for corresponding baseColor texture
      const basePattern = `baseColor_${number}`;
      if (!content.includes(basePattern)) continue;

      // Determine MIME type
      const ext = normalFile.split('.').pop().toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

      // Add normal map to images array
      const imagesMatch = content.match(/"images"\s*:\s*\[([\s\S]*?)\]/);
      if (imagesMatch) {
        const newImage = `,
    {
      "mimeType": "${mimeType}",
      "uri": "${normalFile}"
    }`;
        content = content.replace(
          /"images"\s*:\s*\[([\s\S]*?)\]/,
          (_, inner) => `"images": [${inner.trimEnd()}${newImage}\n  ]`
        );
        addedNormalMaps++;
        modified = true;
      }
    }

    if (addedNormalMaps > 0) {
      onStep('normal', true, `Added ${addedNormalMaps} normal map(s) to GLTF`);
    }
  }

  if (modified) {
    writeFileSync(gltfPath, content);
  }
}
