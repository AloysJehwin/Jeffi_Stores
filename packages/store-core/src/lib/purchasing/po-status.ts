// Pure PO helpers shared by the list, detail and overview.

const OPEN_FOR_DELIVERY = new Set(['sent', 'partial'])

function todayIST(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)
}

/** Days a sent/partial PO is past its expected date (0 when not late or not applicable). */
export function poDaysLate(
  po: { status: string; expected_date: string | null | undefined },
  today: string = todayIST()
): number {
  if (!po.expected_date || !OPEN_FOR_DELIVERY.has(po.status)) return 0
  const exp = String(po.expected_date).slice(0, 10)
  const d = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${exp}T00:00:00Z`)) / 86_400_000)
  return d > 0 ? d : 0
}

/** Share of ordered quantity received, 0..1, across PO lines (base units). */
export function poReceivedShare(items: { quantity: unknown; quantity_received?: unknown }[]): number {
  let ordered = 0
  let received = 0
  for (const it of items) {
    const q = Number(it.quantity) || 0
    ordered += q
    received += Math.min(q, Number(it.quantity_received) || 0)
  }
  return ordered > 0 ? received / ordered : 0
}
