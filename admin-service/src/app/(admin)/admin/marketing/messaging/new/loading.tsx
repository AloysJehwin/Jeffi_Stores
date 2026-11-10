import { ChevronLeft } from 'lucide-react'
import { Sk } from '@/components/admin/kit/skeleton'

// Step 1 of the composer. SMS and WhatsApp appear only when Site Controls has them on, so only the
// always-on channels are drawn.
const CHANNELS = [
  { label: 'Email', note: 'Customers with an email address' },
  {
    label: 'App push',
    note: 'Android app installs that allow offers. Quiet hours (00:00–09:00 on the phone) delay it; at most 2 a day per person.',
  },
]

export default function Loading() {
  return (
    <div className="p-4 sm:p-6" role="status" aria-busy="true" aria-label="Loading new message">
      <div className="mb-6 space-y-1.5">
        <span className="inline-flex items-center gap-1 text-xs text-foreground-muted">
          <ChevronLeft className="h-3.5 w-3.5" />
          Messaging
        </span>
        <h1 className="text-2xl font-bold text-foreground">New message</h1>
        <p className="mt-0.5 text-sm text-foreground-muted">Step 1 of 3 · Channels &amp; templates</p>
      </div>
      <div className="mb-6 flex gap-1">
        {[1, 2, 3].map(s => (
          <span key={s} className={`h-1.5 flex-1 rounded-full ${s === 1 ? 'bg-accent-500' : 'bg-border-default'}`} />
        ))}
      </div>
      <div className="space-y-4">
        <p className="text-sm text-foreground-secondary">
          Pick one or more channels and a template for each from your Templates library — or write the email right here.
        </p>
        {CHANNELS.map(c => (
          <div key={c.label} className="flex items-start gap-3 rounded-lg border border-border-default bg-surface-elevated p-4">
            <Sk className="mt-1 h-4 w-4 shrink-0 rounded" />
            <div>
              <p className="text-sm font-medium text-foreground">{c.label}</p>
              <p className="mt-0.5 text-xs text-foreground-muted">{c.note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
