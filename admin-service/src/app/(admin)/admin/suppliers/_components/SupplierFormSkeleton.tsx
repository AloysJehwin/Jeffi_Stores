import { LoadingForm, PageLoading } from '@/components/admin/kit/skeleton'

/** The supplier form (new or edit) while it loads. */
export default function SupplierFormSkeleton({ title, description }: { title?: string; description: string }) {
  return (
    <PageLoading back="Suppliers" title={title} description={description}>
      <LoadingForm
        sections={[
          { title: 'Basic Information', fields: ['Name', 'GSTIN', 'Payment Terms (days)', 'Contact Name', 'Phone', 'Email', 'Address', 'Notes'], cols: 3 },
          { title: 'Bank & Payment Details', fields: ['IFSC Code', 'Bank Name', 'Account Number', 'UPI ID'], cols: 3 },
        ]}
      />
    </PageLoading>
  )
}
