import PayableDetailClient from './PayableDetailClient'

export const dynamic = 'force-dynamic'

export default function PayableDetailPage({ params }: { params: { id: string } }) {
  return <PayableDetailClient id={params.id} />
}
