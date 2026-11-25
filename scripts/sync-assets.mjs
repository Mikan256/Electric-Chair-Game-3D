#!/usr/bin/env node
/**
 * Copies the usable subset of the legacy Unity project into public/assets.
 *
 * The legacy project is kept read-only (and git-ignored); everything the web
 * build needs lives under public/assets. Run `pnpm assets:sync` after adding
 * new source material.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(root, 'Electric-Chair-Game', 'Assets');
const targetRoot = join(root, 'public', 'assets');

/** logical key -> legacy Unity path (relative to Assets/) */
const files = {
  // 3D assets
  'models/chair-01.data': 'Object/Chair/Block1.fbx',
  'models/chair-02.data': 'Object/Chair/Block2.fbx',
  'models/chair-03.data': 'Object/Chair/Block3.fbx',
  'models/chair-04.data': 'Object/Chair/Block4.fbx',
  'models/chair-05.data': 'Object/Chair/Block5.fbx',
  'models/chair-06.data': 'Object/Chair/Block6.fbx',
  'models/chair-07.data': 'Object/Chair/Block7.fbx',
  'models/chair-08.data': 'Object/Chair/Block8.fbx',
  'models/chair-09.data': 'Object/Chair/Block9.fbx',
  'models/chair-10.data': 'Object/Chair/Block10.fbx',
  'models/chair-11.data': 'Object/Chair/Block11.fbx',
  'models/chair-12.data': 'Object/Chair/Block12.fbx',
  'models/pedestal.data': 'Object/その他/台座.fbx',
  'models/avatar.data': 'Object/その他/電気椅子ゲーム.vrm',

  // Branding / 2D art
  'textures/logo.png': 'Image/電気椅子ゲーム.png',
  'textures/logo-en.png': 'Image/Electric Chair Game.png',
  'textures/clock.png': 'Image/時計.png',
  'textures/emblem.png': 'Image/3606116_l-Photoroom.png',
  'textures/studio-logo.png': 'Image/danball_mikan_box.png',
  'textures/mikan.png': 'Image/mikan.png',

  // Lightning sprites and effects
  'textures/lightning/bolt.png': 'LightningBolt/Textures/LightningBoltTexture.png',
  'textures/lightning/sheet-1.png': 'LightningBolt/Textures/LightningSpriteSheet1.png',
  'textures/lightning/sheet-2.png': 'LightningBolt/Textures/LightningSpriteSheet2.png',
  'textures/lightning/fx-cc.png': 'FX_Kandol_Pack/FX_lightning_II/Textures/fx_lightning_cc.png',
  'textures/lightning/fx-ee.png': 'FX_Kandol_Pack/FX_lightning_II/Textures/fx_lightning_ee_c.png',
  'textures/lightning/fx-ff.png': 'FX_Kandol_Pack/FX_lightning_II/Textures/fx_lightning_ff_a.png',
  'textures/lightning/fx-gg.png': 'FX_Kandol_Pack/FX_lightning_II/Textures/fx_lightning_gg_a.png',
  'textures/lightning/fx-line-a.png':
    'FX_Kandol_Pack/FX_lightning_II/Textures/fx_lightning_line_a.png',
  'textures/lightning/fx-line-c.png':
    'FX_Kandol_Pack/FX_lightning_II/Textures/fx_lightning_line_c.png',
  'textures/lightning/fx-line-d.png':
    'FX_Kandol_Pack/FX_lightning_II/Textures/fx_lightning_line_d.png',
  'textures/lightning/fx-ll.png': 'FX_Kandol_Pack/FX_lightning_II/Textures/fx_lightning_ll.png',
  'textures/lightning/fx-mm.png': 'FX_Kandol_Pack/FX_lightning_II/Textures/fx_lightning_mm.png',
  'textures/lightning/fx-nn.png': 'FX_Kandol_Pack/FX_lightning_II/Textures/fx_lightning_nn.png',
  'textures/lightning/fx-oo.png': 'FX_Kandol_Pack/FX_lightning_II/Textures/fx_lightning_oo.png',
  'textures/lightning/fx-pp.png': 'FX_Kandol_Pack/FX_lightning_II/Textures/fx_lightning_pp.png',

  // Sci-fi UI kit (buttons / frames / bars)
  'textures/ui/window.png': 'Sci-Fi UI/_SciFi_GUISkin_/Skin_Assets/window/window_transparent.png',
  'textures/ui/button.png': 'Sci-Fi UI/_SciFi_GUISkin_/Skin_Assets/buttons/button1.png',
  'textures/ui/button-active.png':
    'Sci-Fi UI/_SciFi_GUISkin_/Skin_Assets/buttons/button_active.png',
  'textures/ui/button-pushed.png':
    'Sci-Fi UI/_SciFi_GUISkin_/Skin_Assets/buttons/button_pushed.png',
  'textures/ui/bar-red.png': 'Sci-Fi UI/_SciFi_GUISkin_/Bonus_Assets/bars/bar_red.png',
  'textures/ui/bar-green.png': 'Sci-Fi UI/_SciFi_GUISkin_/Skin_Assets/bars/bar_green.png',
  'textures/ui/bar-background.png': 'Sci-Fi UI/_SciFi_GUISkin_/Bonus_Assets/bars/progress_bar.png',
  'fonts/zekton.ttf': 'Sci-Fi UI/_SciFi_GUISkin_/Skin_Assets/font/zekton free.ttf',

  // Video cut-ins
  'video/final-thunder.mp4': 'Image/FINAL THUNDER.mp4',
  'video/lightning.mp4': 'Image/nc419728_電光が走る.mp4',

  // Audio
  'audio/bgm/title.mp3': 'BGM/MusMus-BGM-168.mp3',
  'audio/bgm/innovation.mp3': 'BGM/Innovation.wav',
  'audio/bgm/heartbeat.mp3': 'BGM/Heartbeat03-1(Slow-Reverb).mp3',
  'audio/se/electric.mp3': 'BGM/nc383878_【効果音】電流・その1・ビリビリ.mp3',
  'audio/se/chair.mp3': 'BGM/Onoma-Syakiin04-2(Short).mp3',
  'audio/se/click.mp3': 'BGM/決定ボタンを押す15.mp3',
};

