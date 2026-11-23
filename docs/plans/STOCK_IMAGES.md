# Free stock-image APIs for site generation

As of 2026-11-24. This is research only: nothing in the repo was changed. Bracketed tags such as [P2] point to the sources at the end.

## Where images come from today

All three image fills call `generateImage()` (`packages/store-core/src/lib/ai/media.ts`). It preauthorizes billing, calls the gateway's `/v1/images/generate` (razer → google → replicate, `IMAGE_PROVIDER_ORDER` in `ai-platform/gateway/src/media.ts`), copies the bytes into the store's S3 bucket (`uploadGalleryImage`) and, unless `skipGallery` is set, writes a `gallery_images` row with `source='ai'`.

| Call site | Fills | Text available there |
|---|---|---|
| `site/studio/showcase.ts` `showcasePictures()`, from `controller-service/.../showcase-builder/starter.ts` | Up to 3 Showcase mood pictures, 1024² | `brief.category`, `mood`, `artDirection`, `vocabulary`; 3 fixed scenes (the place, a craft detail, the client setting) |
| `site/studio/catalog.ts` `addPictures()`, from `controller-service/.../site-studio/build.ts` | Sample product photos | `product.imagePrompt` (LLM-written, or `name, category`) |
| `site/agent.ts` `fillImages()` | Empty image fields in blocks (hero 1600×700, wide, portrait, square…) | Block `heading`, else `brief.category` |

The prompts are written for an image model ("A mood photograph for… no faces, no text"), not as search terms. Stock search needs short keyword queries.

## Comparison

| | License and commercial use | Attribution | Hotlinking | Free limits | Search |
|---|---|---|---|---|---|
| **Pexels** | Free, including business websites. No selling unaltered copies, no re-listing on stock or wallpaper sites, no implied endorsement by people shown, no trademark use [P1]. AI-generated uploads banned [P4] | License: none [P1]. API docs: a "prominent link to Pexels", plus a photographer credit where possible [P2] | No rule against copying; the license allows it [P1][P2] | 200/hour, 20,000/month; unlimited for free on request with proof of attribution [P2]. **New API keys paused today** [P3] | `query`, `orientation`, `size`, `color` (incl. hex); 28 locales, no `hi-IN`; no safe-search flag [P2] |
| **Pixabay** | Free. No standalone resale of unaltered content, no trademark use, care with recognisable people [X1]; no competing service, no bulk systematic copying [X3]. AI uploads allowed if labelled [X3] | License: none [X1]. API: show where images come from when you display search results [X2] | **Not allowed**: download images to your own server. Cache API responses for 24 hours [X2] | 100 requests per 60 s, raised on request; "made for real human requests". Sizes over 1280 px need approval [X2] | `q`, 26 languages (no Hindi), `image_type=photo`, `orientation`, categories, `min_width`, `colors`, `safesearch` [X2] |
| **Unsplash** | Free commercial use. No selling without significant modification, no competing service [U1] | **Required**: "Photo by X on Unsplash", both linked, with UTM parameters [U2][U5] | **Required**, plus a call to the download endpoint each time a photo is used [U2][U3][U4] | 50/hour in demo mode, 1,000/hour after review [U3]; possible technology fee for heavy business use [U2]; meant for "non-automated" experiences [U4] | `query`, `orientation`, 11 colours, `content_filter=high`, `lang` (beta) [U3] |
| **Openverse** | Indexes CC and public-domain works; license varies per item; you verify it yourself; may charge for commercial use [O1] | As each license requires; the API returns an attribution string [O3] | Files sit on the source sites | Anonymous 5/hour, 100/day; registered 100/minute, 10,000/day [O2] | `license_type=commercial`, `category=photograph`, `aspect_ratio`, `mature` [O3] |
| **Wikimedia Commons** | License varies per file (CC BY, BY-SA, GFDL, public domain); personality rights apply [W1] | Creator, license and its link where required [W1] | Possible, "not recommended" [W1] | 10/minute with no User-Agent, 200/minute with a compliant one (new in 2026) [W2] | Plain text search |
| **Flickr (CC)** | License varies per photo. Commercial API use needs prior permission, and fees are possible [F1][F2]. API keys now Pro-only [F3] | Photo license, plus a "not endorsed by SmugMug" notice [F1] | Caching "for reasonable periods" only [F1] | Not stated | License filter |

**Others:** Freepik's API is pay-as-you-go with a small trial credit, and free-plan assets need attribution [FP]. Burst (Shopify) is free with no attribution but has no public API [B1]. Lorem Picsum serves random Unsplash photos by size or seed with no search [L1], so it suits dev and tests only.

**India, spot-checked on the websites (not the API):** "indian sweet shop" returned about 250K results on Pexels, with the first page mostly Indian shops [S1]; 10 on Unsplash, mixed with paid Unsplash+ results [S2]; and 23,815 on Pixabay, some titled "AI generated" [S3].

**Resale and redistribution:** showing a photo on a client's website is allowed by Pexels, Pixabay and Unsplash. What they forbid is selling unaltered files, re-hosting the library, and replicating the provider's "core functionality" [P2][X3][U1]. So we must never expose a browsable stock catalogue to owners. All three also caution about identifiable people, so keep the current "no faces" rule for mood pictures.

## Recommendation

### 1. Providers and order

1. **Pexels:** real photos only, strong Indian coverage, copying allowed, unlimited use free. Blocker: new keys are paused today, so apply now.
2. **Pixabay:** available today. Copying is required, which our S3 pipeline already does. Use `image_type=photo&safesearch=true` and drop hits tagged "ai generated".
3. **AI generation** (the existing razer → google → replicate order) as the fallback.

Until the Pexels key arrives, run Pixabay → AI.

