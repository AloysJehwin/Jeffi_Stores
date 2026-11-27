import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ detail: vi.fn(), suppress: vi.fn(), transition: vi.fn(), ensureRun: vi.fn(), handOff: vi.fn(), resume: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/contacts', () => ({ getContactDetail: m.detail }))
vi.mock('@controller/lib/outreach/agent/runtime', () => ({ ensureRun: m.ensureRun }))
vi.mock('@controller/lib/outreach/agent/runs', () => ({ handOff: m.handOff, resume: m.resume }))
vi.mock('@controller/lib/outreach/suppress', () => ({ addSuppression: m.suppress }))
vi.mock('@controller/lib/outreach/state', () => ({
  transition: m.transition,
  InvalidTransitionError: class InvalidTransitionError extends Error {},
  ContactNotFoundError: class ContactNotFoundError extends Error {},
}))

import { GET, PATCH } from '@controller/app/api/(admin)/admin/ecom/outreach/contacts/[id]/route'
import { InvalidTransitionError } from '@controller/lib/outreach/state'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const ID = '33333333-3333-3333-3333-333333333333'
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) })
const url = 'http://localhost/api/admin/ecom/outreach/contacts/' + ID
const patch = (body: unknown, id = ID) => PATCH(new NextRequest(url, { method: 'PATCH', body: JSON.stringify(body) }), ctx(id))
const contact = { id: ID, phone: '+919876543210', status: 'no_answer', opted_out_at: null, dnd_status: 'clear' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.detail.mockResolvedValue({ contact, calls: [], messages: [], events: [], agent: { run: null, tasks: [] } })
  m.transition.mockResolvedValue({})
  m.suppress.mockResolvedValue({ phone: contact.phone, contactsSuppressed: 1 })
  m.ensureRun.mockResolvedValue({ run: { id: 'r1' }, skill: {} })
  m.handOff.mockResolvedValue(undefined)
  m.resume.mockResolvedValue(true)
})

describe('/api/admin/ecom/outreach/contacts/[id]', () => {
  it('401 / 403 gates', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(new NextRequest(url), ctx())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await patch({ action: 'requeue' })).status).toBe(403)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await GET(new NextRequest(url), ctx())).status).toBe(403)
    expect(m.transition).not.toHaveBeenCalled()
  })

  it('GET returns the contact with calls, messages and events; 404 when missing', async () => {
    expect(await (await GET(new NextRequest(url), ctx())).json()).toMatchObject({ contact: { id: ID }, calls: [], messages: [], events: [] })
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:read')
    m.detail.mockResolvedValueOnce(null)
    expect((await GET(new NextRequest(url), ctx())).status).toBe(404)
    expect((await GET(new NextRequest(url), ctx('nope'))).status).toBe(400)
  })

  it('PATCH 400s on an action outside the manual five', async () => {
    expect((await patch({ action: 'published' })).status).toBe(400)
    expect((await patch({})).status).toBe(400)
    expect((await patch({ action: 'requeue' }, 'nope')).status).toBe(400)
  })

  it('GET carries the agent run and tasks', async () => {
    expect(await (await GET(new NextRequest(url), ctx())).json()).toMatchObject({ agent: { run: null, tasks: [] } })
  })

  it('handoff makes sure a run exists, then hands the lead to the team with the note as the reason', async () => {
    expect((await patch({ action: 'handoff', note: 'wants a person' })).status).toBe(200)
    expect(m.ensureRun).toHaveBeenCalledWith(contact)
    expect(m.handOff).toHaveBeenCalledWith({ contactId: ID, reason: 'wants a person', channel: 'follow_up', actor: expect.any(String), now: expect.any(Date) })
    expect(m.transition).not.toHaveBeenCalled()
    await patch({ action: 'handoff' })
    expect(m.handOff.mock.calls[1][0].reason).toBe('Handed off by an admin')
  })

  it('resume restarts a handed-off agent; 409 when nothing is handed off', async () => {
    expect((await patch({ action: 'resume' })).status).toBe(200)
    expect(m.resume).toHaveBeenCalledWith(ID, expect.any(String), expect.any(Date))
    m.resume.mockResolvedValueOnce(false)
    expect((await patch({ action: 'resume' })).status).toBe(409)
  })

  it('requeue resets the attempts', async () => {
    expect((await patch({ action: 'requeue', note: 'try again' })).status).toBe(200)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:write')
    expect(m.transition).toHaveBeenCalledWith(contact, 'queued', expect.objectContaining({ set: expect.objectContaining({ attempts: 0 }) }))
  })

  it('refuses to requeue an opted-out or DND contact', async () => {
    m.detail.mockResolvedValue({ contact: { ...contact, opted_out_at: '2026-11-01' }, calls: [], messages: [], events: [] })
    expect((await patch({ action: 'requeue' })).status).toBe(409)
    expect(m.transition).not.toHaveBeenCalled()
  })

  it('suppress goes through the suppression list', async () => {
    expect((await patch({ action: 'suppress' })).status).toBe(200)
    expect(m.suppress).toHaveBeenCalledWith('+919876543210', expect.objectContaining({ source: 'admin' }))
  })

  it('not_interested moves the status; an invalid move is a 409', async () => {
    expect((await patch({ action: 'not_interested' })).status).toBe(200)
    expect(m.transition).toHaveBeenCalledWith(contact, 'not_interested', expect.anything())
    m.transition.mockRejectedValueOnce(new InvalidTransitionError('claimed', 'not_interested'))
    expect((await patch({ action: 'not_interested' })).status).toBe(409)
  })
})
