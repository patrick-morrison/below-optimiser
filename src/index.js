/**
 * belowjs-optimiser - GLB optimization toolkit for Quest
 *
 * Optimises photogrammetry models for WebXR by applying:
 * - 20-bit Draco mesh compression
 * - KTX2 texture compression
 * - Optional uniform scene scaling
 * - Automatic polygon simplification for models over 1.2M polygons
 *
 * @example
 * import { pack, unpack, inspect } from 'belowjs-optimiser';
 *
 * // Optimise a model
 * await pack('model.glb', {
 *   output: 'model-quest.glb',
 *   scale: 1,
 *   targetPolygons: 1200000
 * });
 *
 * // Extract textures for editing
 * await unpack('model.glb', 'model_edit');
 *
 * // Get model stats
 * const stats = await inspect('model.glb');
 * console.log(`Polygons: ${stats.polygons}`);
 */

export { pack } from './pack.js';
export { unpack } from './unpack.js';
export { inspect, getFileSize } from './inspect.js';
