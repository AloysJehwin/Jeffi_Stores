import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'
import { accessToken, callbackAuthHash, clearPhonePeTokenCache, completedPayment, createPayment, orderStatus, parseOrderStatus, PhonePeError, verifyCallbackAuth } from '@/lib/payments/upi/phonepe'

const creds = { env: 'sandbox' as const, clientId: 'cid', clientSecret: 'sec', clientVersion: '1' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const fetchMock = vi.fn()

beforeEach(() => {
  clearPhonePeTokenCache()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('phonepe client', () => {
  it('caches the token per client and sends it as O-Bearer', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: 'tok', expires_at: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(json({ orderId: 'OMO1', state: 'PENDING', redirectUrl: 'https://pay.example/x' }))
      .mockResolvedValueOnce(json({ orderId: 'OMO1', state: 'COMPLETED', amount: 5000, paymentDetails: [] }))
    const r = await createPayment(creds, { merchantOrderId: 'JSabc', amountPaise: 5000, redirectUrl: 'https://s/pay/upi/1/return', metaInfo: { udf1: 'cp' } })
    expect(r.redirectUrl).toBe('https://pay.example/x')
    await orderStatus(creds, 'JSabc')
    expect(fetchMock).toHaveBeenCalledTimes(3) // one token for both calls
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]
    expect(tokenUrl).toBe('https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token')
    expect(String(tokenInit.body)).toContain('grant_type=client_credentials')
    const [payUrl, payInit] = fetchMock.mock.calls[1]
    expect(payUrl).toMatch(/\/checkout\/v2\/pay$/)
    expect(payInit.headers.Authorization).toBe('O-Bearer tok')
    const body = JSON.parse(payInit.body)
    expect(body.expireAfter).toBe(1200)
    expect(body.paymentFlow.paymentModeConfig.enabledPaymentModes.map((m: any) => m.type)).toEqual(['UPI_INTENT', 'UPI_QR', 'UPI_COLLECT'])
    expect(fetchMock.mock.calls[2][0]).toContain('/checkout/v2/order/JSabc/status?details=false&errorContext=true')
  })

  it("surfaces PhonePe's error code and message", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 'AUTHORIZATION_FAILED', message: 'bad client' }, 401))
    const e = await accessToken(creds).catch(x => x)
    expect(e).toBeInstanceOf(PhonePeError)
    expect(e.code).toBe('AUTHORIZATION_FAILED')
    expect(e.message).toContain('bad client')
  })

  it('parses the order status and picks the completed attempt', () => {
    const s = parseOrderStatus({
      orderId: 'OMO1',
      state: 'COMPLETED',
      amount: 5000,
      paymentDetails: [
        { transactionId: 'T1', state: 'FAILED', errorCode: 'X' },
        { transactionId: 'T2', state: 'COMPLETED', rail: { type: 'UPI', utr: '412345678901', vpa: 'a@ybl' } },
      ],
    })
    expect(s.state).toBe('COMPLETED')
    expect(completedPayment(s)?.transactionId).toBe('T2')
    expect(completedPayment(s)?.rail?.utr).toBe('412345678901')
    expect(parseOrderStatus({ state: 'weird' }).state).toBe('PENDING')
  })

  it('verifies the webhook Authorization header', () => {
    const hash = crypto.createHash('sha256').update('user:pass').digest('hex')
    expect(callbackAuthHash('user', 'pass')).toBe(hash)
    expect(verifyCallbackAuth(hash, 'user', 'pass')).toBe(true)
    expect(verifyCallbackAuth(hash.toUpperCase(), 'user', 'pass')).toBe(true)
    expect(verifyCallbackAuth(hash, 'user', 'other')).toBe(false)
    expect(verifyCallbackAuth('not-hex', 'user', 'pass')).toBe(false)
    expect(verifyCallbackAuth(null, 'user', 'pass')).toBe(false)
    expect(verifyCallbackAuth(hash, '', '')).toBe(false)
  })
})
