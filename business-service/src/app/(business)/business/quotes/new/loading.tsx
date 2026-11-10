// The form starts empty, so its loading screen is the page itself.
const INPUT = 'w-full px-3 py-2 text-sm rounded-lg border border-border-default bg-surface text-foreground-muted'
const LABEL = 'block text-xs font-medium text-foreground-secondary mb-1'

export default function Loading() {
  return (
    <div className="max-w-3xl space-y-5" role="status" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <span className="text-accent-500">My Quotes</span>
        <span>/</span>
        <span className="text-foreground">New RFQ</span>
      </div>

      <h1 className="text-xl font-bold text-foreground">Submit Quote Request</h1>

      <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border-default flex items-center justify-between">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Items</h2>
          <span className="text-xs font-semibold text-accent-500">+ Add Item</span>
        </div>
        <div className="p-4 space-y-3">
          <span className="text-xs font-semibold text-foreground-muted">Item 1</span>
          <div>
            <span className={LABEL}>Description *</span>
            <div className={INPUT}>Product name or description</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <span className={LABEL}>Quantity *</span>
              <div className={`${INPUT} text-foreground`}>1</div>
            </div>
            <div className="sm:col-span-3">
              <span className={LABEL}>
                Target Price (₹) <span className="text-foreground-muted font-normal">optional</span>
              </span>
              <div className={INPUT}>Your target price per unit</div>
              <p className="text-[11px] text-foreground-muted mt-1">Maximum discount allowed: 30% off the listed price</p>
            </div>
          </div>
          <div>
            <span className={LABEL}>
              Notes <span className="text-foreground-muted font-normal">optional</span>
            </span>
            <div className={INPUT}>Specifications, grade, brand preference…</div>
          </div>
        </div>
      </div>

      <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
        <span className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">
          Overall Notes <span className="font-normal normal-case text-foreground-muted">(optional)</span>
        </span>
        <div className={`${INPUT} h-[4.75rem]`}>Delivery requirements, project context, urgency…</div>
      </div>

      <div className="flex gap-3">
        <span className="px-6 py-2.5 bg-accent-500 text-white text-sm font-semibold rounded-lg">Submit RFQ</span>
        <span className="px-6 py-2.5 border border-border-default text-sm font-medium rounded-lg">Cancel</span>
      </div>
    </div>
  )
}
