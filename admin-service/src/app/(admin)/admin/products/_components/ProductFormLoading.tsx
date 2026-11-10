import { LoadingForm, LoadingTabs } from '@/components/admin/kit/skeleton'

/** ProductForm on its Basics tab while the add / edit page loads. */
export default function ProductFormLoading({ edit }: { edit?: boolean }) {
  const tabs = ['Basics', 'Pricing & stock', 'Images & media', 'Details & specs', 'SEO', ...(edit ? ['Selling units'] : [])]
  return (
    <div className="space-y-5">
      <LoadingTabs tabs={tabs} />
      <LoadingForm
        sections={[
          {
            title: 'Basics',
            fields: ['Product Name *', 'SKU', 'HSN/SAC Code', 'MPN (Manufacturer Part No.)', 'GTIN / Barcode', 'Category *', 'Brand', 'Description'],
          },
        ]}
      />
    </div>
  )
}
