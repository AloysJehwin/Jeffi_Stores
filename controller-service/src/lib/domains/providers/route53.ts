import 'server-only'
import { signedAwsFetch } from '@/lib/shared/aws-signing'
import type { Availability, DomainContact, DomainDns, DomainRegistrar, OperationStatus, TldPrice } from './types'
import { RegistrarError } from './types'

// Real Route 53 Domains (JSON 1.1, us-east-1) and Route 53 (REST/XML) clients, signed with the shared SigV4
// helper like tenant-dns.ts (no @aws-sdk/client-route-53* in the registry). Constructed only by providers/index.ts
// in production config. Every call here is billed or mutating except the reads; never call it from tests.

const DOMAINS_HOST = 'route53domains.us-east-1.amazonaws.com'
const ROUTE53_HOST = 'route53.amazonaws.com'
const RETRYABLE = new Set(['ThrottlingException', 'OperationLimitExceeded', 'ServiceUnavailable', 'InternalFailure'])

async function domainsCall<T>(op: string, body: Record<string, unknown>): Promise<T> {
  const payload = JSON.stringify(body)
  const res = await signedAwsFetch({
    service: 'route53domains',
    region: 'us-east-1',
    method: 'POST',
    hostname: DOMAINS_HOST,
    path: '/',
    headers: { host: DOMAINS_HOST, 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `Route53Domains_v20140515.${op}` },
    body: payload,
  })
  const text = await res.text().catch(() => '')
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const code = String(json.__type ?? 'Unknown').split('#').pop()!
    throw new RegistrarError(code, `${op}: ${json.message ?? json.Message ?? res.status}`, RETRYABLE.has(code) || res.status >= 500)
  }
  return json as T
}

function awsContact(c: DomainContact) {
  return {
    ContactType: c.contactType,
    FirstName: c.firstName,
    LastName: c.lastName,
    ...(c.contactType !== 'PERSON' && c.organizationName ? { OrganizationName: c.organizationName } : {}),
    Email: c.email,
    PhoneNumber: c.phoneNumber,
    AddressLine1: c.addressLine1,
    ...(c.addressLine2 ? { AddressLine2: c.addressLine2 } : {}),
    City: c.city,
    State: c.state,
    ZipCode: c.zipCode,
    CountryCode: c.countryCode,
  }
}

export class Route53Registrar implements DomainRegistrar {
  readonly live = true

  async checkAvailability(domain: string) {
    const r = await domainsCall<{ Availability: Availability }>('CheckDomainAvailability', { DomainName: domain })
    return r.Availability
  }

  async suggestions(domain: string, count: number) {
    const r = await domainsCall<{ SuggestionsList?: { DomainName: string; Availability: Availability }[] }>('GetDomainSuggestions', {
      DomainName: domain,
      SuggestionCount: count,
      OnlyAvailable: true,
    })
    return (r.SuggestionsList ?? []).map(s => ({ domain: s.DomainName, availability: s.Availability }))
  }

  async listPrices() {
    const out: TldPrice[] = []
    let marker: string | undefined
    for (let page = 0; page < 20; page++) {
      const r = await domainsCall<{ Prices?: any[]; NextPageMarker?: string }>('ListPrices', { MaxItems: 1000, ...(marker ? { Marker: marker } : {}) })
      for (const p of r.Prices ?? []) {
        if (p.RegistrationPrice?.Currency !== 'USD') continue
        out.push({ tld: p.Name, registrationUsd: Number(p.RegistrationPrice.Price), renewalUsd: Number(p.RenewalPrice?.Price ?? p.RegistrationPrice.Price) })
      }
      if (!r.NextPageMarker) break
      marker = r.NextPageMarker
    }
    return out
  }

  async register(domain: string, contact: DomainContact) {
    const c = awsContact(contact)
    const r = await domainsCall<{ OperationId: string }>('RegisterDomain', {
      DomainName: domain,
      DurationInYears: 1,
      AutoRenew: false,
      AdminContact: c,
      RegistrantContact: c,
      TechContact: c,
      PrivacyProtectAdminContact: true,
      PrivacyProtectRegistrantContact: true,
      PrivacyProtectTechContact: true,
    })
    return { operationId: r.OperationId }
  }

