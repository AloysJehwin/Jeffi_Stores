// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { briefHash, businessWith, mergeBriefs, missingOf, readBrief, readyToBuild, siteLanguage, studioAnswersOf } from '@controller/lib/outreach/build/brief'
import { finishRun, isRunning, MAX_BUILDS, planRun, readBuild, RUN_STALE_MS, type BuildState } from '@controller/lib/outreach/build/state'
import { namesColourOrLook, pickTheme, wornTheme, directionOf } from '@controller/lib/outreach/build/sketch'
import { routeByWords } from '@controller/lib/outreach/build/change'
import { templateReady } from '@/lib/site/themes/pages'

// The build's pure parts: the progressive brief, the one-run-plus-one-queued rule, the sketch's theme pick, and
// routing a spoken change to a section when the AI can't.

describe('the progressive brief', () => {
  it('merges: values replace, highlights and changes add up, contact merges per channel', () => {
    const a = mergeBriefs({}, { whatTheyDo: '  Wedding   photography ', highlights: ['Candid shots'], contact: { phone: '98400 12345' } })
    const b = mergeBriefs(a, { audience: 'Couples in Chennai', highlights: ['candid shots', 'Drone video'], contact: { email: 'Hi@Lens.IN' }, whatTheyDo: '' })
    expect(b).toEqual({
      whatTheyDo: 'Wedding photography',
      audience: 'Couples in Chennai',
      highlights: ['Candid shots', 'Drone video'],
      contact: { phone: '98400 12345', email: 'hi@lens.in' },
    })
    expect(readBrief({ brief: b, other: 1 })).toEqual(b)
    expect(readBrief({ brief: 'junk' })).toEqual({})
  })

  it('says what is missing in the order the caller asks, and when the full design can start', () => {
    expect(missingOf({})).toEqual(['whatTheyDo', 'audience', 'highlights', 'contact', 'hours', 'address', 'style'])
    expect(missingOf({ whatTheyDo: 'x', contact: { email: 'a@b.in' }, hours: '9-6' })).toEqual(['audience', 'highlights', 'address', 'style'])
    expect(readyToBuild({ whatTheyDo: 'Bakery' })).toBe(false)
    expect(readyToBuild({ whatTheyDo: 'Bakery', highlights: ['Eggless cakes'] })).toBe(true)
    expect(readyToBuild({ whatTheyDo: 'Bakery', audience: 'Families' })).toBe(true)
  })

  it('rebuilds only for what the design depends on, not details shown live', () => {
    const base = { whatTheyDo: 'Bakery', audience: 'Families' }
    expect(briefHash({ ...base, hours: '9-9', contact: { phone: '1' }, address: 'MG Road' })).toBe(briefHash(base))
    expect(briefHash({ ...base, highlights: ['Eggless'] })).not.toBe(briefHash(base))
    expect(briefHash({ ...base, changes: ['bigger photos'] })).not.toBe(briefHash(base))
  })

  it('fills the sketch details and the studio answers from it', () => {
    const biz = businessWith(
      { name: 'Lens & Light', profession: 'Photographer' },
      { whatTheyDo: 'Wedding and pre-wedding photography across Tamil Nadu. We also do events.', contact: { phone: '9840012345', whatsapp: '9840012345', email: 'x' }, hours: 'Mon-Sat 10-7', address: '12 Anna Salai' }
    )
    expect(biz).toMatchObject({ name: 'Lens & Light', profession: 'Photographer', tagline: 'Wedding and pre-wedding photography across Tamil Nadu', phone: '9840012345', whatsapp: '919840012345', hours: 'Mon-Sat 10-7', address: '12 Anna Salai' })
    expect(biz.email).toBeUndefined()
    const answers = studioAnswersOf({ whatTheyDo: 'Bakery', audience: 'Families', style: 'warm', highlights: ['Eggless cakes'], changes: ['more photos'], language: 'hi' })
    expect(answers).toMatchObject({ sell: 'Bakery', audience: 'Families', mood: 'warm' })
    expect(answers.notes).toContain('Eggless cakes')
    expect(answers.notes).toContain('more photos')
    expect(answers.notes).toContain('in Hindi')
    expect([siteLanguage({ language: 'en' }), siteLanguage({}), siteLanguage({ language: 'Tamil' }), siteLanguage({ language: 'ta' })]).toEqual([null, null, 'Tamil', 'Tamil'])
  })
})

