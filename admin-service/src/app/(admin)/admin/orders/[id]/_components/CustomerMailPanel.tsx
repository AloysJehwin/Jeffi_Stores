'use client'

import { useState } from 'react'
import { ChevronDown, Mail } from 'lucide-react'
import OrderMailForm from '../../_components/OrderMailForm'

interface Props {
  orderId: string
  orderNumber: string
  customerName: string
  customerEmail: string
}

/** The order page's "Customer Mail" section: the shared order email form, for this order's customer. */
export default function CustomerMailPanel({ orderId, orderNumber, customerName, customerEmail }: Props) {
  const [open, setOpen] = useState(false)
  // Mounted on first open and kept, so closing the section does not lose a draft.
  const [opened, setOpened] = useState(false)

  return (
    <section className="rounded-xl border border-border-default bg-surface-elevated">
      <button
        type="button"
        onClick={() => {
          setOpened(true)
          setOpen(o => !o)
        }}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 shrink-0 text-accent-500" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Customer Mail</h2>
        </div>
        <ChevronDown className={`h-4 w-4 text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {opened && (
        <div className={open ? 'border-t border-border-default px-5 pb-5 pt-4' : 'hidden'}>
          <OrderMailForm
            target={{ kind: 'order', orderId, orderNumber, customerName, customerEmail }}
            active={open}
            onSent={() => setOpen(false)}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </section>
  )
}
