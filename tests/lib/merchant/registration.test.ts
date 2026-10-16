import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/merchant/client', () => ({ MERCHANT_API: 'https://merchantapi.googleapis.com', getAccessToken: vi.fn(), getMerchantId: vi.fn() }))
const { registerMerchantApi, emailFromIdToken } = await import('@/lib/merchant/registration')

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body })

describe('registerMerchantApi', () => {
  it('posts registerGcp for the account with the signed-in token', async () => {
    fetchMock.mockResolvedValue(reply(200, { name: 'accounts/5762156822/developerRegistration' }))
    const r = await registerMerchantApi('tok', '5762156822')
    expect(r.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://merchantapi.googleapis.com/accounts/v1/accounts/5762156822/developerRegistration:registerGcp')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok')
  })
  it('treats an existing registration as done', async () => {
    fetchMock.mockResolvedValue(reply(409, { error: { message: 'Already registered' } }))
    expect((await registerMerchantApi('tok', '1')).ok).toBe(true)
  })
  it('explains an unverified website', async () => {
    fetchMock.mockResolvedValue(reply(400, { error: { message: 'The account website is not verified' } }))
    const r = await registerMerchantApi('tok', '1')
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/verified and claimed/)
  })
  it('explains a non-admin sign-in', async () => {
    fetchMock.mockResolvedValue(reply(403, { error: { message: 'The caller does not have permission' } }))
    expect((await registerMerchantApi('tok', '1')).message).toMatch(/not an admin directly/)
  })
  it('names the developer on registration', async () => {
    fetchMock.mockResolvedValue(reply(200, {}))
    const r = await registerMerchantApi('tok', '1', 'owner@jeffi.in')
    expect(r.ok).toBe(true)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ developerEmail: 'owner@jeffi.in' })
  })
  it('grants API developer through the users API when the project is already registered', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(409, { error: { message: 'Already registered' } }))
      .mockResolvedValueOnce(reply(200, { state: 'VERIFIED', accessRights: ['ADMIN'] }))
      .mockResolvedValueOnce(reply(200, {}))
    const r = await registerMerchantApi('tok', '5762156822', 'owner@jeffi.in')
    expect(r.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[2]
    expect(url).toBe('https://merchantapi.googleapis.com/accounts/v1/accounts/5762156822/users/owner%40jeffi.in?updateMask=accessRights')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ accessRights: ['ADMIN', 'API_DEVELOPER'] })
  })
  it('refuses a user who has not accepted the invitation', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(409, { error: { message: 'Already registered' } }))
      .mockResolvedValueOnce(reply(200, { state: 'PENDING', accessRights: ['STANDARD'] }))
    const r = await registerMerchantApi('tok', '1', 'new@jeffi.in')
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/not accepted/)
  })
  it('reads the email from the id token', () => {
    const tok = ['x', Buffer.from(JSON.stringify({ email: 'a@b.in', email_verified: true })).toString('base64url'), 'sig'].join('.')
    expect(emailFromIdToken(tok)).toBe('a@b.in')
    expect(emailFromIdToken(undefined)).toBeNull()
  })
})
