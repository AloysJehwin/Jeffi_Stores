import PayableDetailClient from './PayableDetailClient'

export const dynamic = 'force-dynamic'

export default async function PayableDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PayableDetailClient id={id} />
}
