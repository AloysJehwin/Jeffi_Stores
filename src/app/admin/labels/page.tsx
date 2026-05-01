import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import LabelsClient from '@/components/admin/LabelsClient'
import { LABEL_SIZES } from '@/lib/label-pdf'

export const metadata = {
  title: 'Label Generator — Jeffi Admin',
}

export default async function LabelsPage() {
  const cookieStore = cookies()
  const token = cookieStore.get('admin_token')
  if (!token) redirect('/admin/login')

  let session: any = null
  try {
    session = await verifyToken(token.value)
  } catch {
    redirect('/admin/login')
  }

  if (!hasScope(session?.role || '', session?.scopes || [], 'labels')) {
    redirect('/admin/dashboard')
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Label Generator</h1>
        <p className="text-foreground-secondary mt-1">Generate and download product labels with barcodes and QR codes</p>
      </div>
      <LabelsClient labelSizes={LABEL_SIZES} />
    </div>
  )
}
