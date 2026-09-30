'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { PublicOffer } from '@/lib/payments/razorpay-offers'

// Offers were hardcoded here: HDFC, ICICI, Kotak, SBI and RuPay deals that do not exist on this
// Razorpay account. Customers were shown discounts they could never receive. The list now comes
// from the account's real active offers, and the component renders nothing when there are none.

const AUTO_MS = 3500

const GRADIENTS = [
  'from-blue-700 to-blue-900',
  'from-indigo-700 to-indigo-900',
  'from-orange-600 to-orange-800',
  'from-purple-700 to-purple-900',
  'from-rose-700 to-rose-900',
  'from-emerald-700 to-emerald-900',
]

const METHOD_LABELS: Record<string, string> = {
  card: 'Card',
  emi: 'EMI',
  upi: 'UPI',
  netbanking: 'Netbanking',
  wallet: 'Wallet',
}

function subtitle(o: PublicOffer): string {
  const parts = [...o.issuers, ...o.methods.map(m => METHOD_LABELS[m] ?? m)]
  return parts.join(' · ')
}

export default function RazorpayOffers() {
  const [offers, setOffers] = useState<PublicOffer[]>([])
  const [active, setActive] = useState(0)
  const go = useCallback((n: number) => setActive(n), [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/razorpay/offers')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!cancelled && Array.isArray(d?.offers)) setOffers(d.offers)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (offers.length < 2) return
    const t = setTimeout(() => go((active + 1) % offers.length), AUTO_MS)
    return () => clearTimeout(t)
  }, [active, offers.length, go])

  if (offers.length === 0) return null

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <svg
          className="w-3.5 h-3.5 text-accent-500 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
          />
        </svg>
        <span className="text-[10px] font-semibold text-foreground-secondary uppercase tracking-wide">
          Bank Offers via Razorpay
        </span>
      </div>

      <Link
        href="/legal/terms-and-conditions#5a-bank-offers-cashback"
        className="block relative rounded-lg overflow-hidden h-10 cursor-pointer"
        title="Bank offer T&C"
      >
        {offers.map((offer, i) => (
          <div
            key={offer.id}
            className={`absolute inset-0 flex items-center gap-3 px-3 bg-gradient-to-r ${GRADIENTS[i % GRADIENTS.length]} transition-opacity duration-500 ${i === active ? 'opacity-100' : 'opacity-0'}`}
          >
            <svg
              className="w-3.5 h-3.5 text-white/70 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
              />
            </svg>
            <span className="text-[11px] text-white/90 truncate">{offer.title}</span>
            {subtitle(offer) && (
              <span className="text-[10px] text-white/60 shrink-0 ml-auto hidden sm:block">{subtitle(offer)}</span>
            )}
          </div>
        ))}

        {offers.length > 1 && (
          <div className="absolute right-2 bottom-1.5 flex items-center gap-1 z-10">
            {offers.map((o, i) => (
              <button
                key={o.id}
                onClick={e => {
                  e.preventDefault()
                  go(i)
                }}
                className={`rounded-full transition-all duration-300 ${i === active ? 'bg-white w-3 h-1' : 'bg-white/40 w-1 h-1'}`}
                aria-label={`Offer ${i + 1}`}
              />
            ))}
          </div>
        )}
      </Link>
    </div>
  )
}
