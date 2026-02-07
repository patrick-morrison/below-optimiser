import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { statSync, existsSync } from 'fs';
import { join, basename } from 'path';

/**
 * Get file size in bytes
 */
export function getFileSize(filePath) {
  return statSync(filePath).size;
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
 * Count materials in a document
 */
function countMaterialsFromDocument(document) {
  return document.getRoot().listMaterials().length;
}

/**
 * Count textures in a document
 */
function countTexturesFromDocument(document) {
  return document.getRoot().listTextures().length;
}

/**
 * Inspect a GLB file and return statistics
 * Uses programmatic API for robust handling of all GLB formats
 *
 * @param {string} inputPath - Path to GLB file or directory
 * @returns {Promise<{polygons: number, materials: number, textures: number, fileSize: number}>}
 */
export async function inspect(inputPath) {
  const io = await createIO();
  let targetPath = inputPath;
  let fileSize = 0;

  // Handle directory input (GLTF + textures)
  if (statSync(inputPath).isDirectory()) {
    const baseName = basename(inputPath).replace(/_edit\d*$/, '');
    const gltfPath = join(inputPath, `${baseName}.gltf`);

    if (!existsSync(gltfPath)) {
      throw new Error(`No .gltf file found: ${gltfPath}`);
    }

    targetPath = gltfPath;
    fileSize = 0; // Directory has no single file size
  } else {
    fileSize = getFileSize(inputPath);
  }

  const document = await io.read(targetPath);

  return {
    polygons: countPolygonsFromDocument(document),
    materials: countMaterialsFromDocument(document),
    textures: countTexturesFromDocument(document),
    fileSize
  };
}
