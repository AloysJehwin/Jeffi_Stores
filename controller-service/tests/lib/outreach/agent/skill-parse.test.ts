import { describe, it, expect, vi } from 'vitest'

vi.mock('@controller/lib/outreach/agent/catalog', async () => await import('./skill-fake-catalog'))

import { parseSkill, sectionChannel, slugify } from '@controller/lib/outreach/agent/skill/parse'
import { LANGUAGES } from '@controller/lib/outreach/types'

const codes = (r: ReturnType<typeof parseSkill>, level?: 'error' | 'warning') => r.issues.filter(i => !level || i.level === level).map(i => i.code)

describe('parseSkill defaults', () => {
  it('a bare Markdown file: name from the heading, title = name, one_call, every language', () => {
    const r = parseSkill("# Ravi's Offer!\n\nIntro text\n\n## Voice\nTalk.\n\n## WhatsApp\nChat.")
    expect(codes(r, 'error')).toEqual([])
    const s = r.skill!
    expect(s.meta).toMatchObject({
      name: 'ravi-s-offer',
      title: 'ravi-s-offer',
      description: null,
      flow: 'one_call',
      channels: ['voice', 'whatsapp'],
      languages: [...LANGUAGES],
      defaultLanguage: 'en',
      persona: {},
      tone: null,
      limits: {},
      scriptVersion: null,
      tools: { voice: [], whatsapp: [], follow_up: [] },
    })
    expect(s.preamble).toBe("# Ravi's Offer!\n\nIntro text")
    expect(s.sections).toEqual({ voice: 'Talk.', whatsapp: 'Chat.' })
    expect(codes(r, 'warning')).toContain('no_tools')
  })

  it('channels default to the live channels that have a section; follow-up is not a live channel', () => {
    const r = parseSkill('---\nname: x\n---\n## WhatsApp\nA\n## Follow-up\nB')
    expect(r.skill!.meta.channels).toEqual(['whatsapp'])
    expect(r.skill!.sections.follow_up).toBe('B')
  })

  it('no name and no heading is an error', () => {
    expect(codes(parseSkill('just text'), 'error')).toContain('missing_name')
  })

  it('frontmatter errors give no skill', () => {
    const r = parseSkill('---\nname: x\n')
    expect(r.skill).toBeNull()
    expect(codes(r)).toContain('frontmatter_unclosed')
  })

  it('slugify and sectionChannel', () => {
    expect(slugify('  Hello, World  ')).toBe('hello-world')
    for (const h of ['Voice', 'WHATSAPP', 'Follow-up', 'Follow up', 'Followup', 'Follow-ups']) expect(sectionChannel(h), h).toBeTruthy()
    expect(sectionChannel('Follow-up')).toBe('follow_up')
    expect(sectionChannel('Notes')).toBeNull()
  })
})

describe('sections', () => {
  it('other level-2 headings stay in the current section, level-3 never split, text before the first channel heading is the preamble', () => {
    const r = parseSkill('---\nname: x\n---\nShared\n\n## Notes\nstill preamble\n\n## Voice\nv1\n\n### Sub\nv2\n\n## Pricing\nv3\n\n## WhatsApp\nw')
    expect(r.skill!.preamble).toBe('Shared\n\n## Notes\nstill preamble')
    expect(r.skill!.sections.voice).toBe('v1\n\n### Sub\nv2\n\n## Pricing\nv3')
    expect(r.skill!.sections.whatsapp).toBe('w')
  })

  it('a heading inside a code fence is not a heading', () => {
    const r = parseSkill('---\nname: x\n---\n## Voice\nsay\n```\n## WhatsApp\n```\nmore')
    expect(r.skill!.sections.whatsapp).toBeUndefined()
    expect(r.skill!.sections.voice).toContain('more')
  })

  it('a duplicated section is joined with a warning; an empty one stays defined', () => {
    const r = parseSkill('---\nname: x\n---\n## Voice\na\n## WhatsApp\n## Voice\nb')
    expect(r.skill!.sections.voice).toBe('a\nb')
    expect(r.skill!.sections.whatsapp).toBe('')
    expect(codes(r, 'warning')).toContain('duplicate_section')
  })
})