// `Innovation.wav` (55 MB) is intentionally not shipped; see CREDITS.txt.

/**
 * Generated in-repo with Piper TTS (scripts/generate-round-voice.sh and
 * scripts/generate-final-thunder-voice.sh). These are not copied from the
 * legacy Unity project, but they live in the same manifest so the release hash
 * check and loaders see one consistent asset list.
 */
const generated = {
  ...Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `audio/voice/round-${index + 1}.mp3`,
      `Piper TTS "Round ${index + 1}" (en_US-joe-medium, CC0)`,
    ]),
  ),
  'audio/voice/final-thunder.mp3': 'Piper TTS "Final Thunder" (en_US-joe-medium, CC0)',
};

const credits = `# Asset credits / 来歴

このディレクトリのアセットは、リポジトリ内の旧 Unity プロジェクト
(\`Electric-Chair-Game/\`) から \`scripts/sync-assets.mjs\` でコピーしたものと、
このリポジトリ内で生成したラウンドコール音声で構成されています。

- 企画・一部素材: ダンボールみかん箱 (Danball Mikan Box)
- BGM: MusMus (「MusMus-BGM-168」ほか)、Innovation.wav（旧プロジェクト同梱）
- 効果音: 効果音ラボ、Onoma
- 3D/エフェクト素材: DEVNIK 2D, FX_Kandol_Pack, GabrielAguiarProductions, LightningBolt
- UI: Sci-Fi UI (zekton font を含む)
- 3D アバター形式: UniVRM / VRM
- ラウンドコール / FINAL THUNDER 音声: Piper TTS (MIT) + en_US-joe-medium (CC0) で生成

元の Unity プロジェクトの \`LICENSE\` と各 Asset Store のライセンスに従ってください。
\`Innovation.wav\` (55 MB) はビルドサイズ削減のため、圧縮した MP3 のみ同梱しています。

Flaxia の ZIP 拡張子許可リストに合わせて、FBX/VRM のバイナリは \`.data\` として保存しています
（three.js の FBXLoader / GLTFLoader は拡張子ではなく内容で判定します）。

「水曜日のダウンタウン」「電気イスゲーム」は番組・権利者に帰属します。
本プロジェクトは非公式のファンメイド実装です。
`;

async function main() {
  const manifestOnly = process.argv.includes('--manifest-only');
  await mkdir(targetRoot, { recursive: true });
  const missing = [];

  if (!manifestOnly) {
    for (const [targetRel, sourceRel] of Object.entries(files)) {
      const source = join(sourceRoot, sourceRel);
      const target = join(targetRoot, targetRel);
      try {
        await stat(source);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
        console.log(`✓ ${targetRel.padEnd(36)} ← ${sourceRel}`);
      } catch (error) {
        missing.push({ targetRel, sourceRel, error: String(error) });
        console.warn(`✗ ${targetRel} (missing: ${sourceRel})`);
      }
    }
  }

  if (missing.length > 0) {
    console.warn(`\n${missing.length} asset(s) missing. The game falls back to placeholders.`);
  }

  // Downscale 8K-class textures before hashing so the manifest matches the
  // committed bytes. Pillow is optional; the committed assets already work.
  if (!manifestOnly) {
    const optimize = spawnSync('python3', [join(root, 'scripts', 'optimize-assets.py')], {
      stdio: 'inherit',
    });
    if (optimize.error) {
      console.warn('Pillow が見つからないため画像の最適化をスキップしました。');
    }
  }

  const manifest = { generatedAt: new Date().toISOString(), assets: {} };
  let total = 0;
  for (const [targetRel, sourceRel] of Object.entries(files)) {
    const target = join(targetRoot, targetRel);
    try {
      const info = await stat(target);
      const bytes = await readFile(target);
      manifest.assets[targetRel] = {
        source: `Electric-Chair-Game/Assets/${sourceRel}`,
        bytes: info.size,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      total += info.size;
    } catch {
      // already reported above
    }
  }

  for (const [targetRel, source] of Object.entries(generated)) {
    const target = join(targetRoot, targetRel);
    try {
      const info = await stat(target);
      const bytes = await readFile(target);
      manifest.assets[targetRel] = {
        source,
        generated: true,
        bytes: info.size,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      total += info.size;
    } catch {
      const script = targetRel.includes('final-thunder')
        ? 'scripts/generate-final-thunder-voice.sh'
        : 'scripts/generate-round-voice.sh';
      console.warn(`✗ ${targetRel} (run ${script})`);
    }
  }

  await writeFile(
    join(targetRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(join(targetRoot, 'CREDITS.txt'), credits, 'utf8');

  console.log(
    `\nSynced ${Object.keys(manifest.assets).length} files (${(total / 1024 / 1024).toFixed(1)} MB) to ${relative(root, targetRoot)}/`,
  );
}

await main();
