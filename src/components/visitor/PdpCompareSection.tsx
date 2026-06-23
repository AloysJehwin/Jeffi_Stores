'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'

interface CompareProduct {
  id: string
  name: string
  slug: string
  price: number
  mrp: number | null
  image: string | null
  brandName: string | null
  categoryId: string | null
}

interface PdpCompareSectionProps {
  currentProduct: CompareProduct
  relatedProducts: CompareProduct[]
}

const SPEC_KEYS: { label: string; key: keyof CompareProduct | ((p: any) => string | null) }[] = [
  { label: 'Brand', key: 'brandName' },
]

// Compact spec rows from raw product data passed as extraData
const EXTRA_SPEC_ROWS: { label: string; key: (p: any) => string | null }[] = [
  { label: 'Material',   key: p => p.material ?? null },
  { label: 'Finish',     key: p => p.finish ?? null },
  { label: 'Variant',    key: p => p.variant_type ?? null },
  { label: 'Weight',     key: p => p.weight != null ? `${p.weight} ${p.weight_unit ?? 'kg'}` : null },
  { label: 'HSN Code',   key: p => p.hsn_code ?? null },
  { label: 'GST',        key: p => p.gst_percentage != null ? `${parseFloat(String(p.gst_percentage))}%` : null },
]

interface FullProduct extends CompareProduct {
  material?: string | null
  finish?: string | null
  variant_type?: string | null
  weight?: number | null
  weight_unit?: string | null
  hsn_code?: string | null
  gst_percentage?: number | string | null
}

interface PdpCompareSectionFullProps {
  currentProduct: FullProduct
  relatedProducts: FullProduct[]
}

export default function PdpCompareSection({ currentProduct, relatedProducts }: PdpCompareSectionFullProps) {
  // Start with current product + up to 2 related products
  const initialSlots: FullProduct[] = [
    currentProduct,
    ...relatedProducts.slice(0, 2),
  ]
  const [slots, setSlots] = useState<FullProduct[]>(initialSlots)

  const compareUrl = `/compare?ids=${slots.map(p => p.id).join(',')}`

  // Build spec rows — only show rows where at least one product has data
  const specRows = EXTRA_SPEC_ROWS.filter(row =>
    slots.some(p => row.key(p) != null)
  )

  function swap(slotIdx: number, replacement: FullProduct) {
    setSlots(prev => prev.map((p, i) => i === slotIdx ? replacement : p))
  }

  // Available swaps for each non-current slot
  const allOptions = [currentProduct, ...relatedProducts]

  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 sm:p-8 mb-8">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-foreground">Compare Similar Products</h2>
        <Link
          href={compareUrl}
          className="text-sm text-accent-500 hover:text-accent-600 font-medium flex items-center gap-1.5 group"
        >
          Full Comparison
          <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      <div className="overflow-x-auto -mx-2 px-2">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr>
              {/* Label col */}
              <td className="w-24 sm:w-28" />
              {slots.map((p, i) => {
                const isCurrent = i === 0
                const discount = p.mrp && p.mrp > p.price
                  ? Math.round(((p.mrp - p.price) / p.mrp) * 100)
                  : 0

                return (
                  <td key={p.id} className="pb-4 px-2 align-top text-center" style={{ width: `${Math.floor(80 / slots.length)}%` }}>
                    {/* Image */}
                    <div className={`mx-auto mb-2 w-16 h-16 rounded-lg border overflow-hidden bg-surface-secondary ${isCurrent ? 'border-accent-400 ring-2 ring-accent-200 dark:ring-accent-800' : 'border-border-default'}`}>
                      {p.image ? (
                        <img src={p.image} alt={p.name} className="w-full h-full object-contain p-1" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <svg className="w-6 h-6 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                    </div>

                    {/* Name */}
                    {isCurrent ? (
                      <p className="text-xs font-semibold text-foreground line-clamp-2 leading-snug mb-1">{p.name}</p>
                    ) : (
                      <Link href={`/products/${p.slug}`} className="text-xs font-semibold text-foreground hover:text-accent-500 line-clamp-2 leading-snug mb-1 block">
                        {p.name}
                      </Link>
                    )}

                    {/* Price */}
                    <div className="mb-1">
                      <span className="text-sm font-bold text-primary-600 dark:text-primary-400">
                        ₹{p.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                      {discount > 0 && (
                        <span className="ml-1 text-[10px] text-green-600 font-semibold">{discount}% off</span>
                      )}
                    </div>

                    {/* Current badge or swap control */}
                    {isCurrent ? (
                      <span className="inline-block text-[10px] font-semibold text-accent-600 bg-accent-50 dark:bg-accent-900/20 px-2 py-0.5 rounded-full">
                        Viewing
                      </span>
                    ) : (
                      <SwapSelect
                        current={p}
                        options={allOptions.filter(o => !slots.some((s, si) => si !== i && s.id === o.id))}
                        onSwap={(replacement) => swap(i, replacement)}
                      />
                    )}
                  </td>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {/* Brand row always shown */}
            <tr className="border-t border-border-default">
              <td className="py-2.5 pr-3 text-xs font-semibold text-foreground-muted uppercase tracking-wide whitespace-nowrap">Brand</td>
              {slots.map((p, i) => {
                const base = slots[0].brandName
                const isDiff = i > 0 && p.brandName !== base
                return (
                  <td key={p.id} className={`py-2.5 px-2 text-xs text-center font-medium ${isDiff ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                    {p.brandName ?? <span className="text-foreground-muted">—</span>}
                  </td>
                )
              })}
            </tr>
            {specRows.map(row => {
              const values = slots.map(p => row.key(p))
              const base = values[0]
              return (
                <tr key={row.label} className="border-t border-border-default">
                  <td className="py-2.5 pr-3 text-xs font-semibold text-foreground-muted uppercase tracking-wide whitespace-nowrap">{row.label}</td>
                  {slots.map((p, i) => {
                    const val = row.key(p)
                    const isDiff = i > 0 && val !== base
                    return (
                      <td key={p.id} className={`py-2.5 px-2 text-xs text-center ${isDiff ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-foreground'}`}>
                        {val ?? <span className="text-foreground-muted">—</span>}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-center">
        <Link
          href={compareUrl}
          className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-accent-500 hover:bg-accent-600 px-5 py-2.5 rounded-xl transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          View Full Comparison
        </Link>
      </div>
    </div>
  )
}

function SwapSelect({ current, options, onSwap }: {
  current: FullProduct
  options: FullProduct[]
  onSwap: (p: FullProduct) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(v => !v)}
        className="text-xs text-accent-500 hover:text-accent-600 hover:underline font-medium"
      >
        Change
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-56 bg-surface-elevated border border-border-default rounded-xl shadow-2xl overflow-hidden">
          {options.map(o => (
            <button
              key={o.id}
              onMouseDown={() => { onSwap(o); setOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 hover:bg-surface-secondary transition-colors text-left ${o.id === current.id ? 'bg-accent-50 dark:bg-accent-900/20' : ''}`}
            >
              {o.image ? (
                <img src={o.image} alt="" className="w-7 h-7 rounded border border-border-default object-contain flex-shrink-0 bg-surface-secondary p-0.5" />
              ) : (
                <div className="w-7 h-7 rounded border border-border-default bg-surface-secondary flex-shrink-0 flex items-center justify-center">
                  <svg className="w-3.5 h-3.5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground line-clamp-2 leading-snug">{o.name}</p>
                <p className="text-[10px] text-foreground-muted">₹{o.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
              </div>
              {o.id === current.id && (
                <svg className="w-3.5 h-3.5 text-accent-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
