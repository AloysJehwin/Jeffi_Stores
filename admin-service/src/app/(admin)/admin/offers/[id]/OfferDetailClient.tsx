'use client'

import { useState, useCallback, type ReactNode } from 'react'
import Link from 'next/link'
import { Badge, DetailHeader, DraftLockBanner, FormFooter, LockedFieldset, PageBody, StatusBadge, fieldInputCls } from '@/components/admin/kit'
import { useRouter } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import Toggle from '@/components/ui/Toggle'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import DatePicker from '@/components/ui/DatePicker'
import OfferProductPicker, { type AssignOption } from '@/components/admin/OffersProductPicker'
import { useEditSession } from '@/hooks/useEditSession'
import type { ProductOffer } from '@/lib/catalog/product-offers-shared'
import { useDraftLock } from '@/hooks/useDraftLock'
import { lockHeaders, type DraftLockState } from '@/lib/client/draft-lock-client'
import type { MergeConflict } from '@/lib/admin/draft-merge'
import MergeDialog from '@/components/admin/drafts/MergeDialog'
import { ChangeLog } from '@/components/admin/change-log'

function toDateInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fromDateInput(value: string, endOfDay: boolean): string | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  const local = endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d)
  return local.toISOString()
}

const INPUT_CLASS = fieldInputCls

