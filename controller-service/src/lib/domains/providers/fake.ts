import type { Availability, DomainContact, DomainDns, DomainHosting, DomainRegistrar, OperationStatus, TldPrice } from './types'
import { RegistrarError } from './types'

// Local dev and tests: no AWS or cluster call ever. Stateless and deterministic, so it survives restarts:
// an operation id carries its domain, kind and start time, and finishes DOMAIN_FAKE_OP_SECONDS later.
//   a label containing "taken"   → UNAVAILABLE        "premium" → UNAVAILABLE_PREMIUM
//   a label containing "fail"    → registration ends in ERROR (the refund path)
//   a label containing "renewfail" → renewal ends in ERROR

// Illustrative list prices (USD), not AWS's.
const PRICES: TldPrice[] = [
  { tld: 'com', registrationUsd: 15, renewalUsd: 15 },
  { tld: 'in', registrationUsd: 13, renewalUsd: 13 },
  { tld: 'net', registrationUsd: 17, renewalUsd: 17 },
  { tld: 'org', registrationUsd: 15, renewalUsd: 15 },
  { tld: 'co', registrationUsd: 25, renewalUsd: 25 },
  { tld: 'store', registrationUsd: 48, renewalUsd: 48 },
  { tld: 'shop', registrationUsd: 36, renewalUsd: 36 },
  { tld: 'online', registrationUsd: 38, renewalUsd: 38 },
]
const TAKEN = new Set(['google', 'amazon', 'jeffi', 'jeffistores', 'flipkart'])

const opSeconds = () => Math.max(0, Number(process.env.DOMAIN_FAKE_OP_SECONDS ?? 20))
const label = (domain: string) => domain.split('.')[0]
const encode = (s: string) => Buffer.from(s).toString('base64url')
const decode = (s: string) => Buffer.from(s, 'base64url').toString()

function parseOp(id: string): { kind: 'reg' | 'ren'; domain: string; at: number } {
  const m = id.match(/^fake-(reg|ren)-([A-Za-z0-9_-]+)-(\d+)$/)
  if (!m) throw new RegistrarError('InvalidInput', `Unknown operation ${id}`)
  return { kind: m[1] as 'reg' | 'ren', domain: decode(m[2]), at: Number(m[3]) }
}

export class FakeRegistrar implements DomainRegistrar {
  readonly live = false

  async checkAvailability(domain: string): Promise<Availability> {
    const name = label(domain)
    if (!PRICES.some(p => domain.endsWith('.' + p.tld))) return 'INVALID_NAME_FOR_TLD'
    if (TAKEN.has(name) || name.includes('taken')) return 'UNAVAILABLE'
    if (name.includes('premium')) return 'UNAVAILABLE_PREMIUM'
    return 'AVAILABLE'
  }

  async suggestions(domain: string, count: number) {
    const name = label(domain)
    const out: { domain: string; availability: Availability }[] = []
    for (const variant of [`get${name}`, `${name}store`, `${name}shop`, `the${name}`, `${name}online`, `${name}india`]) {
      for (const tld of ['com', 'in']) {
        const d = `${variant}.${tld}`
        out.push({ domain: d, availability: await this.checkAvailability(d) })
      }
    }
    return out.slice(0, count)
  }

  async listPrices() {
    return PRICES
  }

  async register(domain: string, contact: DomainContact) {
    if (!contact.email || !contact.phoneNumber) throw new RegistrarError('InvalidInput', 'Contact email and phone are required')
    if ((await this.checkAvailability(domain)) !== 'AVAILABLE') throw new RegistrarError('DomainLimitExceeded', `${domain} is not available`)
    return { operationId: `fake-reg-${encode(domain)}-${Date.now()}` }
  }

  async operation(operationId: string): Promise<{ status: OperationStatus; message: string | null }> {
    const op = parseOp(operationId)
    const elapsed = (Date.now() - op.at) / 1000
    if (elapsed < opSeconds() / 2) return { status: 'SUBMITTED', message: null }
    if (elapsed < opSeconds()) return { status: 'IN_PROGRESS', message: null }
    const failing = op.kind === 'reg' ? label(op.domain).includes('fail') && !label(op.domain).includes('renewfail') : label(op.domain).includes('renewfail')
    if (failing) return { status: 'ERROR', message: 'The registry rejected the request (fake).' }
    return { status: 'SUCCESSFUL', message: null }
  }

  async findOperation() {
    return null
  }

  async domainDetail() {
    return null
  }

  async renew(domain: string) {
    return { operationId: `fake-ren-${encode(domain)}-${Date.now()}` }
  }

  async contactVerified() {
    return true
  }
}

export class FakeDns implements DomainDns {
  async hostedZoneFor(domain: string) {
    return `ZFAKE${encode(domain).slice(0, 12).toUpperCase()}`
  }

  async pointAtCluster() {}
}

export class FakeHosting implements DomainHosting {
  readonly live = false

  async applyRoutes() {}

  async certReady(_slug: string, _host: string, requestedAt: Date) {
    return Date.now() - requestedAt.getTime() >= (opSeconds() / 2) * 1000
  }
}
