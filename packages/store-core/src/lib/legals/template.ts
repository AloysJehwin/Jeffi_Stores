import type { Policy, Section } from '@/lib/legals/policies'
import { policies } from '@/lib/legals/policies'
import { tenantNoReplyAddress } from '@/lib/catalog/brand'

// Rewrites the flagship's policy text for a tenant store: its name, address, contact details and
// web address in place of Jeffi Stores'. Pure — the store's details are passed in.

export interface TenantLegalInfo {
  businessName: string
  /** Used for the tenant's own noreply address when they have set no contact email. */
  slug: string
  address: string
  /** Registered legal entity, used where the policies name the operator with its address. */
  legalName?: string
  gstin?: string
  email?: string
  phone?: string
  /** The store's host, e.g. acme.jeffistores.in or its own domain. */
  web?: string
  /** "City, State" for the jurisdiction clause; the address when unknown. */
  jurisdiction?: string
  logoUrl?: string
  sealUrl?: string
}

/** Flagship-only policies never shown to a tenant's shoppers. */
export const TENANT_HIDDEN_POLICIES = new Set(['merchant-agreement'])

const PLATFORM = {
  businessName: 'Jeffi Stores',
  address: 'Sanjay Gandhi Chowk, Station Road, Raipur, CG 490092',
  addressAlt: 'SANJAY GANTHI CHOWK, STATION ROAD, RAIPUR, CHHATTISGARH-490092',
  email: 'jeffistoress@gmail.com',
  supportEmail: 'support@jeffistores.in',
  phone: '+91 96853 54099',
  web: 'jeffistores.in',
}

const swap = (s: string, from: string, to: string) => s.split(from).join(to)

export function applyReplacements(text: string, info: TenantLegalInfo): string {
  const web = info.web?.trim() || `${info.slug}.${PLATFORM.web}`
  const jurisdiction = info.jurisdiction?.trim() || info.address
  const address = info.address || jurisdiction || web
  const operator = info.legalName?.trim() || info.businessName

  let out = text
  // Tenant stores have no Android app of their own.
  out = swap(out, ` or in the ${PLATFORM.businessName} app for Android (com.jeffistores.app). It is one account for both, so deleting it removes your access to the website and the app.`, '.')
  out = swap(out, ' (website and Android app)', '')
  out = swap(out, 'App analytics linked', 'Analytics linked')
  out = swap(out, `Postal: ${PLATFORM.businessName}, Raipur, Chhattisgarh`, `Postal: ${operator}, ${address}`)
  out = swap(out, PLATFORM.addressAlt, address)
  out = swap(out, PLATFORM.address, address)
  out = swap(out, 'Raipur, Chhattisgarh, India', address)
  out = swap(out, 'Raipur, Chhattisgarh', jurisdiction || address)

  // A legal document must never carry another business's contact details: fall back to the
  // tenant's own noreply address, and drop the phone line rather than substitute someone else's.
  const contactEmail = info.email?.trim() || tenantNoReplyAddress(info.slug)
  out = swap(out, PLATFORM.supportEmail, contactEmail)
  out = swap(out, PLATFORM.email, contactEmail)

  if (info.phone?.trim()) {
    out = swap(out, PLATFORM.phone, info.phone.trim())
  } else {
    out = swap(out, ` or call ${PLATFORM.phone}`, '')
    out = swap(out, `, or call ${PLATFORM.phone}`, '')
    out = swap(out, PLATFORM.phone, contactEmail)
  }

  out = swap(out, `${PLATFORM.businessName}, ${address}`, `${operator}, ${address}`)
  out = swap(out, 'Jeffi-Stores', info.businessName)
  out = swap(out, PLATFORM.businessName, info.businessName)

  // Hosts: the store's own, never the platform's (emails above are already rewritten).
  out = swap(out, ` (and the business.${PLATFORM.web} / admin.${PLATFORM.web} subdomains)`, '')
  out = swap(out, `business.${PLATFORM.web}`, web)
  out = swap(out, `admin.${PLATFORM.web}`, web)
  out = out.replace(/(^|[^@\w.-])jeffistores\.in\b/g, `$1${web}`)

  return out
}

// List lines: no phone line without a phone, and the GSTIN beside the registered address.
function templateLines(lines: string[], info: TenantLegalInfo): string[] {
  const out: string[] = []
  for (const line of lines) {
    if (line === `Phone: ${PLATFORM.phone}` && !info.phone?.trim()) continue
    if (line.startsWith('In the app: ')) continue
    out.push(applyReplacements(line, info))
    if (line === `Address: ${PLATFORM.address}` && info.gstin?.trim()) out.push(`GSTIN: ${info.gstin.trim()}`)
  }
  return out
}

function templateSection(section: Section, info: TenantLegalInfo): Section {
  const body = Array.isArray(section.body) ? templateLines(section.body, info) : applyReplacements(section.body, info)
  return { heading: applyReplacements(section.heading, info), body }
}

export function buildTenantPolicies(info: TenantLegalInfo): Policy[] {
  return policies
    .filter(p => !TENANT_HIDDEN_POLICIES.has(p.slug))
    .map(policy => ({
      ...policy,
      title: applyReplacements(policy.title, info),
      description: applyReplacements(policy.description, info),
      sections: policy.sections.map(section => templateSection(section, info)),
    }))
}
