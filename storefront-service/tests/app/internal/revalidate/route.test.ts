import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const revalidatePath = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ revalidatePath }))

import { POST } from '@storefront/app/api/(internal)/revalidate/route'

const call = (body: unknown, auth?: string) =>
  POST(
    new NextRequest('http://localhost/api/revalidate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
const OK = 'Bearer test-cron-secret'

describe('POST /api/revalidate', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  it('rejects a missing or wrong bearer with 401 and revalidates nothing', async () => {
    expect((await call({ paths: ['/'] })).status).toBe(401)
    expect((await call({ paths: ['/'] }, 'Bearer nope')).status).toBe(401)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('400s on malformed bodies', async () => {
    expect((await call('not json', OK)).status).toBe(400)
    expect((await call({ paths: [] }, OK)).status).toBe(400)
    expect((await call({ paths: ['no-slash'] }, OK)).status).toBe(400)
    expect((await call({ paths: Array(11).fill('/a') }, OK)).status).toBe(400)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('revalidates each path and echoes them', async () => {
    const res = await call({ paths: ['/', '/products'] }, OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revalidated: ['/', '/products'] })
    expect(revalidatePath).toHaveBeenCalledTimes(2)
    expect(revalidatePath).toHaveBeenCalledWith('/products')
  })

  it('surfaces a revalidation failure', async () => {
    revalidatePath.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    await expect(call({ paths: ['/'] }, OK)).rejects.toThrow('boom')
  })
})
