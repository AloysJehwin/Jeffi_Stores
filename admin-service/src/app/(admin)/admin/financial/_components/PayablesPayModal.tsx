'use client'

import { Dispatch, SetStateAction } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import DatePicker from '@/components/ui/DatePicker'
import { Dialog, FormField, TextInput, NumberInput } from '@/components/admin/kit'
import { PAYMENT_METHOD_OPTIONS, PAYOUT_MODE_OPTIONS, btnPrimary, btnSecondary, formatINR } from './shared'

type PayForm = { amount: string; payment_date: string; payment_method: string; reference: string }
type RzpForm = { mode: string; amount: string; notes: string }

export function PayablesPayModal({
  payModal,
  payTab,
  setPayTab,
  payForm,
  setPayForm,
  rzpForm,
  setRzpForm,
  paying,
  payoutResult,
  setPayoutResult,
  hasBank,
  hasUpi,
  submitPayment,
  submitPayout,
  closePayModal,
}: {
  payModal: any
  payTab: 'manual' | 'razorpayx'
  setPayTab: Dispatch<SetStateAction<'manual' | 'razorpayx'>>
  payForm: PayForm
  setPayForm: Dispatch<SetStateAction<PayForm>>
  rzpForm: RzpForm
  setRzpForm: Dispatch<SetStateAction<RzpForm>>
  paying: boolean
  payoutResult: any
  setPayoutResult: Dispatch<SetStateAction<any>>
  hasBank: any
  hasUpi: any
  submitPayment: () => void
  submitPayout: () => void
  closePayModal: () => void
}) {
  const segCls = (on: boolean) =>
    `flex-1 h-full text-xs font-medium transition-colors ${on ? 'bg-accent-500 text-white' : 'text-foreground-secondary hover:bg-surface-secondary'}`

  return (
    <Dialog
      open
      onClose={closePayModal}
      title={payModal.supplier_name}
      description={`Remaining: ${formatINR(parseFloat(payModal.total_amount) - parseFloat(payModal.paid_amount))}`}
      footer={
        payTab === 'manual' ? (
          <>
            <button type="button" className={btnSecondary} onClick={closePayModal}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} onClick={submitPayment} disabled={paying}>
              {paying ? 'Saving...' : 'Record Payment'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={btnSecondary} onClick={closePayModal}>
              Close
            </button>
            <button type="button" className={btnPrimary} onClick={submitPayout} disabled={paying || !!payoutResult?.ok}>
              {paying ? 'Sending...' : payoutResult?.ok ? 'Sent' : 'Send Payout'}
            </button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {(hasBank || hasUpi) && (
          <div className="rounded-lg bg-surface-secondary px-3 py-2 text-xs space-y-0.5 break-words">
            {payModal.supplier_bank_name && (
              <p className="text-foreground-secondary">
                Bank: <span className="text-foreground">{payModal.supplier_bank_name}</span>
              </p>
            )}
            {hasBank && (
              <p className="text-foreground-secondary">
                A/C: <span className="text-foreground font-mono">{payModal.supplier_account_number}</span> · IFSC:{' '}
                <span className="text-foreground font-mono">{payModal.supplier_ifsc}</span>
              </p>
            )}
            {hasUpi && (
              <p className="text-foreground-secondary">
                UPI: <span className="text-foreground font-mono">{payModal.supplier_upi_id}</span>
              </p>
            )}
          </div>
        )}

        {(hasBank || hasUpi) && (
          <div className="flex h-control rounded-lg border border-border-default overflow-hidden">
            <button
              type="button"
              className={segCls(payTab === 'manual')}
              onClick={() => {
                setPayTab('manual')
                setPayoutResult(null)
              }}
            >
              Manual Entry
            </button>
            <button
              type="button"
              className={segCls(payTab === 'razorpayx')}
              onClick={() => {
                setPayTab('razorpayx')
                setPayoutResult(null)
              }}
            >
              Pay via RazorpayX
            </button>
          </div>
        )}

        {payTab === 'manual' && (
          <div className="space-y-3">
            <FormField label="Amount" required>
              <NumberInput step="0.01" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
            </FormField>
            <FormField label="Payment Date" required>
              <DatePicker className="w-full" value={payForm.payment_date} onChange={v => setPayForm(f => ({ ...f, payment_date: v }))} />
            </FormField>
            <AdminSelect
              label="Method"
              value={payForm.payment_method}
              onChange={v => setPayForm(f => ({ ...f, payment_method: v }))}
              options={PAYMENT_METHOD_OPTIONS}
            />
            <FormField label="Reference / UTR">
              <TextInput value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} />
            </FormField>
          </div>
        )}

        {payTab === 'razorpayx' && (
          <div className="space-y-3">
            <AdminSelect
              label="Mode"
              value={rzpForm.mode}
              onChange={v => setRzpForm(f => ({ ...f, mode: v }))}
              options={PAYOUT_MODE_OPTIONS.filter(o => (o.value === 'UPI' ? hasUpi : hasBank))}
            />
            <FormField label="Amount (Rs)" required>
              <NumberInput step="0.01" value={rzpForm.amount} onChange={e => setRzpForm(f => ({ ...f, amount: e.target.value }))} />
            </FormField>
            <FormField label="Narration" hint={payoutResult?.ok ? `Payout ${payoutResult.payout_id} queued (${payoutResult.status}).` : undefined}>
              <TextInput
                placeholder={`Payment ${payModal.expense_number}`}
                value={rzpForm.notes}
                onChange={e => setRzpForm(f => ({ ...f, notes: e.target.value.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30) }))}
                maxLength={30}
              />
            </FormField>
          </div>
        )}
      </div>
    </Dialog>
  )
}
