import { describe, it, expect, vi } from 'vitest'

vi.mock('@controller/lib/outreach/agent/catalog', async () => await import('./skill-fake-catalog'))

import { BUILTIN_SKILLS, DEFAULT_SKILL_SLUG } from '@controller/lib/outreach/agent/skill/builtin'
import { parseSkill } from '@controller/lib/outreach/agent/skill/parse'
import { PLACEHOLDERS, personaNameFor, renderSystemPrompt, skillLanguage } from '@controller/lib/outreach/agent/skill/render'
import type { RenderContext } from '@controller/lib/outreach/agent/types'
import { LANGUAGE_NAMES, LINES, PERSONA_NAMES, SCRIPT_VERSION, type KnownBrief } from '@controller/lib/outreach/prompt'
import { legacySystemPrompt } from './legacy-prompt'

const parse = (slug: string) => parseSkill(BUILTIN_SKILLS.find(b => b.slug === slug)!.content, { builtin: true }).skill!
const DEFAULT = parse(DEFAULT_SKILL_SLUG)

const NOW = new Date('2026-11-25T06:00:00Z')
const KNOWN: KnownBrief = { whatTheyDo: 'Sweets and snacks', audience: 'Families nearby', highlights: ['Fresh ghee', 'Gift boxes'], hours: '9am to 9pm', address: 'Main Road', style: 'Warm and festive', contact: { phone: '9876543210', email: 'shop@example.com' } }
const STATES = [
  { name: 'no consent', consentWhatsApp: false, previewStarted: false, published: false, known: {} as KnownBrief },
  { name: 'consent and preview started', consentWhatsApp: true, previewStarted: true, published: false, known: {} as KnownBrief },
  { name: 'published with a known brief', consentWhatsApp: true, previewStarted: true, published: true, known: KNOWN },
]
const WHO = [
  { owner: null, category: null, city: null },
  { owner: 'Ravi', category: 'Sweet shop', city: 'Madurai' },
]

const ctx = (over: Partial<RenderContext> = {}): RenderContext => ({
  channel: 'voice',
  language: 'en',
  personaName: PERSONA_NAMES.en,
  business: 'Ravi Stores',
  owner: 'Ravi',
  category: 'Sweet shop',
  city: 'Madurai',
  status: 'interested',
  now: NOW,
  continuing: false,
  consentWhatsApp: false,
  previewStarted: false,
  published: false,
  known: {},
  scriptVersion: SCRIPT_VERSION,
  ...over,
})

describe('the default skill renders today\'s voice prompt byte for byte', () => {
  for (const language of ['en', 'hi', 'ta'] as const) {
    for (const continuing of [false, true]) {
      for (const st of STATES) {
        for (const who of WHO) {
          it(`${language}, continuing ${continuing}, ${st.name}, ${who.owner ? 'full lead' : 'bare lead'}`, () => {
            const personaName = PERSONA_NAMES[language]
            const shared = { language, personaName, business: 'Ravi Stores', continuing, consentWhatsApp: st.consentWhatsApp, previewStarted: st.previewStarted, published: st.published, known: st.known, now: NOW, ...who }
            const expected = legacySystemPrompt(shared)
            const actual = renderSystemPrompt(DEFAULT, ctx({ ...shared, status: st.published ? 'published' : 'interested' }))
            expect(actual).toBe(expected)
          })
        }
      }
    }
  }

  it('covers every language too', () => {
    for (const language of Object.keys(PERSONA_NAMES) as (keyof typeof PERSONA_NAMES)[]) {
      const shared = { language, personaName: PERSONA_NAMES[language], business: 'B', owner: null, category: null, city: null, now: NOW, continuing: false, consentWhatsApp: false, previewStarted: false, published: false, known: {} }
      expect(renderSystemPrompt(DEFAULT, ctx(shared)), language).toBe(legacySystemPrompt(shared))
    }
  })
})

describe('voice rendering', () => {
  const raw = (extra: string, voice = 'Hi {{persona}} at {{business}}.') => `---\nname: x\n${extra}\n---\nShared line.\n\n## Voice\n${voice}`

  it('the language block lists only the skill\'s languages, and offers switchLanguage only when allowed', () => {
    const allowed = parseSkill(raw('languages: [en, hi, ta]\ntools:\n  voice: [switchLanguage, markOutcome]')).skill!
    const p = renderSystemPrompt(allowed, ctx())
    expect(p).toContain('you support (Hindi (hi), Tamil (ta)), call switchLanguage')
    expect(p).not.toContain('Telugu')
    const denied = parseSkill(raw('languages: [en, hi]\ntools:\n  voice: [markOutcome]')).skill!
    const q = renderSystemPrompt(denied, ctx())
    expect(q).toContain('If the person prefers another language, say you can only continue in English and offer a call back.')
    expect(q).not.toContain('call switchLanguage')
    const single = parseSkill(raw('languages: [en]\ntools:\n  voice: [switchLanguage]')).skill!
    expect(renderSystemPrompt(single, ctx())).toContain('offer a call back')
  })

  it('the skill text is the preamble plus the Voice section, with placeholders filled and unknown ones left', () => {
    const s = parseSkill(raw('tone: warm and plain', 'Hi {{persona}} at {{business}} ({{owner}}, {{city}}, {{category}}, {{language}}). {{mystery}} {{ trial_days }} {{ai_answer}}')).skill!
    const p = renderSystemPrompt(s, ctx())
    expect(p).toContain('Shared line.\n\nHi Priya at Ravi Stores (Ravi, Madurai, Sweet shop, English). {{mystery}} 7 I\'m Jeffi Stores\' AI assistant.')
    expect(p).toContain('Tone: warm and plain.')
    expect(p).toContain('Script version: ' + SCRIPT_VERSION + '.')
  })

  it('always carries the persona rule, whatever the skill says', () => {
    const p = renderSystemPrompt(parseSkill(raw('')).skill!, ctx({ language: 'hi', personaName: 'Asha' }))
    expect(p).toContain('Do not volunteer that you are an AI')
    expect(p).toContain(LINES.hi.aiAnswer)
    expect(p).toContain('Never claim to be human')
    expect(p).toContain('You use a human name, Asha')
  })
})

