import 'server-only'
import { aiChat } from '@/lib/shared/ai-client'
import { queryMany } from '@/lib/shared/db'
import { saveTranslations } from './messages'
import { updateSession, type SessionRow } from './sessions'
import { isSupportLanguage, languageLabel } from './types'

// Two-way chat translation. Each message keeps the words as written (message + lang) and caches
// translations by language. Detection is by script where the script settles it; Devanagari and
// Latin text are disambiguated by the model only when it matters (no session language yet).

const SCRIPTS: Array<[RegExp, string]> = [
  [/[஀-௿]/, 'ta'],
  [/[ఀ-౿]/, 'te'],
  [/[ಀ-೿]/, 'kn'],
  [/[ഀ-ൿ]/, 'ml'],
  [/[ঀ-৿]/, 'bn'],
  [/[઀-૿]/, 'gu'],
  [/[਀-੿]/, 'pa'],
  [/[଀-୿]/, 'or'],
  [/[؀-ۿ]/, 'ur'],
]

/** Best-effort language of a message; `fallback` (the session's language) settles ambiguous text. */
export function detectLang(text: string, fallback?: string | null): string | null {
  const t = text.replace(/https?:\/\/\S+/g, '').trim()
  if (!t) return fallback ?? null
  for (const [re, code] of SCRIPTS) if (re.test(t)) return code
  if (/[ऀ-ॿ]/.test(t)) return fallback === 'mr' ? 'mr' : 'hi'
  if (/[a-z]/i.test(t)) return fallback && fallback !== 'en' && !/[ऀ-෿]/.test(t) ? fallback : 'en'
  return fallback ?? null
}

/** Ask the model when the script can't tell (first Devanagari or romanised message). */
export async function detectLangAi(text: string): Promise<string | null> {
  try {
    const r = await aiChat({
      messages: [
        {
          role: 'system',
          content:
            'Identify the language the customer is writing in. Romanised Hindi ("mera order kab aayega") counts as Hindi. ' +
            'Answer with JSON {"lang":"<code>"} using one of: en, hi, ta, te, kn, ml, mr, bn, gu, pa, ur, or.',
        },
        { role: 'user', content: text.slice(0, 500) },
      ],
      jsonMode: true,
      modelHint: 'fast',
      temperature: 0,
      maxTokens: 20,
      noCache: true,
      feature: 'support_translate',
    })
    const lang = JSON.parse(r.content || '{}').lang
    return isSupportLanguage(lang) ? lang : null
  } catch {
    return null
  }
}

/**
 * The customer's language after this message. The first message settles it (asking the model when
 * the script can't); later, a message in a different script switches it.
 */
export async function settleCustomerLang(s: SessionRow, text: string): Promise<{ lang: string | null; session: SessionRow }> {
  const t = text.trim()
  if (!t) return { lang: s.customer_lang, session: s }
  let lang = detectLang(t, s.customer_lang)
  if (!s.customer_lang) {
    const scripted = SCRIPTS.some(([re]) => re.test(t))
    if (!scripted) lang = (await detectLangAi(t)) ?? lang
  } else if (lang === s.customer_lang || lang === 'en' || !lang) {
    return { lang, session: s }
  }
  if (!lang || lang === s.customer_lang) return { lang, session: s }
  return { lang, session: (await updateSession(s.id, { customer_lang: lang })) ?? s }
}

/** Translate several texts to one language in one call; returns them in order (null = failed). */
export async function translateMany(texts: string[], to: string, from?: string | null): Promise<Array<string | null>> {
  if (!texts.length) return []
  try {
    const r = await aiChat({
      messages: [
        {
          role: 'system',
          content:
            `You translate customer-support chat messages${from ? ` from ${languageLabel(from)}` : ''} into ${languageLabel(to)}. ` +
            'Keep the meaning and tone; sound natural to a native speaker. Keep unchanged: order numbers, ticket numbers, ' +
            'amounts and currency, product names, SKUs, URLs, email addresses, phone numbers, codes and emoji. ' +
            'Romanised input may be answered in the target language\'s own script. ' +
            'Reply with JSON {"t":["...", ...]} — one string per input, same order.',
        },
        { role: 'user', content: JSON.stringify({ texts }) },
      ],
      jsonMode: true,
      modelHint: 'fast',
      temperature: 0.2,
      maxTokens: Math.min(4000, 200 + texts.reduce((n, t) => n + t.length * 3, 0)),
      noCache: true,
      feature: 'support_translate',
    })
    const out = JSON.parse(r.content || '{}').t
    if (!Array.isArray(out)) return texts.map(() => null)
    return texts.map((_, i) => (typeof out[i] === 'string' && out[i].trim() ? out[i] : null))
  } catch {
    return texts.map(() => null)
  }
}

export async function translateOne(text: string, to: string, from?: string | null): Promise<string | null> {
  if (!text.trim() || (from && from === to)) return null
  return (await translateMany([text], to, from))[0]
}

/**
 * Fill in missing translations into `lang` for a chat's messages (the admin's view). Only messages
 * in another language with no cached translation are sent, in one batch per call.
 */
export async function ensureTranslations(sessionId: string, lang: string, limit = 60): Promise<number> {
  const rows = await queryMany<{ id: string; message: string; lang: string }>(
    `SELECT id, message, lang FROM support_messages
      WHERE session_id = $1 AND lang IS NOT NULL AND lang <> $2 AND message <> '' AND NOT (translations ? $2)
      ORDER BY created_at DESC LIMIT ${limit}`,
    [sessionId, lang]
  )
  if (!rows.length) return 0
  const byFrom = new Map<string, typeof rows>()
  for (const r of rows) byFrom.set(r.lang, [...(byFrom.get(r.lang) ?? []), r])
  let done = 0
  for (const [from, group] of byFrom) {
    const out = await translateMany(group.map(r => r.message), lang, from)
    for (let i = 0; i < group.length; i++) {
      if (!out[i]) continue
      await saveTranslations(group[i].id, sessionId, { [lang]: out[i]! })
      done++
    }
  }
  return done
}
