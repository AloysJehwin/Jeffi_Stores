'use client'

import { Dispatch, SetStateAction } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import DatePicker from '@/components/ui/DatePicker'
import { Dialog, FormField, TextInput, NumberInput } from '@/components/admin/kit'
import { PAYMENT_METHOD_OPTIONS, btnPrimary, btnSecondary, formatINR } from './shared'

type PayForm = { amount: string; payment_date: string; payment_method: string; reference: string }

export function PayablesPayModal({
  payModal,
  payForm,
  setPayForm,
  paying,
  submitPayment,
  closePayModal,
}: {
  payModal: any
  payForm: PayForm
  setPayForm: Dispatch<SetStateAction<PayForm>>
  paying: boolean
  submitPayment: () => void
  closePayModal: () => void
}) {
  const hasBank = !!(payModal.supplier_account_number && payModal.supplier_ifsc)
  const hasUpi = !!payModal.supplier_upi_id
  return (
    <Dialog
      open
      onClose={closePayModal}
      title={payModal.supplier_name}
      description={`Remaining: ${formatINR(parseFloat(payModal.total_amount) - parseFloat(payModal.paid_amount))}`}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={closePayModal}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={submitPayment} disabled={paying}>
            {paying ? 'Saving...' : 'Record Payment'}
          </button>
        </>
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
      </div>
    </Dialog>
  )
}
