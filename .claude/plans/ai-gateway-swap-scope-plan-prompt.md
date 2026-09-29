# Route all AI through the gateway + correct scope/plan gating + tenant-safe prompts

Branch: `fix/tenant-forms-host`. No commit/push without instruction. No emojis. Files < 500 lines.

## Three coupled goals
1. Every model call goes through the ai-platform gateway (aiChat/aiEmbed/aiVision) — no direct Ollama fetch.
2. Every AI action is gated by the CORRECT domain scope, both on the endpoint and (for buttons) in the UI.
   Because admin session scopes are already plan-narrowed (auth-sessions.ts:319-328 via getTenantPlan),
   checking the field's domain scope enforces role AND plan together. Basic/no-AI plans -> button hidden +
   endpoint 403.
3. Enrichment prompts must NOT leak "Jeffi Stores" or hardware/fastener context to a tenant. Use
   `storeDescriptorForPrompt()` (brand.ts:207) — tenant name + tagline/about, never the flagship pitch.

## Scope map (domain scope per AI action; already exists in plan_features, verified live)
- Product field enrich / fill-form  -> `products:write`
- Email/rate copy (ai-generate-email) -> `mailer:write`
- Campaign copy (campaigns/generate, scenarios) -> `campaigns:write`  (already scoped)
- Coupon enrichment -> `coupons:write`
- Category/brand field enrich -> `categories:write` / `brands:write`
- Catalog enrichment run-all/approve -> `catalog_enrichment:write` (already scoped)
- Review generate -> `reviews:write` (already scoped)
- Storefront (ai-recap, ai-cart-insight, ai-pitch, ai-affirmation): NO admin session. Gate per-tenant with
  `currentTenantPlanGate('ai:storefront')`. DECIDED: a NEW `ai:storefront` scope_key. I do NOT own the
  control-plane, so I will prepare a seed snippet (INSERT into plan_features for Pro + Enterprise) in
  `ai-platform/deploy/` (or a scripts/ SQL file) for YOU to apply to the control-plane DB; the code ships
  gating on `ai:storefront` and simply 403s until the scope is seeded. `currentTenantPlanGate` returns
  allowed:true for the platform's own store, so the flagship is unaffected.

## Part A — Gateway swap (all direct Ollama callers)
Rewrite the model call in each to use `@/lib/ai-client`:
- Admin (already scoped, just swap the call + fix prompt): `ai-enrich-field`, `ai-fill-form`,
  `ai-generate-email` (generate->chat, single user message), `catalog-enrichment/run-all`.
- Storefront (swap call + add plan gate): `ai-recap`, `ai-cart-insight`, `ai-pitch`, `ai-affirmation`.
- Lib: `social/caption.ts` (generate->chat; caller keeps its own scope check).
- `admin/products/edit/[id]/page.tsx` inline Ollama call -> aiChat.
`/api/generate` single-prompt calls become one `{role:'user'}` message via aiChat({modelHint,jsonMode});
prompt text preserved verbatim. Delete each file's local OLLAMA_URL/OLLAMA_MODEL consts.

## Part B — Endpoint scope correctness
- `ai-enrich-field` / `ai-fill-form`: currently hardcode `products:write` for ALL fields. Accept a `scope`
  (or `domain`) in the request body, validate it against an allowlist, and `hasScope(admin,...)` on THAT
  scope so enriching an email/coupon field checks mailer/coupons, not products. Default stays
  `products:write` when omitted (back-comCompat).
- Storefront four: add `currentTenantPlanGate(scope)` -> 403 `{error, upgradeRequired}` when not allowed.
- Others already correct — leave their existing hasScope.

## Part C — Tenant-safe prompts
- `ai-enrich-field` SYSTEM_PROMPT and `ai-fill-form` SYSTEM_PROMPT: replace the hardcoded
  "Indian B2B/B2C hardware and tools store (jeffistores.com)" with `await storeDescriptorForPrompt()`
  injected at request time (per-tenant). Same for `catalog-enrichment/run-all` and any prompt embedding
  "Jeffi"/"hardware"/"fastener". Grep-sweep to catch all: `Jeffi`, `hardware`, `fastener`, `jeffistores`.
- caption.ts + campaign generators: audit for the same hardcode; use the descriptor.

## Part D — UI: hide AI buttons by scope/plan
- `AIEnrichButton.tsx`: add a required `scope` prop; wrap in `<RequireWrite scope={scope}>` (it already
  wraps, but hardcoded to `catalog_enrichment:write`). Each call site passes its field's domain scope.
  Since session scopes are plan-narrowed, a basic-plan tenant simply won't have the scope -> button hidden.
- Update every `<AIEnrichButton>` usage (ProductForm, CategoryForm, BrandForm, CustomerMailerPanel,
  CustomerMailPanel, HeroSlideManager, OfferSlideDisplayEditor, ReviewModal, AIFillForm) to pass `scope`.
- `AIFillForm.tsx` and any standalone AI buttons: same RequireWrite gate with the right scope.

## Verification (local, when asked)
- `tsc --noEmit` clean. Grep proves zero remaining `OLLAMA_BASE_URL`/`/api/chat`/`/api/generate`/`100.82.208.8`
  in src (except none). Grep proves zero `Jeffi`/`hardware` literals left in AI prompt strings.
- Unit/behavior: an enrich request with a mismatched scope is 403; a storefront route on a basic plan is 403.
- Run AI-touching tests + agent/tools tests.

## Constraints
One branch, no commit/push until asked, no emojis, files < 500 lines, touch only AI wiring + its gating/prompt.
Live reads only (already done to fetch scope keys).