export default function OfferDetailClient({
  offer,
  backHref,
  categoryOptions,
  brandOptions,
  initialLock,
  draftId = null,
  draftTitle,
  draftCount = 0,
  actions,
  notices,
}: {
  offer: ProductOffer
  backHref: string
  categoryOptions: AssignOption[]
  brandOptions: AssignOption[]
  initialLock?: DraftLockState | null
  /** The draft being edited (lock and session key); without one the page is read-only. */
  draftId?: string | null
  draftTitle?: string | null
  draftCount?: number
  actions?: ReactNode
  notices?: ReactNode
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const canWrite = useCanWrite('coupons:write')
  const [title, setTitle] = useState(offer.title)
  const [savedTitle, setSavedTitle] = useState(offer.title)
  const [startsAt, setStartsAt] = useState<string | null>(offer.starts_at)
  const [endsAt, setEndsAt] = useState<string | null>(offer.ends_at)
  const [isActive, setIsActive] = useState(offer.is_active)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [pickerKey, setPickerKey] = useState(0)
  const [conflicts, setConflicts] = useState<MergeConflict[] | null>(null)

  const lock = useDraftLock({ resourceType: 'offer', resourceId: draftId, initial: initialLock })
  const readOnly = !draftId || lock.readOnly
  const publishPath = `/api/admin/product-offers/${offer.id}/publish?draft=${draftId}`
  const edit = useEditSession({
    resourceType: 'offer',
    resourceId: draftId,
    lock,
    onCancelled: () => {
      // Reset local state + remount picker so it re-fetches the restored live rows.
      setTitle(offer.title)
      setSavedTitle(offer.title)
      setStartsAt(offer.starts_at)
      setEndsAt(offer.ends_at)
      setIsActive(offer.is_active)
      setPickerKey(k => k + 1)
      router.push(backHref)
    },
  })

  const save = useCallback(
    async (patch: Record<string, unknown>): Promise<boolean> => {
      if (!draftId) return false
      setSaving(true)
      try {
        const res = await fetch(`/api/admin/product-offers/${offer.id}?draft=${draftId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...lockHeaders('offer', draftId) },
          credentials: 'include',
          body: JSON.stringify(patch),
        })
        if (res.status === 423) {
          const body = await res.json().catch(() => ({}))
          showToast(body.error || 'Someone else is editing this offer', 'error')
          lock.markLocked(patch)
          return false
        }
        if (!res.ok) showToast('Failed to save', 'error')
        return res.ok
      } catch {
        showToast('Failed to save', 'error')
        return false
      } finally {
        setSaving(false)
      }
    },
    [offer.id, draftId, showToast, lock]
  )

  async function commitTitle(value = title) {
    const next = value.trim()
    if (!next) {
      setTitle(savedTitle)
      return
    }
    if (next === savedTitle) return
    if (await save({ title: next })) setSavedTitle(next)
  }

  async function publish() {
    setPublishing(true)
    try {
      const res = await fetch(publishPath, {
        method: 'POST',
        credentials: 'include',
        headers: lockHeaders('offer', draftId),
      })
      if (!res.ok) {
        if (res.status === 423) lock.markLocked()
        const body = await res.json().catch(() => ({}))
        // Someone published overlapping edits since this draft started: pick per field.
        if (res.status === 409 && body.code === 'DRAFT_CONFLICT') {
          setConflicts(body.conflicts ?? [])
          return
        }
        showToast(body.error || 'Failed to publish', 'error')
        return
      }
      showToast('Offer published', 'success')
      router.push(ap(`/admin/offers/${offer.id}/view`))
    } catch {
      showToast('Failed to publish', 'error')
    } finally {
      setPublishing(false)
    }
  }

  const autosaveStatus = saving ? 'saving' : 'saved'

  return (
    <PageBody>
      <DetailHeader
        back={{ href: backHref, label: 'Offers' }}
        title={`${title || 'Untitled offer'}${draftTitle ? ` · ${draftTitle}` : ''}`}
        status={
          <>
            <StatusBadge status={String(isActive)} map={{ true: { label: 'Active', tone: 'green' }, false: { label: 'Paused', tone: 'muted' } }} />
            {draftId ? (
              <Badge tone="amber">Draft</Badge>
            ) : (
              draftCount > 0 && <Badge tone="amber">{draftCount === 1 ? 'Draft pending' : `${draftCount} drafts`}</Badge>
            )}
          </>
        }
        actions={actions}
      />

      {notices}
      {draftId && <DraftLockBanner lock={lock} scope="coupons:write" />}
      <LockedFieldset readOnly={readOnly} className="contents">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)] items-start">
          <div className="space-y-4 min-w-0">
            <div className="space-y-5 rounded-xl border border-border-default bg-surface-elevated p-4 sm:p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Offer details</h2>

              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">Title</label>
                <AIEnrichButton
                  fieldLabel="Offer title"
                  value={title}
                  onChange={v => {
                    setTitle(v)
                    void commitTitle(v)
                  }}
                  scope="coupons:write"
                  maxLength={255}
                  context="Headline of a storefront offer card; keep it short and punchy."
                >
                  <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    onBlur={() => commitTitle()}
                    maxLength={255}
                    disabled={!canWrite}
                    className={`${INPUT_CLASS} pr-8`}
                  />
                </AIEnrichButton>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">Launch date</label>
                  <DatePicker
                    className="w-full"
                    value={toDateInput(startsAt)}
                    onChange={d => {
                      const v = fromDateInput(d, false)
                      setStartsAt(v)
                      save({ startsAt: v })
                    }}
                    max={toDateInput(endsAt) || undefined}
                    clearable
                    placeholder="No date"
                    disabled={!canWrite}
                    triggerClassName={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">End date</label>
                  <DatePicker
                    className="w-full"
                    value={toDateInput(endsAt)}
                    onChange={d => {
                      const v = fromDateInput(d, true)
                      setEndsAt(v)
                      save({ endsAt: v })
                    }}
                    min={toDateInput(startsAt) || undefined}
                    clearable
                    placeholder="No date"
                    disabled={!canWrite}
                    triggerClassName={INPUT_CLASS}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border-default bg-surface px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">{isActive ? 'Active' : 'Paused'}</p>
                  <p className="text-[11px] text-foreground-muted">
                    {isActive ? 'Live and eligible to show on the homepage.' : 'Hidden everywhere until reactivated.'}
                  </p>
                </div>
                <Toggle
                  checked={isActive}
                  disabled={!canWrite}
                  onChange={next => {
                    setIsActive(next)
                    save({ isActive: next })
                  }}
                />
              </div>
            </div>

            <div className="rounded-xl border border-border-default bg-surface-elevated p-4">
              <p className="text-sm text-foreground">
                Set this offer&apos;s card image, badge and colour in{' '}
                <Link
                  href={ap('/admin/settings/homepage')}
                  className="font-medium text-accent-500 hover:underline"
                >
                  Homepage &gt; Offer Slider
                </Link>
                .
              </p>
            </div>

            <ChangeLog kind="offer" id={offer.id} variant="compact" version={offer.updated_at} />
          </div>

          <div className="min-w-0 rounded-xl border border-border-default bg-surface-elevated p-4 sm:p-5">
            <OfferProductPicker
              key={pickerKey}
              offerId={offer.id}
              draftId={draftId}
              canWrite={canWrite && !readOnly}
              categoryOptions={categoryOptions}
              brandOptions={brandOptions}
            />
          </div>
        </div>
      </LockedFieldset>

      {canWrite && draftId && (
        <FormFooter
          lock={lock}
          cancelHref={lock.readOnly ? backHref : undefined}
          autosave={autosaveStatus}
          cancel={async () => {
            await edit.cancel()
          }}
          cancelLabel="Cancel"
        >
          <button
            type="button"
            onClick={publish}
            disabled={publishing || edit.status === 'closing' || edit.status === 'closed'}
            className="control-md whitespace-nowrap bg-accent-500 text-white hover:bg-accent-600 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        </FormFooter>
      )}
      {conflicts && (
        <MergeDialog
          open
          conflicts={conflicts}
          publishPath={publishPath}
          onClose={() => setConflicts(null)}
          onDone={() => {
            setConflicts(null)
            showToast('Offer published', 'success')
            router.push(ap(`/admin/offers/${offer.id}/view`))
          }}
        />
      )}
    </PageBody>
  )
}
