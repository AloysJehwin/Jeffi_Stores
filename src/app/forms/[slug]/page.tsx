import { notFound } from 'next/navigation'
import { queryOne } from '@/lib/db'
import FormClient from './FormClient'
import FormsTopNav from '@/components/forms/FormsTopNav'

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
  google_review_url: string
  slug: string
  is_active: boolean
  coupon_id: string | null
  custom_fields: CustomField[]
}

export default async function FormPage({ params }: { params: { slug: string } }) {
  const form = await queryOne<ReviewForm>(
    'SELECT id, title, description, google_review_url, slug, is_active, coupon_id, custom_fields FROM review_forms WHERE slug = $1',
    [params.slug]
  )
  if (!form) notFound()

  return (
    <>
      <FormsTopNav />
      <FormClient form={{ ...form, custom_fields: form.custom_fields || [] }} />
    </>
  )
}
