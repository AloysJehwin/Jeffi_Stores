'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import clsx from 'clsx'

interface QA {
  q: string
  a: string
}

const FAQS: QA[] = [
  {
    q: 'Do I get my own domain?',
    a: 'Every store launches on its own subdomain, ready to use straight away. You can also connect a custom domain you already own on the higher plans.',
  },
  {
    q: 'How does pricing work?',
    a: 'We offer plans from Basic to Enterprise, so you can start small and move up as you grow. Every plan includes the storefront and admin — you only step up for more capacity and advanced features.',
  },
  {
    q: 'Which payment methods are supported?',
    a: 'Online payments run through Razorpay — cards, UPI, netbanking and wallets — and Cash on Delivery is built in. Both are settled and reconciled for you automatically.',
  },
  {
    q: 'Are the invoices GST compliant?',
    a: 'Yes. Orders generate GST-ready invoices with your details filled in, so your billing stays compliant without any manual work.',
  },
  {
    q: 'How is delivery handled?',
    a: 'Delivery is powered by Delhivery. You can generate shipments from the admin and share live tracking with your customers end to end.',
  },
  {
    q: 'Can I move my existing catalogue over?',
    a: 'Yes. You can bring your existing products across in bulk and pick up where you left off, rather than rebuilding your catalogue from scratch.',
  },
  {
    q: 'What support do I get?',
    a: 'You get support throughout — from the initial setup of your store to help whenever you have a question while running your business.',
  },
]

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section className="w-full px-6 lg:px-12 py-16">
      <div className="text-center mb-10">
        <p className="ecom-accent-text font-semibold text-sm uppercase tracking-widest">Questions</p>
        <h2 className="text-4xl lg:text-5xl font-extrabold mt-3 text-foreground">Frequently asked questions</h2>
      </div>

      <div className="mx-auto max-w-3xl space-y-3">
        {FAQS.map((item, i) => {
          const isOpen = open === i
          return (
            <div
              key={item.q}
              className="rounded-2xl border border-border-default bg-surface-elevated shadow-sm shadow-black/[0.04] overflow-hidden"
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="text-base font-semibold text-foreground">{item.q}</span>
                <ChevronDown
                  aria-hidden
                  className={clsx(
                    'ecom-accent-text h-5 w-5 shrink-0 transition-transform duration-200',
                    isOpen && 'rotate-180',
                  )}
                />
              </button>
              <div className={clsx('px-5 pb-4 text-sm text-foreground-secondary', !isOpen && 'hidden')}>
                {item.a}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
