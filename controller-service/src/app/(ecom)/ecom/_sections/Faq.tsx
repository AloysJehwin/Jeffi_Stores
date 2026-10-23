'use client'

import { useState } from 'react'
import { Eyebrow, Display } from '../_ui'
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
    <section className="w-full px-4 sm:px-6 lg:px-12 py-12 sm:py-20">
      <Eyebrow>Questions</Eyebrow>
      <Display className="mt-3 text-3xl sm:text-4xl lg:text-5xl max-w-xl">Frequently asked questions</Display>
      <div className="mt-8 sm:mt-10 max-w-3xl space-y-3">
        {FAQS.map((item, i) => {
          const isOpen = open === i
          return (
            <div key={item.q} className="org-sand rounded-3xl sm:rounded-[2rem] overflow-hidden">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : i)}
                className="org-square flex w-full items-center justify-between gap-4 px-5 py-4 sm:px-8 sm:py-5 text-left"
              >
                <span className="min-w-0 font-display font-black text-lg text-foreground">{item.q}</span>
                <ChevronDown aria-hidden className={clsx('h-5 w-5 shrink-0 text-foreground transition-transform', isOpen && 'rotate-180')} />
              </button>
              <div className={clsx('px-5 pb-5 sm:px-8 sm:pb-6 text-base text-foreground-secondary leading-relaxed max-w-2xl', !isOpen && 'hidden')}>{item.a}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
