#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { glob } from 'glob';
import { existsSync, statSync } from 'fs';
import { basename, dirname, resolve } from 'path';
import { pack } from '../src/pack.js';
import { unpack } from '../src/unpack.js';
import { inspect } from '../src/inspect.js';

const VERSION = '2.0.0';

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
  .name('below-optimiser')
  .description('Optimise GLB models for WebXR on Meta Quest headsets')
  .version(VERSION);

program
  .command('pack')
  .description('Optimise GLB files for Quest (Draco + KTX2 compression)')
  .argument('<input...>', 'GLB files or directories to optimise')
  .option('--no-simplify', 'Skip automatic polygon reduction')
  .option('--polygon <count>', 'Target polygon count', '1200000')
  .option('--suffix <suffix>', 'Output file suffix', '-belowjs')
  .action(async (inputs, options) => {
    console.log(chalk.bold(`\nbelow-optimiser v${VERSION}\n`));

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
    const suffix = options.suffix;
    const shouldSimplify = options.simplify;

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

program
  .command('unpack')
  .description('Extract textures from GLB for editing')
  .argument('<input>', 'GLB file to unpack')
  .argument('[output]', 'Output directory (default: <name>_edit)')
  .action(async (input, output) => {
    console.log(chalk.bold(`\nbelow-optimiser v${VERSION}\n`));

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

program
  .command('info')
  .description('Show model information')
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

program.parse();
