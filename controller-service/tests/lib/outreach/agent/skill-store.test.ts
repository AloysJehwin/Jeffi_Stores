import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ query: vi.fn(), recordEvent: vi.fn() }))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: h.query }) }))
vi.mock('@controller/lib/outreach/events', () => ({ recordEvent: h.recordEvent }))
vi.mock('@controller/lib/outreach/agent/catalog', async () => await import('./skill-fake-catalog'))

import { BUILTIN_SKILLS } from '@controller/lib/outreach/agent/skill/builtin'
import {
  SkillError,
  addSkillVersion,
  archiveSkill,
  builtinSkill,
  createSkill,
  getSkillDetail,
  getVersion,
  listSkills,
  loadRunSkill,
  resolveSkillForContact,
  updateSkill,
} from '@controller/lib/outreach/agent/skill/store'
import { SCRIPT_VERSION } from '@controller/lib/outreach/prompt'

const SKILL_ID = '11111111-1111-4111-8111-111111111111'
const VER_ID = '22222222-2222-4222-8222-222222222222'
const actor = { id: 'a1', label: 'admin:a1' }
const GOOD = `---\nname: demo\ntitle: Demo skill\ndescription: A test\ntools:\n  voice: [markOutcome]\n---\n## Voice\nHello {{business}}.\n`
const BAD = `---\nname: demo\ntools: [bogus]\n---\n## Voice\nv`

const summaryRow = (over: Record<string, unknown> = {}) => ({
  id: SKILL_ID,
  slug: 'demo',
  title: 'Demo skill',
  description: 'A test',
  current_version_id: VER_ID,
  archived_at: null,
  updated_at: new Date('2026-11-27T00:00:00Z'),
  current_version: 1,
  current_meta: { flow: 'one_call', channels: ['voice'], tools: { voice: ['markOutcome'], whatsapp: [], follow_up: ['sendLink'] } },
  list_count: 2,
  is_default: false,
  ...over,
})
const versionRow = (content = GOOD, over: Record<string, unknown> = {}) => ({ id: VER_ID, skill_id: SKILL_ID, version: 1, content, slug: 'demo', archived_at: null, created_at: new Date('2026-11-27T00:00:00Z'), ...over })

/** Routes each SQL statement to the first handler whose pattern matches. */
function sql(handlers: [RegExp, unknown | ((params: unknown[]) => unknown)][]) {
  h.query.mockImplementation(async (text: string, params: unknown[] = []) => {
    for (const [re, out] of handlers) {
      if (re.test(text)) {
        const rows = typeof out === 'function' ? (out as (p: unknown[]) => unknown)(params) : out
        return { rows: rows as unknown[], rowCount: (rows as unknown[]).length }
      }
    }
    return { rows: [], rowCount: 0 }
  })
}
const calls = (re: RegExp) => h.query.mock.calls.filter(c => re.test(c[0] as string))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('listSkills and getSkillDetail', () => {
  it('lists the flagship skills of a program and maps rows to summaries', async () => {
    sql([[/FROM outreach_skills s/, [summaryRow()]]])
    const out = await listSkills({ program: 'showcase-offer' })
    expect(out).toEqual([
      {
        id: SKILL_ID,
        slug: 'demo',
        title: 'Demo skill',
        description: 'A test',
        current_version_id: VER_ID,
        current_version: 1,
        flow: 'one_call',
        channels: ['voice', 'follow_up'],
        archived_at: null,
        updated_at: '2026-11-27T00:00:00.000Z',
        list_count: 2,
        is_default: false,
      },
    ])
    const [text, params] = h.query.mock.calls[0]
    expect(text).toContain('archived_at IS NULL')
    expect(text).toContain('tenant_id IS NOT DISTINCT FROM')
    expect(params).toEqual([null, 'showcase-offer'])
    await listSkills({ includeArchived: true })
    expect(h.query.mock.calls[1][0]).not.toContain('archived_at IS NULL')
  })

  it('detail returns the skill, its versions (newest first) and the lists using it; null when missing', async () => {
    sql([
      [/FROM outreach_skills s/, [summaryRow()]],
      [/FROM outreach_skill_versions WHERE skill_id/, [versionRow()]],
      [/FROM outreach_lists WHERE skill_id/, [{ id: 'l1', name: 'Madurai', pinned_version_id: null }]],
    ])
    const d = await getSkillDetail(SKILL_ID)
    expect(d!.skill.slug).toBe('demo')
    expect(d!.versions).toHaveLength(1)
    expect(d!.lists).toEqual([{ id: 'l1', name: 'Madurai', pinned_version_id: null }])
    sql([[/FROM outreach_skills s/, []]])
    expect(await getSkillDetail(SKILL_ID)).toBeNull()
  })

  it('getVersion', async () => {
    sql([[/FROM outreach_skill_versions WHERE id/, [versionRow()]]])
    expect((await getVersion(VER_ID))!.id).toBe(VER_ID)
    sql([])
    expect(await getVersion(VER_ID)).toBeNull()
  })
})

