'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

const OFFERS = [
  { id: 'hdfc-cc',  bank: 'HDFC Bank',   offer: '5% cashback on HDFC Credit Cards',         min: '₹1,000 min. purchase', color: 'from-blue-700 to-blue-900' },
  { id: 'sbi-emi',  bank: 'SBI Card',    offer: 'No-cost EMI on SBI Credit Cards',           min: 'Starting ₹749/month',  color: 'from-indigo-700 to-indigo-900' },
  { id: 'icici-cc', bank: 'ICICI Bank',  offer: '10% instant discount on ICICI Credit Cards',min: '₹1,500 min. purchase', color: 'from-orange-600 to-orange-800' },
  { id: 'axis-cc',  bank: 'Axis Bank',   offer: '5% cashback on Axis Bank Cards',            min: '₹1,000 min. purchase', color: 'from-purple-700 to-purple-900' },
  { id: 'kotak-cc', bank: 'Kotak Bank',  offer: '7.5% instant discount on Kotak Cards',      min: '₹2,000 min. purchase', color: 'from-rose-700 to-rose-900' },
  { id: 'rupay-cc', bank: 'RuPay',       offer: '10% cashback on RuPay Credit Cards',        min: '₹500 min. purchase',   color: 'from-emerald-700 to-emerald-900' },
]

const AUTO_MS = 3500

export default function RazorpayOffers() {
  const [active, setActive] = useState(0)
  const go = useCallback((n: number) => setActive(n), [])

  useEffect(() => {
    const t = setTimeout(() => go((active + 1) % OFFERS.length), AUTO_MS)
    return () => clearTimeout(t)
  }, [active, go])

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-3.5 h-3.5 text-accent-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
        <span className="text-[10px] font-semibold text-foreground-secondary uppercase tracking-wide">Bank Offers via Razorpay</span>
      </div>

      <Link href="/legal/terms-and-conditions#5a-bank-offers-cashback" className="block relative rounded-lg overflow-hidden h-10 cursor-pointer" title="Bank offer T&C">
        {OFFERS.map((offer, i) => (
          <div
            key={offer.id}
            className={`absolute inset-0 flex items-center gap-3 px-3 bg-gradient-to-r ${offer.color} transition-opacity duration-500 ${i === active ? 'opacity-100' : 'opacity-0'}`}
          >
            <svg className="w-3.5 h-3.5 text-white/70 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <span className="text-[11px] font-bold text-white shrink-0">{offer.bank}</span>
            <span className="text-[11px] text-white/80 truncate">{offer.offer}</span>
            <span className="text-[10px] text-white/60 shrink-0 ml-auto">{offer.min}</span>
          </div>
        ))}

        {/* Dot indicators */}
        <div className="absolute right-2 bottom-1.5 flex items-center gap-1 z-10">
          {OFFERS.map((_, i) => (
            <button
              key={i}
              onClick={(e) => { e.preventDefault(); go(i) }}
              className={`rounded-full transition-all duration-300 ${i === active ? 'bg-white w-3 h-1' : 'bg-white/40 w-1 h-1'}`}
              aria-label={`Offer ${i + 1}`}
            />
          ))}
        </div>
      </Link>
    </div>
  )
}
