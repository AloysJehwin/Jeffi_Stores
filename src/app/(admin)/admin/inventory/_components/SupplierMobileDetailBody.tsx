interface Props {
  supplier: {
    name: string
    gstin: string | null
    contact_name: string | null
    phone: string | null
    email: string | null
    payment_terms: number
    po_count: number
    is_active: boolean
    address: string | null
    bank_name: string | null
    account_number: string | null
    ifsc: string | null
    upi_id: string | null
  }
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border-default last:border-0">
      <span className="text-xs font-medium text-foreground-muted flex-shrink-0">{label}</span>
      <span className="text-sm text-foreground text-right break-words min-w-0">{value}</span>
    </div>
  )
}

export default function SupplierMobileDetailBody({ supplier }: Props) {
  return (
    <div className="px-5 py-4">
      <div className="mb-3">
        <span
          className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${
            supplier.is_active
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
              : 'bg-surface-secondary text-foreground-muted'
          }`}
        >
          {supplier.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <Row label="GSTIN" value={supplier.gstin} />
      <Row label="Contact" value={supplier.contact_name} />
      <Row label="Phone" value={supplier.phone ? `+91 ${supplier.phone}` : null} />
      <Row label="Email" value={supplier.email} />
      <Row label="Payment terms" value={`${supplier.payment_terms} days`} />
      <Row label="Purchase orders" value={String(supplier.po_count)} />
      <Row label="Address" value={supplier.address} />
      <Row label="Bank" value={supplier.bank_name} />
      <Row label="Account" value={supplier.account_number} />
      <Row label="IFSC" value={supplier.ifsc} />
      <Row label="UPI" value={supplier.upi_id} />
    </div>
  )
}
