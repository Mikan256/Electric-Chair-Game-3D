#!/usr/bin/env bash
# Re-encode the heavy media so the Flaxia free-plan ZIP stays under 25 MiB.
# Requires a full ffmpeg build (e.g. `brew install ffmpeg` or ffmpeg-static).
#
#   FFMPEG=/path/to/ffmpeg bash scripts/compress-media.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FFMPEG="${FFMPEG:-ffmpeg}"

if ! command -v "$FFMPEG" >/dev/null 2>&1; then
  echo "ffmpeg not found. Set FFMPEG=/path/to/ffmpeg" >&2
  exit 1
fi

encode() {
  local input="$1"
  local output="$2"
  shift 2
  local ext="${output##*.}"
  local tmp="${output%.*}.tmp.${ext}"
  echo "encoding $(basename "$input") -> $(basename "$output")"
  "$FFMPEG" -hide_banner -loglevel error -y -i "$input" "$@" "$tmp"
  mv "$tmp" "$output"
  ls -lh "$output"
}

TITLE="$ROOT/public/assets/audio/bgm/title.mp3"
if [[ -f "$TITLE" ]]; then
  encode "$TITLE" "$TITLE" -codec:a libmp3lame -b:a 128k
fi

INNOVATION="$ROOT/public/assets/audio/bgm/innovation.mp3"
if [[ -f "$INNOVATION" ]]; then
  # assets:sync copies the 55 MB WAV bytes under the .mp3 name; only convert
  # when the file is still RIFF/WAV, so repeated release runs do not double-encode.
  if [[ "$(head -c 4 "$INNOVATION")" == "RIFF" ]]; then
    encode "$INNOVATION" "$INNOVATION" -codec:a libmp3lame -b:a 128k
  else
    echo "innovation.mp3 is already compressed"
  fi
fi

FINAL="$ROOT/public/assets/video/final-thunder.mp4"
if [[ -f "$FINAL" ]]; then
  encode "$FINAL" "$FINAL" \
    -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
    -r 30 -c:v libx264 -preset medium -crf 26 -pix_fmt yuv420p \
    -c:a aac -b:a 96k -movflags +faststart
fi

LIGHTNING="$ROOT/public/assets/video/lightning.mp4"
if [[ -f "$LIGHTNING" ]]; then
  encode "$LIGHTNING" "$LIGHTNING" \
    -vf "scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2" \
    -r 30 -c:v libx264 -preset medium -crf 30 -pix_fmt yuv420p -an \
    -movflags +faststart
fi

echo "done"
