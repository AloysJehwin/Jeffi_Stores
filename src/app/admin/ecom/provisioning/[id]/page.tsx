import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// Consolidated into the tenant object page — see src/app/admin/ecom/tenants/[id]/page.tsx.
// Kept as a redirect because provisioning failure alerts link here.
export default async function LegacyRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/admin/ecom/tenants/${id}?tab=provisioning`)
}
