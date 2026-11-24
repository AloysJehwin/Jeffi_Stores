import { describe, it, expect } from 'vitest'
import {
  LINES,
  PERSONA_NAMES,
  SCRIPT_VERSION,
  TOOL_SCHEMAS,
  TOOL_NAMES,
  asLanguage,
  greeting,
  isToolName,
  spokenTime,
  systemPrompt,
} from '@controller/lib/outreach/prompt'
import { LANGUAGES } from '@controller/lib/outreach/types'

const base = {
  personaName: 'Priya',
  business: 'Ravi Stores',
  owner: null,
  category: null,
  city: null,
  now: new Date('2026-11-25T06:00:00Z'),
  continuing: false,
  consentWhatsApp: false,
  previewStarted: false,
  published: false,
  known: {},
}

describe('the showcase-offer script', () => {
  it('has a versioned script and every line in all nine languages', () => {
    expect(SCRIPT_VERSION).toMatch(/^showcase-offer\/\d{4}-\d{2}-\d{2}\.\d+$/)
    const keys = Object.keys(LINES.en).sort()
    for (const l of LANGUAGES) {
      expect(Object.keys(LINES[l]).sort(), l).toEqual(keys)
      expect(PERSONA_NAMES[l], l).toBeTruthy()
      for (const [k, v] of Object.entries(LINES[l])) {
        const s = typeof v === 'function' ? v('Priya', { business: 'Ravi Stores', owner: 'Ravi' }) : v
        expect(String(s).trim().length, `${l}.${k}`).toBeGreaterThan(5)
      }
    }
  })

  it('the greeting carries the persona name, the business and the recording notice', () => {
    const g = greeting({ language: 'en', personaName: 'Priya', business: 'Ravi Stores', owner: 'Ravi', continuing: false })
    expect(g).toContain('Priya')
    expect(g).toContain('Ravi Stores')
    expect(g).toContain('may be recorded so we get your details right')
    for (const l of LANGUAGES) {
      expect(greeting({ language: l, personaName: 'X', business: 'Biz', continuing: false }), l).toContain('Biz')
      expect(greeting({ language: l, personaName: 'X', business: 'Biz', continuing: true }), l).toContain('Jeffi Stores')
    }
  })

  it('the system prompt keeps the persona and honesty rules', () => {
    const p = systemPrompt({ ...base, language: 'hi' })
    expect(p).toContain('Do not volunteer that you are an AI')
    expect(p).toContain(LINES.hi.aiAnswer)
    expect(p).toContain('Never claim to be human')
    expect(p).toContain('One question at a time')
    expect(p).toContain('Never invent facts')
    expect(p).toContain('unless the tool you called returned ok')
    expect(p).toContain('call optOut at once')
    expect(p).toContain('Speak only Hindi')
    expect(p).toContain(SCRIPT_VERSION)
    expect(p).toContain('IST')
  })

  it('tool schemas cover the plan §2 tools', () => {
    expect(TOOL_SCHEMAS.map(t => t.name)).toEqual([...TOOL_NAMES])
    for (const t of TOOL_SCHEMAS) expect(t.input_schema.type).toBe('object')
    expect(isToolName('optOut')).toBe(true)
    expect(isToolName('dropTables')).toBe(false)
  })

  it('asLanguage and spokenTime', () => {
    expect(asLanguage('hi-IN')).toBe('hi')
    expect(asLanguage('fr')).toBe('en')
    expect(asLanguage(undefined)).toBe('en')
    const t = spokenTime(new Date('2026-11-25T11:30:00Z'), 'en')
    expect(t).toMatch(/Wednesday/)
    expect(t).toMatch(/5:00/)
  })
})
