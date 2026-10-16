// Platform cost table (INR). Defaults here; override any cell with AI_PRICES_JSON, e.g.
//   {"google":{"gemini-3.1-flash-image":{"image":6}},"razer":{"*":{"image":0.4}}}
// Lookup: exact model -> longest model prefix -> provider '*' -> 0.
// USD list prices (Oct 2026) converted at AI_USD_INR (default 84).

export type PriceUnit = 'image' | 'video_second' | 'token_1k_in' | 'token_1k_out'
export type PriceCells = Partial<Record<PriceUnit, number>>
export type PriceTable = Record<string, Record<string, PriceCells>>

const USD = Number(process.env.AI_USD_INR) || 84
const usd = (n: number) => round(n * USD)

// Razer box: ~350 W GPU at ~8 INR/kWh plus hardware amortisation (~1.2 lakh over 3 years).
// An image is ~10 s, a 1k-token generation ~3 s. Small but non-zero so Razer work is costed.
const RAZER_IMAGE_INR = 0.3
const RAZER_TOKEN_1K_INR = 0.02

export const DEFAULT_PRICES: PriceTable = {
  razer: {
    '*': { image: RAZER_IMAGE_INR, token_1k_in: RAZER_TOKEN_1K_INR, token_1k_out: RAZER_TOKEN_1K_INR },
  },
  ollama: {
    '*': { token_1k_in: RAZER_TOKEN_1K_INR, token_1k_out: RAZER_TOKEN_1K_INR },
    'nomic-embed-text': { token_1k_in: RAZER_TOKEN_1K_INR / 4, token_1k_out: 0 },
  },
  google: {
    'gemini-3.1-flash-image': { image: usd(0.067) },
    'gemini-3.1-flash-lite-image': { image: usd(0.0336) },
    'gemini-nano-banana-2.1': { image: usd(0.0336) },
    'gemini-3-pro-image': { image: usd(0.134) },
    'gemini-2.5-flash-image': { image: usd(0.039) },
    'imagen-4.0-generate-001': { image: usd(0.04) },
    'imagen-4.0-fast': { image: usd(0.02) },
    'imagen-4.0-ultra': { image: usd(0.06) },
    'imagen-3.0-generate-002': { image: usd(0.03) },
    'veo-3.1-generate-preview': { video_second: usd(0.40) },
    'veo-3.1-fast-generate-preview': { video_second: usd(0.10) },
    'veo-3.1-lite-generate-preview': { video_second: usd(0.05) },
    'veo-3.0-generate-001': { video_second: usd(0.40) },
    'veo-3.0-fast-generate-001': { video_second: usd(0.15) },
    'veo-2.0-generate-001': { video_second: usd(0.35) },
    '*': { image: usd(0.04), video_second: usd(0.40) },
  },
  replicate: {
    'black-forest-labs/flux-schnell': { image: usd(0.003) },
    'black-forest-labs/flux-dev': { image: usd(0.025) },
    'black-forest-labs/flux-1.1-pro': { image: usd(0.04) },
    // Estimate: Replicate lists Wan 2.2 fast around $0.05 per output second at 480p.
    'wan-video/wan-2.2-t2v-fast': { video_second: usd(0.05) },
    'wan-video/wan-2.2-i2v-fast': { video_second: usd(0.05) },
    '*': { image: usd(0.03), video_second: usd(0.10) },
  },
}

let table: PriceTable | null = null

export function loadPrices(overridesJson: string | undefined = process.env.AI_PRICES_JSON): PriceTable {
  const out: PriceTable = {}
  for (const [p, models] of Object.entries(DEFAULT_PRICES)) out[p] = Object.fromEntries(Object.entries(models).map(([m, c]) => [m, { ...c }]))
  if (overridesJson) {
    let o: PriceTable
    try { o = JSON.parse(overridesJson) } catch { throw new Error('AI_PRICES_JSON is not valid JSON') }
    for (const [p, models] of Object.entries(o || {})) {
      out[p] ??= {}
      for (const [m, cells] of Object.entries(models || {})) out[p][m] = { ...(out[p][m] || {}), ...cells }
    }
  }
  table = out
  return out
}

export function resetPrices(): void { table = null }

function cellsFor(provider: string, model: string): PriceCells {
  const t = table ?? loadPrices()
  const models = t[provider]
  if (!models) return {}
  if (models[model]) return { ...(models['*'] || {}), ...models[model] }
  const prefix = Object.keys(models).filter(k => k !== '*' && model.startsWith(k)).sort((a, b) => b.length - a.length)[0]
  return { ...(models['*'] || {}), ...(prefix ? models[prefix] : {}) }
}

/** Unit price in INR for one unit of `unit` (0 when unknown). */
export function unitPrice(provider: string, model: string, unit: PriceUnit): number {
  return cellsFor(provider, model)[unit] ?? 0
}

/** Total platform cost in INR for the given unit quantities (token units are in thousands). */
export function costFor(provider: string, model: string, units: PriceCells): number {
  let total = 0
  for (const [u, qty] of Object.entries(units) as [PriceUnit, number][]) {
    if (!qty) continue
    total += unitPrice(provider, model, u) * qty
  }
  return round(total)
}

/** Token usage block for chat/embed responses from Ollama's counters. */
export function tokenUsage(provider: string, model: string, promptTokens: number, completionTokens: number): { promptTokens: number; completionTokens: number; costInr: number } {
  const p = Math.max(0, Math.floor(promptTokens || 0))
  const c = Math.max(0, Math.floor(completionTokens || 0))
  return { promptTokens: p, completionTokens: c, costInr: costFor(provider, model, { token_1k_in: p / 1000, token_1k_out: c / 1000 }) }
}

export function round(n: number): number {
  return Math.round(n * 10_000) / 10_000
}
