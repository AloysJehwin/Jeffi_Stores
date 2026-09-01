'use client'

import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/contexts/ToastContext'
import Toggle from '@/components/ui/Toggle'
import { useCanWrite } from '@/contexts/AdminScopesContext'

interface AdminOffer {
  id: string
  title: string
  methods: string[]
  issuers: string[]
  endsAt: string | null
  terms: string | null
  isVisible: boolean
  titleOverride: string | null
  displayOrder: number
  looksInternal: boolean
}

const METHOD_LABELS: Record<string, string> = {
  card: 'Card', emi: 'EMI', upi: 'UPI', netbanking: 'Netbanking', wallet: 'Wallet',
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

export default function OffersClient({ canWrite: canWriteProp }: { canWrite: boolean }) {
  const { showToast } = useToast()
  const hasWriteScope = useCanWrite('coupons:write')
  const canWrite = canWriteProp && hasWriteScope
  const [offers, setOffers] = useState<AdminOffer[]>([])
  const [problem, setProblem] = useState<{ reason: string; detail: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/offers', { credentials: 'include' })
      if (!res.ok) throw new Error('failed')
      const d = await res.json()
      setOffers(d.offers || [])
      setProblem(d.problem ?? null)
    } catch {
      showToast('Could not load offers from Razorpay', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { load() }, [load])

  async function patch(offerId: string, body: Record<string, unknown>) {
    setSaving(offerId)
    try {
      const res = await fetch('/api/admin/offers', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId, ...body }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(d.error || 'Update failed', 'error'); return }
      await load()
    } catch {
      showToast('Update failed', 'error')
    } finally {
      setSaving(null)
    }
  }

  const visibleCount = offers.filter(o => o.isVisible).length

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border-default bg-surface-secondary p-4">
        <p className="text-sm text-foreground">
          Offers are created in the Razorpay dashboard, not here — Razorpay&apos;s API does not
          allow creating them. This page controls which of your account&apos;s offers appear on
          product pages, how they read, and in what order.
        </p>
        <p className="text-xs text-foreground-muted mt-2">
          {loading
            ? 'Loading…'
            : problem
              ? 'Could not read offers from Razorpay — see below.'
              : `${offers.length} active on the account · ${visibleCount} shown on the storefront`}
        </p>
      </div>

      {!loading && problem && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {problem.reason === 'test_mode'
              ? 'Offers cannot be listed on test keys'
              : problem.reason === 'no_keys'
                ? 'Razorpay keys are not configured'
                : 'Could not reach Razorpay'}
          </p>
          <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1">{problem.detail}</p>
        </div>
      )}

      {!loading && !problem && offers.length === 0 && (
        <div className="rounded-xl border border-border-default p-8 text-center">
          <p className="text-sm text-foreground-muted">
            No active offers on this Razorpay account.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {offers.map((o) => {
          const d = daysLeft(o.endsAt)
          const expiringSoon = d !== null && d < 30
          return (
            <div key={o.id} className="rounded-xl border border-border-default bg-surface-elevated p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground break-words">
                      {o.titleOverride || o.title}
                    </span>
                    {o.titleOverride && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary text-foreground-muted">edited</span>
                    )}
                    {o.looksInternal && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        looks internal
                      </span>
                    )}
                  </div>

                  {o.titleOverride && (
                    <div className="text-xs text-foreground-muted mt-1 break-words">
                      Razorpay: {o.title}
                    </div>
                  )}

                  <div className="flex items-center gap-3 mt-2 text-xs text-foreground-muted flex-wrap">
                    <span className="font-mono">{o.id}</span>
                    {o.issuers.length > 0 && <span>{o.issuers.join(', ')}</span>}
                    {o.methods.length > 0 && <span>{o.methods.map(m => METHOD_LABELS[m] ?? m).join(' · ')}</span>}
                    {o.endsAt && (
                      <span className={expiringSoon ? 'text-amber-600 dark:text-amber-400' : ''}>
                        ends {new Date(o.endsAt).toLocaleDateString('en-IN')}
                        {d !== null && d >= 0 ? ` · ${d}d` : ' · expired'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-3">
                  {canWrite && (
                    <Toggle
                      checked={o.isVisible}
                      disabled={saving === o.id}
                      onChange={(on) => patch(o.id, { isVisible: on })}
                      label={o.isVisible ? 'Shown' : 'Hidden'}
                    />
                  )}
                </div>
              </div>

              {canWrite && (
                <div className="mt-3 pt-3 border-t border-border-default flex items-center gap-3 flex-wrap">
                  {editing === o.id ? (
                    <>
                      <input
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        placeholder={o.title}
                        maxLength={200}
                        className="flex-1 min-w-[16rem] px-2.5 py-1.5 text-sm rounded-lg border border-border-default bg-surface-secondary text-foreground"
                      />
                      <button
                        onClick={() => { patch(o.id, { titleOverride: draftTitle }); setEditing(null) }}
                        className="px-3 py-1.5 text-sm rounded-lg bg-accent-500 hover:bg-accent-600 text-white font-medium"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="px-3 py-1.5 text-sm rounded-lg border border-border-default text-foreground hover:bg-surface-secondary"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => { setEditing(o.id); setDraftTitle(o.titleOverride || '') }}
                        className="text-sm text-accent-600 dark:text-accent-400 hover:underline"
                      >
                        {o.titleOverride ? 'Edit wording' : 'Override wording'}
                      </button>
                      {o.titleOverride && (
                        <button
                          onClick={() => patch(o.id, { titleOverride: null })}
                          className="text-sm text-foreground-muted hover:text-foreground"
                        >
                          Reset to Razorpay wording
                        </button>
                      )}
                      <label className="ml-auto flex items-center gap-2 text-xs text-foreground-muted">
                        Order
                        <input
                          type="number"
                          min={0}
                          max={999}
                          defaultValue={o.displayOrder}
                          onBlur={(e) => {
                            const v = Number(e.target.value)
                            if (v !== o.displayOrder) patch(o.id, { displayOrder: v })
                          }}
                          className="w-16 px-2 py-1 rounded border border-border-default bg-surface-secondary text-foreground"
                        />
                      </label>
                    </>
                  )}
                </div>
              )}

              {o.terms && (
                <details className="mt-3">
                  <summary className="text-xs text-foreground-muted cursor-pointer">Terms from Razorpay</summary>
                  <p className="text-xs text-foreground-muted mt-2 whitespace-pre-wrap break-words">{o.terms}</p>
                </details>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
