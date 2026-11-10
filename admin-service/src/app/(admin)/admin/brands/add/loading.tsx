import { LoadingForm, PageLoading } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading back="Brands" title="Add New Brand" description="Create a new product brand">
      <LoadingForm
        sections={[
          { title: 'Brand', description: 'Name, slug, website, logo and description.', fields: ['Brand Name', 'Slug', 'Website', 'Logo', 'Description'] },
          { title: 'Return & Replacement Policy', description: 'Brand policy takes priority over category policy on the product page.', fields: ['Return window (days)', 'Replacement window (days)'] },
        ]}
      />
    </PageLoading>
  )
}
