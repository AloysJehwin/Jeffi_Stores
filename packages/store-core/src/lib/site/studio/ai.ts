import { AsyncLocalStorage } from 'async_hooks'
import { aiChat, type AiChatMessage } from '@/lib/shared/ai-client'
import { parseAiJson } from '@/lib/auth/ai-scope'
import { platformFunding, runPlatformFunded } from '@/lib/ai/billing'
import { metered } from '@/lib/ai/cost-meter'
import { AI_UNAVAILABLE_MESSAGE, noteSiteAiDown, siteAiKnownDown } from '../ai-status'

// The studio's model calls: one feature key, tolerant JSON reading (small local models wrap, rename and truncate),
// and a budget. Inside runStudioFunded, usage is platform-funded (lib/ai/billing.ts); the flagship logs text at
// price 0, so the provider cost the gateway reports is also counted here and either total stops the AI.

export const STUDIO_FEATURE = 'site_builder'
export const STUDIO_BUDGET_INR = () => Number(process.env.SITE_STUDIO_BUDGET_INR || process.env.SITE_BUILD_BUDGET_INR || 1000)

const spend = new AsyncLocalStorage<{ budgetInr: number; costInr: number }>()

/** The gateway hints the site-writing ('deep') calls may run on instead. */
export type StudioModel = 'deep' | 'agent' | 'fast'
const model = new AsyncLocalStorage<StudioModel>()

/** Runs fn with the studio's site-writing calls on another model (an outreach build runs on a faster one, mid-call). */
export function runStudioWithModel<T>(m: StudioModel, fn: () => Promise<T>): Promise<T> {
  return model.run(m, fn)
}

/** Runs fn as the owner's free generation: platform-funded, stopping AI calls once `budgetInr` is spent. */
export function runStudioFunded<T>(fn: () => Promise<T>, budgetInr = STUDIO_BUDGET_INR(), label = 'site-studio'): Promise<T> {
  return spend.run({ budgetInr, costInr: 0 }, () => runPlatformFunded(label, budgetInr, fn))
}

/** Inside runStudioFunded: what this run has spent, so a session can carry the rest of its budget to the next request. */
export function studioSpentInr(): number {
  return Math.max(spend.getStore()?.costInr ?? 0, platformFunding()?.spentInr ?? 0)
}

/** What is left of the free generation's budget, or of a metered one (lib/ai/paid-generation.ts); Infinity outside both. */
export function studioBudgetLeft(): number {
  const s = spend.getStore()
  const own = s ? s.budgetInr - s.costInr : Infinity
  return Math.max(0, Math.min(own, platformFunding()?.remainingInr ?? Infinity, metered()?.remainingInr ?? Infinity))
}

export class StudioBudgetError extends Error {
  constructor() {
    super('The free generation budget is spent')
    this.name = 'StudioBudgetError'
  }
}

/** Claude did not answer (the gateway fell back to another model): the studio stops instead of building on it. */
export class StudioAiDownError extends Error {
  constructor() {
    super(AI_UNAVAILABLE_MESSAGE)
    this.name = 'StudioAiDownError'
  }
}

/** For an AI call with a fallback: null on failure, except when Claude is down (the caller stops, not falls back). */
export const orNull = (err: unknown): null => {
  if (err instanceof StudioAiDownError) throw err
  return null
}

export interface ChatOpts {
  maxTokens: number
  temperature?: number
  json?: boolean
  modelHint?: 'deep' | 'copy'
}

/** One model call, counted against the budget; throws StudioBudgetError when none is left. */
export async function chat(messages: AiChatMessage[], o: ChatOpts): Promise<string> {
  if (studioBudgetLeft() <= 0) throw new StudioBudgetError()
  if (siteAiKnownDown()) throw new StudioAiDownError()
  const r = await aiChat({
    feature: STUDIO_FEATURE,
    // Site generation runs on Opus (the gateway's deep hint); copy work stays on Haiku.
    modelHint: o.modelHint ?? model.getStore() ?? 'deep',
    maxTokens: o.maxTokens,
    temperature: o.temperature ?? 0.7,
    jsonMode: o.json,
    noCache: true,
    messages,
  })
  const s = spend.getStore()
  if (s) s.costInr += Number(r.usage?.costInr ?? 0)
  if (r.provider !== 'anthropic') {
    noteSiteAiDown()
    throw new StudioAiDownError()
  }
  return r.content ?? ''
}

/** A JSON object from the model, or null; fenced, prefixed or trailing-comma answers are read too. */
export async function askJson<T = Record<string, unknown>>(system: string, user: string, o: Omit<ChatOpts, 'json'>): Promise<T | null> {
  const raw = await chat([{ role: 'system', content: system }, { role: 'user', content: user }], { ...o, json: true })
  return readJson<T>(raw)
}

export function readJson<T = Record<string, unknown>>(raw: string): T | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)?.[1] ?? ''
  for (const s of [raw, fenced]) {
    const direct = parseAiJson<T>(s)
    if (direct && typeof direct === 'object') return direct
    const m = s.match(/\{[\s\S]*\}/)
    if (m) {
      const loose = parseAiJson<T>(m[0].replace(/,\s*([}\]])/g, '$1'))
      if (loose && typeof loose === 'object') return loose
    }
  }
  return null
}

/** The first list in an object under any of `keys` (models rename lists), else []. */
export function listOf(o: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(o)) return o
  if (!o || typeof o !== 'object') return []
  const rec = o as Record<string, unknown>
  for (const k of keys) if (Array.isArray(rec[k])) return rec[k] as unknown[]
  return (Object.values(rec).find(Array.isArray) as unknown[] | undefined) ?? []
}

export const str = (v: unknown, max: number, d = '') => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d)

/** Like str, for text the owner reads: a longer one is cut at a word and ends in "…", never mid-word. */
export function clip(v: unknown, max: number, d = ''): string {
  const s = str(v, Infinity)
  if (!s) return d
  if (s.length <= max) return s
  const cut = s.slice(0, max - 1).replace(/\s+\S*$/, '')
  // Not on a dangling "in a" or a comma.
  const tidy = cut.replace(/(\s+(a|an|the|and|or|of|in|on|at|to|for|with|by|as|from|into|its|their))+$/i, '').replace(/[\s,;:.\-–—]+$/, '')
  return `${tidy || s.slice(0, max - 1)}…`
}

// Seeded choices: one brief always makes the same picks for the same salt, another brief (or seed) makes others.
export function rng(seed: number, salt = '') {
  let h = seed >>> 0
  for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 2654435761) >>> 0
  return () => {
    h = (h + 0x6d2b79f5) >>> 0
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length]

export function shuffle<T>(r: () => number, list: readonly T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export const newSeed = () => Math.floor(Math.random() * 2 ** 31)
