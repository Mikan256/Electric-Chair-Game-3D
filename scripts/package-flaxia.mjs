#!/usr/bin/env node
/**
 * Build the two Flaxia upload archives:
 *   - slim: gameplay + media, no experimental VRM or unused source assets
 *   - full: every asset in public/assets
 *
 * WVFS rejects .fbx/.vrm/.md entries, so the assets are stored as .data/.txt.
 * The validator script checks the same rules as Flaxia's sandbox.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const release = join(root, 'release');
const staging = join(root, 'release', 'staging');

const SLIM_EXCLUDE = [
  'assets/models/avatar.data',
  'assets/models/pedestal.data',
  'assets/textures/clock.png',
  'assets/textures/logo-en.png',
  'assets/textures/emblem.png',
  'assets/textures/studio-logo.png',
  'assets/textures/mikan.png',
  'assets/textures/ui',
];

const EXTRA_SLIM_EXCLUDE_PATTERNS = [
  /^assets\/textures\/lightning\/(fx-|sheet-).*\.png$/,
  /^assets\/vrm-.*\.js$/,
  /^assets\/avatar-.*\.js$/,
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function removePath(path) {
  rmSync(path, { recursive: true, force: true });
}

function copyDist(target) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(dist, target, { recursive: true });
}

function slimPrune(target) {
  for (const item of SLIM_EXCLUDE) removePath(join(target, item));
  const lightningDir = join(target, 'assets', 'textures', 'lightning');
  if (existsSync(lightningDir)) {
    for (const file of readdirSync(lightningDir)) {
      if (EXTRA_SLIM_EXCLUDE_PATTERNS[0].test(`assets/textures/lightning/${file}`)) {
        removePath(join(lightningDir, file));
      }
    }
  }
  const assetsDir = join(target, 'assets');
  for (const file of readdirSync(assetsDir)) {
    if (
      EXTRA_SLIM_EXCLUDE_PATTERNS[1].test(`assets/${file}`) ||
      EXTRA_SLIM_EXCLUDE_PATTERNS[2].test(`assets/${file}`)
    ) {
      removePath(join(assetsDir, file));
    }
  }
}

function filterManifest(target) {
  const manifestPath = join(target, 'assets', 'manifest.json');
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const filtered = { ...manifest, assets: {} };
  for (const [key, value] of Object.entries(manifest.assets ?? {})) {
    if (existsSync(join(target, 'assets', key))) filtered.assets[key] = value;
  }
  writeFileSync(manifestPath, `${JSON.stringify(filtered, null, 2)}\n`);
}

function zip(target, output) {
  removePath(output);
  run('zip', ['-q', '-r', '-9', output, '.'], { cwd: target });
  const size = statSync(output).size;
  console.log(`  -> ${relative(root, output)} (${(size / 1024 / 1024).toFixed(1)} MiB)`);
}

function validate(file) {
  run('python3', [join(root, 'scripts', 'validate-flaxia-zip.py'), file]);
}

function main() {
  console.log('building...');
  run('pnpm', ['build'], { cwd: root });

  if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/index.html is missing');
  mkdirSync(release, { recursive: true });

  // Slim: everything needed for the game, without the experimental 15 MB VRM.
  const slimDir = join(staging, 'slim');
  copyDist(slimDir);
  slimPrune(slimDir);
  filterManifest(slimDir);
  const slimZip = join(release, 'electric-chair-game-3d-flaxia.zip');
  zip(slimDir, slimZip);

  // Full: includes the VRM and the complete mirrored asset set.
  const fullDir = join(staging, 'full');
  copyDist(fullDir);
  const fullZip = join(release, 'electric-chair-game-3d-flaxia-full.zip');
  zip(fullDir, fullZip);

  validate(slimZip);
  validate(fullZip);

  rmSync(staging, { recursive: true, force: true });
  console.log('\nrelease archives ready:');
  console.log(`  ${relative(root, slimZip)}`);
  console.log(`  ${relative(root, fullZip)}`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
