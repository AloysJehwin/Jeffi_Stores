import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { getAllCategories } from '@/lib/queries'
import CategoryForm from '@/components/admin/CategoryForm'
import { FormPage, PageHeader } from '@/components/admin/kit'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { createCategory } from './actions'

export default async function AddCategoryPage() {
  const host = await getHost()
  const categories = await getAllCategories()

  return (
    <MobileEditBlock>
    <FormPage header={<PageHeader back={{ href: ap('/admin/categories', host), label: 'Categories' }} title="Add New Category" description="Create a new product category" />}>
      <CategoryForm categories={categories || []} action={createCategory} submitLabel="Save as Draft" />
    </FormPage>
    </MobileEditBlock>
  )
}
