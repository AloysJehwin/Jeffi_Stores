import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// Consolidated into the tenant object page — see src/app/admin/ecom/customers/[id]/page.tsx.
// Kept as a redirect so existing links and bookmarks still land on the right tab.
export default async function LegacyRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/admin/ecom/customers/${id}?tab=overview`)
}
