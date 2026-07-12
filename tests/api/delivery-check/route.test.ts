import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('https', () => {
  const EventEmitter = require('events')
  return {
    default: {
      get: vi.fn(),
    },
  }
})

import https from 'https'
import { GET } from '@/app/api/delivery-check/route'

function makeReq(pincode?: string) {
  const url = new URL('http://localhost/api/delivery-check')
  if (pincode !== undefined) url.searchParams.set('pincode', pincode)
  return new NextRequest(url.toString())
}

function mockHttpsGet(responseBody: string) {
  vi.mocked(https.get).mockImplementation((_url: any, _opts: any, callback: any) => {
    const { EventEmitter } = require('events')
    const res = new EventEmitter()
    const req = new EventEmitter()
    callback(res)
    setImmediate(() => {
      res.emit('data', responseBody)
      res.emit('end')
    })
    return req as any
  })
}

function mockHttpsGetError(err: Error) {
  vi.mocked(https.get).mockImplementation((_url: any, _opts: any, _callback: any) => {
    const { EventEmitter } = require('events')
    const req = new EventEmitter()
    setImmediate(() => req.emit('error', err))
    return req as any
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/delivery-check', () => {
  it('returns serviceable=false for missing pincode', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.serviceable).toBe(false)
    expect(body.message).toMatch(/valid 6-digit/)
  })

  it('returns serviceable=false for short pincode', async () => {
    const res = await GET(makeReq('1234'))
    const body = await res.json()
    expect(body.serviceable).toBe(false)
  })

  it('returns serviceable=false for non-numeric pincode', async () => {
    const res = await GET(makeReq('abcdef'))
    const body = await res.json()
    expect(body.serviceable).toBe(false)
  })

  it('returns serviceable=false when postal API returns non-Success status', async () => {
    mockHttpsGet(JSON.stringify([{ Status: 'Error', PostOffice: null }]))
    const res = await GET(makeReq('600001'))
    const body = await res.json()
    expect(body.serviceable).toBe(false)
    expect(body.message).toMatch(/not found/)
  })

  it('returns serviceable=false when PostOffice is empty', async () => {
    mockHttpsGet(JSON.stringify([{ Status: 'Success', PostOffice: [] }]))
    const res = await GET(makeReq('600001'))
    const body = await res.json()
    expect(body.serviceable).toBe(false)
  })

  it('returns serviceable=true on valid pincode with post office', async () => {
    mockHttpsGet(JSON.stringify([{
      Status: 'Success',
      PostOffice: [{ Name: 'Anna Nagar', District: 'Chennai', State: 'Tamil Nadu' }],
    }]))
    const res = await GET(makeReq('600040'))
    const body = await res.json()
    expect(body.serviceable).toBe(true)
    expect(body.message).toContain('Anna Nagar')
    expect(body.message).toContain('Chennai')
  })

  it('returns serviceable=false on network error', async () => {
    mockHttpsGetError(new Error('network fail'))
    const res = await GET(makeReq('600001'))
    const body = await res.json()
    expect(body.serviceable).toBe(false)
    expect(body.message).toMatch(/Could not check/)
  })

  it('returns serviceable=false on invalid JSON from API', async () => {
    mockHttpsGet('not-json')
    const res = await GET(makeReq('600001'))
    const body = await res.json()
    expect(body.serviceable).toBe(false)
  })
})
