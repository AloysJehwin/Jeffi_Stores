import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function LegacyProvisioningRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/admin/ecom/provisioning/${id}`)
}
