'use client'

import { NOTE_TAGS } from '@/lib/shared/customer-notes-shared'
import AdminSelect from '@/components/admin/AdminSelect'
import NoteAttachments from '@/components/admin/NoteAttachments'
import StaffQrScanner from './StaffQrScanner'
import StaffCustomerPicker from './StaffCustomerPicker'
import StaffAttachmentsPicker from './StaffAttachmentsPicker'
import StaffNoteSaved from './StaffNoteSaved'
import type { StaffNoteDraft } from '@/app/(portal)/staff/notes/_lib/useStaffNoteDraft'

const inputClass =
  'w-full px-4 py-2.5 border border-border-secondary rounded-xl bg-surface text-foreground text-sm placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent'

// Laptop layout: two columns using the full width - customer, order and attachments on the left,
// the note itself plus that customer's recent notes on the right.
export default function StaffNotesFormDesktop({
  d,
  staff,
}: {
  d: StaffNoteDraft
  staff: { email: string; name: string | null }
}) {
  return (
    <div>
      {d.scanning && <StaffQrScanner onResult={d.onScanResult} onClose={() => d.setScanning(false)} />}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Customer note</h1>
          <p className="text-xs text-foreground-muted mt-1">Signed in as {staff.name || staff.email}</p>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-5 gap-8">
        <div className="col-span-3 space-y-6">
          <section className="rounded-2xl border border-border-default bg-surface-elevated p-5">
            <label className="block text-sm font-medium mb-2">Customer</label>
            <StaffCustomerPicker d={d} autoFocus />
            {d.customer && d.orders.length > 0 && (
              <div className="mt-4">
                <AdminSelect
                  label="Link to an order (optional)"
                  value={d.orderId}
                  onChange={d.setOrderId}
                  options={[
                    { value: '', label: 'No specific order' },
                    ...d.orders.map(o => ({
                      value: o.id,
                      label: `${o.orderNumber} · ${o.status.replace(/_/g, ' ')} · Rs. ${o.total.toLocaleString('en-IN')}${o.returnRequestId ? ' · has return' : ''}`,
                    })),
                  ]}
                />
              </div>
            )}
          </section>
          <section className="rounded-2xl border border-border-default bg-surface-elevated p-5">
            <StaffAttachmentsPicker d={d} layout="desktop" />
          </section>
        </div>

        <div className="col-span-2 space-y-6">
          <section className="rounded-2xl border border-border-default bg-surface-elevated p-5">
            {d.done ? (
              <StaffNoteSaved d={d} wide />
            ) : (
              <div className="space-y-3">
                <input
                  value={d.title}
                  onChange={e => d.setTitle(e.target.value)}
                  placeholder="Title (optional)"
                  className={inputClass}
                  maxLength={200}
                />
                <textarea
                  value={d.body}
                  onChange={e => d.setBody(e.target.value)}
                  rows={6}
                  placeholder="Typed note (optional)"
                  className={inputClass}
                  maxLength={2000}
                />
                <div className="flex flex-wrap gap-1.5">
                  {NOTE_TAGS.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => d.toggleTag(t)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border ${d.tags.includes(t) ? 'bg-accent-500 text-white border-accent-500' : 'bg-surface border-border-secondary text-foreground-secondary'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={d.shared}
                    onChange={e => d.setShared(e.target.checked)}
                    className="rounded"
                  />
                  Share with the customer
                </label>
                {d.error && <p className="text-sm text-red-600">{d.error}</p>}
                <button
                  type="button"
                  onClick={d.submit}
                  disabled={d.submitting || !d.canSubmit}
                  className="w-full py-2.5 rounded-xl bg-accent-500 hover:bg-accent-600 text-white font-semibold text-sm disabled:opacity-50"
                >
                  {d.submitting ? 'Saving…' : 'Save note'}
                </button>
              </div>
            )}
          </section>

          {d.customer && (
            <section className="rounded-2xl border border-border-default bg-surface-elevated p-5">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">
                Recent notes for {d.customer.name}
              </h2>
              {d.recentNotes.length === 0 ? (
                <p className="text-sm text-foreground-muted mt-3">No notes yet.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {d.recentNotes.slice(0, 8).map(n => (
                    <li key={n.id} className="border border-border-default rounded-lg p-3">
                      {n.title && <p className="text-sm font-semibold">{n.title}</p>}
                      {n.body && <p className="text-sm text-foreground-secondary whitespace-pre-wrap">{n.body}</p>}
                      <NoteAttachments attachments={n.attachments} size="sm" />
                      <p className="text-[11px] text-foreground-muted mt-2">
                        {n.adminUsername ? `${n.adminUsername} · ` : ''}
                        {new Date(n.createdAt).toLocaleString('en-IN')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
