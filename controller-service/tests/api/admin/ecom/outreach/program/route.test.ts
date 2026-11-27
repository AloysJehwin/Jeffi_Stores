import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ getState: vi.fn(), update: vi.fn(), counts: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/contacts', () => ({ statusCounts: m.counts }))
vi.mock('@controller/lib/outreach/program-state', () => ({
  getProgramState: m.getState,
  updateProgramState: m.update,
  ProgramStateError: class ProgramStateError extends Error {},
}))

import { GET, PATCH } from '@controller/app/api/(admin)/admin/ecom/outreach/program/route'
import { ProgramStateError } from '@controller/lib/outreach/program-state'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const SKILL = '11111111-1111-4111-8111-111111111111'
const url = 'http://localhost/api/admin/ecom/outreach/program'
const patch = (body: unknown) => new NextRequest(url, { method: 'PATCH', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.getState.mockResolvedValue({ program: 'showcase-offer', enabled: false })
  m.counts.mockResolvedValue({ queued: 3 })
  m.update.mockResolvedValue({ program: 'showcase-offer', enabled: true })
})

describe('/api/admin/ecom/outreach/program', () => {
  it('401 without a session, 403 without the scope or for a non-platform admin', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(new NextRequest(url))).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await PATCH(patch({ enabled: true }))).status).toBe(403)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await GET(new NextRequest(url))).status).toBe(403)
    expect(m.update).not.toHaveBeenCalled()
  })

  it('GET returns the registry entry, state and counts under the read scope', async () => {
    const j = await (await GET(new NextRequest(url))).json()
    expect(j).toMatchObject({ program: { key: 'showcase-offer', maxAttempts: 3 }, state: { enabled: false }, counts: { queued: 3 } })
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:read')
    expect((await GET(new NextRequest(url + '?program=nope'))).status).toBe(404)
  })

  it('PATCH 400s on bad input', async () => {
    expect((await PATCH(patch({ daily_cap: -1 }))).status).toBe(400)
    expect((await PATCH(patch({ window_start: '9am' }))).status).toBe(400)
    expect((await PATCH(patch({ concurrency: 0 }))).status).toBe(400)
    expect(m.update).not.toHaveBeenCalled()
  })

  it('PATCH writes the changes under the write scope', async () => {
    const res = await PATCH(patch({ enabled: true, daily_cap: 20, test_numbers: ['9876543210'] }))
    expect(res.status).toBe(200)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:write')
    expect(m.update).toHaveBeenCalledWith('showcase-offer', { enabled: true, daily_cap: 20, test_numbers: ['9876543210'] }, expect.objectContaining({ id: 'a1' }))
  })

  it('GET carries the default skill id in the state', async () => {
    m.getState.mockResolvedValueOnce({ program: 'showcase-offer', enabled: false, default_skill_id: SKILL })
    expect((await (await GET(new NextRequest(url))).json()).state.default_skill_id).toBe(SKILL)
  })

  it('PATCH sets or clears the default skill, and 400s on a bad id', async () => {
    expect((await PATCH(patch({ default_skill_id: 'nope' }))).status).toBe(400)
    expect(m.update).not.toHaveBeenCalled()
    expect((await PATCH(patch({ default_skill_id: SKILL }))).status).toBe(200)
    expect(m.update).toHaveBeenLastCalledWith('showcase-offer', { default_skill_id: SKILL }, expect.objectContaining({ id: 'a1' }))
    expect((await PATCH(patch({ default_skill_id: null }))).status).toBe(200)
    expect(m.update).toHaveBeenLastCalledWith('showcase-offer', { default_skill_id: null }, expect.objectContaining({ id: 'a1' }))
  })

  it('PATCH turns an unknown, archived or foreign skill into a 400', async () => {
    m.update.mockRejectedValueOnce(new ProgramStateError('That skill is archived'))
    const res = await PATCH(patch({ default_skill_id: SKILL }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/archived/)
  })

  it('PATCH turns a compliance refusal into a 400', async () => {
    m.update.mockRejectedValueOnce(new ProgramStateError('The calling window must sit inside 09:30-20:30 IST'))
    const res = await PATCH(patch({ window_end: '22:00' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/09:30/)
  })
})
