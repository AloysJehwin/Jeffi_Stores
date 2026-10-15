'use client'

import { Dispatch, SetStateAction } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import DatePicker from '@/components/ui/DatePicker'
import {
  Modal,
  PAYMENT_METHOD_OPTIONS,
  PAYOUT_MODE_OPTIONS,
  inputCls,
  labelCls,
  btnPrimary,
  btnSecondary,
  formatINR,
} from './shared'

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
  return (
    <Modal onClose={closePayModal}>
      <div className="bg-surface-elevated rounded-xl border border-border-default p-6 w-full max-w-md space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">{payModal.supplier_name}</h3>
            <p className="text-xs text-foreground-secondary mt-0.5">
              Remaining: {formatINR(parseFloat(payModal.total_amount) - parseFloat(payModal.paid_amount))}
            </p>
          </div>
          <button
            className="text-foreground-secondary hover:text-foreground text-lg leading-none"
            onClick={closePayModal}
          >
            ×
          </button>
        </div>

        {(hasBank || hasUpi) && (
          <div className="bg-surface-secondary rounded-lg px-3 py-2 text-xs space-y-0.5">
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
          <div className="flex rounded-lg border border-border-default overflow-hidden text-xs font-medium">
            <button
              className={`flex-1 py-2 transition-colors ${payTab === 'manual' ? 'bg-surface-secondary text-foreground' : 'text-foreground-secondary hover:bg-surface-secondary/50'}`}
              onClick={() => {
                setPayTab('manual')
                setPayoutResult(null)
              }}
            >
              Manual Entry
            </button>
            <button
              className={`flex-1 py-2 transition-colors ${payTab === 'razorpayx' ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900' : 'text-foreground-secondary hover:bg-surface-secondary/50'}`}
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
            <div>
              <label className={labelCls}>Amount *</label>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={payForm.amount}
                onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>Payment Date *</label>
              <DatePicker value={payForm.payment_date} onChange={v => setPayForm(f => ({ ...f, payment_date: v }))} />
            </div>
            <AdminSelect
              label="Method"
              value={payForm.payment_method}
              onChange={v => setPayForm(f => ({ ...f, payment_method: v }))}
              options={PAYMENT_METHOD_OPTIONS}
            />
            <div>
              <label className={labelCls}>Reference / UTR</label>
              <input
                className={inputCls}
                value={payForm.reference}
                onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button className={btnPrimary} onClick={submitPayment} disabled={paying}>
                {paying ? 'Saving…' : 'Record Payment'}
              </button>
              <button className={btnSecondary} onClick={closePayModal}>
                Cancel
              </button>
            </div>
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
            <div>
              <label className={labelCls}>Amount (₹) *</label>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={rzpForm.amount}
                onChange={e => setRzpForm(f => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>Narration</label>
              <input
                className={inputCls}
                placeholder={`Payment ${payModal.expense_number}`}
                value={rzpForm.notes}
                onChange={e =>
                  setRzpForm(f => ({ ...f, notes: e.target.value.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30) }))
                }
                maxLength={30}
              />
            </div>
            {payoutResult && (
              <div
                className={`rounded-lg px-3 py-2 text-xs ${payoutResult.ok ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}
              >
                {payoutResult.ok
                  ? `Payout queued · ID: ${payoutResult.payout_id} · Status: ${payoutResult.status}`
                  : `Error: ${payoutResult.error}`}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                className={btnPrimary + ' bg-secondary-500 hover:bg-secondary-600'}
                onClick={submitPayout}
                disabled={paying || !!payoutResult?.ok}
              >
                {paying ? 'Sending…' : payoutResult?.ok ? 'Sent' : 'Send Payout'}
              </button>
              <button className={btnSecondary} onClick={closePayModal}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
