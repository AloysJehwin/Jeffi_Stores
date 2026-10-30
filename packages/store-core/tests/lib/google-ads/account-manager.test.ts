import { describe, it, expect, vi, beforeEach } from 'vitest'

const { cpQuery, deleteCred } = vi.hoisted(() => ({ cpQuery: vi.fn(), deleteCred: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(async () => null), queryMany: vi.fn(async () => []), query: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: cpQuery }), deleteIntegrationCredential: deleteCred }))
vi.mock('@/lib/google-ads/credentials', () => ({ GOOGLE_ADS_PROVIDER: 'google_ads' }))

import { GoogleAdsClient } from '@/lib/google-ads/client'
import { billingStatus, createStoreAccount } from '@/lib/google-ads/account-create'
import { listManagedAccounts, mapManagedAccounts, unlinkManagedAccount } from '@/lib/google-ads/manager-view'

const MGR = '9998887776'
const NEW = '1112223334'

function harness(handler: (url: string, body: any) => unknown) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = []
  const fetchMock = vi.fn(async (url: string, init: any) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url, body, headers: init.headers })
    const out = handler(url, body)
    return out instanceof Response ? out : new Response(JSON.stringify(out ?? {}), { status: 200 })
  })
  const mgr = new GoogleAdsClient({ refreshToken: 'rt', customerId: MGR, developerToken: 'dev', fetchImpl: fetchMock as any, retryDelays: [5], getAccessToken: async () => ({ token: 'at', expiresInSec: 3600 }) })
  return { mgr, calls, fetchMock }
}
const path = (u: string) => u.replace(/^https:\/\/googleads\.googleapis\.com\/v26/, '')

beforeEach(() => {
  cpQuery.mockReset()
  deleteCred.mockReset()
})

describe('createStoreAccount', () => {
  it('validates, creates once in INR / Asia/Kolkata under the manager, then invites the owner as Admin', async () => {
    const { mgr, calls } = harness((url, body) => (url.endsWith(':createCustomerClient') && !body.validateOnly ? { resourceName: `customers/${NEW}` } : {}))
    const r = await createStoreAccount(mgr, { name: '  Acme   Tools ', inviteEmail: 'owner@acme.in' })
    expect(calls.map(c => [path(c.url), !!c.body.validateOnly])).toEqual([
      [`/customers/${MGR}:createCustomerClient`, true],
      [`/customers/${MGR}:createCustomerClient`, false],
      [`/customers/${NEW}/customerUserAccessInvitations:mutate`, false],
    ])
    expect(calls[1].body).toEqual({ customerClient: { descriptiveName: 'Acme Tools', currencyCode: 'INR', timeZone: 'Asia/Kolkata' } })
    expect(calls[2].body).toEqual({ operation: { create: { emailAddress: 'owner@acme.in', accessRole: 'ADMIN' } } })
    expect(calls[2].headers['login-customer-id']).toBe(MGR)
    expect(r).toEqual({ customerId: NEW, name: 'Acme Tools', invitation: { email: 'owner@acme.in', sent: true, error: null } })
  })

  it('stops at validation when the manager may not create accounts, and never retries the create', async () => {
    const denied = () =>
      new Response(
        JSON.stringify({
          error: {
            status: 'PERMISSION_DENIED',
            details: [{ '@type': 'type.googleapis.com/google.ads.googleads.v26.errors.GoogleAdsFailure', errors: [{ errorCode: { customerError: 'CREATION_DENIED_INELIGIBLE_MCC' }, message: 'x' }] }],
          },
        }),
        { status: 403 }
      )
    const { mgr, calls } = harness(() => denied())
    await expect(createStoreAccount(mgr, { name: 'Acme' })).rejects.toThrow('not allowed to create accounts')
    expect(calls).toHaveLength(1)

    const flaky = harness((url, body) => (body.validateOnly ? {} : new Response('{}', { status: 503 })))
    await expect(createStoreAccount(flaky.mgr, { name: 'Acme' })).rejects.toThrow()
    expect(flaky.calls.filter(c => !c.body.validateOnly)).toHaveLength(1)
  })

  it('keeps the account when the invitation fails, and previews without creating', async () => {
    const { mgr } = harness(url =>
      url.includes('Invitations') ? new Response(JSON.stringify({ error: { message: 'bad email' } }), { status: 400 }) : { resourceName: `customers/${NEW}` }
    )
    const r: any = await createStoreAccount(mgr, { name: 'Acme', inviteEmail: 'x@y.in' })
    expect(r.customerId).toBe(NEW)
    expect(r.invitation).toMatchObject({ sent: false, error: expect.stringContaining('bad email') })
    const p = harness(() => ({}))
    expect(await createStoreAccount(p.mgr, { name: 'Acme' }, { preview: true })).toEqual({ preview: true })
    expect(p.calls).toHaveLength(1)
  })
})

