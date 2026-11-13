import type { DomainDns, DomainHosting, DomainRegistrar } from './types'
import { FakeDns, FakeHosting, FakeRegistrar } from './fake'

export * from './types'

// Real Route 53 Domains / Route 53 / cluster calls only with DOMAIN_REGISTRAR=route53 in a production build,
// never under vitest. Anything else gets the fake, so local dev (which has real AWS keys) and tests can't
// register, renew or write DNS.
export function domainsLive(): boolean {
  return process.env.DOMAIN_REGISTRAR === 'route53' && process.env.NODE_ENV === 'production' && !process.env.VITEST
}

/** Production without the real registrar has the feature off rather than pretending to register. */
export function domainPurchaseEnabled(): boolean {
  return domainsLive() || process.env.NODE_ENV !== 'production'
}

export interface DomainProviders {
  registrar: DomainRegistrar
  dns: DomainDns
  hosting: DomainHosting
}

let cached: DomainProviders | null = null
let override: DomainProviders | null = null

export async function domainProviders(): Promise<DomainProviders> {
  if (override) return override
  if (cached) return cached
  if (domainsLive()) {
    const [{ Route53Registrar, Route53Dns }, { ClusterHosting }] = await Promise.all([import('./route53'), import('./cluster')])
    cached = { registrar: new Route53Registrar(), dns: new Route53Dns(), hosting: new ClusterHosting() }
  } else {
    cached = { registrar: new FakeRegistrar(), dns: new FakeDns(), hosting: new FakeHosting() }
  }
  return cached
}

/** Tests: swap in spies. */
export function setDomainProviders(p: DomainProviders | null) {
  override = p
}
