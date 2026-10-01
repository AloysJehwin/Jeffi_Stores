import { notFound } from 'next/navigation'
import { queryOne } from '@/lib/shared/db'
import FormClient from './FormClient'
import FormsTopNav from './FormsTopNav'

interface CustomField {
  id: string
  label: string
  type: 'text' | 'textarea' | 'image' | 'rating'
  required: boolean
}

interface ReviewForm {
  id: string
  title: string
  description: string | null
  template_type: 'google_review' | 'product_feedback' | 'testimonial'
  google_review_url: string
  slug: string
  is_active: boolean
  coupon_id: string | null
  custom_fields: CustomField[]
}

export default async function FormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const form = await queryOne<ReviewForm>(
    'SELECT id, title, description, template_type, google_review_url, slug, is_active, coupon_id, custom_fields FROM review_forms WHERE slug = $1 AND is_draft = false',
    [slug]
  )
  if (!form) notFound()

  return (
    <>
      <FormsTopNav />
      <FormClient
        form={{
          ...form,
          template_type: form.template_type || 'google_review',
          custom_fields: form.custom_fields || [],
        }}
      />
    </>
  )
}
