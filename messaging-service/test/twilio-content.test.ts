import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createContent, getContent, deleteContent, submitForApproval, getApprovalStatus, mapApprovalStatus,
} from '../src/providers/twilio-content'

const okJson = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })

describe('twilio-content mapApprovalStatus', () => {
  it('passes known statuses through and maps the rest to pending', () => {
    for (const s of ['approved', 'rejected', 'paused', 'disabled', 'pending', 'received', 'unsubmitted'])
      expect(mapApprovalStatus(s.toUpperCase())).toBe(s)
    expect(mapApprovalStatus('in_appeal')).toBe('pending')
    expect(mapApprovalStatus('in review')).toBe('pending')
    expect(mapApprovalStatus('something-else')).toBe('pending')
    expect(mapApprovalStatus(null)).toBe('pending')
    expect(mapApprovalStatus(undefined)).toBe('pending')
  })
})

describe('twilio-content API client', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    process.env.TWILIO_ACCOUNT_SID = 'ACx'
    process.env.TWILIO_AUTH_TOKEN = 'tok'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.TWILIO_ACCOUNT_SID
    delete process.env.TWILIO_AUTH_TOKEN
  })

  it('POSTs JSON with a basic-auth header built from the env credentials', async () => {
    fetchMock.mockResolvedValue(okJson({ sid: 'HX1', friendly_name: 'n' }))
    const r = await createContent({ friendly_name: 'n', language: 'en', types: { 'twilio/text': { body: 'hi' } } })
    expect(r.sid).toBe('HX1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://content.twilio.com/v1/Content')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Authorization).toBe('Basic ' + Buffer.from('ACx:tok').toString('base64'))
  })

  it('GET/DELETE send no body and use form content-type', async () => {
    fetchMock.mockResolvedValue(okJson({ sid: 'HX1' }))
    await getContent('HX1')
    expect(fetchMock.mock.calls[0][0]).toBe('https://content.twilio.com/v1/Content/HX1')
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined()
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe('application/x-www-form-urlencoded')

    fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => '' })
    expect(await deleteContent('HX1')).toEqual({})
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
  })

  it('submit + status hit the approval endpoints', async () => {
    fetchMock.mockResolvedValue(okJson({ name: 'n', category: 'UTILITY', status: 'received' }))
    await submitForApproval('HX1', { name: 'n', category: 'UTILITY' })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/Content\/HX1\/ApprovalRequests\/whatsapp$/)
    fetchMock.mockResolvedValue(okJson({ sid: 'HX1', whatsapp: { status: 'approved' } }))
    const s = await getApprovalStatus('HX1')
    expect(s.whatsapp.status).toBe('approved')
  })

  it('throws an error carrying status/code/body on a non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => JSON.stringify({ message: 'bad name', code: 63001 }) })
    await expect(createContent({ friendly_name: 'n', language: 'en', types: {} }))
      .rejects.toMatchObject({ message: 'bad name', status: 422, code: 63001 })
  })

  it('throws when the Twilio credentials are missing', async () => {
    delete process.env.TWILIO_ACCOUNT_SID
    await expect(getContent('HX1')).rejects.toThrow(/TWILIO_ACCOUNT_SID/)
  })
})
