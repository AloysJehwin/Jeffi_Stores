import { describe, it, expect, vi } from 'vitest'

vi.mock('@controller/lib/outreach/agent/catalog', async () => await import('./skill-fake-catalog'))

import { BUILTIN_SKILLS, DEFAULT_SKILL_SLUG } from '@controller/lib/outreach/agent/skill/builtin'
import { parseSkill } from '@controller/lib/outreach/agent/skill/parse'
import { validateSkill } from '@controller/lib/outreach/agent/skill/validate'
import { PERSONA_NAMES, SCRIPT_VERSION } from '@controller/lib/outreach/prompt'
import { LANGUAGES } from '@controller/lib/outreach/types'

const get = (slug: string) => BUILTIN_SKILLS.find(b => b.slug === slug)!

describe('builtin skills', () => {
  it('ships the default and two templates', () => {
    expect(DEFAULT_SKILL_SLUG).toBe('showcase-offer')
    expect(BUILTIN_SKILLS.map(b => b.slug)).toEqual(['showcase-offer', 'showcase-two-call', 'showcase-whatsapp-only'])
  })

  it.each(BUILTIN_SKILLS.map(b => [b.slug, b] as const))('%s validates with no errors, and its listing matches its frontmatter', (_slug, b) => {
    const v = validateSkill(b.content, { builtin: true })
    expect(v.issues.filter(i => i.level === 'error')).toEqual([])
    expect(v.ok).toBe(true)
    expect(v.skill!.meta).toMatchObject({ name: b.slug, title: b.title, description: b.description })
    expect(v.tools.every(t => t.known)).toBe(true)
    // no backticks or template residue in the Markdown
    expect(b.content).not.toMatch(/`|\$\{/)
  })

  it('the default is today\'s flow: one call, 9 voice tools, 3 WhatsApp tools, no follow-up, the code personas and script version', () => {
    const s = parseSkill(get('showcase-offer').content, { builtin: true }).skill!
    expect(s.meta.flow).toBe('one_call')
    expect(s.meta.channels).toEqual(['voice', 'whatsapp'])
    expect(s.meta.languages).toEqual([...LANGUAGES])
    expect(s.meta.persona).toEqual(PERSONA_NAMES)
    expect(s.meta.scriptVersion).toBe(SCRIPT_VERSION)
    expect(s.meta.tools.voice).toEqual(['recordConsent', 'startPreview', 'addDetails', 'requestChange', 'publishSite', 'scheduleCallback', 'markOutcome', 'optOut', 'switchLanguage'])
    expect(s.meta.tools.whatsapp).toEqual(['addDetails', 'requestChange', 'optOut'])
    expect(s.meta.tools.follow_up).toEqual([])
    expect(s.sections.follow_up).toBeUndefined()
    expect(s.preamble).toBe('')
  })

  it('the two-call template books a second call, has a follow-up and caps agent calls at 2', () => {
    const v = validateSkill(get('showcase-two-call').content, { builtin: true })
    const s = v.skill!
    expect(s.meta.flow).toBe('two_call')
    expect(s.meta.limits).toEqual({ maxAgentCalls: 2 })
    expect(s.sections.voice).toContain('scheduleCallback')
    expect(s.sections.follow_up).toContain('details_needed')
    expect(s.meta.scriptVersion).toBeNull()
    expect(v.issues.filter(i => i.level === 'warning').map(i => i.code)).not.toContain('limit_clamped')
  })

  it('the WhatsApp-only template has no voice and a kickoff follow-up that starts the preview', () => {
    const s = parseSkill(get('showcase-whatsapp-only').content, { builtin: true }).skill!
    expect(s.meta.flow).toBe('whatsapp_only')
    expect(s.meta.channels).toEqual(['whatsapp'])
    expect(s.sections.voice).toBeUndefined()
    expect(s.meta.tools.follow_up).toContain('startPreview')
    expect(s.sections.follow_up).toContain('startPreview')
    expect(s.sections.whatsapp).toContain('publishSite')
  })
})
