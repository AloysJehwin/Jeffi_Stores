import { LoadingForm, LoadingTabs, PageLoading } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading
      title="Site Controls"
      description="One place to control your store: branding, contact info, feature toggles, delivery rules and storefront content. Changes take effect within 30 seconds."
    >
      <LoadingTabs tabs={['Store', 'Payments & tax', 'Orders & delivery', 'Customers', 'Storefront', 'Daily email', 'AI & shortcuts']} />
      <LoadingForm
        footer={false}
        sections={[
          {
            title: 'Store Identity',
            description: 'Name, logo and contact details used across the site, emails, invoices and documents.',
            fields: ['Favicon URL', 'Store name', 'Contact email', 'Contact phone', 'Website URL', 'Email accent colour'],
          },
          {
            title: 'Legal & Banking',
            description: 'Business identity and bank details printed on invoices, quotations and purchase orders.',
            fields: ['Legal name', 'Trade name', 'GSTIN', 'Registered address', 'City', 'Pincode', 'State', 'State code', 'Invoice number prefix', 'Account holder name', 'Bank name', 'Account number', 'IFSC code', 'Branch'],
          },
        ]}
      />
    </PageLoading>
  )
}
