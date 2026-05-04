import { query } from '@/lib/db'

const DELHIVERY_EDIT_URL = 'https://track.delhivery.com/api/p/edit'

export async function cancelDelhiveryShipment(awbNumber: string): Promise<void> {
  const token = process.env.DELHIVERY_API_KEY
  if (!token) throw new Error('DELHIVERY_API_KEY not configured')

  const res = await fetch(DELHIVERY_EDIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ waybill: awbNumber, cancellation: 'true' }),
    cache: 'no-store',
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`Delhivery cancellation failed (${res.status}): ${JSON.stringify(data)}`)
  }

  await query('UPDATE orders SET awb_number = NULL WHERE awb_number = $1', [awbNumber])
}
