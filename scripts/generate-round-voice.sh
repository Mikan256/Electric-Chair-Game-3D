#!/usr/bin/env bash
# ラウンドコール音声 (audio/voice/round-N.mp3) を再生成する。
#
# 事前準備 (初回のみ):
#   python3 -m venv /tmp/piper && /tmp/piper/bin/pip install piper-tts
#   /tmp/piper/bin/python -m piper.download_voices en_US-joe-medium \
#     --download-dir /tmp/piper/voices
#
# 使い方:
#   PIPER_BIN=/tmp/piper/bin/piper \
#   PIPER_MODEL=/tmp/piper/voices/en_US-joe-medium.onnx \
#   FFMPEG=/path/to/ffmpeg ./scripts/generate-round-voice.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/public/assets/audio/voice"
PIPER_BIN="${PIPER_BIN:-piper}"
: "${PIPER_MODEL:?PIPER_MODEL に en_US-joe-medium.onnx のパスを指定してください}"
FFMPEG="${FFMPEG:-ffmpeg}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$OUT"

for round in 1 2 3 4 5 6 7 8; do
  echo "Round $round" |
    "$PIPER_BIN" -m "$PIPER_MODEL" -f "$TMP/round-$round.wav" \
      --length-scale 1.22 --volume 0.92 >/dev/null

  # 少し低く・遅めにして、会場アナウンス風の軽いリバーブをかける。
  "$FFMPEG" -hide_banner -loglevel error -y -i "$TMP/round-$round.wav" \
    -af "asetrate=22050*0.93,aresample=44100,atempo=1.05,aecho=0.7:0.6:28:0.18,loudnorm=I=-16:TP=-1.5:LRA=7" \
    -ac 1 -ar 44100 -b:a 96k "$OUT/round-$round.mp3"
  echo "generated audio/voice/round-$round.mp3"
done

node "$ROOT/scripts/sync-assets.mjs" --manifest-only
