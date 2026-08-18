/**
 * Tests for src/lib/tenant-dns.ts
 *
 * Two hard-won behaviours are pinned here because both previously broke live
 * tenants:
 *
 *  1. targetIp() MUST throw when TENANT_APP_TARGET_IP is unset. A hardcoded
 *     default once wrote A-records pointing at a dead EC2 IP after an EIP move,
 *     so tenants provisioned "successfully" but served nothing. Failing fast at
 *     provision time is the fix.
 *
 *  2. deleteRecords() MUST read the live record and echo its real TTL/Values
 *     back in the DELETE. Route53 requires an exact match, so rebuilding the
 *     payload from the *current* target IP left stale records behind whenever
 *     the IP had changed (InvalidChangeBatch). Teardown has to be value-agnostic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Sign is irrelevant to the logic under test — stub it so no real credentials
// are resolved and no network call is attempted.
// NOTE: must be declared with `function` (not an arrow) so `new SignatureV4()` works.
vi.mock('@smithy/signature-v4', () => ({
  SignatureV4: vi.fn().mockImplementation(function (this: any) {
    this.sign = vi.fn().mockImplementation(async (req: any) => ({
      ...req,
      headers: { ...(req?.headers ?? {}), authorization: 'AWS4-signed' },
    }))
  }),
}))
vi.mock('@aws-sdk/credential-provider-node', () => ({ defaultProvider: vi.fn(() => async () => ({ accessKeyId: 'AK', secretAccessKey: 'SK' })) }))
vi.mock('@aws-crypto/sha256-js', () => ({ Sha256: vi.fn() }))
vi.mock('@smithy/protocol-http', () => ({
  HttpRequest: vi.fn().mockImplementation(function (this: any, cfg: any) { Object.assign(this, cfg) }),
}))

const ZONE = 'Z08094881XKVZ9XSGBKG1'

function mockFetchSequence(responses: Array<{ ok?: boolean; status?: number; text?: string }>) {
  const calls: Array<{ url: string; method: string; body?: string }> = []
  let i = 0
  const fn = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, method: init?.method, body: init?.body })
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      text: async () => r.text ?? '',
    }
  })
  vi.stubGlobal('fetch', fn)
  return { calls, fn }
}

/** A realistic ListResourceRecordSets response for one A record. */
function listXml(name: string, ttl: number, values: string[]) {
  const recs = values.map((v) => `<ResourceRecord><Value>${v}</Value></ResourceRecord>`).join('')
  return `<?xml version="1.0"?><ListResourceRecordSetsResponse><ResourceRecordSets><ResourceRecordSet>
    <Name>${name}</Name><Type>A</Type><TTL>${ttl}</TTL><ResourceRecords>${recs}</ResourceRecords>
  </ResourceRecordSet></ResourceRecordSets></ListResourceRecordSetsResponse>`
}