describe('whatsapp and follow-up rendering', () => {
  const skill = parseSkill('---\nname: x\n---\nShared.\n\n## WhatsApp\nWA text for {{business}}.\n\n## Follow-up\nFU text, {{now_ist}}.').skill!

  it('whatsapp: identity, stage, language, safety, skill text, state', () => {
    const p = renderSystemPrompt(skill, ctx({ channel: 'whatsapp', language: 'hi', windowOpen: true, consentWhatsApp: true, previewStarted: true, known: { whatTheyDo: 'Sweets' } }))
    expect(p.startsWith('You are the WhatsApp assistant of Jeffi Stores, chatting with Ravi of "Ravi Stores" in Madurai.\nThe site is a draft preview the owner is helping us fill in.\nReply in Hindi.')).toBe(true)
    expect(p).toContain(LINES.hi.aiAnswer)
    expect(p).toContain('Never claim to be human')
    expect(p).toContain('unless the tool you called returned ok')
    expect(p).toContain('call optOut at once')
    expect(p).toContain('Shared.\n\nWA text for Ravi Stores.')
    expect(p).not.toContain('FU text')
    expect(p).toContain('WHERE THINGS STAND\n- Status: interested\n- WhatsApp consent: already given; do not ask again\n- WhatsApp window: open (free text allowed)\n- Preview site: already started; do not call startPreview again')
    expect(p).toContain('- What they do: Sweets')
  })

  it('whatsapp stage lines and the missing-owner wording', () => {
    expect(renderSystemPrompt(skill, ctx({ channel: 'whatsapp', status: 'published', owner: null, city: null, windowOpen: false }))).toContain('chatting with the owner of "Ravi Stores".\nThe site is live; the owner has not claimed it yet.')
    expect(renderSystemPrompt(skill, ctx({ channel: 'whatsapp', status: 'claimed' }))).toContain('The owner has claimed the site.')
    expect(renderSystemPrompt(skill, ctx({ channel: 'whatsapp', windowOpen: false }))).toContain('closed (approved templates only)')
  })

  it('follow-up: not a conversation, the trigger, the skill text', () => {
    const base = ctx({ channel: 'follow_up' })
    const p = renderSystemPrompt(skill, { ...base, trigger: { kind: 'follow_up', taskId: 't1', reason: 'details missing', instruction: 'send the template' } })
    expect(p).toContain('You are the outreach assistant of Jeffi Stores, deciding the next step for Ravi of "Ravi Stores" in Madurai.')
    expect(p).toContain('You are not in a conversation: act only through tools; nothing you write is sent.')
    expect(p).toContain('A follow-up you scheduled is due (details missing). Your note to yourself: send the template')
    expect(p).toContain('Shared.\n\nFU text, ')
    expect(p).not.toContain('WA text')
    const triggers = [
      [{ kind: 'inbound', messageId: 'm' }, 'They just sent a WhatsApp message.'],
      [{ kind: 'call_ended', callId: 'c', outcome: 'callback', summary: 'wants tomorrow' }, 'A call with them just ended (outcome: callback). Summary: wants tomorrow'],
      [{ kind: 'call_unanswered', callId: 'c', status: 'no_answer' }, 'Your call to them was not answered (no_answer).'],
    ] as const
    for (const [trigger, line] of triggers) expect(renderSystemPrompt(skill, { ...base, trigger: trigger as any })).toContain(line)
  })
})

describe('helpers', () => {
  it('personaNameFor uses the skill name, else the code default', () => {
    const s = parseSkill('---\nname: x\npersona:\n  en: Asha\n---\n## Voice\nv').skill!
    expect(personaNameFor(s, 'en')).toBe('Asha')
    expect(personaNameFor(s, 'ta')).toBe(PERSONA_NAMES.ta)
  })

  it('skillLanguage keeps an allowed preference and falls back to the default', () => {
    const s = parseSkill('---\nname: x\nlanguages: [hi, en]\ndefault_language: hi\n---\n## Voice\nv').skill!
    expect(skillLanguage(s, 'en')).toBe('en')
    expect(skillLanguage(s, 'en-IN')).toBe('en')
    expect(skillLanguage(s, 'ta')).toBe('hi')
    expect(skillLanguage(s, null)).toBe('hi')
    expect(skillLanguage(s, 'zz')).toBe('hi')
  })

  it('lists the placeholders', () => {
    expect([...PLACEHOLDERS].sort()).toEqual(['ai_answer', 'business', 'category', 'city', 'consent_ask', 'language', 'now_ist', 'owner', 'persona', 'pitch', 'store', 'trial_days'])
    expect(LANGUAGE_NAMES.en.english).toBe('English')
  })
})