describe('createSkill', () => {
  it('validates first: an invalid skill is a 400 carrying the validation, and nothing is written', async () => {
    const e = await createSkill({ tenantId: null, program: 'showcase-offer', content: BAD, actor }).catch(x => x)
    expect(e).toBeInstanceOf(SkillError)
    expect(e.status).toBe(400)
    expect(e.validation.issues.some((i: { code: string }) => i.code === 'unknown_tool')).toBe(true)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('inserts the skill, version 1 with a sha256, makes it current and records the event', async () => {
    sql([
      [/INSERT INTO outreach_skills/, [{ id: SKILL_ID }]],
      [/INSERT INTO outreach_skill_versions/, [versionRow()]],
      [/FROM outreach_skills s/, [summaryRow()]],
    ])
    const out = await createSkill({ tenantId: null, program: 'showcase-offer', content: GOOD, actor })
    expect(out.skill.slug).toBe('demo')
    expect(out.validation.ok).toBe(true)
    expect(calls(/INSERT INTO outreach_skills/)[0][1]).toEqual([null, 'showcase-offer', 'demo', 'Demo skill', 'A test', 'a1'])
    const vp = calls(/INSERT INTO outreach_skill_versions/)[0][1] as unknown[]
    expect(vp[1]).toBe(GOOD)
    expect(vp[3]).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.parse(vp[4] as string).skill).toBeNull()
    expect(calls(/UPDATE outreach_skills SET current_version_id/)).toHaveLength(1)
    expect(h.recordEvent).toHaveBeenCalledWith(null, 'skill_created', expect.objectContaining({ actor: 'admin:a1', data: expect.objectContaining({ skillId: SKILL_ID, slug: 'demo', version: 1 }) }))
  })

  it('a taken slug is a 409', async () => {
    h.query.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }))
    const e = await createSkill({ tenantId: null, program: 'showcase-offer', content: GOOD, actor }).catch(x => x)
    expect(e).toMatchObject({ status: 409 })
    expect(e.message).toContain('demo')
  })

  it('other database errors pass through', async () => {
    h.query.mockRejectedValueOnce(new Error('boom'))
    await expect(createSkill({ tenantId: null, program: 'p', content: GOOD, actor })).rejects.toThrow('boom')
  })
})

describe('addSkillVersion', () => {
  it('404 for a missing skill, 409 for an archived one', async () => {
    sql([[/FROM outreach_skills s/, []]])
    await expect(addSkillVersion(SKILL_ID, GOOD, actor)).rejects.toMatchObject({ status: 404 })
    sql([[/FROM outreach_skills s/, [summaryRow({ archived_at: new Date() })]]])
    await expect(addSkillVersion(SKILL_ID, GOOD, actor)).rejects.toMatchObject({ status: 409 })
  })

  it('an invalid file is a 400 with the validation; a renamed file is refused', async () => {
    sql([[/FROM outreach_skills s/, [summaryRow()]]])
    await expect(addSkillVersion(SKILL_ID, BAD, actor)).rejects.toMatchObject({ status: 400, validation: expect.objectContaining({ ok: false }) })
    const e = await addSkillVersion(SKILL_ID, GOOD.replace('name: demo', 'name: other'), actor).catch(x => x)
    expect(e).toMatchObject({ status: 400 })
    expect(e.message).toContain('"demo"')
    expect(calls(/INSERT INTO outreach_skill_versions/)).toHaveLength(0)
  })

  it('inserts the next version, makes it current, refreshes title and description, records the event', async () => {
    sql([
      [/FROM outreach_skills s/, [summaryRow()]],
      [/INSERT INTO outreach_skill_versions/, [versionRow(GOOD, { version: 3, id: '33333333-3333-4333-8333-333333333333' })]],
    ])
    const out = await addSkillVersion(SKILL_ID, GOOD, actor)
    expect(out.version.version).toBe(3)
    expect(calls(/INSERT INTO outreach_skill_versions/)[0][0]).toContain('COALESCE(MAX(version), 0) + 1')
    const up = calls(/UPDATE outreach_skills SET current_version_id/)[0]
    expect(up[1]).toEqual([SKILL_ID, '33333333-3333-4333-8333-333333333333', 'Demo skill', 'A test'])
    expect(h.recordEvent).toHaveBeenCalledWith(null, 'skill_version_added', expect.objectContaining({ data: expect.objectContaining({ version: 3 }) }))
  })
})

