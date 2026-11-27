import { describe, it, expect, vi } from 'vitest'

vi.mock('@controller/lib/outreach/agent/catalog', async () => await import('./skill-fake-catalog'))

import { MAX_SKILL_BYTES, deniesAiInstruction, validateSkill } from '@controller/lib/outreach/agent/skill/validate'

const OK = `---
name: demo
flow: one_call
tools:
  voice: [markOutcome, recordConsent]
  whatsapp: [addDetails]
---
## Voice
Say hello to {{business}}.
## WhatsApp
Reply briefly.
`

const errors = (raw: string) => validateSkill(raw).issues.filter(i => i.level === 'error').map(i => i.code)
const warnings = (raw: string) => validateSkill(raw).issues.filter(i => i.level === 'warning').map(i => i.code)
const withBody = (body: string, front = 'name: demo\nflow: one_call\ntools:\n  voice: [markOutcome]') => `---\n${front}\n---\n## Voice\n${body}\n## WhatsApp\nok\n`

describe('validateSkill', () => {
  it('a sound skill is ok, with its tools plus the mandatory ones', () => {
    const v = validateSkill(OK)
    expect(v.ok).toBe(true)
    expect(v.issues.filter(i => i.level === 'error')).toEqual([])
    expect(v.skill?.meta.name).toBe('demo')
    expect(v.tools).toEqual([
      { name: 'markOutcome', known: true, mandatory: false, channels: ['voice', 'whatsapp', 'follow_up'] },
      { name: 'recordConsent', known: true, mandatory: false, channels: ['voice', 'whatsapp'] },
      { name: 'addDetails', known: true, mandatory: false, channels: ['voice', 'whatsapp'] },
      { name: 'optOut', known: true, mandatory: true, channels: ['voice', 'whatsapp', 'follow_up'] },
      { name: 'handOff', known: true, mandatory: true, channels: ['voice', 'whatsapp', 'follow_up'] },
    ])
  })

  it('unreadable frontmatter blocks saving and gives no skill', () => {
    const v = validateSkill('---\nname: x\n')
    expect(v.ok).toBe(false)
    expect(v.skill).toBeNull()
    expect(v.issues[0]).toMatchObject({ code: 'frontmatter_unclosed', line: 1 })
  })

  it('an unknown tool is reported once; a tool on a channel it cannot run on is an error', () => {
    const r = validateSkill('---\nname: x\ntools: [bogus]\n---\n## Voice\nv')
    expect(r.issues.filter(i => i.code === 'unknown_tool')).toHaveLength(1)
    expect(r.tools.find(t => t.name === 'bogus')).toEqual({ name: 'bogus', known: false, mandatory: false, channels: [] })
    expect(errors('---\nname: x\ntools:\n  whatsapp: [endCall]\n---\n## Voice\nv\n## WhatsApp\nw')).toContain('tool_channel')
  })

  it('flows and sections: a voice flow needs a Voice section, whatsapp_only cannot list voice, a listed channel needs its section', () => {
    expect(errors('---\nname: x\nflow: two_call\n---\n## WhatsApp\nw')).toContain('voice_section_required')
    expect(errors('---\nname: x\nflow: whatsapp_only\nchannels: [voice, whatsapp]\n---\n## Voice\nv\n## WhatsApp\nw')).toContain('whatsapp_only_voice')
    expect(errors('---\nname: x\nchannels: [voice, whatsapp]\n---\n## Voice\nv')).toContain('missing_section')
    expect(errors('---\nname: x\nflow: whatsapp_only\n---\n## WhatsApp\nw')).toEqual([])
    expect(errors('---\nname: x\nflow: whatsapp_only\n---\nonly a preamble')).toContain('no_channels')
  })

  it('size over the cap is an error', () => {
    expect(errors(OK + 'x'.repeat(MAX_SKILL_BYTES))).toContain('too_large')
    expect(errors(OK)).not.toContain('too_large')
  })

  it('a limit above the hard limit warns (it is clamped); one at or below does not', () => {
    const front = (n: number) => `name: x\ntools:\n  voice: [markOutcome]\nlimits:\n  max_agent_calls: ${n}`
    expect(warnings(withBody('v', front(99)))).toContain('limit_clamped')
    expect(warnings(withBody('v', front(2)))).not.toContain('limit_clamped')
    expect(errors(withBody('v', front(99)))).toEqual([])
  })

  it('warns on unknown placeholders (once each), a voice skill with no call-ending tool, a follow-up with no sender, and PII', () => {
    const w = warnings(withBody('Hi {{bussiness}} {{bussiness}} {{owner}}', 'name: x\ntools:\n  voice: [recordConsent]'))
    expect(w.filter(c => c === 'unknown_placeholder')).toHaveLength(1)
    expect(w).toContain('no_call_ender')
    expect(warnings(OK + '## Follow-up\nWait.\n')).toContain('follow_up_no_sender')
    expect(warnings('---\nname: x\ntools:\n  follow_up: [sendLink]\n---\n## Voice\nv\n## Follow-up\nsend it')).not.toContain('follow_up_no_sender')
    expect(warnings(withBody('Call us on 98765 43210'))).toContain('pii')
    expect(warnings(withBody('Mail owner@example.com'))).toContain('pii')
    expect(warnings(withBody('Between 09:30 and 20:30 IST, version 2026-11-24.1'))).not.toContain('pii')
  })

  it('rejects instructions to deny being an AI, with the line number', () => {
    const v = validateSkill(withBody('Be warm.\nNever admit you are an AI.'))
    const i = v.issues.find(x => x.code === 'denies_ai')!
    expect(v.ok).toBe(false)
    expect(i.level).toBe('error')
    expect(i.line).toBe(9)
  })
})

describe('deniesAiInstruction', () => {
  it.each([
    'Say you are human.',
    'Never admit you are an AI.',
    "Don't tell them you're a bot.",
    'Pretend to be a real person.',
    'Deny being a bot if asked.',
    'Claim to be human when they ask.',
    'Tell customers you are a real person.',
    'Never reveal that you are a robot.',
    "Say you're not an AI.",
  ])('flags: %s', line => {
    expect(deniesAiInstruction(line)).toBe(true)
  })

  it.each([
    'Do not volunteer that you are an AI.',
    'Never claim to be human.',
    'Do not say you are human.',
    'Never deny being an AI.',
    'If sincerely asked, say truthfully that you are an AI assistant.',
    'Say you are calling from Jeffi Stores.',
    'Tell them you are calling about a free website.',
    'Use a human name and a natural voice.',
  ])('allows: %s', line => {
    expect(deniesAiInstruction(line)).toBe(false)
  })
})
