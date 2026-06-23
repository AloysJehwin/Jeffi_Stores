import { NextRequest, NextResponse } from 'next/server'
import https from 'https'

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pin: string }> }
) {
  const { pin } = await params

  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: 'Invalid PIN code' }, { status: 400 })
  }

  try {
    const raw = await httpsGet(`https://api.postalpincode.in/pincode/${pin}`)
    const data = JSON.parse(raw)
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
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
