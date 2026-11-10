import { LoadingFacts, LoadingKpis, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'

const TAX = ['Taxable', 'CGST', 'SGST', 'IGST']

export function GstKpisSkeleton() {
  return <LoadingKpis labels={['Invoices', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total Tax']} />
}

/** A GST tab's cards while the reports load. */
export function GstTabSkeleton({ tab }: { tab: 'gstr1' | 'gstr3b' | 'irn' | 'itc' }) {
  if (tab === 'gstr3b')
    return (
      <div className="space-y-4">
        <LoadingSection title="GSTR-3B Summary">
          <LoadingFacts labels={['Entity', 'GSTIN']} />
        </LoadingSection>
        <LoadingSection title="3.1 Details of Outward Supplies">
          <LoadingKpis labels={['Taxable Value', 'Integrated Tax (IGST)', 'Central Tax (CGST)', 'State/UT Tax (SGST)']} />
        </LoadingSection>
        <LoadingSection title="Tax Breakup by GST Rate">
          <LoadingTable bare rows={4} columns={['GST Rate', 'Supply Type', ...TAX, 'Total Tax']} />
        </LoadingSection>
        <LoadingSection title="6. Payment of Tax">
          <LoadingKpis labels={['IGST Payable', 'CGST Payable', 'SGST Payable', 'Total Payable']} />
        </LoadingSection>
      </div>
    )
  if (tab === 'irn')
    return (
      <LoadingSection title="e-Invoice (IRN) Status">
        <LoadingTable bare columns={['Invoice No', 'Date', 'Customer', 'Type', 'Amount', 'IRN', 'Ack No', 'Ack Date', 'Status']} />
      </LoadingSection>
    )
  if (tab === 'itc')
    return (
      <div className="space-y-4">
        <LoadingSection title="Input Tax Credit Ledger">
          <LoadingKpis labels={['PO Line Items', 'Total Taxable Purchases', 'Total ITC Claimable']} />
        </LoadingSection>
        <LoadingSection title="By Supplier">
          <LoadingTable bare rows={4} columns={['Supplier', 'GSTIN', 'POs', 'Taxable', 'ITC (Tax)']} />
        </LoadingSection>
        <LoadingSection title="Line-level Detail">
          <LoadingTable bare rows={5} columns={['PO No', 'Date', 'Supplier', 'Product', 'Qty', 'Unit Cost', 'GST %', 'Taxable', 'ITC']} />
        </LoadingSection>
      </div>
    )
  return (
    <div className="space-y-4">
      <LoadingSection title="B2B Invoices">
        <LoadingTable bare rows={5} columns={['Invoice No', 'Date', 'Customer', 'GSTIN', ...TAX, 'Total']} />
      </LoadingSection>
      <LoadingSection title="B2C Invoices">
        <LoadingTable bare rows={5} columns={['Invoice No', 'Date', 'Customer', ...TAX, 'Total']} />
      </LoadingSection>
      <LoadingSection title="HSN Summary">
        <LoadingTable bare rows={4} columns={['HSN Code', 'GST Rate', ...TAX, 'Total Tax']} />
      </LoadingSection>
    </div>
  )
}
