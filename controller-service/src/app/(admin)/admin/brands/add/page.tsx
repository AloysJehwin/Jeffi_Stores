import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import BrandForm from '@/components/admin/BrandForm'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { FormPage, PageHeader } from '@/components/admin/kit'
import { createBrand } from './actions'

export default async function AddBrandPage() {
  const host = await getHost()
  return (
    <MobileEditBlock>
      <FormPage
        header={<PageHeader back={{ href: ap('/admin/brands', host), label: 'Brands' }} title="Add New Brand" description="Create a new product brand" />}
      >
        <BrandForm action={createBrand} submitLabel="Save as Draft" />
      </FormPage>
    </MobileEditBlock>
  )
}
