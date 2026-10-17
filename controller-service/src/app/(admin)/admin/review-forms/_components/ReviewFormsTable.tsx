'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Star, MessageSquare, FileText } from 'lucide-react'
import HoverCard from '@/components/ui/HoverCard'
import CopyLinkButton from '@/components/admin/CopyLinkButton'
import { useToast } from '@/contexts/ToastContext'
import { ap } from '@/lib/shared/admin-path'
import {
  DataTable,
  Dialog,
  Field,
  Fields,
  StatusBadge,
  ACTIVE_STATUS,
  badgeCls,
  type DataCol,
} from '@/components/admin/kit'
import ReviewFormsMobileList from './ReviewFormsMobileList'

export interface FormRow {
  id: string
  title: string
  slug: string
  template_type: 'google_review' | 'product_feedback' | 'testimonial'
  coupon_code: string | null
  submissions_count: number
  is_active: boolean
}

function TemplateTag({ type }: { type: FormRow['template_type'] }) {
  const cls = `${badgeCls('blue')} inline-flex items-center gap-1`
  if (type === 'google_review')
    return (
      <span className={cls}>
        <Star className="h-3 w-3 fill-current" /> Google
      </span>
    )
  if (type === 'product_feedback')
    return (
      <span className={cls}>
        <MessageSquare className="h-3 w-3" /> Feedback
      </span>
    )
  return (
    <span className={cls}>
      <FileText className="h-3 w-3" /> Testimonial
    </span>
  )
}

export default function ReviewFormsTable({
  forms,
  total,
  page,
  pageSize,
  search,
  backUrl,
  formsBase,
}: {
  forms: FormRow[]
  total: number
  page: number
  pageSize: number
  search?: string
  backUrl: string
  formsBase: string
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState<FormRow | null>(null)
  // Row Edit routes through the view page so startReviewFormDraft is the single
  // entry point to editing a live form; the view's Edit button creates the draft
  // and redirects on. For create-drafts (is_draft=true) the view also hosts the
  // same Edit button, which just links to /edit since no edit-draft is needed.
  const editHref = (f: FormRow) => ap(`/admin/review-forms/${f.id}/view?back=${encodeURIComponent(backUrl)}`)
  const url = (f: FormRow) => `${formsBase}/${f.slug}`

  // Clone every param so advancing page keeps tab/filters; otherwise the parent Suspense re-keys.
  const sp = useSearchParams()
  const pageHref = (p: number) => {
    const params = new URLSearchParams(sp.toString())
    if (p > 1) params.set('page', String(p))
    else params.delete('page')
    const qs = params.toString()
    return ap(`/admin/review-forms${qs ? `?${qs}` : ''}`)
  }

  const [gone, setGone] = useState<Set<string>>(new Set())

  async function deleteForm(f: FormRow) {
    const res = await fetch(`/api/admin/review-forms/${f.id}`, { method: 'DELETE' })
    if (!res.ok) {
      showToast((await res.json().catch(() => ({})))?.error || 'Failed to delete form', 'error')
      return
    }
    setGone(g => new Set(g).add(String(f.id)))
    router.refresh()
  }

  const cols: DataCol<FormRow>[] = [
    {
      key: 'title',
      label: 'Title',
      render: f => (
        <HoverCard
          trigger={
            <span
              className="cursor-pointer font-medium text-foreground transition-colors hover:text-accent-500"
              onClick={e => e.stopPropagation()}
            >
              {f.title}
            </span>
          }
          align="left"
          side="bottom"
          width="240px"
        >
          <div className="space-y-2 p-3">
            <p className="text-sm font-semibold text-foreground">{f.title}</p>
            <p className="font-mono text-xs text-foreground-muted">{f.slug}</p>
            <div className="space-y-1 text-xs text-foreground-secondary">
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
                <StatusBadge status={String(f.is_active)} map={ACTIVE_STATUS} />
              </div>
            </div>
          </div>
        </HoverCard>
      ),
    },
    { key: 'template', label: 'Template', render: f => <TemplateTag type={f.template_type} /> },
    {
      key: 'link',
      label: 'Shareable Link',
      hideBelow: 'lg',
      render: f => (
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          <a
            href={url(f)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs text-accent-500 hover:underline"
          >
            Open ↗
          </a>
          <CopyLinkButton url={url(f)} />
        </div>
      ),
    },
    {
      key: 'coupon',
      label: 'Coupon',
      render: f =>
        f.coupon_code ? (
          <span className="font-mono text-xs text-foreground-secondary">{f.coupon_code}</span>
        ) : (
          <span className="text-foreground-muted">None</span>
        ),
    },
    {
      key: 'subs',
      label: 'Submissions',
      render: f => (
        <Link
          href={ap(`/admin/review-forms/${f.id}/submissions`)}
          className="font-medium text-accent-500 hover:underline"
          onClick={e => e.stopPropagation()}
        >
          {f.submissions_count} view
        </Link>
      ),
    },
    { key: 'status', label: 'Status', render: f => <StatusBadge status={String(f.is_active)} map={ACTIVE_STATUS} /> },
  ]

  return (
    <>
      <DataTable<FormRow>
        mode="server"
        hide={r => gone.has(String(r.id))}
        rows={forms}
        cols={cols}
        rowKey={f => f.id}
        total={total}
        page={page}
        pageSize={pageSize}
        pageHref={pageHref}
        onRowClick={setOpen}
        mobile={rows => <ReviewFormsMobileList forms={rows} backUrl={backUrl} formsBase={formsBase} />}
        empty={{ title: 'No review forms yet.', body: 'Create your first one!' }}
        rowActions={f => [
          { key: 'edit', kind: 'edit', label: 'Edit Form', href: editHref(f), scope: 'review_forms:write' },
          {
            key: 'delete',
            kind: 'delete',
            label: 'Delete Review Form',
            scope: 'review_forms:write',
            onSelect: () => deleteForm(f),
            confirm: {
              title: 'Delete Review Form',
              message: `Delete review form "${f.title}"? This action cannot be undone.`,
              confirmLabel: 'Delete',
              variant: 'danger',
            },
          },
        ]}
      />

      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.title}
        description={open && <span className="font-mono">{open.slug}</span>}
        zIndex="z-[300]"
        footer={
          open && (
            <Link
              href={editHref(open)}
              onClick={() => setOpen(null)}
              className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600"
            >
              Edit Form
            </Link>
          )
        }
      >
        {open && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <TemplateTag type={open.template_type} />
              <StatusBadge status={String(open.is_active)} map={ACTIVE_STATUS} />
            </div>
            <Fields>
              <Field label="Submissions" value={String(open.submissions_count)} />
              <Field label="Coupon" value={open.coupon_code} mono />
            </Fields>
            <div className="flex items-center gap-2">
              <a
                href={url(open)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent-500 hover:underline"
              >
                Open form ↗
              </a>
              <CopyLinkButton url={url(open)} />
            </div>
          </div>
        )}
      </Dialog>
    </>
  )
}
