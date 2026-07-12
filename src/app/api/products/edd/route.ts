import { NextRequest, NextResponse } from 'next/server'

// 3-digit prefixes covering full pincode ranges for each metro city
const METRO_PINS_3 = new Set([
  // Delhi / NCR
  '110', '111', '112',
  // Mumbai (including suburbs, Thane, Navi Mumbai)
  '400', '401', '402', '403', '410', '421',
  // Bangalore / Bengaluru
  '560', '561', '562', '563',
  // Chennai
  '600', '601', '602', '603',
  // Hyderabad / Secunderabad
  '500', '501', '502', '503',
  // Kolkata
  '700', '711', '712',
  // Pune
  '411', '412', '413',
  // Ahmedabad
  '380', '382', '383',
])

function getTat(pin: string): number {
  if (pin.startsWith('49')) return 7
  if (METRO_PINS_3.has(pin.slice(0, 3))) return 10
  return 14
}

function addDays(from: Date, days: number): Date {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  return d
}

export async function GET(request: NextRequest) {
  const pin = request.nextUrl.searchParams.get('pin') ?? ''
  const handlingDays = Math.max(2, parseInt(request.nextUrl.searchParams.get('handlingDays') ?? '2') || 2)
  const extraDays = parseInt(request.nextUrl.searchParams.get('extraDays') ?? '0') || 0
  const tat = handlingDays + (/^\d{6}$/.test(pin) ? getTat(pin) : 7) + extraDays
  const edd = addDays(new Date(), tat).toISOString().slice(0, 10)
  return NextResponse.json({ edd })
}
