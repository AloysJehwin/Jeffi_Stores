import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('https', () => ({
  default: {
    get: vi.fn(),
  },
}))

import { GET } from '@/app/api/pincode/[pin]/route'
import https from 'https'

const mockHttpsGet = vi.mocked(https.get)

function makeRequest(pin: string) {
  return new Request(`http://localhost/api/pincode/${pin}`)
}

function mockHttpsResponse(data: object) {
  mockHttpsGet.mockImplementationOnce((_url: any, _opts: any, callback: any) => {
    const res = {
      on: (event: string, handler: (chunk?: any) => void) => {
        if (event === 'data') handler(JSON.stringify(data))
        if (event === 'end') handler()
        return res
      },
    }
    callback(res)
    return { on: vi.fn() } as any
  })
}

function mockHttpsError(err: Error) {
  mockHttpsGet.mockImplementationOnce((_url: any, _opts: any, _callback: any) => {
    return {
      on: (_event: string, handler: (e: Error) => void) => {
        handler(err)
        return { on: vi.fn() }
      },
    } as any
  })
}

const successResponse = [
  {
    Status: 'Success',
    PostOffice: [
      { Name: 'Andheri', District: 'Mumbai', State: 'Maharashtra' },
      { Name: 'Versova', District: 'Mumbai', State: 'Maharashtra' },
    ],
  },
]

describe('GET /api/pincode/[pin]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 400 for non-6-digit pin', async () => {
    const res = await GET(makeRequest('123') as any, { params: Promise.resolve({ pin: '123' }) } as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Invalid PIN code')
  })

  it('returns 400 for pin with letters', async () => {
    const res = await GET(makeRequest('12345A') as any, { params: Promise.resolve({ pin: '12345A' }) } as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 for 7-digit pin', async () => {
    const res = await GET(makeRequest('1234567') as any, { params: Promise.resolve({ pin: '1234567' }) } as any)
    expect(res.status).toBe(400)
  })

  it('returns district, state, and postOffices on success', async () => {
    mockHttpsResponse(successResponse)
    const res = await GET(makeRequest('400053') as any, { params: Promise.resolve({ pin: '400053' }) } as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.district).toBe('Mumbai')
    expect(json.state).toBe('Maharashtra')
    expect(json.postOffices).toContain('Andheri')
    expect(json.postOffices).toContain('Versova')
  })

  it('deduplicates post office names', async () => {
    const dupResponse = [
      {
        Status: 'Success',
        PostOffice: [
          { Name: 'Andheri', District: 'Mumbai', State: 'Maharashtra' },
          { Name: 'Andheri', District: 'Mumbai', State: 'Maharashtra' },
        ],
      },
    ]
    mockHttpsResponse(dupResponse)
    const res = await GET(makeRequest('400053') as any, { params: Promise.resolve({ pin: '400053' }) } as any)
    const json = await res.json()
    expect(json.postOffices).toHaveLength(1)
  })

  it('returns 404 when postal API returns Status != Success', async () => {
    mockHttpsResponse([{ Status: 'Error', PostOffice: null }])
    const res = await GET(makeRequest('999999') as any, { params: Promise.resolve({ pin: '999999' }) } as any)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('PIN code not found')
  })

  it('returns 404 when PostOffice array is empty', async () => {
    mockHttpsResponse([{ Status: 'Success', PostOffice: [] }])
    const res = await GET(makeRequest('999999') as any, { params: Promise.resolve({ pin: '999999' }) } as any)
    expect(res.status).toBe(404)
  })

  it('returns 404 when response entry is null', async () => {
    mockHttpsResponse([null])
    const res = await GET(makeRequest('400001') as any, { params: Promise.resolve({ pin: '400001' }) } as any)
    expect(res.status).toBe(404)
  })

  it('returns 502 on network error', async () => {
    mockHttpsError(new Error('ECONNREFUSED'))
    const res = await GET(makeRequest('400053') as any, { params: Promise.resolve({ pin: '400053' }) } as any)
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toBe('Lookup failed')
  })
})