Not for automatic filling:
- **Unsplash**: hotlinking, download pings, a credit on every photo and the "non-automated" clause all conflict with our copy-to-S3 model. It could later be a manual picker in the media library.
- **Openverse, Wikimedia Commons and Flickr**: per-image ShareAlike and NonCommercial licenses, and uneven quality.

### 2. How it fits our code

- **Gateway:** add a new `POST /v1/images/stock` route rather than a fourth entry in `IMAGE_PROVIDER_ORDER`: `/generate` takes an image-model prompt and returns paid, temporary files.
  - Add `providers/pexels.ts` and `providers/pixabay.ts`, with keys in the gateway Secret and the order in `AI_STOCK_PROVIDERS`.
  - Cache search results in Redis for 24 hours by provider, query and orientation. This satisfies Pixabay and shares the quota across stores.
  - Each result returns `{provider, id, url, width, height, alt, photographer, photographerUrl, pageUrl}`.
- **App:** add `lib/ai/stock.ts`.
  - It picks a candidate and copies it via `uploadGalleryImage` into the store's bucket under a stable key (`stock/<provider>-<id>`), so a rebuild reuses the file.
  - It needs no `preauthorize`/`settle` (₹0).
  - A `pictureFor()` wrapper tries stock first, then `generateImage`. Wire it into `showcasePictures`, `addPictures` and `fillImages`.
  - `studioBudgetLeft()` and `PICTURE_RESERVE_INR` then limit only the AI fallback.
- **Queries:**
  - `showcaseBrief` returns `stockQueries`: one 2–4-word query per scene.
  - `sampleCatalog` adds a `photoQuery` next to each `imagePrompt`.
  - `fillImages` searches `brief.category` plus a noun for the block type, never the marketing heading.
  - Search with "indian" first, then without it. Map hero/wide/landscape → landscape, portrait/story → portrait, square → square. Heroes need a 1600 px minimum width.
- **Dedupe:** keep a `used` set of provider:id pairs per site. Pick from the top ~15 hits using `brief.seed`, plus a Redis set of recently used images per query, so stores in the same category rarely share a hero.
- **Attribution:**
  - *Data.* Add `credit {name, url, source, pageUrl}` to `ShowcasePagePicture` (`ai:false`). Put the photo page in `gallery_images.source_url`. Add a `credit jsonb` column (table file, no migration), and add `'stock'` to `gallery_images_source_check` (today `'upload','ai','import'`, in `admin-service/database/constraints.sql`).
  - *Rendering.* The site renderer, not LLM-written page code, adds a footer line whenever stock is used, for example "Photos: A. Rao, S. Iyer on Pexels · Pixabay", with links. That meets Pexels' link-and-credit request and Pixabay's source notice. `BusinessPicture` already shows non-owner pictures as "mood", never "their work".
- **Safety:** Pexels has no safe-search flag, so query for places and objects rather than people. A vision check can come later.

### 3. What you need to set up

- **Pexels:** sign up with the business mailbox and request a key at pexels.com/api. Issuance is paused, so also email api@pexels.com. Once the credits line is live, ask for unlimited use with screenshots [P2][P3].
- **Pixabay:** create an account; the key appears on the API docs page. Later, ask for higher limits and full access (over 1280 px) [X2].
- **Keys:** add `PEXELS_API_KEY` and `PIXABAY_API_KEY` to the gateway Secret.
- **Unsplash (optional, later):** register an app; the production review wants evidence of attribution, hotlinking and download tracking [U3][U4]. Ask api@unsplash.com about automatic selection first.

### 4. Effort

| Piece | Days |
|---|---|
| Gateway route, two providers, cache, tests | ~2 |
| App helper, query fields, wiring the 3 call sites, budget gating | ~2 |
| Credits: data, column and constraint, footer rendering | ~1.5 |
| **Total** | **~5–6** |

An Unsplash path would add about 2 days.

## Sources

- [U1] https://unsplash.com/license
- [U2] https://unsplash.com/api-terms
- [U3] https://unsplash.com/documentation (the live page says 1,000/hour in production; older third-party pages say 5,000)
- [U4] https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines
- [U5] https://help.unsplash.com/en/articles/2511315-guideline-attribution
- [P1] https://www.pexels.com/license/
- [P2] https://www.pexels.com/api/documentation/
- [P3] https://www.pexels.com/api/ ("New API key issuance is currently paused")
- [P4] https://www.pexels.com/terms-of-service/ (updated 2026-10-20)
- [X1] https://pixabay.com/service/license-summary/
- [X2] https://pixabay.com/api/docs/
- [X3] https://pixabay.com/service/terms/ (updated 2026-10-20)
- [O1] https://docs.openverse.org/terms_of_service.html
- [O2] https://github.com/WordPress/openverse/blob/main/api/conf/settings/rest_framework.py (code defaults; the live service may differ)
- [O3] https://api.openverse.org/v1/schema/
- [W1] https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia
- [W2] https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits (revision of 2026-11-08)
- [F1] https://www.flickr.com/services/api/tos/
- [F2] https://www.flickr.com/services/api/misc.api_keys.html
- [F3] https://www.flickrhelp.com/hc/en-us/articles/4404070036884-Flickr-API (blocks automated reads; the Pro requirement comes from its search snippet)
- [FP] https://www.freepik.com/api/pricing (did not load; figures from search snippets, so check them)
- [B1] https://www.shopify.com/stock-photos/licenses/shopify-some-rights-reserved
- [L1] https://picsum.photos/
- [S1] https://www.pexels.com/search/indian%20sweet%20shop/
- [S2] https://unsplash.com/s/photos/indian-sweet-shop
- [S3] https://pixabay.com/images/search/indian%20sweet%20shop/
