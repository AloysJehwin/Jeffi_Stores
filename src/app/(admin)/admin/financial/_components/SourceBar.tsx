'use client'

export function SourceBar({
  online,
  business,
  cashSale,
  offline,
}: {
  online: number
  business: number
  cashSale: number
  offline: number
}) {
  const total = online + business + cashSale + offline
  if (total <= 0) return null
  const pct = (n: number) => Math.round((n / total) * 100)
  return (
    <div
      className="flex h-1.5 rounded-full overflow-hidden w-full gap-px"
      title={`Online ${pct(online)}% · Business ${pct(business)}% · Cash ${pct(cashSale)}% · Offline ${pct(offline)}%`}
    >
      {online > 0 && <div className="bg-blue-500" style={{ width: `${pct(online)}%` }} />}
      {business > 0 && <div className="bg-purple-500" style={{ width: `${pct(business)}%` }} />}
      {cashSale > 0 && <div className="bg-green-500" style={{ width: `${pct(cashSale)}%` }} />}
      {offline > 0 && <div className="bg-orange-400" style={{ width: `${pct(offline)}%` }} />}
    </div>
  )
}
