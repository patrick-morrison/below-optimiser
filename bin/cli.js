#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { glob } from 'glob';
import { existsSync, statSync, readFileSync } from 'fs';
import { basename, dirname, resolve } from 'path';
import { pack } from '../src/pack.js';
import { unpack } from '../src/unpack.js';
import { inspect } from '../src/inspect.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

// Format bytes to human readable
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Format number with commas
function formatNumber(num) {
  return num.toLocaleString();
}

program
  .name('belowjs-optimiser')
  .description('Optimise GLB photogrammetry models for WebXR on Meta Quest')
  .version(VERSION)
  .showHelpAfterError('\nRun with --help for usage and examples.')
  .addHelpText('after', `
Input notes:
  - Primary command: belowjs-optimiser
  - Compatibility alias: below-optimiser
  - pack accepts .glb files, shell globs, or unpacked *_edit directories.
  - unpack writes an editable directory (default: <name>_edit).
  - info inspects a .glb file and prints model stats.

Requirements:
  - KTX-Software must be installed and "ktx" available on PATH for "pack".
    Install: https://github.com/KhronosGroup/KTX-Software/releases

Common examples:
  belowjs-optimiser pack model.glb
  belowjs-optimiser pack model.glb --scale 0.01
  belowjs-optimiser pack "models/*.glb" --polygon 800000 --suffix "_ar"
  belowjs-optimiser unpack model.glb
  belowjs-optimiser pack model_edit/
  belowjs-optimiser info model.glb

Docs: https://belowjs.com/guides/optimisation.html
`);

const packCommand = program
  .command('pack')
  .description('Optimise GLB files or unpacked directories')
  .argument('<input...>', '.glb file(s), glob(s), or *_edit directory path(s)')
  .option('--no-simplify', 'Skip automatic polygon reduction')
  .option('--polygon <count>', 'Target polygon count for simplification', '1200000')
  .option('--scale <factor>', 'Uniform scene scale factor (for example: 0.01)', '1')
  .option('--suffix <suffix>', 'Output suffix for generated GLB', '-belowjs')
  .action(async (inputs, options) => {
    console.log(chalk.bold(`\nbelowjs-optimiser v${VERSION}\n`));

    // Expand globs and validate inputs
    const files = [];
    for (const input of inputs) {
      const matches = await glob(input, { nodir: false });
      if (matches.length === 0) {
        console.log(chalk.yellow(`Warning: No matches for "${input}"`));
        continue;
      }
      files.push(...matches);
    }

    if (files.length === 0) {
      console.log(chalk.red('Error: No input files found'));
      process.exit(1);
    }

    const targetPolygons = parseInt(options.polygon, 10);
    const scaleFactor = parseFloat(options.scale);
    const suffix = options.suffix;
    const shouldSimplify = options.simplify;

    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
      console.log(chalk.red(`Error: --scale must be a positive number (received: ${options.scale})`));
      process.exit(1);
    }

    for (const input of files) {
      const inputPath = resolve(input);

      if (!existsSync(inputPath)) {
        console.log(chalk.yellow(`Skipping: ${input} (not found)`));
        continue;
      }

      const isDir = statSync(inputPath).isDirectory();
      const baseName = isDir
        ? basename(inputPath).replace(/_edit\d*$/, '')
        : basename(inputPath, '.glb');
      const outputPath = resolve(dirname(inputPath), `${baseName}${suffix}.glb`);

      console.log(chalk.cyan(`\n${isDir ? 'Directory' : 'File'}: ${input}`));
      console.log(chalk.dim('─'.repeat(50)));

      const spinner = ora({ spinner: 'dots' });

      try {
        // Get initial stats
        spinner.start('Analysing model...');
        const stats = await inspect(inputPath);
        spinner.succeed(`Polygons: ${formatNumber(stats.polygons)}, Materials: ${stats.materials}`);

        // Run pack with progress callbacks
        const result = await pack(inputPath, {
          output: outputPath,
          simplify: shouldSimplify,
          targetPolygons,
          scale: scaleFactor,
          onProgress: (step, detail) => {
            spinner.start(detail || step);
          },
          onStep: (step, success, detail) => {
            if (success) {
              spinner.succeed(detail || step);
            } else {
              spinner.fail(detail || step);
            }
          }
        });

        // Final summary
        const reduction = ((1 - result.outputSize / result.inputSize) * 100).toFixed(1);
        console.log(chalk.dim('─'.repeat(50)));
        console.log(
          chalk.green('✓'),
          chalk.bold(basename(outputPath)),
          chalk.dim(`(${formatBytes(result.outputSize)}, ${reduction}% smaller)`)
        );

        if (result.polygonsBefore !== result.polygonsAfter) {
          console.log(
            chalk.dim('  Polygons:'),
            `${formatNumber(result.polygonsBefore)} → ${formatNumber(result.polygonsAfter)}`
          );
        }

      } catch (err) {
        spinner.fail(err.message);
        console.log(chalk.red(`Failed: ${input}`));
        if (process.env.DEBUG) {
          console.error(err);
        }
      }
    }

    console.log('');
  });

