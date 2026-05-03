import { notFound } from 'next/navigation'
import { queryOne } from '@/lib/db'
import FormClient from './FormClient'

interface ReviewForm {
  id: string
  title: string
  description: string | null
  google_review_url: string
  slug: string
  is_active: boolean
  coupon_id: string | null
}

export default async function FormPage({ params }: { params: { slug: string } }) {
  const form = await queryOne<ReviewForm>(
    'SELECT id, title, description, google_review_url, slug, is_active, coupon_id FROM review_forms WHERE slug = $1',
    [params.slug]
  )
  if (!form) notFound()

  return <FormClient form={form} />
}
