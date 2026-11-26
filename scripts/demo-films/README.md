# Landing page films

These scripts record, narrate and render the four product films on the ecom landing page (`ecom.jeffistores.in`):

| Film | Length | Where it plays |
|---|---|---|
| overview | 1:09 | the hero |
| storefront | 0:30 | the row below the hero |
| admin | 0:25 | the row below the hero |
| campaigns | 0:27 | the row below the hero |

The published files are on the CDN at `https://dm9rri2wgl1e.cloudfront.net/marketing/demo/v1/`. Each film has `<film>.mp4`, `<film>.webm` and a `<film>.jpg` poster. [`demo-videos.ts`](<../../controller-service/src/app/(ecom)/ecom/_demo/demo-videos.ts>) points the landing page at them. A build with `NEXT_PUBLIC_DEMO_VIDEOS=off` hides them.

## How a film is made

1. **Shots** (`shots/*.mjs`). Playwright walks the real local app with an animated cursor. `compose/record.mjs` saves each walk to `clips/<shot>/` as 30 fps JPEG frames.
2. **Narration** (`narration/<film>.json`). Each line gets its own take from the AI gateway's text to speech (Sarvam, then Azure; `language` defaults to en-IN, `ttsVoice` picks a voice), so set `AI_GATEWAY_URL` and `AI_GATEWAY_TOKEN`. The v1/v2 takes were Gemini TTS (voice Sulafat); a re-shoot sounds different. `compose/narrate.mjs` measures each take and places it on the film's clock.
3. **Plan** (`plans/<film>.json`). There is one scene per narration line. A scene is one of:
   - a title card
   - a recording inside a browser frame
   - the page grid
   - the phone
   
   A clip takes `from`, `rate` and `cuts`. Camera keys take:
   - `k`: position through the scene, 0 to 1
   - `z`: zoom
   - `cx` and `cy`: the focus point
4. **Timeline and render**.
   - `compose/build-timeline.mjs` times the scenes to the voice.
   - `compose/render.mjs` draws every frame through `compose/stage.html` and mixes in the music, ducked under the voice at −16 LUFS.
   - The output is an MP4 (H.264/AAC), a WebM (VP9/Opus) and the poster.

## Before you start

You need:

- The local stack on port 3000, serving `ecom.localhost:3000` and `localhost:3000/admin`.
- Local Postgres (`jeffi_production_ready`) and local Redis. The sign-in codes are read from Redis.
- `ffmpeg` and `ffprobe`.
- Python 3 with Pillow, for the contact sheets and filmstrips.
- The repo's Playwright Chromium.
- A Google AI key, in `GOOGLE_AI_API_KEY` or `~/.jeffi/google-ai-key`, for the narration and the music.
- The test stores the shots film, in the local database:

| Store | Studio session | Owner |
|---|---|---|
| Halo Audio, wearing Glass · Mint (`halo-*`, `studio-dnd`, `studio-look-build` and the stills) | `bb7b7c9c…` | `film-audio@crm.test` |
| Lumen Home | `ecf96288…` | `theme-demo@crm.test`, who also owns the Showcase site |
| Paws & Co (only the old `paws-*` shots) | `340c9782…` | `studio-ui-check@crm.test` |

If these stores are gone, create new ones through onboarding and update `shots/common.mjs`.

## Privacy

The local database is a copy of the real store.

**Masking.** Admin shots set `mask: true`. As each page renders, these are swapped for stand-ins:
- customer names
- addresses
- emails
- phone numbers
- GSTINs

The swap uses a dictionary built from the database by `node setup.mjs mask`. It is saved in `.local/`, which git ignores.

**Before rendering:**
- Check every contact sheet.
- Keep these out of frame:
  - revenue totals, such as the "All orders" header on Orders and the Financial overview
  - the failed-sends notice on the campaigns overview

**messaging-service:** don't start it locally. It could retry failed sends to real customers.

## Re-shooting

Run everything from this folder.

```bash
node setup.mjs admin    # the film admin, demo-films@crm.test; two-factor is enrolled on its first sign-in
node setup.mjs mask
./rec.sh halo-home admin-orders    # any shots; then check clips/sheet-<shot>.jpg
node stills.mjs home categories category brand product search cart checkout wishlist    # the storefront page grid (Halo Audio; FILMS_STORE=paws or lumen for another store)
./make-film.sh overview storefront admin campaigns
node check-landing.mjs --local     # the landing page playing the new renders from out/
node setup.mjs cleanup  # removes the film admin and .local/
```

**Which shots a film uses:** see the `clip` names in its plan.

**Shots that change test-store data:** `showcase`, `studio-dnd`, `theme-gallery` and `store-step` change themes, section order or a category, and put them back in `after()`. If one fails partway through, check the store.

**Changing the words:** edit `narration/<film>.json`. `make-film.sh` re-voices only the lines that changed.

**Music:** the beds are `music/*.mp3`, the Lyria tracks used in v1. `python3 music/make-music.py lyria-3-pro-preview` makes new ones.

**Helpers:**
- `node explore.mjs admin /admin/orders buttons shot:orders` finds selectors when the UI changes.
- `python3 strip.py <shot> 0.5` makes a timestamped filmstrip, for picking `from` and `cuts`.
- `node compose/frames.mjs timelines/<film>.json qa/<film> 3 12 30` renders stills of chosen moments.

## Publishing

Uploading makes the films public, so get the go-ahead first.

1. Upload to a new version: `./upload.sh v2`. Never overwrite a version, because browsers and CloudFront keep each one for 7 days. The script refuses a folder that already has files.
2. Change `BASE` in `demo-videos.ts` to `…/marketing/demo/v2`.
3. Run `node check-landing.mjs`.
4. Release.
