#!/usr/bin/env bash
# Writes base64 chunks of the binary model files for the artifact host, which serves text but not raw
# binaries (16 MB per text file). The app reassembles <name>.bin.b64.0.txt, .1.txt, … at load.
#   tools/build-artifact.sh <out-dir>
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:?out dir}; mkdir -p "$OUT/models"
rm -f "$OUT"/models/*.b64.*.txt
for m in detector full heavy; do
  f=models/blazepose-$m.bin
  split -b 9000000 -d -a 1 "$f" "$OUT/models/.part-$m-"
  for p in "$OUT"/models/.part-$m-*; do
    i=${p##*-}; base64 -w0 "$p" > "$OUT/models/blazepose-$m.bin.b64.$i.txt"; rm "$p"
  done
  cp models/blazepose-$m.json "$OUT/models/"
done
ls -la "$OUT/models"
