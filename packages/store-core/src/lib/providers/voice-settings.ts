// Outreach voice and India SMS DLT settings: shapes, defaults and validation, shared by the admin UI,
// the provider policy (PUT validation) and lib/providers/voice-config.ts. Non-secret only.

export const VOICE_PROVIDERS = ['exotel', 'twilio_test'] as const
export type VoiceProviderName = (typeof VOICE_PROVIDERS)[number]

export const VOICE_LANGS = ['en', 'hi', 'ta', 'te', 'kn', 'ml', 'mr', 'bn', 'gu'] as const
export type VoiceLang = (typeof VOICE_LANGS)[number]

/** Exotel API hosts: Mumbai (India accounts) and Singapore. A fixed list, so a test call never goes elsewhere. */
export const EXOTEL_SUBDOMAINS = ['api.in.exotel.com', 'api.exotel.com'] as const
export type ExotelSubdomain = (typeof EXOTEL_SUBDOMAINS)[number]

export const SARVAM_STT_MODELS = ['saaras:v3', 'saaras:v4'] as const
export const SARVAM_TTS_MODELS = ['bulbul:v3', 'bulbul:v2'] as const

/** The Haiku ID the AI gateway uses (ai-platform/gateway/src/config.ts). */
export const DEFAULT_VOICE_LLM = 'claude-haiku-5-5'
/** Bulbul v3 speakers Sarvam recommends per language. */
export const DEFAULT_SARVAM_VOICES: Record<VoiceLang, string> = {
  en: 'ishita',
  hi: 'priya',
  ta: 'ishita',
  te: 'neha',
  kn: 'neha',
  ml: 'pooja',
  mr: 'priya',
  bn: 'roopa',
  gu: 'priya',
}

export const MAX_TEST_NUMBERS = 20
export const MAX_SENDER_IDS = 20
/** Exotel's telemarketer ID on DLT, for the PE–TM chain behind its 140-series calls. */
export const EXOTEL_TM_ID = '1002641844184516305'

export interface VoiceSettings {
  exotel: { accountSid: string; subdomain: ExotelSubdomain; callerId: string; appId: string }
  twilioTest: { from: string }
  testNumbers: string[]
  sarvam: { sttModel: string; ttsModel: string; voices: Record<VoiceLang, string> }
  llmModel: string
}

/** What voice_config stores: any subset of VoiceSettings, unset fields fall back to the defaults. */
export interface StoredVoiceConfig {
  exotel?: Partial<VoiceSettings['exotel']>
  twilioTest?: Partial<VoiceSettings['twilioTest']>
  testNumbers?: string[]
  sarvam?: { sttModel?: string; ttsModel?: string; voices?: Partial<Record<VoiceLang, string>> }
  llmModel?: string
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  exotel: { accountSid: '', subdomain: 'api.in.exotel.com', callerId: '', appId: '' },
  twilioTest: { from: '' },
  testNumbers: [],
  sarvam: { sttModel: 'saaras:v3', ttsModel: 'bulbul:v3', voices: { ...DEFAULT_SARVAM_VOICES } },
  llmModel: DEFAULT_VOICE_LLM,
}

const E164 = /^\+[1-9]\d{7,14}$/
const ID = /^[A-Za-z0-9_-]{1,64}$/
const CALLER = /^\+?\d{8,15}$/
const MODEL = /^[a-z0-9-]+:[a-z0-9.-]+$/i
const LLM = /^[A-Za-z0-9][A-Za-z0-9.:@_-]{2,99}$/
const SPEAKER = /^[a-z][a-z0-9_-]{0,39}$/
const DLT_ENTITY = /^\d{10,30}$/
const SENDER = /^[A-Z0-9]{6}$/

const compact = (s: string) => s.replace(/[\s()-]/g, '')
export const isE164 = (v: unknown): v is string => typeof v === 'string' && E164.test(compact(v))

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

type Check = (s: string) => string | null
const re = (r: RegExp): Check => s => (r.test(s) ? s : null)
const oneOf = (list: readonly string[]): Check => s => (list.includes(s) ? s : null)

