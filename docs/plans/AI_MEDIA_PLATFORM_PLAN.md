# AI media platform: one provider layer for text, images and short video, with cost logs and wallet charging

Status: in progress (2026-10-16).

## Goal

Every AI feature in the admin (captions, hashtags, product copy, enrichment, ad creatives, social images, reels and Shorts, email hero images) goes through one layer that:
1. Picks a provider per capability: the **Razer** box (Ollama for text, Stable Diffusion for images), **Google** (Gemini text, Imagen images, Veo short video) and **Replicate** (Flux) as the paid fallback.
2. Logs **every call's cost** (platform cost) and **price** (what the store is charged).
3. **Charges tenants through the wallet** on every call, even when the Razer box served it. The flagship is never charged; its costs show on the Finance page.

## Today

- Text goes through `ai-platform/gateway` (`/v1/chat`, `/v1/embed`, `/v1/vision`) with a durable queue and a two-tier cache. App callers use `lib/shared/ai-client.ts` (`aiChat`).
- Images: one route (`api/(public)/generate-image`) calls Replicate Flux directly; the "ad image" is a rendered card (`lib/social/card.ts`), not AI.
- No video. No cost log except storefront AI search (`ai_queries.cost_inr`). The wallet (`@jeffi/wallet`) already has an `ai` category and `debit` / `trueUp` helpers; the flagship id is skipped inside `debit`.

## Architecture

```
admin UI ──▶ lib/ai/media.ts (generateImage / generateVideo)   lib/shared/ai-client.ts (aiChat, embed)
                 │ charge + log (lib/ai/billing.ts)                       │ charge + log
                 ▼                                                        ▼
            ai-platform gateway  /v1/images/generate  /v1/video/generate  /v1/jobs/:id  /v1/chat ...
                 ├─ razer-sd  (Stable Diffusion WebUI / ComfyUI on the Razer GPU)   images
                 ├─ google    (Gemini API: Imagen, Veo)                              images, video
                 ├─ replicate (Flux; a video model)                                  images, video
                 └─ ollama    (text, embeddings, vision)                             text
```

## Contracts (fixed; the three work streams build against these)

### Gateway

`POST /v1/images/generate`
```ts
{
  prompt: string; negativePrompt?: string
  width?: number; height?: number            // default 1024x1024; clamped 256..1536, multiples of 64
  n?: number                                  // 1..4, default 1
  quality?: 'draft' | 'standard' | 'premium'  // routing hint, default 'standard'
  provider?: 'razer' | 'google' | 'replicate' // force a provider
  referenceImageUrl?: string                  // image-to-image / edit when the provider supports it
  seed?: number
  namespace?: string                          // cache partition (tenant)
}
→ {
  images: { url: string; width: number; height: number; mime: string }[]   // url = gateway-hosted or data URL; the app persists to S3
  provider: 'razer' | 'google' | 'replicate'; model: string
  usage: { units: number; unitType: 'image'; costInr: number }             // platform cost from the gateway price table
  latencyMs: number; cache?: 'kv' | null
}
```

`POST /v1/video/generate` (async)
```ts
{ prompt: string; imageUrl?: string; durationSec?: number /* 2..8 */; aspect?: '9:16' | '16:9' | '1:1'; provider?: 'google' | 'replicate'; namespace?: string }
→ { jobId: string; provider; model; estimatedCostInr: number }
```
`GET /v1/jobs/:id` → `{ status: 'queued' | 'running' | 'done' | 'failed'; result?: { videoUrl, durationSec, width, height, mime }; usage?: { units: durationSec, unitType: 'video_second', costInr }; error?: string }`

`/v1/chat` and `/v1/embed` responses gain `usage: { promptTokens, completionTokens, costInr }` (Ollama returns token counts; cost from the price table).

Routing: `AI_IMAGE_PROVIDERS` (default `razer,google,replicate`) and `AI_VIDEO_PROVIDERS` (default `google,replicate`), tried in order on provider error or when a provider is not configured. `quality: 'premium'` prefers `google` for images; `'draft'` prefers `razer`. Gateway price table from env `AI_PRICES_JSON`, defaults in `gateway/src/pricing.ts`.

Provider env: `SD_WEBUI_URL` (Automatic1111-compatible `/sdapi/v1/txt2img` and `img2img`; ComfyUI later), `GOOGLE_AI_API_KEY` (Gemini API: `imagen-4.0-generate-001` or `imagen-3.0-generate-002`, `veo-3.0-generate-001` or `veo-2.0-generate-001` via `predictLongRunning`), `REPLICATE_API_TOKEN`.

### App billing (`lib/ai/billing.ts`)

