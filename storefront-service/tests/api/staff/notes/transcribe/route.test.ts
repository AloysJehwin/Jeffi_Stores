import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const requireStaff = vi.hoisted(() => vi.fn())
const hasScope = vi.hoisted(() => vi.fn())
const transcribeAudio = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/staff-auth', async () => {
  const { NextResponse } = await import('next/server')
  return { requireStaff, isStaffDenied: (x: unknown) => x instanceof NextResponse }
})
vi.mock('@/lib/auth/scopes', () => ({ hasScope }))
vi.mock('@/lib/shared/transcribe', async () => {
  const actual = await vi.importActual<typeof import('@/lib/shared/transcribe')>('@/lib/shared/transcribe')
  return { ...actual, transcribeAudio }
})

import { POST } from '@storefront/app/api/(public)/staff/notes/transcribe/route'

const audio = (type = 'audio/webm;codecs=opus') => new File([new Uint8Array([1, 2, 3])], 'voice-memo.webm', { type })
function post(fields: Record<string, string | File> | null) {
  let body: FormData | string = 'plain'
  if (fields) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.append(k, v)
    body = fd
  }
  return POST(new NextRequest('http://localhost/api/staff/notes/transcribe', { method: 'POST', body, headers: fields ? {} : { 'content-type': 'text/plain' } }))
}

describe('POST /api/staff/notes/transcribe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireStaff.mockResolvedValue({ session: { adminId: 'a1', role: 'staff', scopes: [] } })
    hasScope.mockReturnValue(true)
    transcribeAudio.mockResolvedValue({ ok: true, text: 'hello', language: 'en-IN', durationSeconds: 3, provider: 'azure', model: 'w' })
  })

  it('returns the staff guard denial and 403s without the write scope', async () => {
    requireStaff.mockResolvedValueOnce(NextResponse.json({ error: 'Sign in required' }, { status: 401 }))
    expect((await post({ file: audio() })).status).toBe(401)
    hasScope.mockReturnValue(false)
    expect((await post({ file: audio() })).status).toBe(403)
    expect(requireStaff).toHaveBeenCalledWith(expect.anything(), 'customers:write')
    expect(transcribeAudio).not.toHaveBeenCalled()
  })

  it('400s on a non-multipart body, a missing file and a non-audio file', async () => {
    expect((await post(null)).status).toBe(400)
    expect((await post({ language: 'hi-IN' })).status).toBe(400)
    expect((await post({ file: new File(['x'], 'a.png', { type: 'image/png' }) })).status).toBe(400)
  })

  it('413s a recording longer than the limit before calling the provider', async () => {
    expect((await post({ file: audio(), durationSeconds: '601' })).status).toBe(413)
    expect(transcribeAudio).not.toHaveBeenCalled()
  })

  it('transcribes with the language hint and a staff_voice_memo feature tag', async () => {
    const res = await post({ file: audio(), language: 'hi-IN', durationSeconds: '12' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'hello', language: 'en-IN', durationSeconds: 3 })
    expect(transcribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'audio/webm', language: 'hi-IN', feature: 'staff_voice_memo' })
    )
  })

  it('treats auto and junk language values as no hint', async () => {
    await post({ file: audio(), language: 'auto' })
    expect(transcribeAudio.mock.calls[0][0].language).toBeUndefined()
    await post({ file: audio(), language: '<script>' })
    expect(transcribeAudio.mock.calls[1][0].language).toBeUndefined()
  })

  it('maps provider outcomes to status codes with the reason as the error', async () => {
    for (const [code, status] of [['too_large', 413], ['empty', 422], ['unavailable', 503], ['failed', 502]] as const) {
      transcribeAudio.mockResolvedValueOnce({ ok: false, code, reason: `why ${code}` })
      const res = await post({ file: audio() })
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual({ error: `why ${code}` })
    }
  })
})