describe('billingStatus', () => {
  it('reports the best billing setup or NONE', async () => {
    const ads = (rows: any[]) => ({ searchStream: vi.fn(async () => rows) }) as any
    expect(
      await billingStatus(
        ads([
          { billingSetup: { status: 'CANCELLED' } },
          { billingSetup: { status: 'APPROVED', paymentsAccountInfo: { paymentsAccountName: 'Acme invoices' } } },
          { billingSetup: { status: 'PENDING' } },
        ])
      )
    ).toEqual({ status: 'APPROVED', paymentsAccountName: 'Acme invoices' })
    expect(await billingStatus(ads([]))).toEqual({ status: 'NONE', paymentsAccountName: null })
  })
})

describe('manager view', () => {
  const clients = [
    { customerClient: { id: NEW, descriptiveName: 'Acme', status: 'ENABLED', currencyCode: 'INR', manager: false } },
    { customerClient: { id: '5556667778', descriptiveName: 'Old', status: 'CANCELED', manager: false } },
    { customerClient: { id: '4445556667', descriptiveName: 'Sub manager', status: 'ENABLED', manager: true } },
  ]
  const links = [
    { customerClientLink: { clientCustomer: `customers/${NEW}`, status: 'ACTIVE' } },
    { customerClientLink: { clientCustomer: 'customers/3334445556', status: 'PENDING' } },
  ]
  const storeRows = [
    { tenant_id: 't1', display_name: 'Acme Store', slug: 'acme', meta: { customer_id: NEW, connected_via: 'manager' } },
    { tenant_id: 't2', display_name: 'Beta', slug: 'beta', meta: { customer_id: '3334445556', connected_via: 'manager' } },
  ]

  it('maps clients to stores with spend, skips managers and lists pending invitations', () => {
    const stores = new Map([[NEW, [{ tenantId: 't1', name: 'Acme Store', slug: 'acme', connectedVia: 'manager' }]]])
    const spend = new Map<string, any>([[NEW, { cost: 1234.5, clicks: 80, conversions: 4 }]])
    const out = mapManagedAccounts(clients, links, stores, spend)
    expect(out.map(a => [a.customerId, a.status, a.linkStatus, a.spend30d])).toEqual([
      [NEW, 'ENABLED', 'ACTIVE', 1234.5],
      ['3334445556', 'INVITED', 'PENDING', null],
      ['5556667778', 'CANCELED', null, null],
    ])
    expect(out[0].stores[0].name).toBe('Acme Store')
  })

  it('queries customer_client from the manager and spend per enabled client', async () => {
    cpQuery.mockResolvedValue({ rows: storeRows })
    const { mgr, calls } = harness((url, body) => {
      const q: string = body.query
      if (q.includes('FROM customer_client_link')) return [{ results: links }]
      if (q.includes('FROM customer_client')) return [{ results: clients }]
      if (q.includes('FROM customer WHERE')) return [{ results: [{ metrics: { costMicros: '2500000000', clicks: '10', conversions: 2 } }] }]
      return []
    })
    const r = await listManagedAccounts(mgr)
    expect(r.managerId).toBe(MGR)
    const spendCalls = calls.filter(c => c.body.query.includes('LAST_30_DAYS'))
    expect(spendCalls.map(c => path(c.url))).toEqual([`/customers/${NEW}/googleAds:searchStream`])
    expect(spendCalls[0].headers['login-customer-id']).toBe(MGR)
    expect(r.accounts[0]).toMatchObject({ customerId: NEW, spend30d: 2500, clicks30d: 10, stores: [{ tenantId: 't1', name: 'Acme Store' }] })
    expect(cpQuery.mock.calls[0][1]).toEqual(['google_ads'])
  })

  it('unlinks an active client (INACTIVE) after validating and disconnects stores using it through the manager', async () => {
    cpQuery.mockResolvedValue({ rows: storeRows })
    const LINK = `customers/${MGR}/customerClientLinks/${NEW}~42`
    const { mgr, calls } = harness((url, body) => (url.endsWith(':searchStream') ? [{ results: [{ customerClientLink: { resourceName: LINK, status: 'ACTIVE' } }] }] : {}))
    const r = await unlinkManagedAccount(mgr, '111-222-3334')
    const writes = calls.filter(c => c.url.endsWith('/customerClientLinks:mutate'))
    expect(writes.map(c => c.body)).toEqual([
      { operation: { update: { resourceName: LINK, status: 'INACTIVE' }, updateMask: 'status' }, validateOnly: true },
      { operation: { update: { resourceName: LINK, status: 'INACTIVE' }, updateMask: 'status' } },
    ])
    expect(deleteCred).toHaveBeenCalledWith('t1', 'google_ads')
    expect(r.disconnected.map(s => s.tenantId)).toEqual(['t1'])
  })

  it('withdraws a pending invitation with CANCELED and refuses unknown accounts', async () => {
    cpQuery.mockResolvedValue({ rows: [] })
    const pending = harness((url, body) => (url.endsWith(':searchStream') ? [{ results: [{ customerClientLink: { resourceName: 'l', status: 'PENDING' } }] }] : {}))
    await unlinkManagedAccount(pending.mgr, NEW)
    expect(pending.calls.at(-1)!.body.operation.update.status).toBe('CANCELED')
    const none = harness(() => [{ results: [] }])
    await expect(unlinkManagedAccount(none.mgr, NEW)).rejects.toThrow('not linked')
    await expect(unlinkManagedAccount(none.mgr, '12')).rejects.toThrow('Invalid')
  })
})
