import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement('a', { href, ...rest }, children) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))

import OutreachSkillsClient from '@controller/app/(admin)/admin/ecom/outreach/OutreachSkillsClient'
import OutreachListsClient from '@controller/app/(admin)/admin/ecom/outreach/OutreachListsClient'
import OutreachProgramClient from '@controller/app/(admin)/admin/ecom/outreach/OutreachProgramClient'
import ContactDetailClient from '@controller/app/(admin)/admin/ecom/outreach/ContactDetailClient'
import { TABS } from '@controller/app/(admin)/admin/ecom/outreach/shared'

const calls: { url: string; init?: RequestInit }[] = []
let routes: Record<string, (init?: RequestInit) => unknown> = {}

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const key = Object.keys(routes).find(k => `${init?.method ?? 'GET'} ${url}`.startsWith(k))
      const body = key ? routes[key](init) : { error: 'no route' }
      const ok = !(body && typeof body === 'object' && 'error' in (body as object))
      return { ok, json: async () => body } as Response
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const B = '/api/admin/ecom/outreach'
const skill = (o: object = {}) => ({
  id: 's1', slug: 'showcase-offer', title: 'Showcase offer', description: null, current_version_id: 'v2', current_version: 2, flow: 'one_call', channels: ['voice', 'whatsapp'],
  archived_at: null, updated_at: '2026-11-26T10:00:00Z', list_count: 1, is_default: true, ...o,
})
const meta = { name: 'new-skill', title: 'New skill', description: null, flow: 'one_call', channels: ['voice'], languages: ['en'], defaultLanguage: 'en', persona: {}, tone: 'warm', tools: { voice: ['getLead', 'bogus'], whatsapp: [], follow_up: [] }, limits: {}, scriptVersion: null }
const okValidation = { ok: true, issues: [{ level: 'warning', code: 'w', message: 'No Follow-up section' }], skill: { meta, preamble: '', sections: {}, raw: '' }, tools: [{ name: 'getLead', known: true, mandatory: true, channels: ['voice'] }, { name: 'bogus', known: false, mandatory: false, channels: [] }] }
const badValidation = { ok: false, issues: [{ level: 'error', code: 'name', message: 'name is required', line: 2 }], skill: null, tools: [] }
const listing = { skills: [skill(), skill({ id: 's2', slug: 'old', title: 'Old pitch', archived_at: '2026-11-01T00:00:00Z', is_default: false, list_count: 0 })], builtins: [{ slug: 'showcase-offer', title: 'Showcase offer', description: 'The default pitch', content: '---\nname: showcase-offer\n---\nhello' }], defaultSkillId: 's1' }
const version = (n: number, id: string) => ({ id, skill_id: 's1', version: n, content: `body v${n}`, meta, sha256: 'abcdef0123456789', validation: { ok: true, issues: [] }, source: 'upload', created_by: null, created_at: '2026-11-26T10:00:00Z' })

const typeContent = (v: string) => fireEvent.change(screen.getByLabelText('Agent content'), { target: { value: v } })

describe('tabs', () => {
  it('lists the Skills tab', () => {
    expect(TABS.map(t => t.id)).toContain('skills')
  })
})

