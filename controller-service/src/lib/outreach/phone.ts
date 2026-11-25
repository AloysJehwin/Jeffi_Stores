/** Indian mobile numbers only, as E.164 (+91XXXXXXXXXX). Returns null for anything else. */
export function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  let s = String(raw).trim()
  if (!s) return null
  // spreadsheet numbers that went through a float
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '')
  const digits = s.replace(/\D/g, '')
  let national: string
  if (digits.length === 10) national = digits
  else if (digits.length === 11 && digits.startsWith('0')) national = digits.slice(1)
  else if (digits.length === 12 && digits.startsWith('91')) national = digits.slice(2)
  else if (digits.length === 14 && digits.startsWith('0091')) national = digits.slice(4)
  else return null
  return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : null
}
