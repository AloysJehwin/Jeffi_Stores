#!/bin/zsh
# Records each named shot (retrying twice) into clips/<shot>/, then writes an 8-frame contact sheet clips/sheet-<shot>.jpg.
# Usage: ./rec.sh paws-home admin-orders ...   (needs python3 with Pillow for the sheets)
cd "$(dirname "$0")"
mkdir -p clips logs
for s in "$@"; do
  for attempt in 1 2 3; do
    if node compose/record.mjs shots/$s.mjs clips/$s > logs/$s.log 2>&1 && [ -f clips/$s/meta.json ]; then
      echo "$s ok $(cat clips/$s/meta.json)"; break
    fi
    echo "$s attempt $attempt failed: $(grep -m1 -E 'Error|error' logs/$s.log | cut -c1-160)"
  done
  python3 - "$s" <<'PY'
import sys, json, os
from PIL import Image
s = sys.argv[1]
d = f'clips/{s}'
if not os.path.exists(f'{d}/meta.json'): sys.exit()
m = json.load(open(f'{d}/meta.json'))
n = m['count']
idx = [max(1, int(n * k / 8) + 1) for k in range(8)]
ims = [Image.open(f'{d}/{i:05d}.jpg') for i in idx]
w, h = ims[0].size
tw, th = 640, int(640 * h / w)
sheet = Image.new('RGB', (tw * 4, th * 2), 'white')
for j, im in enumerate(ims):
    sheet.paste(im.resize((tw, th)), ((j % 4) * tw, (j // 4) * th))
sheet.save(f'clips/sheet-{s}.jpg', quality=78)
PY
done
