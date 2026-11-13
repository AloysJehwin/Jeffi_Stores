import type { DomainContact } from '@controller/lib/domains/providers/types'
import type { SearchResult } from '@controller/lib/domains/orders'
import type { OwnerOrderView } from '@controller/lib/domains/owner-api'

export type { DomainContact, SearchResult, OwnerOrderView }

export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export const EMPTY_CONTACT: DomainContact = {
  contactType: 'PERSON',
  firstName: '',
  lastName: '',
  organizationName: '',
  email: '',
  phoneNumber: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  zipCode: '',
  countryCode: 'IN',
}

/** What the server will refuse; checked before submit so the owner sees it next to the form. */
export function contactProblem(c: DomainContact): string | null {
  if (!c.firstName.trim() || !c.lastName.trim()) return 'Enter the first and last name.'
  if (c.contactType === 'COMPANY' && !c.organizationName?.trim()) return 'Enter the business name.'
  if (!/^\S+@\S+\.\S+$/.test(c.email.trim())) return 'Enter a valid email.'
  if (c.phoneNumber.replace(/\D/g, '').length < 10) return 'Enter a phone number.'
  if (!c.addressLine1.trim() || !c.city.trim() || !c.state.trim()) return 'Enter the address, city and state.'
  if (!/^[A-Za-z0-9 -]{3,12}$/.test(c.zipCode.trim())) return 'Enter the PIN code.'
  return null
}
