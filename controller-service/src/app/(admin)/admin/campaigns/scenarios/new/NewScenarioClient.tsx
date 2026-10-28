'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, X } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { ap } from '@/lib/shared/admin-path'
import { RequireWrite, RequireAi } from '@/contexts/AdminScopesContext'
import { useDraftLock } from '@/hooks/useDraftLock'
import { useAutosaveDraft } from '@/hooks/useAutosaveDraft'
import { DraftLockBanner, LockedFieldset } from '@/components/admin/kit/draft-lock'
import { FormButton, FormFooter } from '@/components/admin/kit/form'
import { assertDraftResponse, lockHeaders } from '@/lib/client/draft-lock-client'
import type { ScenarioDraftFields } from '@/lib/campaigns/scenario-drafts'

interface Validation {
  ok: boolean
  reason?: string
  matched?: string
  normalized?: string
  tablesReferenced?: string[]
}

type Step = 'describe' | 'review_sql' | 'dry_run' | 'save'

interface DryRun {
  count: number
  sample: string[]
  productCount: number | null
  productSample: Array<{ name: string; price: number | null; image_url: string | null }>
  elapsedMs: number | null
}

const DRAFTS = '/api/admin/campaigns/scenarios/drafts'
const LIST = '/admin/campaigns/scenarios'

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

