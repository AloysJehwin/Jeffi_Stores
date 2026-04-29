import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: { pin: string } }
) {
  const { pin } = params

  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: 'Invalid PIN code' }, { status: 400 })
  }

  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, {
      next: { revalidate: 86400 },
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
    }

    const data = await res.json()
    const entry = data?.[0]

    if (!entry || entry.Status !== 'Success' || !entry.PostOffice?.length) {
      return NextResponse.json({ error: 'PIN code not found' }, { status: 404 })
    }

    const postOffices: string[] = [...new Set<string>(entry.PostOffice.map((po: any) => po.Name as string))]
    const first = entry.PostOffice[0]

    return NextResponse.json({
      district: first.District as string,
      state: first.State as string,
      postOffices,
    })
  } catch {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
