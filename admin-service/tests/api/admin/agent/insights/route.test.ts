import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getInsightsSeries: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/agent/insights/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/agent/insights${qs}`)

describe('GET /api/admin/agent/insights', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(getInsightsSeries).mockResolvedValue({ weeks: 26, days: [] } as any)
  })

  it('has the agent overview gate', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await GET(req())).status).toBe(401)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'agent:read')
  })

  it('counts conversations that got a question and the tool calls the agent made', async () => {
    const res = await GET(req('?weeks=13'))
    expect(res.status).toBe(200)
    const spec = vi.mocked(getInsightsSeries).mock.calls[0][0]
    expect(spec).toMatchObject({ table: 'admin_agent_messages', dateColumn: 'created_at', weeks: 13 })
    expect(spec.series?.map(s => s.key)).toEqual(['conversations', 'tool_calls'])
    expect(spec.series?.[0].value).toBe('COUNT(DISTINCT m.conversation_id)')
    expect(spec.series?.[1].value).toContain('jsonb_array_length(m.tool_calls)')
  })

  it('rejects an unknown period and answers 500 on a failed query', async () => {
    expect((await GET(req('?weeks=9'))).status).toBe(400)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getInsightsSeries).mockRejectedValueOnce(new Error('db'))
    expect((await GET(req())).status).toBe(500)
  })
})
