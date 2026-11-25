import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { signServiceToken } from '@jeffi/service-auth'

const runTool = vi.hoisted(() => vi.fn())
vi.mock('@controller/lib/outreach/tools', () => ({ runTool }))

import { POST } from '@controller/app/api/(internal)/internal/outreach/calls/[callId]/tools/[tool]/route'

const CALL = '11111111-1111-4111-8111-111111111111'
const token = (service = 'voice') => `Bearer ${signServiceToken({ service, tenantId: '00000000-0000-0000-0000-000000000000', callId: CALL } as any)}`
const post = (body: unknown, auth: string | null = token(), tool = 'optOut', id = CALL) =>
  POST(
    new NextRequest(`http://localhost/api/internal/outreach/calls/${id}/tools/${tool}`, {
      method: 'POST',
      headers: auth ? { authorization: auth } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ callId: id, tool }) }
  )

beforeEach(() => {
  vi.clearAllMocks()
  runTool.mockResolvedValue({ status: 200, body: { ok: true, say: 'Bye', end: true } })
})

describe('POST /api/internal/outreach/calls/[callId]/tools/[tool]', () => {
  it('401s without a voice token', async () => {
    expect((await post({ args: {} }, null)).status).toBe(401)
    expect((await post({ args: {} }, token('platform'))).status).toBe(401)
    expect(runTool).not.toHaveBeenCalled()
  })

  it('400s a bad id or body', async () => {
    expect((await post('not json')).status).toBe(400)
    expect((await post([1])).status).toBe(400)
    expect(runTool).not.toHaveBeenCalled()
  })

  it('runs the tool with its args and relays the reply and status', async () => {
    const r = await post({ args: { language: 'ta' } }, token(), 'switchLanguage')
    expect(runTool).toHaveBeenCalledWith(CALL, 'switchLanguage', { language: 'ta' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, say: 'Bye', end: true })
    runTool.mockResolvedValueOnce({ status: 404, body: { ok: false, error: 'Unknown tool: x' } })
    expect((await post({ args: {} }, token(), 'x')).status).toBe(404)
  })

  it('500s with ok:false when the tool throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    runTool.mockRejectedValueOnce(new Error('boom'))
    const r = await post({ args: {} })
    expect(r.status).toBe(500)
    expect((await r.json()).ok).toBe(false)
  })
})
