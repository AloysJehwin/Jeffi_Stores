'use client'

import { NOTE_TAGS } from '@/lib/customer-notes-shared'
import AdminSelect from '@/components/admin/AdminSelect'
import StaffQrScanner from './StaffQrScanner'
import StaffCustomerPicker from './StaffCustomerPicker'
import StaffAttachmentsPicker from './StaffAttachmentsPicker'
import StaffNoteSaved from './StaffNoteSaved'
import type { StaffNoteDraft } from './useStaffNoteDraft'

const inputClass = 'w-full px-4 py-3 border border-border-secondary rounded-xl bg-surface text-foreground text-base placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent'

// Phone layout: one column, camera-first, sticky Save at the bottom.
export default function StaffNotesFormMobile({ d, staff }: { d: StaffNoteDraft; staff: { email: string; name: string | null } }) {
  if (d.done) return <StaffNoteSaved d={d} />
  return (
    <div>
      {d.scanning && <StaffQrScanner onResult={d.onScanResult} onClose={() => d.setScanning(false)} />}
      <h1 className="text-2xl font-bold">Customer note</h1>
      <p className="text-xs text-foreground-muted mt-1">Signed in as {staff.name || staff.email}</p>

      <section className="mt-6">
        <label className="block text-sm font-medium mb-1.5">Customer</label>
        <StaffCustomerPicker d={d} autoFocus />
      </section>

      {d.customer && d.orders.length > 0 && (
        <section className="mt-5">
          <AdminSelect
            label="Link to an order (optional)"
            value={d.orderId}
            onChange={d.setOrderId}
            options={[
              { value: '', label: 'No specific order' },
              ...d.orders.map(o => ({ value: o.id, label: `${o.orderNumber} · ${o.status.replace(/_/g, ' ')} · Rs. ${o.total.toLocaleString('en-IN')}${o.returnRequestId ? ' · has return' : ''}` })),
            ]}
          />
        </section>
      )}

      <section className="mt-5"><StaffAttachmentsPicker d={d} layout="mobile" /></section>

      <section className="mt-5 space-y-3">
        <input value={d.title} onChange={e => d.setTitle(e.target.value)} placeholder="Title (optional)" className={inputClass} maxLength={200} />
        <textarea value={d.body} onChange={e => d.setBody(e.target.value)} rows={3} placeholder="Typed note (optional)" className={inputClass} maxLength={2000} />
        <div className="flex flex-wrap gap-2">
          {NOTE_TAGS.map(t => (
            <button key={t} type="button" onClick={() => d.toggleTag(t)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border ${d.tags.includes(t) ? 'bg-accent-500 text-white border-accent-500' : 'bg-surface border-border-secondary text-foreground-secondary'}`}>
              {t}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-border-default p-3 text-sm">
          <input type="checkbox" checked={d.shared} onChange={e => d.setShared(e.target.checked)} className="w-5 h-5 rounded" />
          <span>Share with the customer <span className="block text-[11px] text-foreground-muted">Shows on their order page. Leave off for internal notes.</span></span>
        </label>
      </section>

      {d.error && <p className="mt-4 text-sm text-red-600">{d.error}</p>}

      <div className="fixed bottom-0 inset-x-0 p-4 bg-surface/95 backdrop-blur border-t border-border-default">
        <button type="button" onClick={d.submit} disabled={d.submitting || !d.canSubmit} className="w-full py-3.5 rounded-xl bg-accent-500 hover:bg-accent-600 text-white font-semibold text-base disabled:opacity-50">
          {d.submitting ? 'Saving…' : 'Save note'}
        </button>
      </div>
    </div>
  )
}
