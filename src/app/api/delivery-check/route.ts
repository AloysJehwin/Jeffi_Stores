import { NextRequest, NextResponse } from 'next/server'
import https from 'https'

export const dynamic = 'force-dynamic'

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

export async function GET(req: NextRequest) {
  const pincode = new URL(req.url).searchParams.get('pincode') ?? ''

  if (!/^\d{6}$/.test(pincode)) {
    return NextResponse.json({ serviceable: false, message: 'Enter a valid 6-digit pincode' })
  }

  try {
    const raw = await httpsGet(`https://api.postalpincode.in/pincode/${pincode}`)
    const data = JSON.parse(raw)
    const entry = data?.[0]

    if (!entry || entry.Status !== 'Success' || !entry.PostOffice?.length) {
      return NextResponse.json({ serviceable: false, message: 'Pincode not found — please check and retry' })
    }

    const first = entry.PostOffice[0]
    const location = `${first.Name}, ${first.District}, ${first.State}`
    return NextResponse.json({
      serviceable: true,
      message: `Delivery available to ${location}`,
    })
  } catch {
    return NextResponse.json({ serviceable: false, message: 'Could not check delivery. Try again.' })
  }
}
