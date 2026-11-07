import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ getIntegrationCredential: vi.fn() }))
vi.mock('@/lib/crypto/token-cipher', () => ({ decryptToken: (s: string) => s.replace(/^enc:/, '') }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))

import { generateEWayBill, __resetTokenCacheForTests, type EWayBillPayload } from '@/lib/shipping/ewaybill'
import { GstApiNotConnectedError } from '@/lib/shipping/gst-api-creds'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getIntegrationCredential } from '@/lib/tenant-registry'
import { queryOne } from '@/lib/shared/db'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const PAYLOAD = {
  supplyType: 'O',
  subSupplyType: '1',
  docType: 'INV',
  docNo: 'INV-1',
  docDate: '01/01/2026',
  fromGstin: '29ABCDE1234F1Z5',
  fromTrdName: 'Store',
  fromAddr1: 'a',
  fromPlace: 'b',
  fromPincode: 560001,
  fromStateCode: 29,
  toGstin: 'URP',
  toTrdName: 'Buyer',
  toAddr1: 'c',
  toPlace: 'd',
  toPincode: 560002,
  toStateCode: 29,
  totalValue: 100,
  cgstValue: 9,
  sgstValue: 9,
  igstValue: 0,
  cessValue: 0,
  transMode: '1',
  transDistance: 10,
  items: [],
} as unknown as EWayBillPayload

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const authOk = () => ok({ response: { authtoken: 'tok' } })
const genOk = () => ok({ response: { ewbNo: 123456789012, ewbDt: 'now', ewbValidTill: 'later' } })
const storeRow = {
  status: 'connected',
  config_enc: `enc:${JSON.stringify({
    username: 'store-user',
    password: 'store-pass',
    client_id: 'store-cid',
    client_secret: 'store-secret',
    base_url: 'https://gsp.example.com/api',
  })}`,
  meta: {},
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetTokenCacheForTests()
  Object.assign(process.env, {
    EWAYBILL_CLIENT_ID: 'env-cid',
    EWAYBILL_CLIENT_SECRET: 'env-secret',
    EWAYBILL_USERNAME: 'env-user',
    EWAYBILL_PASSWORD: 'env-pass',
    EWAYBILL_GSTIN: '33PLATF0000A1Z5',
  })
  vi.mocked(queryOne).mockResolvedValue({ value: '29abcde1234f1z5' })
})

afterEach(() => {
  for (const k of ['CLIENT_ID', 'CLIENT_SECRET', 'USERNAME', 'PASSWORD', 'GSTIN']) delete process.env[`EWAYBILL_${k}`]
})

describe('e-way bill credentials per store', () => {
  it("refuses a store without its own credentials, even when the platform's are set", async () => {
    vi.mocked(resolveTenantId).mockResolvedValue('t-acme')
    vi.mocked(getIntegrationCredential).mockResolvedValue(null)
    const err = await generateEWayBill(PAYLOAD).catch(e => e)
    expect(err).toBeInstanceOf(GstApiNotConnectedError)
    expect(err.message).toBe('Add your e-way bill API credentials in Integrations')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("uses the store's own credentials under its own GSTIN", async () => {
    vi.mocked(resolveTenantId).mockResolvedValue('t-acme')
    vi.mocked(getIntegrationCredential).mockResolvedValue(storeRow as any)
    fetchMock.mockResolvedValueOnce(authOk()).mockResolvedValueOnce(genOk())
    const r = await generateEWayBill(PAYLOAD)
    expect(r).toMatchObject({ ewbNo: '123456789012', status: 'generated' })
    expect(getIntegrationCredential).toHaveBeenCalledWith('t-acme', 'ewaybill')
    const [authUrl, auth] = fetchMock.mock.calls[0]
    expect(authUrl).toBe('https://gsp.example.com/api/ewayapi/authenticate')
    expect(auth.headers).toMatchObject({ clientid: 'store-cid', clientsecret: 'store-secret', gstin: '29ABCDE1234F1Z5' })
    expect(JSON.parse(auth.body)).toMatchObject({ username: 'store-user', password: 'store-pass' })
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ gstin: '29ABCDE1234F1Z5', authtoken: 'tok' })
  })

  it('refuses a store with credentials but no GSTIN', async () => {
    vi.mocked(resolveTenantId).mockResolvedValue('t-acme')
    vi.mocked(getIntegrationCredential).mockResolvedValue(storeRow as any)
    vi.mocked(queryOne).mockResolvedValue(null)
    await expect(generateEWayBill(PAYLOAD)).rejects.toThrow(/GSTIN/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the platform env path on the flagship', async () => {
    vi.mocked(resolveTenantId).mockResolvedValue(null)
    fetchMock.mockResolvedValueOnce(authOk()).mockResolvedValueOnce(genOk())
    await generateEWayBill(PAYLOAD)
    expect(getIntegrationCredential).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ clientid: 'env-cid', gstin: '33PLATF0000A1Z5' })
  })

  it('caches tokens per store', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue(storeRow as any)
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/authenticate') ? authOk() : genOk()))
    vi.mocked(resolveTenantId).mockResolvedValue('t-acme')
    await generateEWayBill(PAYLOAD)
    await generateEWayBill(PAYLOAD)
    vi.mocked(resolveTenantId).mockResolvedValue('t-other')
    await generateEWayBill(PAYLOAD)
    const auths = fetchMock.mock.calls.filter(c => String(c[0]).endsWith('/authenticate'))
    expect(auths).toHaveLength(2)
    fetchMock.mockReset()
  })
})
