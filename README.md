# 電気イスゲーム 3D

水曜日のダウンタウン「電気イスゲーム」をモチーフにした、three.js + TypeScript の
3D オンライン対戦ゲームです。Flaxia Arcade のサンドボックス（iframe）上で動作し、
2 人対戦と CPU 戦に対応します。

> 非公式のファンメイド実装です。番組・権利者とは関係ありません。

## いまできること

- 部屋（床・奥壁・左右壁・照明トラス）と、前方の段差ステージ
- 本家セットを意識した白い立方体椅子（凸座面・外側に黒数字）
- 椅子の内側に白い床数字、前方ステージの黒台座に黄色い電流ボタン
- 12 脚の椅子による完全ルール実装（40pt 先取 / 3 回感電 / 8 ターン）
- 攻撃側が仕掛け（set）→ 守備側が着席（sit）→ 攻撃側が前方ボタン（press）の順で再現
- 攻撃側の仕掛けはボタンを押すまで秘匿。守備側の着席は公開
- Flaxia の `postMessage` マルチプレイ（P2P / リレー）対応
- 2 画面のローカル対戦ハーネス（本物のプロトコルをそのまま使用）
- 3D ステージ（時計状の椅子配置、スポットライト、雷エフェクト、Bloom）
- CPU 戦、結果画面、再戦、チャット、効果音、FINAL THUNDER カットイン
- 旧 Unity プロジェクトの椅子モデル・ロゴ・時計・BGM・SE・動画を再利用

## クイックスタート

```bash
pnpm install
pnpm dev
# http://127.0.0.1:5173/
```

- `CPUと対戦` でソロ開始
- `/dev/harness.html` で 2 人対戦のローカル検証
- `/?mode=solo&attacker=0&botDelay=20&seed=test` で自動開始（テスト用）
- `/?avatar=1` で旧プロジェクトの VRoid アバターを読み込み（実験的）

## コマンド

| コマンド                       | 内容                                    |
| ------------------------------ | --------------------------------------- |
| `pnpm dev`                     | Vite 開発サーバー                       |
| `pnpm build`                   | 本番ビルド（`dist/`）                   |
| `pnpm preview`                 | ビルドのプレビュー                      |
| `pnpm typecheck`               | TypeScript 型チェック                   |
| `pnpm lint`                    | ESLint                                  |
| `pnpm test`                    | ルール・ネットワークのユニットテスト    |
| `pnpm test:e2e`                | Playwright のスモークテスト             |
| `pnpm simulate --matches 1000` | ボット同士のヘッドレス対戦              |
| `pnpm assets:sync`             | 旧 Unity から画像・音声・モデルをコピー |
| `pnpm verify`                  | typecheck + lint + test + build         |

## ディレクトリ

```
src/
  game/     ルールエンジン（純粋 TS、DOM/three/ネット非依存）
  net/      Flaxia プロトコル、ホスト権威セッション、メモリトランスポート
  scene/    three.js ステージ、椅子、エフェクト、音、VRM
  ui/       DOM HUD（タイトル / ロビー / 対戦 / 結果）
  assets/   アセットの論理パス
dev/
  harness.html / harness.ts   Flaxia 親フレームのモック（2 iframe）
tests/
  game/ net/ e2e/
docs/
  ルール・Flaxia API・設計メモ
```

## アセット

`Electric-Chair-Game/` の旧 Unity プロジェクトは **読み取り専用の素材置き場** です。
`pnpm assets:sync` で必要なファイルだけを `public/assets/` にコピーし、
`public/assets/CREDITS.txt` に来歴を残します。詳細は [docs/assets.md](docs/assets.md)。

## Flaxia への投稿

```bash
pnpm release:flaxia
# release/electric-chair-game-3d-flaxia.zip       (5.6MB, 推奨)
# release/electric-chair-game-3d-flaxia-full.zip  (17.2MB, VRM 含む)
```

ZIP のルートに `index.html` が必要です。`release:flaxia` は Flaxia の WVFS
拡張子・サイズ・パス検証を通してから出力します。`.fbx` / `.vrm` / `.md` は
WVFS が拒否してゲームが 404 になるため、素材は `.data` / `.txt` として同梱しています。

ゲームIDは `denki-isu-3d`（`src/assets/registry.ts`）。

サンドボックスは opaque origin のため、`fetch` や直接 WebSocket は使えません。
アセットは相対 URL、通信は親フレームの `postMessage` のみです。

## 既知の制限 / 次の作業

- VRM アバターは `?avatar=1` の実験的表示のみ（MToon の見た目を要調整）
- ホスト交代時の試合引き継ぎは未対応（退出 = 降参）
- 効果音/BGM の音量バランス、モバイルの HUD 最適化
- スコア投稿は勝利時のみ。称号（バッジ）は未実装
- 配布用 ZIP は軽量版 5.6MB / 完全版 17.2MB（圧縮後）

## クレジット

- 企画・素材: ダンボールみかん箱
- BGM: MusMus / 効果音: 効果音ラボ、Onoma
- 3D/UI 素材: DEVNIK 2D, FX_Kandol_Pack, GabrielAguiarProductions, LightningBolt, Sci-Fi UI
- アバター形式: UniVRM / VRM

「水曜日のダウンタウン」「電気イスゲーム」は番組・権利者に帰属します。