describe('OutreachSkillsClient', () => {
  it('renders the list with default badge and hides archived ones behind the toggle', async () => {
    routes = { [`GET ${B}/skills`]: () => listing }
    render(<OutreachSkillsClient />)
    expect(await screen.findByText('Showcase offer', { selector: 'span' })).toBeTruthy()
    expect(screen.getByText('Default')).toBeTruthy()
    expect(screen.getByText(/· v2 ·/)).toBeTruthy()
    expect(screen.queryByText('Old pitch')).toBeNull()
    fireEvent.click(screen.getByLabelText(/Show archived/))
    expect(screen.getByText('Old pitch')).toBeTruthy()
  })

  it('disables Save on errors, then saves the pasted content', async () => {
    routes = {
      [`POST ${B}/skills/validate`]: init => ({ validation: String(JSON.parse(init!.body as string).content).includes('bad') ? badValidation : okValidation }),
      [`POST ${B}/skills`]: () => ({ skill: skill({ id: 's9', title: 'New skill' }), version: version(1, 'v9'), validation: okValidation }),
      [`GET ${B}/skills/s9`]: () => ({ skill: skill({ id: 's9', slug: 'new-skill', title: 'New skill', is_default: false }), versions: [version(1, 'v9')], lists: [] }),
      [`GET ${B}/skills`]: () => listing,
    }
    render(<OutreachSkillsClient />)
    fireEvent.click(await screen.findByRole('button', { name: 'New agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start blank' }))
    const save = () => screen.getByRole('button', { name: 'Create agent' }) as HTMLButtonElement

    typeContent('bad file')
    expect(await screen.findByText(/name is required/, undefined, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByText(/line 2/)).toBeTruthy()
    expect(save().disabled).toBe(true)

    typeContent('---\nname: new-skill\n---')
    expect(await screen.findByText('Valid', undefined, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByText('bogus (unknown)')).toBeTruthy()
    expect(screen.getByText(/No Follow-up section/)).toBeTruthy()
    await waitFor(() => expect(save().disabled).toBe(false))

    fireEvent.click(save())
    expect(await screen.findByRole('button', { name: 'Upload new version' })).toBeTruthy()
    const post = calls.find(c => c.init?.method === 'POST' && c.url === `${B}/skills`)!
    expect(JSON.parse(post.init!.body as string)).toEqual({ content: '---\nname: new-skill\n---' })
  })

  it('fills the editor from a template', async () => {
    routes = { [`GET ${B}/skills`]: () => listing }
    render(<OutreachSkillsClient />)
    fireEvent.click(await screen.findByRole('button', { name: 'New agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use Showcase offer as a starting point' }))
    expect((screen.getByLabelText('Agent content') as HTMLTextAreaElement).value).toContain('name: showcase-offer')
  })

  it('makes an older version current', async () => {
    routes = {
      [`PATCH ${B}/skills/s1`]: () => ({ skill: skill() }),
      [`GET ${B}/skills/s1`]: () => ({ skill: skill(), versions: [version(2, 'v2'), version(1, 'v1')], lists: [{ id: 'l1', name: 'Pune', pinned_version_id: null }] }),
      [`GET ${B}/skills`]: () => listing,
    }
    render(<OutreachSkillsClient />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Showcase offer' }))
    expect(await screen.findByText('Follows current')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Make v1 current' }))
    await waitFor(() => expect(calls.some(c => c.init?.method === 'PATCH')).toBe(true))
    expect(JSON.parse(calls.find(c => c.init?.method === 'PATCH')!.init!.body as string)).toEqual({ current_version_id: 'v1' })
  })
})

describe('Lists and Program skill selects', () => {
  it('sets a list skill', async () => {
    routes = {
      [`GET ${B}/lists`]: () => ({ lists: [{ id: 'l1', name: 'Pune', source: 'file', row_count: 4, last_synced_at: null, created_at: '', skill_id: null, skill_version_id: null, skill_title: null }] }),
      [`PATCH ${B}/lists/l1`]: () => ({ list: { id: 'l1', skill_id: 's1', skill_version_id: null } }),
      [`GET ${B}/skills`]: () => listing,
    }
    render(<OutreachListsClient />)
    await screen.findByText('Pune')
    await screen.findByRole('option', { name: 'Showcase offer' })
    fireEvent.change(screen.getByLabelText('Agent for Pune'), { target: { value: 's1' } })
    await waitFor(() => expect(calls.some(c => c.init?.method === 'PATCH')).toBe(true))
    expect(JSON.parse(calls.find(c => c.init?.method === 'PATCH')!.init!.body as string)).toEqual({ skill_id: 's1', skill_version_id: null })
    expect(await screen.findByLabelText('Pin version for Pune')).toBeTruthy()
  })

  it('saves the program default skill', async () => {
    const state = { program: 'showcase-offer', enabled: false, daily_cap: 1, concurrency: 1, window_start: '09:30', window_end: '20:30', test_numbers: [], default_skill_id: null, updated_at: '', updated_by: null }
    routes = {
      [`GET ${B}/program`]: () => ({ program: { key: 'showcase-offer', title: 'Showcase offer' }, state, counts: {} }),
      [`PATCH ${B}/program`]: () => ({ state: { ...state, default_skill_id: 's1' } }),
      [`GET ${B}/skills`]: () => listing,
    }
    render(<OutreachProgramClient />)
    await screen.findByRole('option', { name: 'Showcase offer' })
    fireEvent.change(screen.getByLabelText('Default agent'), { target: { value: 's1' } })
    await waitFor(() => expect(calls.some(c => c.init?.method === 'PATCH')).toBe(true))
    expect(JSON.parse(calls.find(c => c.init?.method === 'PATCH')!.init!.body as string)).toEqual({ default_skill_id: 's1' })
  })
})

describe('Contact agent card', () => {
  const contact = { id: 'c1', phone: '+919876543210', business_name: 'Acme Sweets', status: 'interested', attempts: 0, dnd_status: 'clear', language: 'hi', handoff_at: null, handoff_reason: null, claim_token_hash: null, claimed_owner_id: null }
  const run = { id: 'r1', contact_id: 'c1', skill_ref: 'showcase-offer@v2', status: 'active', turns: 3, spend_paise: 1250, last_channel: 'whatsapp', last_turn_at: '2026-11-26T10:00:00Z', started_at: '2026-11-25T10:00:00Z' }
  const task = { id: 't1', kind: 'whatsapp_turn', due_at: '2026-11-28T10:00:00Z', status: 'pending', reason: 'asked to wait', instruction: 'x'.repeat(120), attempts: 0 }

  it('shows the run and tasks, hands off with a reason and resumes', async () => {
    routes = {
      [`GET ${B}/contacts/c1`]: () => ({ contact, calls: [], messages: [], events: [], agent: { run, tasks: [task] } }),
      [`PATCH ${B}/contacts/c1`]: init =>
        JSON.parse(init!.body as string).action === 'handoff'
          ? { contact: { ...contact, handoff_at: '2026-11-26T11:00:00Z', handoff_reason: 'wants a person' }, calls: [], messages: [], events: [], agent: { run: { ...run, status: 'handed_off' }, tasks: [] } }
          : { contact, calls: [], messages: [], events: [], agent: { run, tasks: [] } },
    }
    render(<ContactDetailClient contactId="c1" />)
    expect(await screen.findByText('showcase-offer@v2')).toBeTruthy()
    expect(screen.getByText('₹12.50')).toBeTruthy()
    expect(screen.getByText('asked to wait')).toBeTruthy()
    expect(screen.getByText(`${'x'.repeat(80)}…`)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Hand-off reason'), { target: { value: 'wants a person' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hand off to team' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Resume agent' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hand off to team' })).toBeTruthy())
    const bodies = calls.filter(c => c.init?.method === 'PATCH').map(c => JSON.parse(c.init!.body as string))
    expect(bodies).toEqual([{ action: 'handoff', note: 'wants a person' }, { action: 'resume' }])
  })
})
