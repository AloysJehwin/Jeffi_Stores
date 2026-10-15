import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { publicRoutes } from '../src/tenant/public'

describe('public token routes', () => {
  it('404s on a non-tenant host and on a malformed token', async () => {
    const app = Fastify()
    await app.register(publicRoutes)
    expect((await app.inject({ url: '/t/invoice/nope', headers: { host: 'localhost' } })).statusCode).toBe(404)
    expect((await app.inject({ url: '/t/invoice/nope', headers: { host: 'invoice-x.localhost' } })).statusCode).toBe(404)
  })
})