/** Copies the string fields of `src` that pass; '' or absent is skipped, anything else invalid fails the lot. */
function fields(src: unknown, checks: Record<string, Check>, out: Record<string, string>, pre: (s: string) => string = s => s.trim()): boolean {
  if (src === undefined || src === null) return true
  if (!isObj(src)) return false
  for (const [k, check] of Object.entries(checks)) {
    const v = src[k]
    if (v === undefined || v === null || v === '') continue
    if (typeof v !== 'string') return false
    const s = pre(v)
    if (!s) continue
    const ok = check(s)
    if (ok === null) return false
    out[k] = ok
  }
  return true
}

export function normalizeTestNumbers(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const n of v) {
    if (!isE164(n)) return null
    const c = compact(n)
    if (!out.includes(c)) out.push(c)
  }
  return out.length > MAX_TEST_NUMBERS ? null : out
}

/** Validates voice_config; null when anything given is invalid. Unknown fields are dropped. */
export function normalizeVoiceConfig(v: unknown): StoredVoiceConfig | null {
  if (!isObj(v)) return null
  const out: StoredVoiceConfig = {}

  const exotel: Record<string, string> = {}
  if (!fields(v.exotel, { accountSid: re(ID), subdomain: oneOf(EXOTEL_SUBDOMAINS), appId: re(ID) }, exotel)) return null
  const caller: Record<string, string> = {}
  if (!fields(v.exotel, { callerId: re(CALLER) }, caller, s => compact(s))) return null
  if (Object.keys(exotel).length || caller.callerId) out.exotel = { ...exotel, ...caller }

  const twilio: Record<string, string> = {}
  if (!fields(v.twilioTest, { from: s => (E164.test(s) ? s : null) }, twilio, s => compact(s))) return null
  if (twilio.from) out.twilioTest = { from: twilio.from }

  if (v.testNumbers !== undefined) {
    const nums = normalizeTestNumbers(v.testNumbers)
    if (!nums) return null
    out.testNumbers = nums
  }

  if (v.sarvam !== undefined) {
    if (!isObj(v.sarvam)) return null
    const models: Record<string, string> = {}
    if (!fields(v.sarvam, { sttModel: re(MODEL), ttsModel: re(MODEL) }, models)) return null
    const voices: Record<string, string> = {}
    if (v.sarvam.voices !== undefined) {
      if (!isObj(v.sarvam.voices)) return null
      const checks = Object.fromEntries(VOICE_LANGS.map(l => [l, re(SPEAKER)]))
      if (!fields(v.sarvam.voices, checks, voices, s => s.trim().toLowerCase())) return null
    }
    const sarvam: StoredVoiceConfig['sarvam'] = { ...models }
    if (Object.keys(voices).length) sarvam.voices = voices
    if (Object.keys(sarvam).length) out.sarvam = sarvam
  }

  const llm: Record<string, string> = {}
  if (!fields({ llmModel: v.llmModel }, { llmModel: re(LLM) }, llm)) return null
  if (llm.llmModel) out.llmModel = llm.llmModel
  return out
}

/** Stored voice_config over the defaults; an invalid stored value counts as unset. */
export function mergeVoiceSettings(stored: unknown): VoiceSettings {
  const s = (stored === undefined || stored === null ? {} : normalizeVoiceConfig(stored)) ?? {}
  const d = DEFAULT_VOICE_SETTINGS
  return {
    exotel: { ...d.exotel, ...s.exotel } as VoiceSettings['exotel'],
    twilioTest: { ...d.twilioTest, ...s.twilioTest },
    testNumbers: s.testNumbers ?? [],
    sarvam: {
      sttModel: s.sarvam?.sttModel ?? d.sarvam.sttModel,
      ttsModel: s.sarvam?.ttsModel ?? d.sarvam.ttsModel,
      voices: { ...d.sarvam.voices, ...s.sarvam?.voices },
    },
    llmModel: s.llmModel ?? d.llmModel,
  }
}

export function normalizeDltEntityId(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return DLT_ENTITY.test(s) ? s : null
}

export function normalizeSenderId(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toUpperCase()
  return SENDER.test(s) ? s : null
}

/** DLT headers: 6 letters or digits, upper-cased and de-duplicated, at most MAX_SENDER_IDS. */
export function normalizeSenderIds(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const x of v) {
    const s = normalizeSenderId(x)
    if (!s) return null
    if (!out.includes(s)) out.push(s)
  }
  return out.length > MAX_SENDER_IDS ? null : out
}
