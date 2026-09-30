import { getBusinessValues } from '@/lib/site-controls'

interface RefundOrderLike {
  status: string
  total_amount: number | string
}

interface ReturnRequestLike {
  type?: string | null
  items?: Array<{ refund_amount: number | string }> | null
}

export async function computeRefundableAmount(
  order: RefundOrderLike,
  returnRequest: ReturnRequestLike | null
): Promise<number> {
  const total = parseFloat(String(order.total_amount)) || 0
  const isReturn = order.status === 'returned'

  if (!isReturn) {
    return Math.max(0, Math.round(total * 100) / 100)
  }

  const charge = (await getBusinessValues()).returnStandardCharge
  const items = Array.isArray(returnRequest?.items) ? returnRequest!.items! : []
  const returnedValue =
    items.length > 0 ? items.reduce((sum, i) => sum + (parseFloat(String(i.refund_amount)) || 0), 0) : total

  return Math.max(0, Math.round((returnedValue - charge) * 100) / 100)
}
