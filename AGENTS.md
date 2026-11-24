# AGENTS.md — 電気イスゲーム 3D

OpenCode でこのリポジトリを触るエージェント向けの運用ルールです。
作業前に `README.md`、`docs/denki_isu_game_rules.md`、`docs/game-api.md`、
`docs/multiplayer.md`、`docs/design.md` を読んでください。

## プロジェクトの不変条件

1. **ルールの正は docs/denki_isu_game_rules.md。**
   得点 = 座った椅子番号、感電 = 累積ポイント 0、得点椅子は使用不可、
   感電椅子は再使用可、40pt / 3 感電 / 8 ターン。
   ルール変更は必ず `src/game/` と `tests/game/` をセットで。
2. `src/game/` は純粋 TS。three.js / DOM / `window` / ネットワークを import しない。
   ヘッドレスでシミュレーションできる状態を保つ。
3. マルチプレイは **ホスト権威 + 攻撃側のコミット・リビール**。
   ターン順は `set`（攻撃側が仕掛ける）→ `sit`（守備側が座る・公開）→
   `press`（攻撃側が前方ボタンを押す）。
   `MatchView` に `wiredChair` を result まで入れない。
   公開ビューは `createView(state, viewer)` のみ。
4. ゲームから WebSocket / WebRTC / fetch を直接使わない。
   Flaxia 親フレームとの `postMessage` は `src/net/flaxia-client.ts` に集約する。
5. `Electric-Chair-Game/` は旧 Unity の残骸。**編集しない**。
   必要な素材は `scripts/sync-assets.mjs` で `public/assets/` にコピーする。
   日本語ファイル名を直接コードから参照しない（ASCII の論理パスを使う）。
6. アセットは遅延ロードを原則とする。タイトル BGM・動画・VRM を初期表示で
   全部読み込まない（`avatar.ts` は dynamic import）。
7. Flaxia の ZIP は拡張子許可リストが厳しい。`.fbx` / `.vrm` / `.md` を入れない。
   3D モデルは `.data`、クレジットは `.txt` として同梱する。
   提出前に `pnpm release:flaxia`（内部で WVFS 検証）を通す。
8. Flaxia のサンドボックスは opaque origin。`base: './'`、相対 URL、
   `localStorage` は WVFS シム前提で扱う。

## よく使うコマンド

```bash
pnpm dev                 # 5173
pnpm typecheck
pnpm lint
pnpm test                # ルール + セッション
pnpm test:e2e            # Playwright（dev サーバーを自動起動）
pnpm simulate --matches 500 --seed 1
pnpm build
pnpm verify
```

ローカル 2 人対戦:

```bash
pnpm dev
# ブラウザで http://127.0.0.1:5173/dev/harness.html
```

ハーネスは Flaxia 親のモックで、`MULTIPLAYER_*` フレームを実装しています。
ゲーム側は本番と同じ `FlaxiaClient` / `MatchSession` が動きます。

## アーキテクチャ

```
main.ts → App
  ├── Theater (three.js)   : scene/stage.ts, chair.ts, effects.ts, audio.ts
  ├── GameUI (DOM)         : ui/game-ui.ts, ui/styles.css
  ├── FlaxiaClient         : net/flaxia-client.ts（postMessage 契約）
  └── MatchSession         : net/session.ts（ホスト権威 + set/sit/press）
        └── rules.ts       : 純粋な状態機械
```

- 状態の流れ: `set → sit → press → result → (next set | finished)`
- 攻撃側の仕掛けは `commitmentHash(chair, salt)` のみ送る。salt は press までローカル保持。
- 守備側の `sittingChair` は sit 時点で公開する。
- ホストは `applyAction()` の結果だけを `createView()` で配布する。
- 通信は `sendPeerData` の JSON。65,536 bytes 制限に注意。
- 再接続は `hello` / `sync` / full snapshot で行う。差分同期はしない。

## テスト方針

- ルール変更: `tests/game/rules.test.ts` に境界ケースを追加。
- セッション/プロトコル変更: `tests/net/session.test.ts` に 2 セッションの
  MemoryBus テストを追加。`timers: false` で定期処理を止めて検証する。
- UI/導線: `tests/e2e/*.spec.ts` を更新。ハーネスの 2 iframe テストは
  実際の postMessage 経路を検証するので壊さない。
- 変更後は最低 `pnpm typecheck && pnpm lint && pnpm test`。
  可能なら `pnpm build` と `pnpm test:e2e` も。

## サブエージェント

- `rules`: ルール・状態機械・テスト（`src/game/`, `tests/game/`）
- `three`: シーン・シェーダ・アセット（`src/scene/`, `public/`）
- `net`: Flaxia プロトコル・同期・ハーネス（`src/net/`, `dev/`）
- `reviewer`: 読み取り専用レビュー

`/verify`、`/rules-check`、`/playtest` コマンドも利用できます。

## コーディング規約

- 2 スペース、シングルクォート、セミコロン、Prettier。
- `strict` + `noUncheckedIndexedAccess`。`any` を避ける（境界では `unknown` → 検証）。
- `src/game` はイミュータブル更新。`state` を直接書き換えない。
- 日本語 UI 文言は `src/ui/game-ui.ts` に集約。ログ・コメントは日本語/英語混在可。
- 新しい定数・アセットパスは `src/assets/registry.ts` に追加。
- 乱数は `src/game/rng.ts` の決定論的 RNG を使う（テスト再現性）。
- 失敗してもゲームが止まらないよう、アセット読み込みはフォールバックを持つ。

## デプロイ前チェック

- `pnpm verify`
- `pnpm build` 後の `dist/index.html` が相対 URL で動くか
- `dist/` にハーネスが含まれていないこと（production では除外）
- 追加アセットが `public/assets/manifest.json` と CREDITS に載っていること
- モバイル幅（390px）で HUD が崩れないこと
