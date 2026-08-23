import type { Policy, Section } from '@/app/legal/policies'
import { policies, POLICY_VERSION } from '@/app/legal/policies'
import { generatePolicyPDF } from '@/lib/policy-pdf'

export interface TenantLegalInfo {
  businessName: string
  address: string
  gstin?: string
  email?: string
  phone?: string
  logoUrl?: string
  sealUrl?: string
}

export { POLICY_VERSION }

const PLATFORM = {
  businessName: 'Jeffi Stores',
  address: 'Sanjay Gandhi Chowk, Station Road, Raipur, CG 490092',
  addressAlt: 'SANJAY GANTHI CHOWK, STATION ROAD, RAIPUR, CHHATTISGARH-490092',
  gstin: '',
  email: 'jeffistoress@gmail.com',
  supportEmail: 'support@jeffistores.in',
  phone: '+91 96853 54099',
  web: 'jeffistores.in',
}

function applyReplacements(text: string, info: TenantLegalInfo): string {
  let out = text
    .split(PLATFORM.addressAlt).join(info.address)
    .split(PLATFORM.address).join(info.address)
    .split('Raipur, Chhattisgarh, India').join(info.address)
    .split('Raipur, Chhattisgarh').join(info.address)

  if (info.phone) out = out.split(PLATFORM.phone).join(info.phone)

  if (info.email) {
    out = out.split(PLATFORM.supportEmail).join(info.email)
    out = out.split(PLATFORM.email).join(info.email)
  }

  out = out.split(`${PLATFORM.businessName}, ${info.address}`).join(`${info.businessName}, ${info.address}`)
  out = out.split(PLATFORM.businessName).join(info.businessName)

  out = out
    .split('business.jeffistores.in').join(`business.${PLATFORM.web}`)
    .split('admin.jeffistores.in').join(`admin.${PLATFORM.web}`)

  return out
}

function templateSection(section: Section, info: TenantLegalInfo): Section {
  const body = Array.isArray(section.body)
    ? section.body.map((line) => applyReplacements(line, info))
    : applyReplacements(section.body, info)
  return { heading: section.heading, body }
}

export function buildTenantPolicies(info: TenantLegalInfo): Policy[] {
  return policies.map((policy) => ({
    slug: policy.slug,
    title: policy.title,
    description: applyReplacements(policy.description, info),
    lastUpdated: policy.lastUpdated,
    sections: policy.sections.map((section) => templateSection(section, info)),
  }))
}

async function toImageBuffer(src?: string): Promise<Buffer | undefined> {
  if (!src) return undefined
  if (!/^https?:\/\//i.test(src)) return undefined
  try {
    const res = await fetch(src)
    if (!res.ok) return undefined
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return undefined
  }
}

export async function generateTenantPolicyPdf(policy: Policy, info: TenantLegalInfo): Promise<Buffer> {
  const [logo, seal] = await Promise.all([
    toImageBuffer(info.logoUrl),
    toImageBuffer(info.sealUrl),
  ])
  return generatePolicyPDF(policy, { logo, seal })
}