```ts
type Capability = 'text' | 'embed' | 'vision' | 'image' | 'video'
type UnitType = 'token_1k_in' | 'token_1k_out' | 'image' | 'video_second' | 'call'

interface UsageInput {
  feature: string                 // 'social_caption' | 'social_image' | 'ad_image' | 'product_copy' | 'enrichment' | 'email_hero' | 'reel' | ...
  capability: Capability; provider: string; model: string
  units: { type: UnitType; qty: number }[]
  costInr: number                 // platform cost (from the gateway usage)
  ref?: string                    // product id, post id, campaign id
  actor?: string | null           // admin email
  latencyMs?: number; cache?: string | null
}

// Before the call: estimate price and make sure the wallet can pay (tenants only).
preauthorize(input: Omit<UsageInput,'costInr'|'units'> & { estimateUnits: UsageInput['units'] }): Promise<{ usageId: string; priceInr: number }>
// After the call: exact units and cost; wallet true-up; usage row finalised.
settle(usageId: string, input: Pick<UsageInput,'units'|'costInr'|'latencyMs'|'cache'> & { status: 'ok' | 'failed'; error?: string }): Promise<void>
// One-shot for callers that know units up front (text is settled after; images pre-authorise 1 image).
recordUsage(input: UsageInput): Promise<{ usageId: string; priceInr: number }>

class AiWalletError extends Error { status = 402; balanceInr; neededInr }  // "Top up your wallet" in the UI
```

Price list (control plane, platform-wide, editable by the platform admin): `ai_price_list(capability, provider, model, unit_type, cost_inr, price_inr, active)`. The **Razer rows carry a non-zero price** (compute price) so tenants are charged for local inference too; `cost_inr` for Razer is the amortised compute estimate. Flagship: `price_inr` is logged as 0 and no wallet entry.

Usage log (tenant DB): `ai_usage(id, feature, capability, provider, model, units jsonb, cost_inr, price_inr, wallet_ref, status, error, ref, actor, latency_ms, cache, created_at)`. Wallet entries use `external_ref = 'ai:' || usage.id`, category `ai`.

Plan gate: every AI call still passes the existing plan gate (`currentTenantPlanGate(AI_ADMIN_SCOPE)`). A per-plan monthly free allowance can come later; the wallet is the only limit now.

### App media client (`lib/ai/media.ts`)

```ts
generateImage(opts: { prompt; negativePrompt?; width?; height?; n?; quality?; referenceImageUrl?; feature; ref?; actor? }): Promise<{ images: { url: string /* S3 */; width; height }[]; usageId; priceInr; provider; model }>
generateVideo(opts: { prompt; imageUrl?; durationSec?; aspect?; feature; ref?; actor? }): Promise<{ jobId; usageId; estimatedPriceInr }>
videoJob(jobId): Promise<{ status; videoUrl? /* S3 once done */; error? }>
```
Images are persisted to the store's S3 bucket through the existing upload helpers (the gateway URL is temporary). Route for the UI: `POST /api/admin/ai/image`, `POST /api/admin/ai/video`, `GET /api/admin/ai/video/:jobId`, all gated by `aiDenial(role, scopes, <feature scope>)` plus the plan gate; 402 with `{ error, balanceInr, neededInr, topUpUrl }` on `AiWalletError`.

Shared UI: `components/admin/ai/AiMediaButton.tsx` (prompt, size preset per destination, quality, generate, pick result, shows price before generating and the charge after) and `AiVideoButton.tsx` (async with polling).

## Where it is used ("everywhere")

| Place | Capability | Feature key |
|---|---|---|
| Social composer: image for a post, reel or Short video | image, video | `social_image`, `social_video` |
| Social: captions, hashtags (exists) | text | `social_caption`, `social_hashtags` |
| Products: AI product image (lifestyle or clean background from the product photo), copy and enrichment | image, text | `product_image`, `product_copy`, `enrichment` |
| Google Ads: image assets in the campaign wizard and asset edits | image | `ads_image` |
| Meta Ads: ad creative image | image | `ads_image` |
| Amazon Ads: creative image for Sponsored Brands (when added) | image | `ads_image` |
| Email campaigns: hero image, subject and copy | image, text | `email_hero`, `email_copy` |
| Homepage hero slides | image | `hero_image` |
| AI admin agent, storefront assistant, SQL agent | text | existing feature keys |
| Public `generate-image` route | image | `generate_image` (moves onto the gateway) |

## Finance and wallet

- **Flagship:** Finance gets an **AI costs** tab: cost by capability, provider and feature, by day; top features; Razer vs paid providers; a KPI on the Finance overview.
- **Tenants:** the Wallet page shows AI spend by feature and the AI entries in the ledger; the Finance overview gets an "AI spend" KPI. The wallet top-up prompt appears on a 402.
- **Platform admin:** a price list editor (`/admin/ecom/ai-pricing`, platform only) over `ai_price_list`, with margin shown (price vs cost).

## Work streams (parallel)

A. **Gateway**: image and video routes, providers (razer-sd, google, replicate), pricing table, token usage on chat, job polling, SDK types.
B. **Billing**: schema (`ai_price_list` control plane; `ai_usage` tenant), `lib/ai/billing.ts`, usage logging and charging inside `aiChat`/`embed`, price list editor, Finance AI tab and KPIs, wallet AI view.
C. **Media client and integrations**: `lib/ai/media.ts`, admin routes, `AiMediaButton`/`AiVideoButton`, wiring into the places above, moving `generate-image` onto the gateway.

## Verification

- Gateway: unit tests per provider with recorded fixtures; routing fallback; pricing maths.
- Billing: pre-authorise then settle; 402 when the balance is short; flagship logs cost with no wallet entry; Razer rows charge tenants; true-up never double-charges (external_ref dedupe).
- Integrations: the client write-gate and scope audits; a component test for `AiMediaButton`.
- Manual on testco: generate a social image (wallet debited, usage row written), a flagship image (cost logged, no debit), a Veo video job end to end when `GOOGLE_AI_API_KEY` is set.