export default function NewScenarioClient({ initialDraftId }: { initialDraftId?: string | null }) {
  const router = useRouter()
  const { showToast } = useToast()
  const confirm = useConfirm()

  const [step, setStep] = useState<Step>('describe')
  const [aiPrompt, setAiPrompt] = useState('')
  const [sql, setSql] = useState('')
  const [productSql, setProductSql] = useState('')
  const [productValidation, setProductValidation] = useState<Validation | null>(null)
  const [explanation, setExplanation] = useState('')
  const [validation, setValidation] = useState<Validation | null>(null)
  const [dryRunCount, setDryRunCount] = useState<number | null>(null)
  const [dryRunSample, setDryRunSample] = useState<string[]>([])
  const [dryRunProductCount, setDryRunProductCount] = useState<number | null>(null)
  const [dryRunProductSample, setDryRunProductSample] = useState<
    Array<{ name: string; price: number | null; image_url: string | null }>
  >([])
  const [dryRunElapsedMs, setDryRunElapsedMs] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('')
  const [description, setDescription] = useState('')

  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [dryRunning, setDryRunning] = useState(false)
  const [saving, setSaving] = useState(false)

  // The wizard's draft: created after the first generation (or Save as Draft), then autosaved.
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null)
  const draftIdRef = useRef(draftId)
  draftIdRef.current = draftId
  const [loaded, setLoaded] = useState(!initialDraftId)
  const skipSaveRef = useRef(true)
  const creatingRef = useRef<Promise<string | null> | null>(null)
  const doneRef = useRef(false)
  // The draft this component already holds in state (the URL catching up must not reload it).
  const hydratedRef = useRef<string | null>(null)

  const fields = (): ScenarioDraftFields => ({
    step,
    aiPrompt,
    sql,
    productSql,
    explanation,
    validation,
    productValidation,
    dryRun:
      dryRunCount === null
        ? null
        : { count: dryRunCount, sample: dryRunSample, productCount: dryRunProductCount, productSample: dryRunProductSample, elapsedMs: dryRunElapsedMs },
    name,
    kind,
    description,
  })
  const draftBody = () => ({ title: name.trim() || null, fields: fields() })

  const lock = useDraftLock({ resourceType: 'scenario', resourceId: draftId })
  const autosave = useAutosaveDraft<ReturnType<typeof draftBody>>({
    save: async (body, signal) => {
      const id = draftIdRef.current
      if (!id) return
      const res = await fetch(`${DRAFTS}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...lockHeaders('scenario', id) },
        credentials: 'include',
        signal,
        body: JSON.stringify(body),
      })
      await assertDraftResponse(res, 'Could not save the scenario draft')
    },
    enabled: () => !!draftIdRef.current && !doneRef.current && !lock.readOnly,
    onLocked: (_err, unsaved) => lock.markLocked(unsaved),
  })

  async function ensureDraft(): Promise<string | null> {
    if (draftIdRef.current) return draftIdRef.current
    creatingRef.current ??= (async () => {
      const res = await fetch(DRAFTS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(draftBody()),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.id) {
        showToast(j.error || 'Could not save the scenario draft', 'error')
        return null
      }
      skipSaveRef.current = true
      hydratedRef.current = j.id
      setDraftId(j.id)
      router.replace(ap(`/admin/campaigns/scenarios/new?draft=${j.id}`), { scroll: false })
      return j.id as string
    })().finally(() => {
      creatingRef.current = null
    })
    return creatingRef.current
  }

  // ?draft=<id>: pick the wizard up where it was left.
  useEffect(() => {
    if (!initialDraftId || initialDraftId === hydratedRef.current) return
    hydratedRef.current = initialDraftId
    let cancelled = false
    ;(async () => {
      const res = await fetch(`${DRAFTS}/${initialDraftId}`, { credentials: 'include' })
      const j = await res.json().catch(() => ({}))
      if (cancelled) return
      if (!res.ok || !j.draft) {
        showToast(j.error || 'Could not open the scenario draft', 'error')
        router.replace(ap('/admin/campaigns?tab=drafts'))
        return
      }
      const f: ScenarioDraftFields = j.draft.fields || {}
      const dr = (f.dryRun ?? null) as DryRun | null
      skipSaveRef.current = true
      setAiPrompt(f.aiPrompt || '')
      setSql(f.sql || '')
      setProductSql(f.productSql || '')
      setExplanation(f.explanation || '')
      setValidation((f.validation as Validation) ?? null)
      setProductValidation((f.productValidation as Validation) ?? null)
      setDryRunCount(dr ? dr.count : null)
      setDryRunSample(dr?.sample ?? [])
      setDryRunProductCount(dr?.productCount ?? null)
      setDryRunProductSample(dr?.productSample ?? [])
      setDryRunElapsedMs(dr?.elapsedMs ?? null)
      setName(f.name || '')
      setKind(f.kind || '')
      setDescription(f.description || '')
      setStep(f.step && (f.step !== 'describe' || !f.sql) ? f.step : f.sql ? 'review_sql' : 'describe')
      setDraftId(initialDraftId)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraftId])

  const triggerRef = useRef(autosave.trigger)
  triggerRef.current = autosave.trigger
  useEffect(() => {
    if (!loaded || doneRef.current) return
    if (skipSaveRef.current) {
      skipSaveRef.current = false
      return
    }
    // The generated SQL is worth keeping: the first generation starts the draft.
    if (!draftIdRef.current) {
      if (sql) void ensureDraft()
      return
    }
    triggerRef.current(draftBody())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, step, aiPrompt, sql, productSql, explanation, validation, productValidation, dryRunCount, dryRunSample, name, kind, description])

  async function saveAsDraft() {
    try {
      if (draftIdRef.current) await autosave.flush(draftBody())
      else if (!(await ensureDraft())) return
    } catch {
      return showToast('Could not save the scenario draft', 'error')
    }
    doneRef.current = true
    showToast('Draft saved', 'success')
    router.push(ap('/admin/campaigns?tab=drafts'))
  }

  async function discardDraft() {
    const id = draftIdRef.current
    if (!id) return
    const ok = await confirm({
      title: 'Discard scenario draft',
      message: 'Throw away this unfinished scenario? The generated SQL and dry run are lost.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep',
      variant: 'danger',
    })
    if (!ok) return
    const res = await fetch(`${DRAFTS}/${id}`, { method: 'DELETE', credentials: 'include' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) return showToast(j.error || 'Could not discard the draft', 'error')
    doneRef.current = true
    showToast('Scenario draft discarded', 'success')
    router.push(ap(LIST))
  }

  async function generate() {
    if (!aiPrompt.trim()) return
    setGenerating(true)
    setGenerateError(null)
    try {
      const res = await fetch('/api/admin/campaigns/scenarios/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt: aiPrompt.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setGenerateError(data.error || 'Generation failed')
        return
      }
      setSql(data.sql || '')
      setProductSql(data.product_sql || '')
      setProductValidation(data.productValidation || null)
      setExplanation(data.explanation || '')
      setValidation(data.validation || null)
      if (data.name && !name.trim()) setName(data.name)
      if (data.kind && !kind.trim()) setKind(data.kind)
      if (data.description && !description.trim()) setDescription(data.description)
      setDryRunCount(null)
      setDryRunSample([])
      setStep('review_sql')
    } catch {
      setGenerateError('Generation failed — please try again')
    } finally {
      setGenerating(false)
    }
  }

  async function dryRun() {
    setDryRunning(true)
    try {
      const res = await fetch('/api/admin/campaigns/scenarios/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sql, product_sql: productSql || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Dry run failed', 'error')
        return
      }
      setDryRunCount(data.count)
      setDryRunSample(data.sample || [])
      setDryRunProductCount(typeof data.productCount === 'number' ? data.productCount : null)
      setDryRunProductSample(Array.isArray(data.productSample) ? data.productSample : [])
      setDryRunElapsedMs(data.elapsedMs ?? null)
      setStep('save')
    } finally {
      setDryRunning(false)
    }
  }

  async function save() {
    if (!name.trim()) {
      showToast('Name is required', 'error')
      return
    }
    if (dryRunCount === null) {
      showToast('Run a dry run first', 'error')
      return
    }
    setSaving(true)
    doneRef.current = true
    try {
      const finalKind = kind.trim() ? slugify(kind) : slugify(name)
      const res = await fetch('/api/admin/campaigns/scenarios/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          kind: finalKind,
          description: description.trim(),
          ai_prompt: aiPrompt.trim(),
          generated_sql: sql,
          product_sql: productSql || null,
          dry_run_count: dryRunCount,
          draft_id: draftIdRef.current,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        doneRef.current = false
        showToast(data.error || 'Failed to save', 'error')
        return
      }
      showToast(`Scenario "${data.kind}" created (paused). Enable it from the list to activate.`, 'success')
      router.push(ap(LIST))
    } finally {
      setSaving(false)
    }
  }

  const validationOk = validation?.ok === true
  const stepIndex: Record<Step, number> = { describe: 0, review_sql: 1, dry_run: 2, save: 3 }

  const backStep = step === 'save' || step === 'dry_run' ? 'review_sql' : step === 'review_sql' ? 'describe' : null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm">
        <Link
          href={ap(LIST)}
          className="text-foreground-muted hover:text-foreground transition-colors"
        >
          Scenarios
        </Link>
        <span className="text-foreground-muted">/</span>
        <span className="text-foreground font-medium">{draftId ? `New scenario${name.trim() ? ` · ${name.trim()}` : ''} (draft)` : 'New scenario'}</span>
      </div>
      {draftId && <DraftLockBanner lock={lock} scope="campaigns:write" />}

      <LockedFieldset readOnly={lock.readOnly}>
      <div className="space-y-5">

      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <div className="flex items-center gap-2 mb-1">
          {(['Describe', 'Review SQL', 'Dry run', 'Save'] as const).map((label, idx) => {
            const active = idx === stepIndex[step]
            const done = idx < stepIndex[step]
            return (
              <div key={label} className="flex items-center gap-2">
                <span
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${
                    done
                      ? 'bg-green-500 text-white'
                      : active
                        ? 'bg-accent-500 text-white'
                        : 'bg-surface-secondary text-foreground-muted'
                  }`}
                >
                  {done ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                </span>
                <span className={`text-xs font-medium ${active ? 'text-foreground' : 'text-foreground-muted'}`}>
                  {label}
                </span>
                {idx < 3 && <span className="w-6 h-px bg-border-default" />}
              </div>
            )
          })}
        </div>
      </div>

      {step === 'describe' && (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">Describe the audience</h2>
            <p className="text-sm text-foreground-secondary mt-1">
              In plain English, describe which customers should receive this campaign and when. AI will translate it
              into a safe SQL query you can review before saving.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
              Audience description
            </label>
            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              rows={5}
              placeholder="e.g. Customers who placed exactly one paid order more than 14 days ago and never came back. Skip anyone we already messaged this month."
              className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <p className="text-[10px] text-foreground-muted mt-1">
              Be specific. Mention which behaviors define the audience and any cooldown windows.
            </p>
          </div>

          {generateError && <p className="text-xs text-red-600 dark:text-red-400">{generateError}</p>}
        </div>
      )}

      {(step === 'review_sql' || step === 'dry_run' || step === 'save') && (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">Review the generated SQL</h2>
            <p className="text-sm text-foreground-secondary mt-1">
              Make sure it does what you expect before running a dry-run.
            </p>
          </div>

          <div className="p-3 bg-surface-secondary rounded-lg border-l-2 border-accent-500">
            <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-1">
              Plain English (AI explanation)
            </p>
            <p className="text-sm text-foreground-secondary">{explanation || aiPrompt}</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
              Generated SQL (read-only)
            </label>
            <textarea
              value={sql}
              readOnly
              rows={Math.min(20, Math.max(8, sql.split('\n').length + 2))}
              className="w-full px-3 py-2 text-xs font-mono border border-border-secondary rounded-lg bg-surface-secondary text-foreground"
            />
            <p className="text-[10px] text-foreground-muted mt-1">
              $1 = campaign kind, $2 = cooldown days, $3 = max recipients. The runner injects these at execution time.
            </p>
          </div>

          {validation && (
            <div
              className={`p-3 rounded-lg text-xs ${
                validationOk
                  ? 'bg-green-500/5 text-green-700 dark:text-green-400 border border-green-500/40'
                  : 'bg-red-500/5 text-red-700 dark:text-red-400 border border-red-500/40'
              }`}
            >
              <p className="font-semibold mb-1 inline-flex items-center gap-1">
                {validationOk ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Safety filter passed
                  </>
                ) : (
                  <>
                    <X className="w-3.5 h-3.5" /> Rejected by safety filter
                  </>
                )}
              </p>
              {validationOk && validation.tablesReferenced && (
                <p>
                  Tables referenced: <code className="font-mono">{validation.tablesReferenced.join(', ')}</code>
                </p>
              )}
              {!validationOk && (
                <p>
                  Reason: {validation.reason} {validation.matched && <code>({validation.matched})</code>}
                </p>
              )}
            </div>
          )}

          {productSql && (
            <div className="pt-3 border-t border-border-default">
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide">
                  Product query (read-only)
                </label>
                <span className="text-[10px] text-foreground-muted">
                  Renders as <code className="font-mono">{'{itemsHtml}'}</code> in the email body
                </span>
              </div>
              <textarea
                value={productSql}
                readOnly
                rows={Math.min(12, Math.max(4, productSql.split('\n').length + 2))}
                className="w-full px-3 py-2 text-xs font-mono border border-border-secondary rounded-lg bg-surface-secondary text-foreground"
              />
              {productValidation && (
                <div
                  className={`mt-2 p-2 rounded text-[11px] ${
                    productValidation.ok
                      ? 'bg-green-500/5 text-green-700 dark:text-green-400'
                      : 'bg-red-500/5 text-red-700 dark:text-red-400'
                  }`}
                >
                  {productValidation.ok ? (
                    <span className="inline-flex items-center gap-1">
                      <Check className="w-3 h-3" /> Product query passed safety check
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <X className="w-3 h-3" /> {productValidation.reason}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {generateError && <p className="text-xs text-red-600 dark:text-red-400">{generateError}</p>}

          {dryRunCount !== null && (
            <div className="mt-2 p-4 bg-surface-secondary rounded-lg border border-border-default">
              <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-2">
                Dry run result{' '}
                {dryRunElapsedMs !== null && (
                  <span className="text-foreground-muted normal-case">({dryRunElapsedMs}ms)</span>
                )}
              </p>
              <p className="text-3xl font-bold text-foreground tabular-nums">
                {dryRunCount.toLocaleString('en-IN')}{' '}
                <span className="text-sm font-normal text-foreground-muted">user(s) match</span>
              </p>
              {dryRunSample.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] text-foreground-muted mb-1">Sample IDs (first 5)</p>
                  <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
                    {dryRunSample.map(id => (
                      <span
                        key={id}
                        className="px-2 py-0.5 bg-surface rounded border border-border-default text-foreground-secondary"
                      >
                        {id}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {productSql && dryRunProductCount !== null && (
                <div className="mt-4 pt-4 border-t border-border-default">
                  <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-2">Product query</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    {dryRunProductCount.toLocaleString('en-IN')}{' '}
                    <span className="text-sm font-normal text-foreground-muted">
                      product(s) will appear in the email
                    </span>
                  </p>
                  {dryRunProductSample.length > 0 && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {dryRunProductSample.map((p, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 px-2 py-1.5 bg-surface rounded border border-border-default"
                        >
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt=""
                              className="w-10 h-10 object-cover rounded border border-border-default"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded bg-surface-secondary border border-border-default" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-foreground truncate">{p.name}</p>
                            {p.price != null && (
                              <p className="text-[10px] text-foreground-muted">
                                ₹{Math.round(p.price).toLocaleString('en-IN')}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!productSql && (
                <div className="mt-4 pt-4 border-t border-border-default">
                  <p className="text-[11px] text-foreground-muted italic">
                    No product query — this scenario only targets customers. The email body will not include a product
                    list.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 'save' && dryRunCount !== null && (
            <div className="mt-2 pt-4 border-t border-border-default space-y-3">
              <h3 className="text-sm font-bold text-foreground">Name and save</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                    Scenario name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. One-time buyers"
                    className="w-full px-3 h-control text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                    Kind (slug)
                  </label>
                  <input
                    type="text"
                    value={kind}
                    onChange={e => setKind(e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_'))}
                    placeholder={name ? slugify(name) : 'auto from name'}
                    className="w-full px-3 h-control text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
                  />
                  <p className="text-[10px] text-foreground-muted mt-1">
                    Lowercase letters, numbers, underscores. Auto-generated from name if blank.
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full px-3 h-control text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
                />
              </div>

              <p className="text-[10px] text-foreground-muted">
                Saved scenarios are paused until you enable them on the list page.
              </p>
            </div>
          )}
        </div>
      )}
      </div>
      </LockedFieldset>

      <FormFooter
        lock={draftId ? lock : null}
        autosave={draftId ? autosave.status : undefined}
        discard={draftId ? discardDraft : undefined}
        cancelHref={ap(LIST)}
      >
        {backStep && (
          <FormButton type="button" variant="secondary" onClick={() => setStep(backStep)}>
            Back
          </FormButton>
        )}
        <RequireWrite scope="campaigns:write">
          {step !== 'describe' && (
            <RequireAi scope="campaigns:write">
              <FormButton type="button" variant="secondary" onClick={generate} pending={generating} pendingLabel="Regenerating…">
                Regenerate SQL
              </FormButton>
            </RequireAi>
          )}
          {(aiPrompt.trim() || draftId) && (
            <FormButton type="button" variant="secondary" onClick={saveAsDraft} disabled={saving}>
              Save as Draft
            </FormButton>
          )}
          {step === 'describe' ? (
            <RequireAi
              scope="campaigns:write"
              fallback={<span className="text-xs text-foreground-muted">AI tools are not available for your plan or role.</span>}
            >
              <FormButton type="button" onClick={generate} disabled={!aiPrompt.trim()} pending={generating} pendingLabel="Generating…">
                Generate SQL with AI
              </FormButton>
            </RequireAi>
          ) : step === 'save' && dryRunCount !== null ? (
            <>
              <FormButton type="button" variant="secondary" onClick={dryRun} pending={dryRunning} pendingLabel="Running…">
                Re-run dry run
              </FormButton>
              <FormButton type="button" onClick={save} disabled={!name.trim()} pending={saving} pendingLabel="Saving…">
                Save scenario (paused)
              </FormButton>
            </>
          ) : (
            <FormButton type="button" onClick={dryRun} disabled={!validationOk} pending={dryRunning} pendingLabel="Running…">
              {dryRunCount !== null ? 'Re-run dry run' : 'Run dry run'}
            </FormButton>
          )}
        </RequireWrite>
      </FormFooter>
    </div>
  )
}
