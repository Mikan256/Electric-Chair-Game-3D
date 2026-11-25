#!/usr/bin/env bash
# FINAL THUNDER のコール音声 (audio/voice/final-thunder.mp3) を再生成する。
#
# 事前準備 (初回のみ):
#   python3 -m venv /tmp/opencode/tts-venv
#   /tmp/opencode/tts-venv/bin/pip install piper-tts
#   /tmp/opencode/tts-venv/bin/python -m piper.download_voices en_US-joe-medium \
#     --download-dir /tmp/opencode/piper-voices
#
# 使い方:
#   PIPER_BIN=/tmp/opencode/tts-venv/bin/piper \
#   PIPER_MODEL=/tmp/opencode/piper-voices/en_US-joe-medium.onnx \
#   FFMPEG=/tmp/opencode/ffmpeg-tmp/node_modules/ffmpeg-static/ffmpeg \
#   ./scripts/generate-final-thunder-voice.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/public/assets/audio/voice"
PIPER_BIN="${PIPER_BIN:-piper}"
PIPER_MODEL="${PIPER_MODEL:-/tmp/opencode/piper-voices/en_US-joe-medium.onnx}"
FFMPEG="${FFMPEG:-ffmpeg}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ ! -f "$PIPER_MODEL" ]]; then
  echo "PIPER_MODEL が見つかりません: $PIPER_MODEL" >&2
  exit 1
fi

mkdir -p "$OUT"

# ROUND コールより遅く・低く。会場アナウンスのように軽い残響を重ねる。
echo 'Final Thunder' |
  "$PIPER_BIN" -m "$PIPER_MODEL" -f "$TMP/final-thunder.wav" \
    --length-scale 1.48 --volume 0.95 >/dev/null

"$FFMPEG" -hide_banner -loglevel error -y -i "$TMP/final-thunder.wav" \
  -af "asetrate=22050*0.88,aresample=44100,atempo=1.04,aecho=0.8:0.55:40|85:0.22|0.12,loudnorm=I=-15:TP=-1.2:LRA=8" \
  -ac 1 -ar 44100 -b:a 96k "$OUT/final-thunder.mp3"

echo "generated audio/voice/final-thunder.mp3"
node "$ROOT/scripts/sync-assets.mjs" --manifest-only