describe('updateSkill and archiveSkill', () => {
  it('404 when missing; refuses a version of another skill', async () => {
    sql([[/FROM outreach_skills s/, []]])
    await expect(updateSkill(SKILL_ID, { title: 'x' }, actor)).rejects.toMatchObject({ status: 404 })
    sql([[/FROM outreach_skills s/, [summaryRow()]], [/FROM outreach_skill_versions WHERE id/, []]])
    await expect(updateSkill(SKILL_ID, { current_version_id: VER_ID }, actor)).rejects.toMatchObject({ status: 400 })
  })

  it('sets the title and the current version, with an event only for the version', async () => {
    sql([[/FROM outreach_skills s/, [summaryRow()]], [/FROM outreach_skill_versions WHERE id/, [{ id: VER_ID, version: 1 }]]])
    await updateSkill(SKILL_ID, { title: 'New', description: null, current_version_id: VER_ID }, actor)
    const up = calls(/^UPDATE outreach_skills SET title/)[0]
    expect(up[0]).toContain('title = $2, description = $3, current_version_id = $4')
    expect(up[1]).toEqual([SKILL_ID, 'New', null, VER_ID])
    expect(h.recordEvent).toHaveBeenCalledWith(null, 'skill_current_set', expect.anything())
    h.recordEvent.mockClear()
    await updateSkill(SKILL_ID, { title: 'Only title' }, actor)
    expect(h.recordEvent).not.toHaveBeenCalled()
  })

  it('an empty patch writes nothing', async () => {
    sql([[/FROM outreach_skills s/, [summaryRow()]]])
    await updateSkill(SKILL_ID, {}, actor)
    expect(calls(/^UPDATE/)).toHaveLength(0)
  })

  it('archive sets archived_at, clears a program default and records the event; archiving twice is a no-op', async () => {
    sql([[/FROM outreach_skills s/, [summaryRow()]]])
    await archiveSkill(SKILL_ID, actor)
    expect(calls(/SET archived_at = now\(\)/)).toHaveLength(1)
    expect(calls(/SET default_skill_id = NULL/)).toHaveLength(1)
    expect(h.recordEvent).toHaveBeenCalledWith(null, 'skill_archived', expect.anything())
    h.query.mockClear()
    h.recordEvent.mockClear()
    sql([[/FROM outreach_skills s/, [summaryRow({ archived_at: new Date() })]]])
    await archiveSkill(SKILL_ID, actor)
    expect(calls(/^UPDATE/)).toHaveLength(0)
    expect(h.recordEvent).not.toHaveBeenCalled()
    sql([[/FROM outreach_skills s/, []]])
    await expect(archiveSkill(SKILL_ID, actor)).rejects.toMatchObject({ status: 404 })
  })
})

describe('builtinSkill', () => {
  it('the default carries the script version as its ref; the others are slug@builtin; unknown slugs fall back to the default', () => {
    const d = builtinSkill()
    expect(d).toMatchObject({ skillId: null, versionId: null, slug: 'showcase-offer', ref: SCRIPT_VERSION, builtin: true })
    expect(builtinSkill('showcase-two-call')).toMatchObject({ slug: 'showcase-two-call', ref: 'showcase-two-call@builtin', builtin: true })
    expect(builtinSkill('nope').slug).toBe('showcase-offer')
    expect(builtinSkill('showcase-offer')).toBe(d)
  })
})

