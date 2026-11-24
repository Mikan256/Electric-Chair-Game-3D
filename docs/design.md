# 実装設計メモ

このドキュメントは `docs/denki_isu_game_rules.md` を Web ゲームとして実装する際の
解釈と、マルチプレイの設計判断をまとめたものです。

## 1. ルールの実装

| ルール | 実装 |
|---|---|
| 12 脚 | `config.chairCount = 12` |
| 交互に攻撃/防御 | 1 ターンごとに `attacker = otherPlayer(attacker)` |
| 攻撃側が 1 脚に仕掛ける | 攻撃側が commit する椅子 |
| 防御側が 1 脚を選ぶ | 防御側が commit する椅子 |
| 回避 | 防御側に「座った椅子番号」を加算 |
| 感電 | 防御側の累積ポイントを 0 に |
| 得点椅子 | `retiredChairs` に追加し、以後選択不可 |
| 感電椅子 | 何もせず、再使用可能 |
| 40pt 先取 | 回避加算直後に判定 |
| 3 回感電 | 攻撃側の `shocksDealt` が 3 で勝利 |
| 最大 8 ターン | 8 ターンの result 後に points 比較 |

### 明文化した追加仕様

元のルール文書にない部分は、実装上の一貫性のために次のように定めました。

- **同時選択**: 攻撃側と防御側は同時に秘密の椅子をコミットする。
  元ネタは「攻撃側が仕掛けてから防御側が座る」順だが、Web では会話と間合いを
  再現しづらいため、同時選択 + 公開演出にしている。心理戦の本質は変わらない。
- **同点**: 8 ターン終了時にポイントが同じ場合は引き分け。
  （感電回数によるタイブレークは採用していない）
- **タイムアウト**: 30 秒以内に commit しない / 15 秒以内に reveal しない
  プレイヤーは降参扱い。両者なら引き分け（abandoned）。
  ホストが相手の秘密を捏造できないよう、auto-commit は行わない。
- **降参/退出**: 相手の勝利（reason: `forfeit`）。
- **再戦**: 試合終了後に両者が `rematch` を押すと新しい matchId で開始。

## 2. コミット・リビール

ホスト権威にすると、ホストは相手の選択を先に知ることができてしまいます。
そこで、両者の選択を次のように隠します。

```
chair, salt (128-bit)  --hash-->  commitment
commit: hash のみ送信
reveal: chair + salt を送信（両者の reveal が揃うまで他方には見せない）
```

- `src/game/rng.ts` の `commitmentHash(chair, salt)` は salt 依存の 53-bit ハッシュ。
  salt が 128-bit ランダムなので、12 候補の総当たりは不可能。
- ホストは `MatchState.reveals` を保持するが、`MatchView` には result まで出さない。
- 両者の reveal が揃った瞬間に `resolveTurn()` が同期的に判定し、
  結果ビューを配信する。片方だけの reveal は公開されない。

## 3. 状態機械

```
commit ──(両者 commit)──▶ reveal ──(両者 reveal)──▶ result
  ▲                                                     │
  └──────────── advance / timeout ──────────────────────┘
                                                        │
                                                   outcome あり
                                                        ▼
                                                    finished
```

- `MatchState` はイミュータブル。`applyAction()` が新しい state を返す。
- `revision` は単調増加。ネットワークのスナップショット連番とは別。
- `deadline` はフェーズ期限（epoch ms）。ホストのみがタイマーを持つ。
- `MatchView` は `you` ごとに生成。`reveals` は含めない。

## 4. ネットワーク

```
[Game iframe A]                         [Game iframe B]
  FlaxiaClient (postMessage)              FlaxiaClient
  MatchSession (host)  ──sendPeerData──▶  MatchSession (guest)
        │                                      │
        └────────── 親フレームが中継 ──────────┘
```

- ホスト = `room.hostId` のプレイヤー。席順は `[host, guest]`。
- ゲストは `hello` を送り、ホストは最新ビューを返す。
- ホストは 2 秒ごとにハートビートとして最新ビューを再送（取りこぼし対策）。
- ビューは `seq` 付き。ゲストは `seq` の飛びを検知すると `sync` を送る。
- アクションは `turn` / `phase` 付き。古いアクションは STALE として破棄。
- `sendPeerData` の上限 65,536 bytes を超えないこと。
  現在のビューは履歴 8 件込みでも数 KB。

### 既知の制約

- ホスト交代（`MULTIPLAYER_HOST_CHANGED`）時の試合継続は未対応。
  新しいホストは旧ホストの秘密を持てないため、退出 = 降参として扱う。
- ルームの再接続・観戦・3 人以上は未対応。
- 親フレームの `MULTIPLAYER_ROOM_STATE` に `selfId` がない環境では、
  `PLAYER_IDENTITY` と「ゲーム開始を要求した側がホスト」の推定で自分を特定する。
  本番 SDK が `selfId` を返す場合はそれを優先する。

## 5. セットの再現

実物のセットに寄せるため、ステージは次の構成にしている。

- 12脚の**白い立方体**の椅子を時計回りに円形配置
- 座面は白い凸（RoundedBox）で、立方体の上に載せる
- 椅子の**外側面**に黒い数字（CanvasTexture）
- 椅子の**内側の床**に白い数字（放射状に配置）
- 前方ステージ、12番の椅子の外側に**黒い台座**と**黄色いボタン**
- 椅子の外側面はキーライトだけでは暗くなるため、周囲に低いフィルライトを置く
- 時計画像の床テクスチャは使わず、椅子ごとの床数字で構成

## 6. 演出

- `result` 遷移時に、椅子のワイヤー（赤）と着席（緑/白）を 3D で表示。
- 感電: 閃光・雷ボルト・カメラシェイク・`se/electric.mp3`。
- 回避: 緑のバースト・`se/chair.mp3`。
- 3 回目の感電: `FINAL THUNDER` 動画 + ハートビート。
- 通常の感電: `lightning.mp4` を控えめに合成。
- 勝利: 紙吹雪 + `WINNER` オーバーレイ。
- BGM: タイトルは `MusMus-BGM-168.mp3`。ゲーム中は環境音を止め、SE 中心。

`ファイナルサンダー` は旧 Unity 実装では「仕掛けた後に押す演出ボタン」で、
ルール上の追加効果はない。本実装も演出のみ。

## 7. テスト

- `tests/game/rules.test.ts`: 得点、感電、椅子の退場、勝利条件、タイムアウト、
  ビューの秘匿性。
- `tests/net/session.test.ts`: MemoryBus 上の 2 セッション、commit-reveal、
  再接続、再戦、ボット対戦。
- `tests/e2e/solo.spec.ts`: タイトル → ソロ → 結果 → 次ターン。
- `tests/e2e/harness.spec.ts`: 2 iframe の実際の postMessage 経路。
- `pnpm simulate`: 大量対戦で不変条件（椅子の重複なし、8 ターン以内など）を検査。

## 8. 今後の候補

- VRM アバターの MToon 表示調整（現状 `?avatar=1` でゴーストのように見える）
- 3 人以上の観戦・トーナメント
- ランキング（勝率、最高ポイント、連勝）
- 称号（`CREATE_TITLE` / `AWARD_TITLE`）と実績
- 効果音の音量設定、字幕、アクセシビリティ
- アセットの再圧縮（VRM / 動画）
