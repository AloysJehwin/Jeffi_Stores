// What a KYB document says, read from its text (a PDF's text layer or OCR), and how that compares with what the owner
// typed. Pure: analyze.ts feeds it text, the console and the platform admin show its checks.
import { checkGstin, idChars } from './ids'
import { NAME_CLOSE, NAME_MATCH, bestNameLine, datesIn, idCandidates, labelledDate, nameSimilarity, repairId } from './match'

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'missing'

export interface DocCheck {
  field: 'number' | 'name' | 'expiry' | 'constitution' | 'document'
  status: CheckStatus
  expected?: string
  found?: string
  message: string
}

export type Verdict = 'verified' | 'review' | 'mismatch' | 'unreadable'

export interface DocAnalysis {
  docType: string
  verdict: Verdict
  checks: DocCheck[]
  /** What was read off the document. */
  fields: Record<string, string>
  source: 'text' | 'ocr'
  /** What read it: the PDF's own text, PaddleOCR, or the vision model when PaddleOCR was down. */
  engine?: 'pdf' | 'paddleocr' | 'vision'
  /** Characters of text read; 0 means nothing legible. */
  chars: number
  /** What the checks compared against, so a later edit shows the result is out of date. */
  expected: Expected
  analyzedAt: string
}

export interface Expected {
  /** The document's number as the owner typed it (PAN, GSTIN, FSSAI number…). */
  number?: string | null
  /** Names the document may be in: the legal name first, then the trade name or the proprietor's own name. */
  names?: (string | null | undefined)[]
  /** YYYY-MM-DD the owner gave for a licence that lapses. */
  expiresOn?: string | null
  /** The business's constitution (an EntityType) for documents that state it. */
  entity?: string | null
}

interface Spec {
  label: string
  /** The number's layout for repairId (A letter, 9 digit, X either), and an extra test a real one passes. */
  layout?: string
  valid?: (n: string) => boolean
  /** Lines that introduce the holder's name. */
  nameLabel?: RegExp
  /** Lines that introduce the date the document lapses. */
  expiryLabel?: RegExp
  /** Text a genuine document of this kind carries (any one). */
  marks?: RegExp
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/

export const DOC_SPECS: Record<string, Spec> = {
  pan_card: {
    label: 'PAN card',
    layout: 'AAAAA9999A',
    valid: n => PAN_RE.test(n) && 'PCFHATBLJG'.includes(n[3]),
    nameLabel: /^(?!.*father)(?:.*\/\s*)?name\b|^नाम/i,
    marks: /INCOME\s*TAX|PERMANENT\s*ACCOUNT|आयकर/i,
  },
  gst_cert: {
    label: 'GST registration certificate',
    layout: '99AAAAA9999AXXX',
    valid: n => !checkGstin(n).problem,
    nameLabel: /legal\s*name/i,
    marks: /REG-?06|GOODS\s*AND\s*SERVICES\s*TAX|REGISTRATION\s*CERTIFICATE/i,
  },
  udyam: {
    label: 'Udyam registration certificate',
    layout: 'AAAAAAA999999999',
    valid: n => /^UDYAM[A-Z]{2}[0-9]{9}$/.test(n),
    nameLabel: /name\s*of\s*(?:the\s*)?enterprise/i,
    marks: /UDYAM/i,
  },
  coi: {
    label: 'Certificate of incorporation',
    layout: 'A99999AA9999AAA999999',
    valid: n => /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(n),
    nameLabel: /certify\s*that|name\s*of\s*(?:the\s*)?company/i,
    marks: /INCORPORATION|CORPORATE\s*IDENTITY|COMPANIES\s*ACT/i,
  },
  llp_cert: {
    label: 'LLP certificate of incorporation',
    layout: 'AAA9999',
    valid: n => /^[A-Z]{3}[0-9]{4}$/.test(n),
    nameLabel: /certify\s*that|name\s*of\s*(?:the\s*)?llp/i,
    marks: /LIMITED\s*LIABILITY\s*PARTNERSHIP|LLPIN/i,
  },
  fssai: {
    label: 'FSSAI licence or registration',
    layout: '99999999999999',
    valid: n => /^[0-9]{14}$/.test(n),
    nameLabel:
      /name\s*(?:and|&)?\s*(?:registered\s*)?(?:office\s*)?address(?:\s*of\s*(?:the\s*)?(?:licensee|registrant|fbo|food\s*business\s*operator))?|name\s*of\s*(?:the\s*)?(?:licensee|food\s*business(?:\s*operator)?|fbo|registrant)/i,
    expiryLabel: /valid(?:ity)?\s*(?:up\s*to|upto|till|period)?|expir/i,
    marks: /FSSAI|FOOD\s*SAFETY/i,
  },
}

/** A document type without a spec of its own (shop licence, drug licence…): number, name and expiry checked loosely. */
const GENERIC: Spec = { label: 'document', expiryLabel: /valid(?:ity)?\s*(?:up\s*to|upto|till)?|expir|renew/i }

const textLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

/** Numbers of this layout on the document: exact reads first, then OCR-repaired ones. */
function numbersOn(text: string, spec: Spec): string[] {
  if (!spec.layout) return []
  const exact: string[] = []
  const repaired: string[] = []
  for (const c of idCandidates(text, spec.layout.length)) {
    if (spec.valid?.(c) ?? true) exact.push(c)
    else {
      const r = repairId(c, spec.layout)
      if (r && (spec.valid?.(r) ?? true)) repaired.push(r)
    }
  }
  return [...new Set([...exact, ...repaired])]
}

/** The text after a label on its line, else the next line. */
function labelled(lines: string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(label)
    if (!m) continue
    const rest = lines[i]
      .slice((m.index ?? 0) + m[0].length)
      .replace(/^[\s,:.\-–/]+/, '')
      .replace(/^if\s*any\b[\s,:.\-–/]*/i, '')
      .trim()
    if (rest.length >= 3 && /[A-Za-z]/.test(rest)) return rest
    const next = lines[i + 1]?.trim()
    if (next && /[A-Za-z]{2}/.test(next)) return next
  }
  return null
}

