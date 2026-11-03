// Per-tenant namespacing for on-device model artifacts (#489).
//
// The base Gemma weights are identical for every store, so the model byte cache is SHARED (keyed by
// the model, not the tenant) — no benefit to re-downloading ~400MB per tenant. But a LoRA adapter is
// fine-tuned on ONE store's data, so it must be namespaced by tenant: on a shared browser (a staff
// member who administers two stores) one tenant's adapter must never load into another's inference.
//
// Pure + dependency-free so both workers and a unit test can use it without WebGPU.

const SLUG_RE = /[^a-z0-9-]/g

/** Normalise a store slug into a safe IndexedDB key segment. Empty/absent → 'platform'. */
export function normalizeSlug(slug: string | null | undefined): string {
  const s = (slug ?? '').toLowerCase().replace(SLUG_RE, '').slice(0, 64)
  return s || 'platform'
}

export interface OnDeviceKeys {
  /** IndexedDB key for this store's LoRA adapter weights. */
  loraKey: string
}

/** Tenant-namespaced on-device keys. The LoRA adapter is per-store; the base model cache is not. */
export function onDeviceKeys(slug: string | null | undefined): OnDeviceKeys {
  return { loraKey: `jeffi_lora_v1_${normalizeSlug(slug)}` }
}
