interface Props {
  supplier: {
    name: string
    gstin: string | null
    contact_name: string | null
    phone: string | null
    payment_terms: number
    po_count: number
    is_active: boolean
  }
}

export default function SupplierMobileCardBody({ supplier }: Props) {
  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground truncate">{supplier.name}</div>
          <div className="text-xs text-foreground-muted font-mono truncate">{supplier.gstin || 'No GSTIN'}</div>
        </div>
        <span
          className={`flex-shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full ${
            supplier.is_active
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
              : 'bg-surface-secondary text-foreground-muted'
          }`}
        >
          {supplier.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-foreground-muted">
        <span className="truncate">{supplier.contact_name || supplier.phone ? `${supplier.contact_name || ''}${supplier.contact_name && supplier.phone ? ' · ' : ''}${supplier.phone ? `+91 ${supplier.phone}` : ''}` : 'No contact'}</span>
        <span className="flex-shrink-0 ml-2">
          {supplier.payment_terms}d · {supplier.po_count} PO{supplier.po_count === 1 ? '' : 's'}
        </span>
      </div>
    </>
  )
}