describe('resolveSkillForContact', () => {
  const contact = { list_id: 'l1', program: 'showcase-offer' }
  const list = (l: Record<string, unknown> | null) => [/FROM outreach_lists WHERE id/, l ? [l] : []] as [RegExp, unknown]
  const byVersion = (row: unknown) => [/WHERE v\.id = \$1/, row ? [row] : []] as [RegExp, unknown]
  const bySkill = (row: unknown) => [/WHERE s\.id = \$1 AND v\.id = s\.current_version_id/, row ? [row] : []] as [RegExp, unknown]
  const program = (id: string | null) => [/FROM outreach_program_state/, [{ default_skill_id: id }]] as [RegExp, unknown]

  it('the list\'s pinned version wins', async () => {
    sql([list({ skill_id: SKILL_ID, skill_version_id: VER_ID }), byVersion(versionRow(GOOD, { version: 2 })), bySkill(null), program(null)])
    const r = await resolveSkillForContact(contact)
    expect(r).toMatchObject({ skillId: SKILL_ID, versionId: VER_ID, version: 2, slug: 'demo', ref: 'demo@v2', builtin: false })
    expect(r.skill.meta.name).toBe('demo')
  })

  it('then the list\'s skill current version, then the program default, then the builtin', async () => {
    sql([list({ skill_id: SKILL_ID, skill_version_id: null }), bySkill(versionRow()), program(null)])
    expect((await resolveSkillForContact(contact)).ref).toBe('demo@v1')
    sql([list({ skill_id: null, skill_version_id: null }), bySkill(versionRow(GOOD, { version: 4 })), program('44444444-4444-4444-8444-444444444444')])
    expect((await resolveSkillForContact(contact)).ref).toBe('demo@v4')
    sql([list({ skill_id: null, skill_version_id: null }), program(null)])
    expect((await resolveSkillForContact(contact)).builtin).toBe(true)
    sql([program(null)])
    expect((await resolveSkillForContact({ list_id: null, program: 'showcase-offer' })).ref).toBe(SCRIPT_VERSION)
  })

  it('archived skills and versions that no longer validate are skipped, with a warning', async () => {
    sql([list({ skill_id: SKILL_ID, skill_version_id: VER_ID }), byVersion(versionRow(GOOD, { archived_at: new Date() })), bySkill(versionRow(BAD)), program(null)])
    const r = await resolveSkillForContact(contact)
    expect(r.builtin).toBe(true)
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('loadRunSkill', () => {
  it('a pinned run loads its version, even when its skill was archived since', async () => {
    sql([[/WHERE v\.id = \$1/, [versionRow(GOOD, { version: 2, archived_at: new Date() })]]])
    const r = await loadRunSkill({ skill_version_id: VER_ID, skill_ref: 'demo@v2' })
    expect(r).toMatchObject({ versionId: VER_ID, ref: 'demo@v2', builtin: false })
  })

  it('a run with no version id maps its ref back to the builtin', async () => {
    expect((await loadRunSkill({ skill_version_id: null, skill_ref: SCRIPT_VERSION })).slug).toBe('showcase-offer')
    expect((await loadRunSkill({ skill_version_id: null, skill_ref: 'showcase-two-call@builtin' })).slug).toBe('showcase-two-call')
    expect((await loadRunSkill({ skill_version_id: null, skill_ref: 'gone@v3' })).slug).toBe('showcase-offer')
    expect(h.query).not.toHaveBeenCalled()
  })

  it('a pinned version that is gone falls back to the builtin named by the ref', async () => {
    sql([[/WHERE v\.id = \$1/, []]])
    expect((await loadRunSkill({ skill_version_id: VER_ID, skill_ref: 'showcase-offer/2026-11-24.1' })).builtin).toBe(true)
  })

  it('every builtin round-trips through its ref', async () => {
    for (const b of BUILTIN_SKILLS) {
      const r = builtinSkill(b.slug)
      expect((await loadRunSkill({ skill_version_id: null, skill_ref: r.ref })).slug).toBe(b.slug)
    }
  })
})
