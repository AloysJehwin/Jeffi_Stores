import 'server-only'

const PACKING_SLIP_URL = 'https://track.delhivery.com/api/p/packing_slip'

export class DelhiveryLabelError extends Error {}

/** Package rows from Delhivery's label API, keyed by AWB. Drawn into our own 4×6 label. */
export async function fetchDelhiveryPackages(awbs: string[], token: string): Promise<Map<string, any>> {
  const res = await fetch(`${PACKING_SLIP_URL}?wbns=${encodeURIComponent(awbs.join(','))}`, {
    headers: { Authorization: `Token ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new DelhiveryLabelError(`Delhivery label API returned ${res.status}`)
  const data = await res.json()
  const out = new Map<string, any>()
  for (const pkg of data?.packages ?? []) {
    const awb = String(pkg?.wbn ?? pkg?.waybill ?? '')
    if (awb) out.set(awb, pkg)
  }
  // A single AWB's package may come back without its waybill field.
  if (awbs.length === 1 && out.size === 0 && data?.packages?.[0]) out.set(awbs[0], data.packages[0])
  return out
}

/** Delhivery's own A4 label PDF: served directly, or as a link to S3. */
export async function fetchDelhiveryA4Label(awb: string, token: string): Promise<ArrayBuffer> {
  const res = await fetch(`${PACKING_SLIP_URL}?wbns=${encodeURIComponent(awb)}&pdf=true`, {
    headers: { Authorization: `Token ${token}` },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new DelhiveryLabelError(`Delhivery label API returned ${res.status}`)
  if ((res.headers.get('content-type') || '').includes('application/pdf')) return res.arrayBuffer()

  const json = await res.json()
  const pdfUrl: string | undefined = json?.packages?.[0]?.pdf_download_link
  if (!pdfUrl) throw new DelhiveryLabelError('No PDF link in Delhivery response')
  const pdfRes = await fetch(pdfUrl)
  if (!pdfRes.ok) throw new DelhiveryLabelError(`Failed to fetch PDF from S3: ${pdfRes.status}`)
  return pdfRes.arrayBuffer()
}