packCommand.addHelpText('after', `
Behavior:
  - For .glb input, output is written beside the source file.
  - For directory input, directory must contain <base>.gltf (for example: ship_edit/ship.gltf).
  - Output name is <basename><suffix>.glb (for example: model-belowjs.glb).
  - Use --scale for uniform scene scaling (default: 1, unchanged).
  - Simplification runs only when polygons exceed --polygon, unless --no-simplify is used.
  - Original input files are not modified.

Examples:
  belowjs-optimiser pack model.glb
  belowjs-optimiser pack model.glb --scale 0.01
  belowjs-optimiser pack "models/*.glb" --polygon 800000
  belowjs-optimiser pack model_edit/ --suffix "_ar"
`);

const unpackCommand = program
  .command('unpack')
  .description('Extract editable GLTF + textures from a GLB')
  .argument('<input>', 'GLB file to unpack')
  .argument('[output]', 'Output directory (default: <name>_edit)')
  .action(async (input, output) => {
    console.log(chalk.bold(`\nbelowjs-optimiser v${VERSION}\n`));

    const inputPath = resolve(input);

    if (!existsSync(inputPath)) {
      console.log(chalk.red(`Error: File not found: ${input}`));
      process.exit(1);
    }

    const baseName = basename(inputPath, '.glb');
    const outputDir = output || resolve(dirname(inputPath), `${baseName}_edit`);

    const spinner = ora({ spinner: 'dots' });

    try {
      spinner.start('Extracting textures...');
      const result = await unpack(inputPath, outputDir);
      spinner.succeed(`Extracted to: ${result.outputDir}`);
      console.log(chalk.dim(`  ${result.textureCount} texture(s) extracted`));
    } catch (err) {
      spinner.fail(err.message);
      process.exit(1);
    }

    console.log('');
  });

unpackCommand.addHelpText('after', `
Behavior:
  - Creates an editable folder with .gltf and external texture files.
  - If output directory exists, a unique directory name is used.
  - Use "pack" on that directory after texture edits.

Examples:
  belowjs-optimiser unpack model.glb
  belowjs-optimiser unpack model.glb model_edit_custom
`);

const infoCommand = program
  .command('info')
  .description('Show polygon/material/texture/file-size stats for a GLB')
  .argument('<input>', 'GLB file to inspect')
  .action(async (input) => {
    const inputPath = resolve(input);

    if (!existsSync(inputPath)) {
      console.log(chalk.red(`Error: File not found: ${input}`));
      process.exit(1);
    }

    try {
      const stats = await inspect(inputPath);
      console.log(chalk.bold(`\n${basename(input)}\n`));
      console.log(`  Polygons:  ${formatNumber(stats.polygons)}`);
      console.log(`  Materials: ${stats.materials}`);
      console.log(`  Textures:  ${stats.textures}`);
      console.log(`  Size:      ${formatBytes(stats.fileSize)}`);
      console.log('');
    } catch (err) {
      console.log(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

infoCommand.addHelpText('after', `
Example:
  belowjs-optimiser info model.glb
`);

program.parse();
