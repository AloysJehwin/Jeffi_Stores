'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, X } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'

interface Validation {
  ok: boolean
  reason?: string
  matched?: string
  normalized?: string
  tablesReferenced?: string[]
}

type Step = 'describe' | 'review_sql' | 'dry_run' | 'save'

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64)
}

export default function NewScenarioClient() {
  const router = useRouter()
  const { showToast } = useToast()

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
  const [dryRunProductSample, setDryRunProductSample] = useState<Array<{ name: string; price: number | null; image_url: string | null }>>([])
  const [dryRunElapsedMs, setDryRunElapsedMs] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('')
  const [description, setDescription] = useState('')

  const [generating, setGenerating] = useState(false)
  const [dryRunning, setDryRunning] = useState(false)
  const [saving, setSaving] = useState(false)

  async function generate() {
    if (!aiPrompt.trim()) return
    setGenerating(true)
    try {
      const res = await fetch('/api/admin/campaigns/scenarios/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt: aiPrompt.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Generation failed', 'error')
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
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Failed to save', 'error')
        return
      }
      showToast(`Scenario "${data.kind}" created (paused). Enable it from the list to activate.`, 'success')
      router.push('/admin/campaigns/scenarios')
    } finally {
      setSaving(false)
    }
  }

  const validationOk = validation?.ok === true
  const stepIndex: Record<Step, number> = { describe: 0, review_sql: 1, dry_run: 2, save: 3 }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm">
        <Link href="/admin/campaigns/scenarios" className="text-foreground-muted hover:text-foreground transition-colors">Scenarios</Link>
        <span className="text-foreground-muted">/</span>
        <span className="text-foreground font-medium">New scenario</span>
      </div>

      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <div className="flex items-center gap-2 mb-1">
          {(['Describe', 'Review SQL', 'Dry run', 'Save'] as const).map((label, idx) => {
            const active = idx === stepIndex[step]
            const done = idx < stepIndex[step]
            return (
              <div key={label} className="flex items-center gap-2">
                <span className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${
                  done ? 'bg-green-500 text-white' :
                  active ? 'bg-accent-500 text-white' :
                  'bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400'
                }`}>
                  {done ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                </span>
                <span className={`text-xs font-medium ${active ? 'text-foreground' : 'text-foreground-muted'}`}>{label}</span>
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
            <p className="text-sm text-foreground-secondary mt-1">In plain English, describe which customers should receive this campaign and when. AI will translate it into a safe SQL query you can review before saving.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Audience description</label>
            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              rows={5}
              placeholder="e.g. Customers who placed exactly one paid order more than 14 days ago and never came back. Skip anyone we already messaged this month."
              className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <p className="text-[10px] text-foreground-muted mt-1">Be specific. Mention which behaviors define the audience and any cooldown windows.</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={generating || !aiPrompt.trim()}
              className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
            >
              {generating ? 'Generating…' : 'Generate SQL with AI'}
            </button>
            <Link href="/admin/campaigns/scenarios" className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground transition-colors">Cancel</Link>
          </div>
        </div>
      )}

      {(step === 'review_sql' || step === 'dry_run' || step === 'save') && (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-bold text-foreground">Review the generated SQL</h2>
              <p className="text-sm text-foreground-secondary mt-1">Make sure it does what you expect before running a dry-run.</p>
            </div>
            <button
              type="button"
              onClick={() => setStep('describe')}
              className="text-xs text-foreground-muted hover:text-foreground transition-colors"
            >
              ← Back to description
            </button>
          </div>

          <div className="p-3 bg-surface-secondary rounded-lg border-l-2 border-accent-500">
            <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-1">Plain English (AI explanation)</p>
            <p className="text-sm text-foreground-secondary">{explanation || aiPrompt}</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Generated SQL (read-only)</label>
            <textarea
              value={sql}
              readOnly
              rows={Math.min(20, Math.max(8, sql.split('\n').length + 2))}
              className="w-full px-3 py-2 text-xs font-mono border border-border-secondary rounded-lg bg-surface-secondary text-foreground"
            />
            <p className="text-[10px] text-foreground-muted mt-1">$1 = campaign kind, $2 = cooldown days, $3 = max recipients. The runner injects these at execution time.</p>
          </div>

          {validation && (
            <div className={`p-3 rounded-lg text-xs ${
              validationOk
                ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800'
            }`}>
              <p className="font-semibold mb-1 inline-flex items-center gap-1">{validationOk ? <><Check className="w-3.5 h-3.5" /> Safety filter passed</> : <><X className="w-3.5 h-3.5" /> Rejected by safety filter</>}</p>
              {validationOk && validation.tablesReferenced && (
                <p>Tables referenced: <code className="font-mono">{validation.tablesReferenced.join(', ')}</code></p>
              )}
              {!validationOk && (
                <p>Reason: {validation.reason} {validation.matched && <code>({validation.matched})</code>}</p>
              )}
            </div>
          )}

          {productSql && (
            <div className="pt-3 border-t border-border-default">
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide">Product query (read-only)</label>
                <span className="text-[10px] text-foreground-muted">Renders as <code className="font-mono">{'{itemsHtml}'}</code> in the email body</span>
              </div>
              <textarea
                value={productSql}
                readOnly
                rows={Math.min(12, Math.max(4, productSql.split('\n').length + 2))}
                className="w-full px-3 py-2 text-xs font-mono border border-border-secondary rounded-lg bg-surface-secondary text-foreground"
              />
              {productValidation && (
                <div className={`mt-2 p-2 rounded text-[11px] ${
                  productValidation.ok
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                }`}>
                  {productValidation.ok
                    ? <span className="inline-flex items-center gap-1"><Check className="w-3 h-3" /> Product query passed safety check</span>
                    : <span className="inline-flex items-center gap-1"><X className="w-3 h-3" /> {productValidation.reason}</span>}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={dryRun}
              disabled={dryRunning || !validationOk}
              className="px-4 py-2 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
            >
              {dryRunning ? 'Running…' : (dryRunCount !== null ? 'Re-run dry run' : 'Run dry run')}
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50"
            >
              {generating ? 'Regenerating…' : 'Regenerate SQL'}
            </button>
          </div>

          {dryRunCount !== null && (
            <div className="mt-2 p-4 bg-surface-secondary rounded-lg border border-border-default">
              <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-2">Dry run result {dryRunElapsedMs !== null && <span className="text-foreground-muted normal-case">({dryRunElapsedMs}ms)</span>}</p>
              <p className="text-3xl font-bold text-foreground tabular-nums">{dryRunCount.toLocaleString('en-IN')} <span className="text-sm font-normal text-foreground-muted">user(s) match</span></p>
              {dryRunSample.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] text-foreground-muted mb-1">Sample IDs (first 5)</p>
                  <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
                    {dryRunSample.map(id => (
                      <span key={id} className="px-2 py-0.5 bg-surface rounded border border-border-default text-foreground-secondary">{id}</span>
                    ))}
                  </div>
                </div>
              )}

              {productSql && dryRunProductCount !== null && (
                <div className="mt-4 pt-4 border-t border-border-default">
                  <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-2">Product query</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">{dryRunProductCount.toLocaleString('en-IN')} <span className="text-sm font-normal text-foreground-muted">product(s) will appear in the email</span></p>
                  {dryRunProductSample.length > 0 && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {dryRunProductSample.map((p, idx) => (
                        <div key={idx} className="flex items-center gap-2 px-2 py-1.5 bg-surface rounded border border-border-default">
                          {p.image_url ? (
                            <img src={p.image_url} alt="" className="w-10 h-10 object-cover rounded border border-border-default" />
                          ) : (
                            <div className="w-10 h-10 rounded bg-surface-secondary border border-border-default" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-foreground truncate">{p.name}</p>
                            {p.price != null && <p className="text-[10px] text-foreground-muted">₹{Math.round(p.price).toLocaleString('en-IN')}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!productSql && (
                <div className="mt-4 pt-4 border-t border-border-default">
                  <p className="text-[11px] text-foreground-muted italic">No product query — this scenario only targets customers. The email body will not include a product list.</p>
                </div>
              )}
            </div>
          )}

          {step === 'save' && dryRunCount !== null && (
            <div className="mt-2 pt-4 border-t border-border-default space-y-3">
              <h3 className="text-sm font-bold text-foreground">Name and save</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Scenario name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. One-time buyers"
                    className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Kind (slug)</label>
                  <input
                    type="text"
                    value={kind}
                    onChange={e => setKind(e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_'))}
                    placeholder={name ? slugify(name) : 'auto from name'}
                    className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
                  />
                  <p className="text-[10px] text-foreground-muted mt-1">Lowercase letters, numbers, underscores. Auto-generated from name if blank.</p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !name.trim()}
                  className="px-5 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save scenario (paused)'}
                </button>
                <span className="text-[10px] text-foreground-muted">Saved scenarios are paused until you enable them on the list page.</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
