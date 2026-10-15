'use client'

import { useEffect, useState } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import { fieldCls } from './choice'

// Country picker + national number → E.164 (`+919876543210`). Lengths are national significant digits.
export const PHONE_COUNTRIES = [
  { iso: 'IN', name: 'India', code: '91', len: [10], example: '98765 43210' },
  { iso: 'AE', name: 'United Arab Emirates', code: '971', len: [9], example: '50 123 4567' },
  { iso: 'US', name: 'United States', code: '1', len: [10], example: '201 555 0123' },
  { iso: 'GB', name: 'United Kingdom', code: '44', len: [10], example: '7400 123456' },
  { iso: 'SG', name: 'Singapore', code: '65', len: [8], example: '8123 4567' },
  { iso: 'SA', name: 'Saudi Arabia', code: '966', len: [9], example: '51 234 5678' },
  { iso: 'QA', name: 'Qatar', code: '974', len: [8], example: '3312 3456' },
  { iso: 'KW', name: 'Kuwait', code: '965', len: [8], example: '500 12345' },
  { iso: 'OM', name: 'Oman', code: '968', len: [8], example: '9212 3456' },
  { iso: 'BH', name: 'Bahrain', code: '973', len: [8], example: '3600 1234' },
  { iso: 'AU', name: 'Australia', code: '61', len: [9], example: '412 345 678' },
  { iso: 'CA', name: 'Canada', code: '1', len: [10], example: '506 234 5678' },
  { iso: 'NP', name: 'Nepal', code: '977', len: [10], example: '984 1234567' },
  { iso: 'BD', name: 'Bangladesh', code: '880', len: [10], example: '1812 345678' },
  { iso: 'LK', name: 'Sri Lanka', code: '94', len: [9], example: '71 234 5678' },
  { iso: 'MY', name: 'Malaysia', code: '60', len: [9, 10], example: '12 345 6789' },
  { iso: 'DE', name: 'Germany', code: '49', len: [10, 11], example: '1512 3456789' },
  { iso: 'FR', name: 'France', code: '33', len: [9], example: '6 12 34 56 78' },
  { iso: 'NZ', name: 'New Zealand', code: '64', len: [8, 9, 10], example: '21 123 4567' },
  { iso: 'ZA', name: 'South Africa', code: '27', len: [9], example: '71 123 4567' },
] as const
type Country = (typeof PHONE_COUNTRIES)[number]

const byIso = (iso: string) => PHONE_COUNTRIES.find(c => c.iso === iso) ?? PHONE_COUNTRIES[0]
/** Splits an E.164 value into its country (longest matching code; +1 → US) and national digits. */
export function splitPhone(value: string, fallback = 'IN'): { country: Country; national: string } {
  const digits = value.replace(/\D/g, '')
  if (!value.trim().startsWith('+') || !digits) return { country: byIso(fallback), national: digits }
  const match = [...PHONE_COUNTRIES].sort((a, b) => b.code.length - a.code.length).find(c => digits.startsWith(c.code))
  return match ? { country: match, national: digits.slice(match.code.length) } : { country: byIso(fallback), national: digits }
}
/** True when the value is `+<code><national>` with a length the country uses. */
export function isValidPhone(value: string): boolean {
  if (!/^\+\d{8,15}$/.test(value)) return false
  const { country, national } = splitPhone(value)
  return (country.len as readonly number[]).includes(national.length)
}

export function PhoneInput({ value, onChange, defaultCountry = 'IN', countries, id, required, className = '', inputClassName }: {
  value: string
  onChange: (e164: string) => void
  defaultCountry?: string
  /** Limit the picker to these ISO codes (e.g. ['IN'] where an Indian number is required). */
  countries?: string[]
  id?: string
  required?: boolean
  className?: string
  /** Classes for the number input, to match the surrounding form. */
  inputClassName?: string
}) {
  const initial = splitPhone(value, defaultCountry)
  const [iso, setIso] = useState<string>(initial.country.iso)
  const [national, setNational] = useState(initial.national)
  // Follow outside changes (e.g. a form prefilled after load) without fighting the user's typing.
  useEffect(() => {
    const next = splitPhone(value, iso)
    if (`+${next.country.code}${next.national}` !== `+${byIso(iso).code}${national}`) { setIso(next.country.iso); setNational(next.national) }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const country = byIso(iso)
  const emit = (c: Country, n: string) => onChange(n ? `+${c.code}${n}` : '')
  const touched = national.length > 0
  const ok = !touched || (country.len as readonly number[]).includes(national.length)
  return (
    <div className={className}>
      <div className="flex gap-2">
        <AdminSelect className="w-[7.5rem] shrink-0" value={iso} onChange={v => { setIso(v); emit(byIso(v), national) }}
          options={PHONE_COUNTRIES.filter(c => !countries || countries.includes(c.iso)).map(c => ({ value: c.iso, label: `${c.iso} +${c.code}`, hint: c.name }))} />
        <input id={id} type="tel" inputMode="numeric" autoComplete="tel-national" required={required}
          className={inputClassName ?? `min-w-0 flex-1 rounded-xl bg-surface-elevated px-4 py-3 text-sm text-foreground ${fieldCls}`}
          value={national} placeholder={country.example} aria-invalid={!ok}
          onChange={e => {
            let n = e.target.value.replace(/\D/g, '')
            if (n.startsWith(country.code) && n.length > Math.max(...country.len)) n = n.slice(country.code.length)
            if (n.startsWith('0')) n = n.replace(/^0+/, '')
            n = n.slice(0, Math.max(...country.len))
            setNational(n); emit(country, n)
          }} />
      </div>
      {!ok && <p className="mt-1 text-[11px] text-[#8a2e1f]">{country.name} numbers have {country.len.join(' or ')} digits after +{country.code}.</p>}
    </div>
  )
}
