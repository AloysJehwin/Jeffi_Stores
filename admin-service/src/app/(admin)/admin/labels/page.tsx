import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { Suspense } from 'react'
import { PageBody, PageHeader } from '@/components/admin/kit'
import LabelsClient from './LabelsClient'
import LabelsTabs from './_components/LabelsTabs'
import { LABEL_SIZES } from '@/lib/documents/label-pdf'
import { getAllCategories } from '@/lib/queries'
import { adminCookieName } from '@/lib/auth/admin-cookie'
import { getStoreIdentity } from '@/lib/catalog/site-controls'

export async function generateMetadata() {
  const { name } = await getStoreIdentity()
  return { title: `Label Generator — ${name} Admin` }
}

export default async function LabelsPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())
  const host = await getHost()
  if (!token) redirect(ap('/admin/login', host))

  let session: any = null
  try {
    session = await verifyToken(token.value)
  } catch {
    redirect(ap('/admin/login', host))
  }

  if (!hasScope(session?.role || '', session?.scopes || [], 'labels:read')) {
    redirect(ap('/admin/dashboard', host))
  }

  const categories = (await getAllCategories()) || []

  return (
    <PageBody>
      <PageHeader title="Label Generator" description="Generate and download product labels with barcodes and QR codes" />
      <Suspense fallback={null}>
        <LabelsTabs generator={<LabelsClient labelSizes={LABEL_SIZES} categories={categories} />} />
      </Suspense>
    </PageBody>
  )
}
