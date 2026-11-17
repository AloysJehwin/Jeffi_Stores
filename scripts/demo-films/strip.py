# Filmstrip with timestamps: one frame every STEP seconds, 6 per row. Usage: python3 strip.py <clip> [step] [crop x0,y0,x1,y1]
import sys, json, os
from PIL import Image, ImageDraw
clip = sys.argv[1]
step = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
crop = tuple(int(v) for v in sys.argv[3].split(',')) if len(sys.argv) > 3 else None
d = f'clips/{clip}'
m = json.load(open(f'{d}/meta.json'))
times = []
t = 0.0
while t < m['seconds']:
    times.append(t); t += step
tw = 400
ims = []
for t in times:
    i = min(m['count'], int(t * m['fps']) + 1)
    im = Image.open(f'{d}/{i:05d}.jpg')
    if crop: im = im.crop(crop)
    th = int(tw * im.height / im.width)
    im = im.resize((tw, th))
    ImageDraw.Draw(im).rectangle((0, 0, 58, 22), fill='black')
    ImageDraw.Draw(im).text((4, 4), f'{t:.1f}s', fill='white')
    ims.append(im)
cols = 6
th = ims[0].height
sheet = Image.new('RGB', (tw * cols, th * ((len(ims) + cols - 1) // cols)), 'white')
for k, im in enumerate(ims):
    sheet.paste(im, ((k % cols) * tw, (k // cols) * th))
sheet.save(f'clips/strip-{clip}.jpg', quality=75)
print(sheet.size, len(ims))
