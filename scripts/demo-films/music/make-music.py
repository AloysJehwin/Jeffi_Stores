# Background music from Lyria through the Gemini API, saved next to this file as <model>-<n>.mp3.
# Usage: python3 music/make-music.py lyria-3-pro-preview lyria-3-clip-preview   (pro: the overview's bed; clip: the short films')
import json, base64, os, sys, urllib.request
K = os.environ.get('GOOGLE_AI_API_KEY') or open(os.path.expanduser('~/.jeffi/google-ai-key')).read().strip()
OUT = os.path.dirname(os.path.abspath(__file__))
prompt = 'A 100-second piece. Uplifting modern product-launch background music: warm piano, soft synth plucks, light claps and a gentle beat, optimistic and confident, 104 BPM, clean mix that sits under a voice-over, no vocals.'
for model in sys.argv[1:]:
    body = {'contents': [{'parts': [{'text': prompt}]}], 'generationConfig': {'responseModalities': ['AUDIO']}}
    req = urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', data=json.dumps(body).encode(), headers={'x-goog-api-key': K, 'Content-Type': 'application/json'})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=300))
    except urllib.error.HTTPError as e:
        print(model, 'HTTP', e.code, e.read()[:300]); continue
    parts = [x for c in d.get('candidates', []) for x in c.get('content', {}).get('parts', [])]
    for i, p in enumerate(parts):
        if 'inlineData' in p:
            mime = p['inlineData'].get('mimeType', '')
            ext = 'wav' if 'wav' in mime else 'mp3' if 'mpeg' in mime or 'mp3' in mime else 'bin'
            path = f'{OUT}/{model}-{i}.{ext}'
            open(path, 'wb').write(base64.b64decode(p['inlineData']['data']))
            print(model, 'audio', mime, path)
        elif 'text' in p:
            print(model, 'text', p['text'][:200])
    print(model, 'usage', d.get('usageMetadata'))
