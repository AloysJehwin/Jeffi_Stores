import { LoadingForm } from '@/components/admin/kit/skeleton'

/** CategoryForm's sections while the add / edit page loads. */
export function CategoryFormLoading() {
  return (
    <LoadingForm
      sections={[
        {
          title: 'Category',
          description: 'Name, icon, parent, ordering and description.',
          fields: ['Category Name *', 'Category Icon', 'Category image', 'Parent Category', 'Display Order *', 'SKU Prefix', 'Google Product Category', 'Description'],
        },
        {
          title: 'Return & Replacement Policy',
          description: 'Category policy is the default. Brand policy can override per product.',
          fields: ['Return window (days)', 'Replacement window (days)'],
        },
      ]}
    />
  )
}
