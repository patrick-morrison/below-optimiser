import { existsSync, mkdirSync } from 'fs';
import { basename, dirname, join } from 'path';
import { spawn } from 'child_process';

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
 * Find a unique directory name by appending numbers
 */
function findUniqueDir(baseDir) {
  if (!existsSync(baseDir)) {
    return baseDir;
  }

  let n = 1;
  let dir = baseDir.replace(/_edit\d*$/, '') + `_edit${n}`;
  while (existsSync(dir)) {
    n++;
    dir = baseDir.replace(/_edit\d*$/, '') + `_edit${n}`;
  }
  return dir;
}

/**
 * Unpack a GLB file for texture editing
 * @param {string} inputPath - Path to GLB file
 * @param {string} outputDir - Output directory (optional)
 * @returns {Promise<{outputDir: string, textureCount: number}>}
 */
export async function unpack(inputPath, outputDir) {
  const baseName = basename(inputPath, '.glb');
  const dir = dirname(inputPath);

  // Determine output directory
  let targetDir = outputDir || join(dir, `${baseName}_edit`);
  targetDir = findUniqueDir(targetDir);

  // Create output directory
  mkdirSync(targetDir, { recursive: true });

  // Try to decompress KTX2 first, then copy
  const tempPath = join(targetDir, `${baseName}-temp.glb`);
  const gltfPath = join(targetDir, `${baseName}.gltf`);

  try {
    // Try KTX2 decompression
    await exec('npx', ['gltf-transform', 'ktxdecompress', inputPath, tempPath]);
  } catch {
    // If decompression fails, use original (might not have KTX2)
    const { copyFileSync } = await import('fs');
    copyFileSync(inputPath, tempPath);
  }

  // Convert to GLTF with separate textures
  await exec('npx', ['gltf-transform', 'copy', tempPath, gltfPath]);

  // Clean up temp file
  const { unlinkSync } = await import('fs');
  try {
    unlinkSync(tempPath);
  } catch {
    // Ignore cleanup errors
  }

  // Count extracted textures
  const { readdirSync } = await import('fs');
  const files = readdirSync(targetDir);
  const textureCount = files.filter(f =>
    /\.(png|jpg|jpeg|webp|ktx2)$/i.test(f)
  ).length;

  return {
    outputDir: targetDir,
    textureCount
  };
}