describe('frontmatter fields', () => {
  it('accepts camelCase keys and kebab-case tool channels', () => {
    const r = parseSkill(
      ['---', 'name: x', 'defaultLanguage: hi', 'languages: [hi, en]', 'scriptVersion: s/1', 'tools:', '  voice: [recordConsent]', '  followUp: [sendLink]', '  whatsapp: [addDetails]', 'limits:', '  maxAgentCalls: 2', '---', '## Voice', 'v'].join('\n'),
      { builtin: true }
    )
    expect(codes(r, 'error')).toEqual([])
    expect(r.skill!.meta).toMatchObject({ defaultLanguage: 'hi', languages: ['hi', 'en'], scriptVersion: 's/1', limits: { maxAgentCalls: 2 } })
    expect(r.skill!.meta.tools).toEqual({ voice: ['recordConsent'], whatsapp: ['addDetails'], follow_up: ['sendLink'] })
    expect(parseSkill('---\nname: x\ndefault-language: en\ntools:\n  follow-up: [sendLink]\n---\n## Voice\nv').skill!.meta.tools.follow_up).toEqual(['sendLink'])
  })

  it('script_version only counts for builtins', () => {
    const raw = '---\nname: x\nscript_version: abc/1\n---\n## Voice\nv'
    expect(parseSkill(raw).skill!.meta.scriptVersion).toBeNull()
    expect(parseSkill(raw, { builtin: true }).skill!.meta.scriptVersion).toBe('abc/1')
  })

  it('a tools list expands to every channel, keeping only tools that can run there; unknown names stay everywhere', () => {
    const r = parseSkill('---\nname: x\ntools: [switchLanguage, addDetails, sendLink, mystery]\n---\n## Voice\nv')
    expect(r.skill!.meta.tools).toEqual({
      voice: ['switchLanguage', 'addDetails', 'sendLink', 'mystery'],
      whatsapp: ['addDetails', 'sendLink', 'mystery'],
      follow_up: ['sendLink', 'mystery'],
    })
  })

  it('a tools map is taken per channel as written', () => {
    const r = parseSkill('---\nname: x\ntools:\n  voice: [endCall]\n  whatsapp: [endCall]\n---\n## Voice\nv')
    expect(r.skill!.meta.tools.whatsapp).toEqual(['endCall'])
  })

  it('persona and tone, channels and default language', () => {
    const r = parseSkill('---\nname: x\ntone: warm, plain\npersona:\n  en: Asha\n  zz: Nobody\nchannels: [voice, follow_up]\nlanguages: [ta, en]\n---\n## Voice\nv')
    expect(r.skill!.meta).toMatchObject({ tone: 'warm, plain', persona: { en: 'Asha' }, channels: ['voice'], defaultLanguage: 'en' })
    expect(codes(r, 'warning')).toContain('unknown_persona_language')
    expect(parseSkill('---\nname: x\nlanguages: [ta, hi]\n---\n## Voice\nv').skill!.meta.defaultLanguage).toBe('ta')
  })

  it('reports bad values as errors and falls back to defaults', () => {
    const r = parseSkill(
      ['---', 'name: Bad Name', 'flow: three_call', 'channels: [voice, sms]', 'languages: [en, xx]', 'default_language: hi', 'tools:', '  email: [a]', 'limits:', '  max_agent_calls: 0', '  nope: 1', '  max_turns_per_day: 2.5', 'surprise: 1', '---', '## Voice', 'v'].join('\n')
    )
    const errors = codes(r, 'error')
    for (const c of ['bad_name', 'unknown_flow', 'unknown_channel', 'unknown_language', 'default_language_not_listed', 'unknown_tools_channel', 'bad_limit', 'unknown_limit']) expect(errors, c).toContain(c)
    expect(codes(r, 'warning')).toContain('unknown_key')
    expect(r.skill!.meta).toMatchObject({ name: 'bad-name', flow: 'one_call', languages: ['en'], limits: {} })
  })
})
