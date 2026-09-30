'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Star, MessageSquare, FileText } from 'lucide-react'
import HoverCard from '@/components/ui/HoverCard'
import CopyLinkButton from '@/components/admin/CopyLinkButton'
import DeleteReviewFormButton from '@/components/admin/DeleteReviewFormButton'
import { ap } from '@/lib/shared/admin-path'

interface FormRow {
  id: string
  title: string
  slug: string
  template_type: 'google_review' | 'product_feedback' | 'testimonial'
  coupon_code: string | null
  submissions_count: number
  is_active: boolean
}

function TemplateTag({ type }: { type: FormRow['template_type'] }) {
  if (type === 'google_review')
    return (
      <span className="text-xs px-2 py-1 rounded-full font-medium inline-flex items-center gap-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
        <Star className="w-3 h-3 fill-current" /> Google
      </span>
    )
  if (type === 'product_feedback')
    return (
      <span className="text-xs px-2 py-1 rounded-full font-medium inline-flex items-center gap-1 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
        <MessageSquare className="w-3 h-3" /> Feedback
      </span>
    )
  return (
    <span className="text-xs px-2 py-1 rounded-full font-medium inline-flex items-center gap-1 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
      <FileText className="w-3 h-3" /> Testimonial
    </span>
  )
}

export default function ReviewFormTableRow({
  form: f,
  backUrl = '/admin/review-forms',
  formsBase,
}: {
  form: FormRow
  backUrl?: string
  formsBase: string
}) {
  const [open, setOpen] = useState(false)
  const formUrl = `${formsBase}/${f.slug}`

  return (
    <>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" onClick={() => setOpen(false)}>
            <div className="absolute inset-0 bg-black/50" />
            <div
              className="relative bg-surface-elevated rounded-xl shadow-2xl border border-border-default w-full max-w-md"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between p-5 border-b border-border-default">
                <div>
                  <h2 className="text-lg font-bold text-foreground">{f.title}</h2>
                  <p className="text-xs text-foreground-muted mt-0.5 font-mono">{f.slug}</p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-muted hover:text-foreground transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <TemplateTag type={f.template_type} />
                  <span
                    className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${f.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}
                  >
                    {f.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-surface-secondary text-sm">
                  <div>
                    <p className="text-xs text-foreground-muted">Submissions</p>
                    <p className="font-semibold mt-0.5">{f.submissions_count}</p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground-muted">Coupon</p>
                    <p className="font-semibold mt-0.5 font-mono">{f.coupon_code || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={formUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent-500 hover:underline"
                  >
                    Open form ↗
                  </a>
                  <CopyLinkButton url={formUrl} />
                </div>
                <div className="flex gap-3 pt-1 border-t border-border-default">
                  <Link
                    href={ap(`/admin/review-forms/edit/${f.id}?back=${encodeURIComponent(backUrl)}`)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent-500 hover:bg-accent-600 text-white transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    Edit Form
                  </Link>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
      <tr className="hover:bg-surface-secondary/50 transition-colors cursor-pointer" onClick={() => setOpen(true)}>
        <td className="px-4 py-3 font-medium">
          <HoverCard
            trigger={
              <span
                className="text-foreground hover:text-accent-500 transition-colors cursor-pointer"
                onClick={e => e.stopPropagation()}
              >
                {f.title}
              </span>
            }
            align="left"
            side="bottom"
            width="240px"
          >
            <div className="p-3 space-y-2">
              <p className="font-semibold text-foreground text-sm">{f.title}</p>
              <p className="text-xs text-foreground-muted font-mono">{f.slug}</p>
              <div className="text-xs text-foreground-secondary space-y-1">
                <div className="flex justify-between gap-4">
                  <span>Type</span>
                  <span className="capitalize text-foreground">{f.template_type.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Submissions</span>
                  <span className="text-foreground">{f.submissions_count}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Status</span>
                  <span className={f.is_active ? 'text-green-600 dark:text-green-400' : 'text-red-500'}>
                    {f.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </div>
          </HoverCard>
        </td>
        <td className="px-4 py-3">
          <TemplateTag type={f.template_type} />
        </td>
        <td className="px-4 py-3 max-w-[260px]">
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <a
              href={formUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-500 hover:underline text-xs shrink-0"
            >
              Open ↗
            </a>
            <CopyLinkButton url={formUrl} />
          </div>
        </td>
        <td className="px-4 py-3 text-foreground-secondary">
          {f.coupon_code || <span className="text-foreground-muted">None</span>}
        </td>
        <td className="px-4 py-3">
          <Link
            href={ap(`/admin/review-forms/${f.id}/submissions`)}
            className="text-accent-500 hover:underline font-medium"
            onClick={e => e.stopPropagation()}
          >
            {f.submissions_count} view
          </Link>
        </td>
        <td className="px-4 py-3">
          <span
            className={`text-xs px-2 py-1 rounded-full font-medium ${f.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}
          >
            {f.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3">
            <Link
              href={ap(`/admin/review-forms/edit/${f.id}?back=${encodeURIComponent(backUrl)}`)}
              className="text-accent-500 hover:underline text-sm"
            >
              Edit
            </Link>
            <DeleteReviewFormButton id={f.id} title={f.title} />
          </div>
        </td>
      </tr>
    </>
  )
}
