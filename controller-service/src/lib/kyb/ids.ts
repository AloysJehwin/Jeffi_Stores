// India business identifiers for KYB: shape, check character, and how they relate (a GSTIN carries the business's
// PAN and state; a PAN's 4th letter says who holds it). Pure, so the console (as the owner types), the routes that
// save them and the document analysis all apply the same rules.
import { getStateCode, stateNameFromCode } from '@/lib/catalog/gst'

export type EntityType =
  | 'proprietor'
  | 'partnership'
  | 'llp'
  | 'pvt_ltd'
  | 'public_ltd'
  | 'opc'
  | 'huf'
  | 'trust'
  | 'society'
  | 'other'

export const ENTITY_TYPES: { id: EntityType; label: string }[] = [
  { id: 'proprietor', label: 'Sole proprietorship' },
  { id: 'partnership', label: 'Partnership firm' },
  { id: 'llp', label: 'Limited liability partnership (LLP)' },
  { id: 'pvt_ltd', label: 'Private limited company' },
  { id: 'opc', label: 'One person company (OPC)' },
  { id: 'public_ltd', label: 'Public limited company' },
  { id: 'huf', label: 'Hindu undivided family (HUF)' },
  { id: 'trust', label: 'Trust' },
  { id: 'society', label: 'Society or association' },
  { id: 'other', label: 'Other' },
]

export const isEntityType = (v: unknown): v is EntityType => ENTITY_TYPES.some(e => e.id === v)

/** tenant_kyc.business_type keeps its five original values. */
export const kycBusinessType = (e: EntityType): 'proprietor' | 'partnership' | 'pvt_ltd' | 'llp' | 'other' =>
  e === 'proprietor' || e === 'partnership' || e === 'llp' || e === 'pvt_ltd' ? e : e === 'opc' || e === 'public_ltd' ? 'pvt_ltd' : 'other'

/** Letters and digits in capitals: what an ID field keeps of what is typed, pasted or read off a document. */
export const idChars = (v: string | null | undefined, max = 32) =>
  String(v ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, max)

export interface IdCheck {
  ok: boolean
  /** Why it is not valid, in a sentence the owner can act on. */
  problem?: string
}

const fail = (problem: string): IdCheck => ({ ok: false, problem })
const OK: IdCheck = { ok: true }

// ── PAN ──

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/

/** The PAN's 4th letter: who the Income Tax Department issued it to. */
export const PAN_HOLDERS: Record<string, string> = {
  P: 'an individual',
  C: 'a company',
  F: 'a firm or LLP',
  H: 'a Hindu undivided family',
  A: 'an association of persons',
  T: 'a trust',
  B: 'a body of individuals',
  L: 'a local authority',
  J: 'an artificial juridical person',
  G: 'a government body',
}

/** The 4th letters a business of this type can hold. A proprietorship uses the proprietor's own PAN. */
const PAN_LETTERS: Record<EntityType, string> = {
  proprietor: 'P',
  partnership: 'F',
  llp: 'F',
  pvt_ltd: 'C',
  opc: 'C',
  public_ltd: 'C',
  huf: 'H',
  trust: 'TA',
  society: 'AT',
  other: Object.keys(PAN_HOLDERS).join(''),
}

export function checkPan(pan: string, entity?: EntityType | null): IdCheck {
  const p = idChars(pan, 10)
  if (!PAN_RE.test(p)) return fail('Enter the PAN as 5 letters, 4 digits and a letter, like ABCDE1234F.')
  const holder = PAN_HOLDERS[p[3]]
  if (!holder) return fail(`${p} is not a valid PAN: its 4th letter, ${p[3]}, is not one the Income Tax Department issues.`)
  if (entity && !PAN_LETTERS[entity].includes(p[3])) {
    const label = ENTITY_TYPES.find(e => e.id === entity)?.label.toLowerCase() ?? 'business'
    return fail(
      entity === 'proprietor'
        ? `${p} is the PAN of ${holder}. A sole proprietorship uses the proprietor's own PAN (its 4th letter is P).`
        : `${p} is the PAN of ${holder}, not of a ${label}. Enter the business's own PAN.`
    )
  }
  return OK
}

