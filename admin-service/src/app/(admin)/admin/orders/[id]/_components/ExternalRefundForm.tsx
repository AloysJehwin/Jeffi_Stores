'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import AdminSelect from '@/components/admin/AdminSelect'
import Toggle from '@/components/ui/Toggle'
import { FormButton, FormField, MoneyInput, TextArea, TextInput } from '@/components/admin/kit/form'
import { EXTERNAL_REFUND_METHODS, RAZORPAY_ONLY_METHODS, type ExternalRefundMethod } from '@/lib/payments/external-refund'

const REFERENCE_HINT: Partial<Record<ExternalRefundMethod, string>> = {
  razorpay_dispute: 'Dispute ID (disp_…)',
  razorpay_dashboard: 'Refund ID (rfnd_…)',
  bank_transfer: 'UTR / transaction reference',
  upi: 'UPI transaction ID',
  cheque: 'Cheque number',
}

interface ExternalRefundFormProps {
  endpoint: string
  amount: number
  /** The money came in through Razorpay, so a dispute or dashboard refund applies. */
  razorpayPaid: boolean
  amountEditable?: boolean
  /** Offer to email the customer (order refunds; change refunds send nothing). */
  notifyOption?: boolean
  submitLabel?: string
  onCancel: () => void
}

/** Records a refund that reached the customer without the in-app Razorpay call. */
export default function ExternalRefundForm({ endpoint, amount, razorpayPaid, amountEditable, notifyOption, submitLabel, onCancel }: ExternalRefundFormProps) {
  const methods = (Object.keys(EXTERNAL_REFUND_METHODS) as ExternalRefundMethod[]).filter(m => razorpayPaid || !RAZORPAY_ONLY_METHODS.includes(m))
  const [method, setMethod] = useState<ExternalRefundMethod>(methods[0])
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [value, setValue] = useState(amount.toFixed(2))
  const [notify, setNotify] = useState(method !== 'razorpay_dispute')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { showToast } = useToast()
  const router = useRouter()

  async function submit() {
    setError(null)
    if (method === 'other' && !note.trim()) return setError('Add a note saying how the refund was made.')
    const n = Number(value)
    if (amountEditable && !(n > 0)) return setError('Enter the amount that was refunded.')
    setPending(true)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          external: { method, reference, note },
          ...(amountEditable ? { amount: n } : {}),
          ...(notifyOption ? { notify } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not record the refund')
      showToast(`Refund of ₹${(amountEditable ? n : amount).toLocaleString('en-IN')} recorded.`, 'success')
      router.refresh()
      onCancel()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border-default p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField label="Refunded via" required>
          <AdminSelect
            value={method}
            options={methods.map(m => ({ value: m, label: EXTERNAL_REFUND_METHODS[m] }))}
            onChange={v => {
              setMethod(v as ExternalRefundMethod)
              setNotify(v !== 'razorpay_dispute')
            }}
          />
        </FormField>
        {amountEditable ? (
          <FormField label="Amount refunded" required>
            <MoneyInput value={value} min={0} onChange={e => setValue(e.target.value)} />
          </FormField>
        ) : null}
        <FormField label="Reference" span={amountEditable ? 2 : 1}>
          <TextInput value={reference} maxLength={120} placeholder={REFERENCE_HINT[method] ?? 'Optional'} onChange={e => setReference(e.target.value)} />
        </FormField>
      </div>
      <FormField label="Note" required={method === 'other'}>
        <TextArea rows={2} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="Optional" />
      </FormField>
      {notifyOption ? <Toggle size="sm" checked={notify} onChange={setNotify} label="Email the customer that the refund was made" /> : null}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <FormButton type="button" onClick={submit} pending={pending} pendingLabel="Saving...">
          {submitLabel ?? 'Mark as refunded'}
        </FormButton>
        <FormButton type="button" variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </FormButton>
      </div>
    </div>
  )
}

/** Payment card link: a refund made outside the app on an order that isn't cancelled or returned (e.g. a lost dispute). */
export function RecordRefundLink({ orderId, amount, razorpayPaid }: { orderId: string; amount: number; razorpayPaid: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <RequireWrite scope="orders:write">
      {open ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-foreground-muted">
            For a Razorpay dispute or chargeback, a refund from the Razorpay dashboard, or money returned by bank transfer or cash. The order is marked refunded.
          </p>
          <ExternalRefundForm endpoint={`/api/orders/${orderId}/refund`} amount={amount} razorpayPaid={razorpayPaid} amountEditable notifyOption onCancel={() => setOpen(false)} />
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mt-3 text-xs font-medium text-accent-600 hover:underline dark:text-accent-400">
          Record a refund made outside the app
        </button>
      )}
    </RequireWrite>
  )
}
