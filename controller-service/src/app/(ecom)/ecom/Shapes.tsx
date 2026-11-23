// Decorative SVG shapes + device mockups for the ecom landing. No emojis anywhere —
// all icons/accents are inline SVG so they respect currentColor and the theme.

import { Search, ShoppingBag } from 'lucide-react'
import ProductArt from './_demo/ProductArt'
import { PRODUCTS } from './_demo/data'

// The phone screen stays light in both themes, so its contents use fixed colours.
const INK = 'text-[#3d3a35]'
const MUTED = 'text-[#8a8275]'
const TILE = 'rounded-lg bg-[#fffdf7]'
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

// A phone frame with a small, realistic in-screen UI built from the demo store's data (not a screenshot).
// Used in the bento section.
export function PhoneMock({
  variant = 'store',
  src,
  alt = '',
  className = '',
}: {
  variant?: 'store' | 'chart' | 'card'
  src?: string
  alt?: string
  className?: string
}) {
  return (
    <div className={`relative mx-auto w-[190px] max-w-full ${className}`} aria-hidden={src ? undefined : true}>
      <div
        className={`rounded-[2.5rem] border-[5px] border-[#3d3a35] bg-[#f8f3ea] overflow-hidden ${src ? 'aspect-[390/844]' : 'aspect-[9/19]'}`}
      >
        {src ? (
          <img src={src} alt={alt} className="w-full h-full object-cover object-top" />
        ) : (
          <>
            {/* notch */}
            <div className="h-6 flex items-center justify-center">
              <span className="w-16 h-2 rounded-full bg-[#d9d2c3]" />
            </div>
            <div className="px-3 pb-3 space-y-2">
              {variant === 'store' && <StoreScreen />}
              {variant === 'card' && <PaymentsScreen />}
              {variant === 'chart' && <InsightsScreen />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StoreScreen() {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-black tracking-tight ${INK}`}>Nova Store</span>
        <ShoppingBag className={`h-3 w-3 ${INK}`} />
      </div>
      <div className={`flex items-center gap-1 rounded-full bg-[#ece5d7] px-2 py-1 text-[8px] ${MUTED}`}>
        <Search className="h-2.5 w-2.5 shrink-0" />
        Search products
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {PRODUCTS.slice(0, 4).map(p => (
          <div key={p.id} className={`${TILE} p-1`}>
            <div className="aspect-square overflow-hidden rounded-md">
              <ProductArt category={p.category} />
            </div>
            <div className={`mt-1 truncate text-[8px] font-semibold ${INK}`}>{p.name}</div>
            <div className="text-[8px] font-bold tabular-nums" style={{ color: 'var(--org-terracotta-deep)' }}>{inr(p.price)}</div>
          </div>
        ))}
      </div>
    </>
  )
}

const PAYMENTS: [string, string, number, string][] = [
  ['1041', 'UPI', 1099, 'Settled'],
  ['1040', 'Cash on delivery', 649, 'Collected'],
  ['1039', 'Card', 2147, 'Captured'],
]

function PaymentsScreen() {
  return (
    <>
      <div className={`text-[10px] font-black tracking-tight ${INK}`}>Payments</div>
      <div className="rounded-xl p-2.5 text-white" style={{ background: 'var(--org-terracotta-deep)' }}>
        <div className="text-[8px] opacity-80">Settled this week</div>
        <div className="mt-0.5 text-sm font-black tabular-nums">{inr(14280)}</div>
        <div className="mt-1 text-[8px] opacity-80">Online and COD, reconciled</div>
      </div>
      {PAYMENTS.map(([n, method, amount, status]) => (
        <div key={n} className={`${TILE} flex items-center justify-between gap-2 px-2 py-1.5`}>
          <div className="min-w-0">
            <div className={`text-[8px] font-semibold ${INK}`}>Order #{n}</div>
            <div className={`truncate text-[8px] ${MUTED}`}>{method}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className={`text-[8px] font-bold tabular-nums ${INK}`}>{inr(amount)}</div>
            <div className="text-[8px]" style={{ color: 'var(--org-sage-deep)' }}>{status}</div>
          </div>
        </div>
      ))}
    </>
  )
}

const WEEK = [40, 65, 50, 80, 60, 90, 70]

function InsightsScreen() {
  return (
    <>
      <div className="flex items-baseline justify-between">
        <span className={`text-[10px] font-black tracking-tight ${INK}`}>Insights</span>
        <span className={`text-[8px] ${MUTED}`}>Last 7 days</span>
      </div>
      <div className={`${TILE} rounded-xl p-2.5`}>
        <div className={`text-[8px] ${MUTED}`}>Revenue</div>
        <div className="flex items-baseline gap-1">
          <span className={`text-sm font-black tabular-nums ${INK}`}>{inr(48920)}</span>
          <span className="text-[8px] font-semibold" style={{ color: 'var(--org-sage-deep)' }}>+12%</span>
        </div>
        <div className="mt-2 h-14 flex items-end gap-1">
          {WEEK.map((h, i) => (
            <div key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: i === 5 ? 'var(--org-terracotta)' : i % 2 ? 'var(--org-apricot)' : 'var(--org-peach)' }} />
          ))}
        </div>
        <div className={`mt-1 flex gap-1 text-[8px] ${MUTED}`}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span key={i} className="flex-1 text-center">{d}</span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className={`${TILE} p-2`}>
          <div className={`text-[8px] ${MUTED}`}>Orders</div>
          <div className={`text-xs font-black tabular-nums ${INK}`}>64</div>
        </div>
        <div className={`${TILE} p-2`}>
          <div className={`text-[8px] ${MUTED}`}>Low stock</div>
          <div className="text-xs font-black tabular-nums" style={{ color: 'var(--org-terracotta-deep)' }}>3 items</div>
        </div>
      </div>
    </>
  )
}

// Loose decorative shapes for section backgrounds.
export function Gear({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
export function Coin({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4}>
      <circle cx="12" cy="12" r="9" />
      <path
        strokeLinecap="round"
        d="M12 7v10M9.5 9.5a2.5 2 0 012.5-1.5c1.4 0 2.5.7 2.5 1.7M14.5 14.5a2.5 2 0 01-2.5 1.5c-1.4 0-2.5-.7-2.5-1.7"
      />
    </svg>
  )
}
export function TrendUp({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8m0 0h-5m5 0v5" />
    </svg>
  )
}
export function Dots({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 60 60" fill="currentColor">
      {Array.from({ length: 5 }).flatMap((_, r) =>
        Array.from({ length: 5 }).map((_, c) => <circle key={`${r}-${c}`} cx={6 + c * 12} cy={6 + r * 12} r={1.6} />)
      )}
    </svg>
  )
}
export { default as CheckMark } from '@/components/ui/CheckMark'
