'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Mail } from 'lucide-react'
import { canonicalQuery, type FilterField } from '@jeffi/list-filters/client'
import { Dialog } from '@/components/admin/kit/dialog'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import OrderMailForm from './OrderMailForm'

/**
 * The Orders list's Mail button: emails the customer of every order the list shows, one email per
 * order. With filters applied, only the orders they match. Sits in the list's toolbar beside Export
 * and sends the same filter query the export does, plus the sort (which decides the preview's order).
 */
export default function BulkOrderMailButton({ fields, search = 'search' }: { fields: FilterField[]; search?: string }) {
  const sp = useSearchParams()
  const [open, setOpen] = useState(false)
  const canWriteOrders = useCanWrite('orders')
  const canWriteMailer = useCanWrite('mailer')
  if (!canWriteOrders || !canWriteMailer) return null

  const params = new URLSearchParams(canonicalQuery(sp, fields, { search }))
  for (const k of ['sort', 'dir']) {
    const v = sp.get(k)
    if (v) params.set(k, v)
  }
  const query = params.toString()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="control-md border border-border-default text-foreground-secondary hover:bg-surface-secondary"
        aria-label="Email the customers of these orders"
      >
        <Mail className="h-4 w-4" />
        <span className="hidden md:inline">Mail</span>
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Email these orders"
        description="Write one email; each order's customer gets it with their own order's details filled in."
        size="xl"
      >
        {/* Keyed by the filters: reopening on a different list starts from that list. */}
        {open && <OrderMailForm key={query} target={{ kind: 'list', query }} active onSent={() => setOpen(false)} onClose={() => setOpen(false)} />}
      </Dialog>
    </>
  )
}
