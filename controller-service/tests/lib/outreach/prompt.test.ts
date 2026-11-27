import { describe, it, expect } from 'vitest'
import {
  LINES,
  PERSONA_NAMES,
  PERSONA_RULE,
  SCRIPT_VERSION,
  asLanguage,
  greeting,
  istStamp,
  knownLines,
  spokenTime,
} from '@controller/lib/outreach/prompt'
import { LANGUAGES } from '@controller/lib/outreach/types'

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

  it('keeps the persona rule word for word (the skill renderer puts it in every voice prompt)', () => {
    expect(PERSONA_RULE).toContain("if sincerely asked it says truthfully that it is Jeffi Stores' AI assistant, and it never claims to be human")
    expect(PERSONA_RULE).toContain('announces recording')
    for (const l of LANGUAGES) expect(LINES[l].aiAnswer, l).toContain('Jeffi Stores')
  })

  it('istStamp is a full IST date and time; knownLines lists what is known', () => {
    expect(istStamp(new Date('2026-11-25T06:00:00Z'))).toMatch(/Wednesday.*2026.*11:30/i)
    expect(knownLines({})).toEqual([])
    expect(knownLines({ whatTheyDo: 'Sweets', highlights: ['a', 'b'], contact: { phone: '1', email: 'e' } })).toEqual(['- What they do: Sweets', '- Highlights: a; b', '- Contact for the site: 1, e'])
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