describe('one generation at a time, one follow-up queued', () => {
  const NOW = Date.parse('2026-11-24T10:00:00Z')
  const idle: BuildState = { state: 'idle', builds: 0 }

  it('starts, then queues one follow-up for a changed brief, then nothing more', () => {
    const s = planRun(idle, 'h1', NOW)
    expect(s.action).toBe('start')
    expect(s.next).toMatchObject({ state: 'running', builds: 1, hash: 'h1', queued: false })
    expect(isRunning(s.next, NOW + 1000)).toBe(true)
    expect(planRun(s.next, 'h1', NOW).action).toBe('none')
    const q = planRun(s.next, 'h2', NOW)
    expect(q).toMatchObject({ action: 'queue', next: { queued: true, builds: 1 } })
    expect(planRun(q.next, 'h3', NOW).action).toBe('none')
  })

  it('runs the queued follow-up from the latest brief when the first ends, then settles', () => {
    const run = planRun(idle, 'h1', NOW).next
    const f = finishRun({ ...run, queued: true }, run.runId!, { ok: true, ms: 90_000 }, 'h3', NOW + 90_000)!
    expect(f.again).toBe(true)
    expect(f.next).toMatchObject({ state: 'running', builds: 2, hash: 'h3', queued: false, builtAt: new Date(NOW + 90_000).toISOString() })
    const g = finishRun(f.next, run.runId!, { ok: false, ms: 1000, error: 'AI down' }, 'h3', NOW + 200_000)!
    expect(g).toMatchObject({ again: false, next: { state: 'failed', error: 'AI down', builtAt: new Date(NOW + 90_000).toISOString() } })
    expect(finishRun(g.next, 'someone-else', { ok: true, ms: 1 }, 'h3')).toBeNull()
  })

  it('tries a failed or dead run again, but never past the cap', () => {
    const failed: BuildState = { state: 'failed', builds: 1, hash: 'h1', runId: 'r' }
    expect(planRun(failed, 'h1', NOW).action).toBe('start')
    const dead: BuildState = { state: 'running', builds: 1, hash: 'h1', runId: 'r', startedAt: new Date(NOW - RUN_STALE_MS - 1).toISOString() }
    expect(planRun(dead, 'h1', NOW).action).toBe('start')
    expect(planRun({ ...failed, builds: MAX_BUILDS }, 'h2', NOW).action).toBe('none')
    expect(readBuild({ build: { state: 'weird', builds: '2' } })).toEqual({ state: 'idle', builds: 2 })
  })
})

describe('the sketch theme', () => {
  it('picks a look and colour from the owner’s words, else keeps what is worn', () => {
    expect(pickTheme('bold and orange', 'c1')).toBe('brutalist.safety-orange')
    // A look whose Showcase template isn't made yet falls back to one that is.
    expect(pickTheme('modern, blue', 'c1')).toBe(templateReady('glass', 'showcase') ? 'glass.lagoon' : 'minimalist.ocean')
    expect(pickTheme('something green', 'c1', 'minimalist.ocean')).toBe('minimalist.sage')
    expect(pickTheme('', 'c1', 'brutalist.acid')).toBe('brutalist.acid')
    expect(pickTheme(undefined, 'c1')).toMatch(/^minimalist\./)
    expect(pickTheme(undefined, 'c1')).toBe(pickTheme(undefined, 'c1'))
    expect(wornTheme(directionOf('glass.mint'))).toBe('glass.mint')
    expect(wornTheme({ id: 'ai-direction' })).toBeNull()
    expect([namesColourOrLook('make it pink'), namesColourOrLook('add our timings')]).toEqual([true, false])
  })
})

describe('routing a change without the AI', () => {
  const sections = [
    { id: 'a', label: 'Header' },
    { id: 'b', label: 'Opening' },
    { id: 'c', label: 'Our services' },
    { id: 'd', label: 'Get in touch' },
    { id: 'e', label: 'Footer' },
  ]
  it('finds the section the owner means, a colour change, or the whole page', () => {
    expect(routeByWords(sections, 'change the headline to Fresh every morning')).toEqual({ target: 'section', id: 'b', label: 'Opening' })
    expect(routeByWords(sections, 'add a price to the services')).toEqual({ target: 'section', id: 'c', label: 'Our services' })
    expect(routeByWords(sections, 'put the enquiry form higher')).toEqual({ target: 'section', id: 'd', label: 'Get in touch' })
    expect(routeByWords(sections, 'make it blue')).toEqual({ target: 'colours' })
    expect(routeByWords(sections, 'it feels too busy')).toEqual({ target: 'page' })
  })
})
