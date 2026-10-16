import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

export default async function AiPricingMovedPage() {
  redirect(ap('/admin/settings/ai-pricing', await getHost()))
}
