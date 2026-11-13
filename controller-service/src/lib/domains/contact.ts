import { z } from 'zod'
import type { DomainContact } from './providers/types'

// The registrant contact sent to Route 53 Domains (admin, registrant and tech; privacy protection hides it
// from WHOIS). The registry emails this address to confirm it.

/** +CC.NUMBER, as Route 53 wants it. Accepts 10-digit Indian numbers with or without +91 / 91. */
export function normalizePhone(raw: string): string | null {
  const s = raw.replace(/[\s()-]/g, '')
  const intl = s.match(/^\+(\d{1,3})\.(\d{4,15})$/)
  if (intl) return s
  const india = s.match(/^(?:\+?91)?0?(\d{10})$/)
  return india ? `+91.${india[1]}` : null
}

const text = (max: number) => z.string().trim().min(1).max(max)

export const ContactSchema = z
  .object({
    contactType: z.enum(['PERSON', 'COMPANY']),
    firstName: text(60),
    lastName: text(60),
    organizationName: z.string().trim().max(120).optional(),
    email: z.string().trim().email().max(254),
    phoneNumber: z.string().trim().min(6).max(24),
    addressLine1: text(255),
    addressLine2: z.string().trim().max(255).optional(),
    city: text(60),
    state: text(60),
    zipCode: z.string().trim().regex(/^[A-Za-z0-9 -]{3,12}$/, 'Enter a valid PIN / ZIP code'),
    countryCode: z.string().trim().regex(/^[A-Z]{2}$/).default('IN'),
  })
  .transform((c, ctx) => {
    const phone = normalizePhone(c.phoneNumber)
    if (!phone) ctx.addIssue({ code: 'custom', path: ['phoneNumber'], message: 'Enter the phone as +91.9876543210' })
    if (c.contactType === 'COMPANY' && !c.organizationName) ctx.addIssue({ code: 'custom', path: ['organizationName'], message: 'Enter the business name' })
    return { ...c, phoneNumber: phone ?? c.phoneNumber, organizationName: c.contactType === 'COMPANY' ? c.organizationName : undefined } as DomainContact
  })

export const firstIssue = (e: z.ZodError) => {
  const i = e.issues[0]
  return i ? `${i.path.join('.') ? `${i.path.join('.')}: ` : ''}${i.message}` : 'Check the contact details'
}

/** Prefill from what onboarding collected: owner, KYC and the pickup warehouse. */
export function defaultContact(src: {
  ownerName?: string | null
  email: string
  mobile?: string | null
  businessName?: string | null
  businessType?: string | null
  businessAddress?: string | null
  warehouse?: { sellerAddress?: string; originPincode?: string } | null
}): Partial<DomainContact> {
  const [firstName, ...rest] = (src.ownerName ?? '').trim().split(/\s+/)
  const company = !!src.businessType && src.businessType !== 'proprietor' && !!src.businessName
  return {
    contactType: company ? 'COMPANY' : 'PERSON',
    firstName: firstName || '',
    lastName: rest.join(' '),
    organizationName: company ? src.businessName ?? '' : '',
    email: src.email,
    phoneNumber: src.mobile ? normalizePhone(src.mobile) ?? src.mobile : '',
    addressLine1: (src.warehouse?.sellerAddress || src.businessAddress || '').slice(0, 255),
    city: '',
    state: '',
    zipCode: src.warehouse?.originPincode ?? '',
    countryCode: 'IN',
  }
}
