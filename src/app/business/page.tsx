import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { bp } from '@/lib/business-path'

export default async function BusinessHomePage() {
  const host = (await headers()).get('host') ?? ''
  redirect(bp('/business/products', host))
}