// ── GSTIN ──

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]$/

/** The GSTIN's 15th character, computed from the first 14 (GSTN's mod-36 check). */
export function gstinCheckChar(first14: string): string {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const p = GST_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(p / 36) + (p % 36)
  }
  return GST_CHARS[(36 - (sum % 36)) % 36]
}

export interface GstinParts {
  stateCode: string
  state: string
  pan: string
}

export const gstinParts = (gstin: string): GstinParts => {
  const g = idChars(gstin, 15)
  return { stateCode: g.slice(0, 2), state: stateNameFromCode(g.slice(0, 2)), pan: g.slice(2, 12) }
}

/** A GSTIN's shape and check character, and (when given) that it carries this PAN and is registered in this state. */
export function checkGstin(gstin: string, expect: { pan?: string | null; state?: string | null } = {}): IdCheck {
  const g = idChars(gstin, 15)
  if (!GSTIN_RE.test(g)) return fail('Enter the 15-character GSTIN, like 27AAPFU0939F1ZV.')
  if (!stateNameFromCode(g.slice(0, 2)) && g.slice(0, 2) !== '97' && g.slice(0, 2) !== '99')
    return fail(`${g} does not start with an Indian state code.`)
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return fail(`${g} is not a valid GSTIN: its last character doesn't match. Check for a typo.`)
  const pan = idChars(expect.pan, 10)
  if (pan && g.slice(2, 12) !== pan) return fail(`This GSTIN belongs to PAN ${g.slice(2, 12)}, not ${pan}. A GSTIN carries the business's own PAN.`)
  const code = expect.state ? getStateCode(expect.state) : ''
  if (code && g.slice(0, 2) !== code)
    return fail(`This GSTIN is registered in ${stateNameFromCode(g.slice(0, 2)) || `state ${g.slice(0, 2)}`}, but your address is in ${expect.state}.`)
  return OK
}

// ── Registration numbers ──

const CIN_RE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}(PLC|PTC|FTC|GOI|SGC|NPL|ULL|ULT|GAP|GAT|FLC|OPC)[0-9]{6}$/
const LLPIN_RE = /^[A-Z]{3}[0-9]{4}$/
const UDYAM_RE = /^UDYAM[A-Z]{2}[0-9]{2}[0-9]{7}$/

/** Corporate Identification Number (MCA): 21 characters, like U72900KA2019PTC123456. */
export function checkCin(cin: string): IdCheck {
  return CIN_RE.test(idChars(cin, 21)) ? OK : fail('Enter the 21-character CIN from your certificate of incorporation, like U72900KA2019PTC123456.')
}

/** LLP Identification Number (MCA): AAA-1234. */
export function checkLlpin(llpin: string): IdCheck {
  return LLPIN_RE.test(idChars(llpin, 7)) ? OK : fail('Enter the LLPIN as 3 letters and 4 digits, like AAB-1234.')
}

/** Udyam registration number: UDYAM-XX-00-0000000. */
export function checkUdyam(udyam: string): IdCheck {
  return UDYAM_RE.test(idChars(udyam, 19)) ? OK : fail('Enter the Udyam number as UDYAM-XX-00-0000000, from your Udyam certificate.')
}

export const formatUdyam = (v: string) => {
  const u = idChars(v, 19)
  return UDYAM_RE.test(u) ? `UDYAM-${u.slice(5, 7)}-${u.slice(7, 9)}-${u.slice(9)}` : u
}

export const formatLlpin = (v: string) => {
  const l = idChars(v, 7)
  return LLPIN_RE.test(l) ? `${l.slice(0, 3)}-${l.slice(3)}` : l
}

/** FSSAI licence or registration number: 14 digits. */
export function checkFssai(n: string): IdCheck {
  return /^[0-9]{14}$/.test(String(n ?? '').replace(/\s+/g, '')) ? OK : fail('Enter the 14-digit FSSAI licence or registration number.')
}
