import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/merchant/client', () => ({ MERCHANT_API: 'https://merchantapi.googleapis.com', getAccessToken: vi.fn(), getMerchantId: vi.fn() }))
const { registerMerchantApi } = await import('@/lib/merchant/registration')

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
})
