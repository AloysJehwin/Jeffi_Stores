import { NextRequest, NextResponse } from 'next/server'

const TOKEN = process.env.DELHIVERY_API_KEY
const ORIGIN_PIN = process.env.DELHIVERY_ORIGIN_PINCODE || '492001'

function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from)
  let added = 0
  while (added < days) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0) added++ // skip Sundays
  }
  return d
}

export async function GET(request: NextRequest) {
  const pin = request.nextUrl.searchParams.get('pin')
  if (!pin || !/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: 'Invalid pincode' }, { status: 400 })
  }

  if (!TOKEN) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  try {
    const res = await fetch(
      `https://track.delhivery.com/api/kinko/v0.2/pickup/serviceability/?md=S&ss=Delivered&d_pin=${pin}&o_pin=${ORIGIN_PIN}`,
      { headers: { Authorization: `Token ${TOKEN}` }, next: { revalidate: 3600 } }
    )
    if (!res.ok) return NextResponse.json({ edd: null })
    const data = await res.json()
    const tat: number | null = data?.data?.[0]?.tat ?? null
    if (!tat || tat <= 0) return NextResponse.json({ edd: null })
    const edd = addBusinessDays(new Date(), tat).toISOString().slice(0, 10)
    return NextResponse.json({ edd })
  } catch {
    return NextResponse.json({ edd: null })
  }
}
