#!/usr/bin/env bash
# Writes base64 copies of the binary models (the artifact host serves text, not raw binaries).
#   tools/build-artifact.sh <out-dir>
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:?out dir}; mkdir -p "$OUT/models"
for f in models/pose_landmarker_full.task models/movenet-lightning.bin; do base64 -w0 "$f" > "$OUT/$f.b64.txt"; done
ls -la "$OUT/models"