const CONSTITUTIONS: [RegExp, string[]][] = [
  [/proprietor/i, ['proprietor']],
  [/limited\s*liability\s*partnership|\bllp\b/i, ['llp']],
  [/partnership/i, ['partnership']],
  [/one\s*person/i, ['opc']],
  [/private\s*limited|pvt\.?\s*ltd/i, ['pvt_ltd', 'opc']],
  [/public\s*limited|limited\s*company/i, ['public_ltd', 'pvt_ltd']],
  [/hindu\s*undivided|\bhuf\b/i, ['huf']],
  [/trust/i, ['trust']],
  [/society|association/i, ['society']],
]

export function analyzeText(docType: string, text: string, expected: Expected, source: 'text' | 'ocr', today: string): DocAnalysis {
  const spec = DOC_SPECS[docType] ?? GENERIC
  const lines = textLines(text)
  const flat = lines.join('\n')
  const fields: Record<string, string> = {}
  const checks: DocCheck[] = []
  const chars = flat.replace(/\s/g, '').length

  if (chars < 20) {
    return {
      docType, verdict: 'unreadable', fields, source, chars, expected, analyzedAt: new Date().toISOString(),
      checks: [{ field: 'document', status: 'missing', message: 'No text could be read from this file. Upload a sharper photo or the original PDF.' }],
    }
  }
  if (spec.marks && !spec.marks.test(flat)) {
    checks.push({ field: 'document', status: 'warn', message: `This doesn't look like a ${spec.label}. Check that you uploaded the right file.` })
  }

  // Number: the one typed, as read off the document.
  const want = docType === 'fssai' ? String(expected.number ?? '').replace(/\D/g, '') : idChars(expected.number, 32)
  if (want) {
    const found = numbersOn(flat, spec)
    if (spec.layout) {
      if (found.length) fields.number = found.includes(want) ? want : found[0]
      if (found.includes(want)) checks.push({ field: 'number', status: 'pass', expected: want, found: want, message: `The number on the ${spec.label} matches.` })
      else if (found.length)
        checks.push({ field: 'number', status: 'fail', expected: want, found: found[0], message: `The ${spec.label} reads ${found[0]}, but you entered ${want}.` })
      else checks.push({ field: 'number', status: 'missing', expected: want, message: `The number couldn't be read off the ${spec.label}.` })
    } else {
      const onDoc = flat.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(want)
      checks.push(
        onDoc
          ? { field: 'number', status: 'pass', expected: want, found: want, message: 'The number you entered appears on the document.' }
          : { field: 'number', status: 'missing', expected: want, message: "The number you entered couldn't be found on the document." }
      )
    }
  }

  // Name: the labelled one when there is a label, else the best-matching line.
  const names = (expected.names ?? []).map(n => String(n ?? '').trim()).filter(Boolean)
  if (names.length) {
    const read = spec.nameLabel ? labelled(lines, spec.nameLabel) : null
    let best: { name: string; text: string; score: number } | null = null
    for (const name of names) {
      const cand = read ? { text: read, score: nameSimilarity(name, read) } : null
      const line = bestNameLine(name, lines)
      for (const c of [cand, line]) if (c && (!best || c.score > best.score)) best = { name, text: c.text, score: c.score }
    }
    if (read) fields.name = read
    if (best && best.score >= NAME_MATCH) checks.push({ field: 'name', status: 'pass', expected: best.name, found: best.text, message: 'The name on the document matches.' })
    else if (best && best.score >= NAME_CLOSE)
      checks.push({ field: 'name', status: 'warn', expected: best.name, found: best.text, message: `The document reads “${best.text}”, close to “${best.name}”. A reviewer will confirm it.` })
    else if (read)
      checks.push({ field: 'name', status: 'fail', expected: names[0], found: read, message: `The document is in the name of “${read}”, not “${names[0]}”.` })
    else checks.push({ field: 'name', status: 'missing', expected: names[0], message: `“${names[0]}” couldn't be found on the document.` })
  }

  // Expiry: the date the document lapses, against the one typed.
  if (spec.expiryLabel) {
    const until = labelledDate(lines, spec.expiryLabel)
    if (until) fields.validUntil = until
    if (expected.expiresOn) {
      if (until === expected.expiresOn) checks.push({ field: 'expiry', status: 'pass', expected: until, found: until, message: 'The expiry date matches.' })
      else if (until)
        checks.push({ field: 'expiry', status: 'fail', expected: expected.expiresOn, found: until, message: `The document is valid until ${until}, but you entered ${expected.expiresOn}.` })
      else checks.push({ field: 'expiry', status: 'missing', expected: expected.expiresOn, message: "The expiry date couldn't be read off the document." })
    }
    const lapse = until ?? expected.expiresOn
    if (lapse && lapse < today) checks.push({ field: 'expiry', status: 'fail', found: lapse, message: `This document expired on ${lapse}. Upload the renewed one.` })
  }

  // What the GST certificate says about the business.
  if (docType === 'gst_cert') {
    const trade = labelled(lines, /trade\s*name/i)
    if (trade && !/^additional/i.test(trade)) fields.tradeName = trade
    const constitution = labelled(lines, /constitution\s*of\s*business/i)
    if (constitution) {
      fields.constitution = constitution
      const kinds = CONSTITUTIONS.find(([re]) => re.test(constitution))?.[1]
      if (expected.entity && kinds && !kinds.includes(expected.entity))
        checks.push({ field: 'constitution', status: 'warn', expected: expected.entity, found: constitution, message: `The certificate gives the constitution as “${constitution}”. Check the business type you picked.` })
    }
    const address = labelled(lines, /address\s*of\s*principal\s*place(?:\s*of\s*business)?/i)
    if (address) fields.address = address
  }
  if (docType === 'pan_card') {
    const dob = labelledDate(lines, /date\s*of\s*(?:birth|incorporation|formation)|जन्म/i) ?? datesIn(flat)[0]
    if (dob) fields.date = dob
  }

  return { docType, verdict: verdictOf(checks), checks, fields, source, chars, expected, analyzedAt: new Date().toISOString() }
}

export function verdictOf(checks: DocCheck[]): Verdict {
  if (checks.some(c => c.status === 'fail')) return 'mismatch'
  if (checks.some(c => c.field === 'number' && c.status === 'missing')) return 'unreadable'
  if (checks.some(c => c.status === 'warn' || c.status === 'missing')) return 'review'
  return 'verified'
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  verified: 'Checked automatically',
  review: 'Needs a reviewer',
  mismatch: 'Doesn’t match',
  unreadable: 'Couldn’t be read',
}