  async operation(operationId: string) {
    const r = await domainsCall<{ Status: OperationStatus; Message?: string }>('GetOperationDetail', { OperationId: operationId })
    return { status: r.Status, message: r.Message ?? null }
  }

  async findOperation(domain: string, type: 'REGISTER_DOMAIN' | 'RENEW_DOMAIN') {
    const r = await domainsCall<{ Operations?: { OperationId: string; Status: OperationStatus; DomainName?: string; Type: string }[] }>('ListOperations', {
      Type: [type],
      SortBy: 'SubmittedDate',
      SortOrder: 'DESC',
      MaxItems: 100,
    })
    const op = (r.Operations ?? []).find(o => o.DomainName === domain && o.Type === type)
    return op ? { operationId: op.OperationId, status: op.Status } : null
  }

  async domainDetail(domain: string) {
    try {
      const r = await domainsCall<{ ExpirationDate?: number }>('GetDomainDetail', { DomainName: domain })
      return { expiresAt: r.ExpirationDate ? new Date(r.ExpirationDate * 1000) : null }
    } catch (e) {
      if (e instanceof RegistrarError && e.code === 'InvalidInput') return null
      throw e
    }
  }

  async renew(domain: string, currentExpiryYear: number) {
    const r = await domainsCall<{ OperationId: string }>('RenewDomain', { DomainName: domain, DurationInYears: 1, CurrentExpiryYear: currentExpiryYear })
    return { operationId: r.OperationId }
  }

  async contactVerified(domain: string) {
    const r = await domainsCall<{ status?: string }>('GetContactReachabilityStatus', { domainName: domain })
    return r.status === 'DONE'
  }
}

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)

async function route53(method: string, path: string, body?: string): Promise<string> {
  const res = await signedAwsFetch({
    service: 'route53',
    region: 'us-east-1',
    method,
    hostname: ROUTE53_HOST,
    path,
    headers: { host: ROUTE53_HOST, ...(body ? { 'content-type': 'application/xml' } : {}) },
    ...(body ? { body } : {}),
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new RegistrarError('Route53', `Route 53 ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`, res.status >= 500 || (res.status === 400 && /Throttling/.test(text)))
  return text
}

export class Route53Dns implements DomainDns {
  async hostedZoneFor(domain: string) {
    const xml = await route53('GET', `/2013-04-01/hostedzonesbyname?dnsname=${encodeURIComponent(domain)}&maxitems=5`)
    for (const m of xml.matchAll(/<HostedZone>([\s\S]*?)<\/HostedZone>/g)) {
      const name = m[1].match(/<Name>([^<]+)<\/Name>/)?.[1]
      const id = m[1].match(/<Id>\/hostedzone\/([^<]+)<\/Id>/)?.[1]
      const priv = m[1].match(/<PrivateZone>true<\/PrivateZone>/)
      if (id && !priv && name?.replace(/\.$/, '') === domain) return id
    }
    return null
  }

  async pointAtCluster(zoneId: string, hosts: string[]) {
    const ip = process.env.CLUSTER_INGRESS_IP?.trim()
    if (!ip) throw new RegistrarError('Config', 'CLUSTER_INGRESS_IP is not set; refusing to write records without a target')
    const changes = hosts
      .map(
        h => `<Change><Action>UPSERT</Action><ResourceRecordSet><Name>${xmlEscape(h)}</Name><Type>A</Type><TTL>300</TTL><ResourceRecords><ResourceRecord><Value>${xmlEscape(ip)}</Value></ResourceRecord></ResourceRecords></ResourceRecordSet></Change>`
      )
      .join('')
    await route53(
      'POST',
      `/2013-04-01/hostedzone/${encodeURIComponent(zoneId)}/rrset`,
      `<?xml version="1.0" encoding="UTF-8"?><ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/"><ChangeBatch><Comment>jeffi domain purchase</Comment><Changes>${changes}</Changes></ChangeBatch></ChangeResourceRecordSetsRequest>`
    )
  }
}
