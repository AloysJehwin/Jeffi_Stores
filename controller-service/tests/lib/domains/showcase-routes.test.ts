import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: vi.fn() }))
vi.mock('@/lib/tenant-registry/custom-domains', () => ({ checkCustomDomainName: vi.fn(), releaseDomainClaim: vi.fn() }))

import { renderShowcaseDomains } from '@controller/lib/domains/showcase-routes'
import { showcaseDomainHosts } from '@/lib/showcase/domain'

describe('Showcase custom domains', () => {
  it('a bought domain serves only the apex and www., never store hosts', () => {
    expect(showcaseDomainHosts('acme.in')).toEqual(['acme.in', 'www.acme.in'])
  })

  it('routes each host to showcase-service in jeffi with its own HTTP-01 certificate', () => {
    const objs = renderShowcaseDomains(['acme.in', 'www.acme.in', 'acme.in'])
    expect(objs.map(o => `${o.kind}/${o.metadata.name}`)).toEqual([
      'Certificate/showcase-acme.in',
      'IngressRoute/showcase-acme.in',
      'Certificate/showcase-www.acme.in',
      'IngressRoute/showcase-www.acme.in',
    ])
    expect(objs.every(o => o.metadata.namespace === 'jeffi' && o.metadata.labels?.['jeffi.io/showcase-domain'] === 'true')).toBe(true)
    const [cert, route] = objs as any[]
    expect(cert.spec).toEqual({ secretName: 'showcase-acme.in-tls', dnsNames: ['acme.in'], issuerRef: { kind: 'ClusterIssuer', name: 'letsencrypt-http' } })
    expect(route.spec.tls).toEqual({ secretName: 'showcase-acme.in-tls' })
    expect(route.spec.routes[0]).toMatchObject({ match: 'Host(`acme.in`)', services: [{ name: 'jeffi-stores-showcase-service', port: 3000 }] })
  })
})