describe('tenant-dns', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.TENANT_APP_TARGET_IP = '52.20.193.62'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.TENANT_APP_TARGET_IP
  })

  describe('upsertTenantDns', () => {
    it('does nothing (no network call) for an empty hostname list', async () => {
      const { fn } = mockFetchSequence([{}])
      const { upsertTenantDns } = await import('@/lib/tenant-dns')
      await upsertTenantDns([])
      expect(fn).not.toHaveBeenCalled()
    })

    it('THROWS when TENANT_APP_TARGET_IP is unset rather than writing a placeholder record', async () => {
      delete process.env.TENANT_APP_TARGET_IP
      mockFetchSequence([{}])
      const { upsertTenantDns } = await import('@/lib/tenant-dns')
      await expect(upsertTenantDns(['acme.jeffistores.in'])).rejects.toThrow(/TENANT_APP_TARGET_IP is not set/)
    })

    it('THROWS when TENANT_APP_TARGET_IP is only whitespace', async () => {
      process.env.TENANT_APP_TARGET_IP = '   '
      mockFetchSequence([{}])
      const { upsertTenantDns } = await import('@/lib/tenant-dns')
      await expect(upsertTenantDns(['acme.jeffistores.in'])).rejects.toThrow(/TENANT_APP_TARGET_IP is not set/)
    })

    it('POSTs an UPSERT change batch containing every hostname and the target IP', async () => {
      const { calls } = mockFetchSequence([{ ok: true }])
      const { upsertTenantDns } = await import('@/lib/tenant-dns')
      await upsertTenantDns(['acme.jeffistores.in', 'admin-acme.jeffistores.in'])

      expect(calls).toHaveLength(1)
      expect(calls[0].method).toBe('POST')
      expect(calls[0].url).toContain(`/hostedzone/${ZONE}/rrset`)
      expect(calls[0].body).toContain('<Action>UPSERT</Action>')
      expect(calls[0].body).toContain('acme.jeffistores.in')
      expect(calls[0].body).toContain('admin-acme.jeffistores.in')
      expect(calls[0].body).toContain('52.20.193.62')
      expect(calls[0].body).toContain('<Type>A</Type>')
    })

    it('trims a padded target IP', async () => {
      process.env.TENANT_APP_TARGET_IP = '  52.20.193.62  '
      const { calls } = mockFetchSequence([{ ok: true }])
      const { upsertTenantDns } = await import('@/lib/tenant-dns')
      await upsertTenantDns(['acme.jeffistores.in'])
      expect(calls[0].body).toContain('<Value>52.20.193.62</Value>')
    })

    it('throws with the Route53 status and body when the UPSERT is rejected', async () => {
      mockFetchSequence([{ ok: false, status: 400, text: 'InvalidChangeBatch: bad' }])
      const { upsertTenantDns } = await import('@/lib/tenant-dns')
      await expect(upsertTenantDns(['acme.jeffistores.in'])).rejects.toThrow(/Route53 UPSERT failed \(400\).*InvalidChangeBatch/s)
    })
  })

  describe('deleteTenantDns', () => {
    it('does nothing for an empty list', async () => {
      const { fn } = mockFetchSequence([{}])
      const { deleteTenantDns } = await import('@/lib/tenant-dns')
      await deleteTenantDns([])
      expect(fn).not.toHaveBeenCalled()
    })

    it('READS the live record first, then DELETEs echoing its real TTL and value', async () => {
      // Live record deliberately holds an OLD ip and a non-default TTL — the delete
      // must mirror those, not the current TENANT_APP_TARGET_IP.
      const { calls } = mockFetchSequence([
        { ok: true, text: listXml('acme.jeffistores.in.', 60, ['1.2.3.4']) }, // GET
        { ok: true },                                                          // POST delete
      ])
      const { deleteTenantDns } = await import('@/lib/tenant-dns')
      await deleteTenantDns(['acme.jeffistores.in'])

      expect(calls).toHaveLength(2)
      expect(calls[0].method).toBe('GET')
      expect(calls[1].method).toBe('POST')
      expect(calls[1].body).toContain('<Action>DELETE</Action>')
      // value-agnostic: uses the LIVE value/TTL, not the configured target
      expect(calls[1].body).toContain('<Value>1.2.3.4</Value>')
      expect(calls[1].body).toContain('<TTL>60</TTL>')
      expect(calls[1].body).not.toContain('52.20.193.62')
    })

    it('SKIPS a hostname whose record does not exist (Route53 returns the next name)', async () => {
      const { calls } = mockFetchSequence([
        { ok: true, text: listXml('zzz-other.jeffistores.in.', 300, ['9.9.9.9']) },
      ])
      const { deleteTenantDns } = await import('@/lib/tenant-dns')
      await deleteTenantDns(['acme.jeffistores.in'])
      // only the GET happened — no DELETE issued
      expect(calls).toHaveLength(1)
      expect(calls[0].method).toBe('GET')
    })

    it('appends the trailing dot when querying', async () => {
      const { calls } = mockFetchSequence([{ ok: true, text: listXml('acme.jeffistores.in.', 300, ['1.1.1.1']) }, { ok: true }])
      const { deleteTenantDns } = await import('@/lib/tenant-dns')
      await deleteTenantDns(['acme.jeffistores.in'])
      expect(decodeURIComponent(calls[0].url)).toContain('acme.jeffistores.in.')
    })

    it('accepts a hostname that already ends with a dot', async () => {
      const { calls } = mockFetchSequence([{ ok: true, text: listXml('acme.jeffistores.in.', 300, ['1.1.1.1']) }, { ok: true }])
      const { deleteTenantDns } = await import('@/lib/tenant-dns')
      await deleteTenantDns(['acme.jeffistores.in.'])
      expect(calls).toHaveLength(2)
    })

    it('carries over MULTIPLE values on the live record', async () => {
      const { calls } = mockFetchSequence([
        { ok: true, text: listXml('acme.jeffistores.in.', 120, ['1.1.1.1', '2.2.2.2']) },
        { ok: true },
      ])
      const { deleteTenantDns } = await import('@/lib/tenant-dns')
      await deleteTenantDns(['acme.jeffistores.in'])
      expect(calls[1].body).toContain('<Value>1.1.1.1</Value>')
      expect(calls[1].body).toContain('<Value>2.2.2.2</Value>')
    })

    it('skips when the record matches by name but carries no values', async () => {
      const { calls } = mockFetchSequence([
        { ok: true, text: '<ResourceRecordSet><Name>acme.jeffistores.in.</Name><Type>A</Type><TTL>300</TTL></ResourceRecordSet>' },
      ])
      const { deleteTenantDns } = await import('@/lib/tenant-dns')
      await deleteTenantDns(['acme.jeffistores.in'])
      expect(calls).toHaveLength(1)
    })

    it('throws when the LIST call fails', async () => {
      mockFetchSequence([{ ok: false, status: 403, text: 'AccessDenied' }])
      const { deleteTenantDns } = await import('@/lib/tenant-dns')
      await expect(deleteTenantDns(['acme.jeffistores.in'])).rejects.toThrow(/Route53 list failed for acme\.jeffistores\.in \(403\)/)
    })

    it('TOLERATES a "does not exist" DELETE failure (idempotent teardown)', async () => {
      mockFetchSequence([
        { ok: true, text: listXml('acme.jeffistores.in.', 300, ['1.1.1.1']) },
        { ok: false, status: 400, text: 'Tried to delete resource record set but it was not found' },
      ])
      const { deleteTenantDns } = await import('@/lib/tenant-dns')
      await expect(deleteTenantDns(['acme.jeffistores.in'])).resolves.toBeUndefined()
    })

    it('throws on a genuine DELETE failure', async () => {
      mockFetchSequence([
        { ok: true, text: listXml('acme.jeffistores.in.', 300, ['1.1.1.1']) },
        { ok: false, status: 500, text: 'InternalError' },
      ])
      const { deleteTenantDns } = await import('@/lib/tenant-dns')
      await expect(deleteTenantDns(['acme.jeffistores.in'])).rejects.toThrow(/Route53 DELETE failed for acme\.jeffistores\.in \(500\)/)
    })

    it('processes every hostname in the list', async () => {
      const { calls } = mockFetchSequence([
        { ok: true, text: listXml('a.jeffistores.in.', 300, ['1.1.1.1']) },
        { ok: true },
        { ok: true, text: listXml('b.jeffistores.in.', 300, ['2.2.2.2']) },
        { ok: true },
      ])
      const { deleteTenantDns } = await import('@/lib/tenant-dns')
      await deleteTenantDns(['a.jeffistores.in', 'b.jeffistores.in'])
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2)
    })

    it('does NOT require TENANT_APP_TARGET_IP (teardown must work after the IP is gone)', async () => {
      delete process.env.TENANT_APP_TARGET_IP
      mockFetchSequence([{ ok: true, text: listXml('acme.jeffistores.in.', 300, ['1.1.1.1']) }, { ok: true }])
      const { deleteTenantDns } = await import('@/lib/tenant-dns')
      await expect(deleteTenantDns(['acme.jeffistores.in'])).resolves.toBeUndefined()
    })
  })
})


