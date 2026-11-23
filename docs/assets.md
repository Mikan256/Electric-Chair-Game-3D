# アセット管理

## 方針

旧 Unity プロジェクト `Electric-Chair-Game/` は素材の倉庫として保持し、
Web ビルドに必要なファイルだけを `public/assets/` にコピーします。

- Unity 側は **編集しない**（親リポジトリの `.gitignore` 対象）
- `public/assets/` はコミット対象（デプロイを再現可能にするため）
- ファイル名は ASCII の論理名に変換する
- 来歴は `public/assets/CREDITS.md`、サイズ・ハッシュは `public/assets/manifest.json`

## 同期

```bash
pnpm assets:sync
python3 scripts/optimize-assets.py   # Pillow がある場合
```

`sync-assets.mjs` の `files` マップに論理パス → Unity パスを追加します。
コピー後に Pillow で大きすぎる画像を縮小します（時計画像は元 8192²）。

## 主なアセット

| 論理パス | 元 | 用途 |
|---|---|---|
| `models/chair-01..12.fbx` | `Object/Chair/Block*.fbx` | 椅子の座面。背もたれ・肘掛けは three.js で追加 |
| `models/pedestal.fbx` | `Object/その他/台座.fbx` | 旧中央台座（現在は手続き型コンソールを使用） |
| `models/avatar.vrm` | `Object/その他/電気椅子ゲーム.vrm` | VRoid アバター（`?avatar=1` で遅延ロード） |
| `textures/clock.png` | `Image/時計.png` | ステージ床の時計 |
| `textures/logo.png` | `Image/電気椅子ゲーム.png` | タイトルロゴ |
| `textures/lightning/*` | LightningBolt / FX_Kandol_Pack | 雷エフェクト |
| `video/final-thunder.mp4` | `Image/FINAL THUNDER.mp4` | 3 回目の感電カットイン |
| `video/lightning.mp4` | `Image/nc419728_電光が走る.mp4` | 通常感電のカットイン |
| `audio/bgm/title.mp3` | `BGM/MusMus-BGM-168.mp3` | タイトル BGM |
| `audio/bgm/heartbeat.mp3` | `BGM/Heartbeat03-1(...).mp3` | reveal 中の緊張音 |
| `audio/se/electric.mp3` | 効果音ラボ | 感電 |
| `audio/se/chair.mp3` | `Onoma-Syakiin...` | 着席 |
| `audio/se/click.mp3` | 決定ボタン | UI |

## ライセンス / クレジット

各素材のライセンスは元の Unity プロジェクトの `LICENSE` と Asset Store の
ライセンスに従います。`public/assets/CREDITS.md` を確認してください。

- BGM: MusMus
- 効果音: 効果音ラボ、Onoma
- 3D/エフェクト: DEVNIK 2D, FX_Kandol_Pack, GabrielAguiarProductions, LightningBolt
- UI: Sci-Fi UI
- アバター: VRoid Studio / UniVRM

「水曜日のダウンタウン」「電気イスゲーム」の名称・企画は番組と権利者に帰属します。
本プロジェクトは非公式のファンメイド実装です。

## サイズ

現在の `public/assets` は約 44MB です。内訳の大部分は VRM (15MB)、
FINAL THUNDER (12MB)、タイトル BGM (9.7MB) です。
公開時のアップロード制限に合わせて、以下を検討してください。

- VRM を glTF-Transform で圧縮、または未使用なら削除
- 動画を H.264 / 短尺に再エンコード
- BGM を 128kbps 程度に再エンコード

VRM は `?avatar=1` のときだけ dynamic import で読み込まれるため、
通常プレイの転送量には含まれません（ビルド成果物には含まれます）。
