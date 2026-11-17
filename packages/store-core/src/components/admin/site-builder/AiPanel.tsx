'use client'

import { useState } from 'react'
import { Blocks, ClipboardCheck, Loader2, MousePointer2, RefreshCw, Sparkles, Wand2 } from 'lucide-react'
import { insertBlock, normalizeTheme, updateBlock, type Block, type PageDoc, type PageKey, type PageRef, type SiteAudience, type ThemeTokens } from '@jeffi/site-blocks'
import { api } from '@/components/admin/kit/core'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { siteRegistry } from '@/lib/site/blocks'
import { UTILITY_SPECS } from '@/lib/site/studio/utility'

const PAGE_IDEAS = ['A festive sale homepage with offers up top', 'Calm and premium: big imagery, few blocks', 'Lead with best sellers and reviews']
const BLOCK_IDEAS = ['Make the heading shorter and punchier', 'Rewrite for a festive sale', 'Switch to a carousel of 8 products']
type Finding = { severity: 'error' | 'warn'; message: string; fixable: boolean }
const NEW_BLOCK_IDEAS = ['Shop by category tiles with a short intro', 'Best sellers beside a big heading and a button', 'Three reviews and a countdown to our sale']

// The pages the AI Site Studio designs (lib/site/studio/plan.ts), so "Design this page again" is offered on them.
const STUDIO_PAGES: Record<SiteAudience, PageKey[]> = {
  store: ['announcement', 'header', 'home', 'products', 'category', 'brand', 'search', 'product', 'cart', 'checkout', 'about', 'contact', 'categories', 'brands', 'footer', 'card', ...UTILITY_SPECS.map(s => s.page)],
  business: ['home', 'catalog'],
}
const studioDesigns = (ref: Pick<PageRef, 'audience' | 'surface' | 'page'>) => ref.surface !== 'app' && STUDIO_PAGES[ref.audience].includes(ref.page)

/** A page being designed again by the AI on the server (SiteBuilderEditor runs it; its result lands in the draft). */
export type PageRedo = { key: string; label: string; status: 'running' | 'done' | 'failed'; message?: string }

/**
 * Ask the AI to build this page, or to correct the block picked with the arrow tool (it also gets what was pointed at).
 * The proposal is applied as an ordinary edit: Undo reverts it, and nothing is live until publish.
 */
export default function AiPanel({
  doc,
  pageRef,
  block,
  pointed,
  picking,
  onPickMode,
  onApply,
  theme,
  onThemeChange,
  draftId,
  redo,
  onRedo,
}: {
  doc: PageDoc
  pageRef: Pick<PageRef, 'audience' | 'surface' | 'page'>
  block: Block | undefined
  pointed: string | null
  picking: boolean
  onPickMode: () => void
  onApply: (doc: PageDoc, summary: string) => void
  theme?: ThemeTokens | null
  onThemeChange?: (t: ThemeTokens) => void
  /** The draft open: an AI redesign's own brief and direction guide its section changes. */
  draftId?: string | null
  redo?: PageRedo | null
  /** Designs this page again with the AI Site Studio's writer (offered on the pages it designs). */
  onRedo?: () => void
}) {
  const canWrite = useCanWrite('settings:write')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState<'block' | 'page' | 'new' | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<{ findings: Finding[]; fixedNote?: string } | null>(null)
  const label = block ? siteRegistry.get(block.type)?.label ?? block.type : null
  const composed = block?.type === 'composed'
  const canCompose = !!siteRegistry.get('composed')?.pages?.includes(pageRef.page as never)
  const redoHere = redo?.key === `${pageRef.audience}:${pageRef.page}` ? redo : null

  // A new custom block from the store's own data, after the selected block; or the selected custom block changed.
  async function compose() {
    if (!canWrite) return
    setBusy('new')
    setResult(null)
    const { ok, data } = await api<{ label?: string; summary?: string; tree?: unknown; error?: string }>('/api/admin/site-builder/ai/compose', {
      method: 'POST',
      json: { page: pageRef.page, prompt, ...(composed && block ? { current: { label: block.props.label, tree: block.props.tree }, hint: pointed } : {}) },
    })
    setBusy(null)
    if (!ok || !data.tree) return setResult({ ok: false, text: data.error || 'The AI could not build that block' })
    const props = { label: data.label ?? 'Custom block', tree: data.tree }
    let next: PageDoc
    if (composed && block) next = updateBlock(doc, block.id, { props })
    else {
      const at = block && doc.order.includes(block.id) ? doc.order.indexOf(block.id) + 1 : doc.order.length
      next = insertBlock(doc, { id: crypto.randomUUID(), type: 'composed', v: 1, props }, at)
    }
    onApply(next, data.summary ?? 'Done')
    setResult({ ok: true, text: `${data.summary ?? 'Done'} Undo reverts it.` })
  }

  // A code section is changed the AI Site Studio way (its code rewritten), not field by field.
  async function correctCode(b: Block) {
    setBusy('block')
    setResult(null)
    const { ok, data } = await api<{ source?: string; summary?: string; error?: string }>('/api/admin/site-builder/ai/code', {
      method: 'POST',
      json: { ref: { audience: pageRef.audience, page: pageRef.page }, block: { id: b.id, label: String(b.props.label ?? ''), source: String(b.props.source ?? '') }, instruction: prompt, hint: pointed, draftId },
    })
    setBusy(null)
    if (!ok || !data.source) return setResult({ ok: false, text: data.error || 'The AI could not make that change' })
    onApply(updateBlock(doc, b.id, { props: { ...b.props, source: data.source } }), data.summary ?? 'Done')
    setResult({ ok: true, text: `${data.summary ?? 'Done'}. Undo reverts it.` })
  }

  async function run(mode: 'block' | 'page') {
    if (!canWrite) return
    if (mode === 'block' && composed) return compose()
    if (mode === 'block' && block?.type === 'code_section') return correctCode(block)
    setBusy(mode)
    setResult(null)
    const { ok, data } = await api<{ doc?: PageDoc; summary?: string; error?: string }>('/api/admin/site-builder/ai', {
      method: 'POST',
      json: { ref: pageRef, doc, prompt, ...(mode === 'block' && block ? { blockId: block.id, hint: pointed } : {}) },
    })
    setBusy(null)
    if (!ok || !data.doc) return setResult({ ok: false, text: data.error || 'The AI could not make that change' })
    onApply(data.doc, data.summary ?? 'Done')
    setResult({ ok: true, text: `${data.summary ?? 'Done'} Undo reverts it.` })
  }

  // The critique pass on this page: what customers would see as broken or empty; "Fix" applies what can be fixed.
  async function critique(fix: boolean) {
    setChecking(true)
    const { ok, data } = await api<{ findings?: Finding[]; fixed?: number; doc?: PageDoc | null; theme?: ThemeTokens | null; error?: string }>('/api/admin/site-builder/critique', {
      method: 'POST',
      json: { ref: pageRef, doc, theme, fix },
    })
    setChecking(false)
    if (!ok) return setCheck({ findings: [], fixedNote: data.error || 'The check did not run; try again' })
    if (fix && data.doc) onApply(data.doc, `Fixed ${data.fixed} issue(s)`)
    if (fix && data.theme && onThemeChange) onThemeChange(normalizeTheme(data.theme))
    setCheck({ findings: data.findings ?? [], fixedNote: fix ? `Fixed ${data.fixed ?? 0} issue(s). Undo reverts the page.` : undefined })
  }

  const fixable = check?.findings.filter(f => f.fixable).length ?? 0

  return (
    <div className="space-y-3">
      {onRedo && studioDesigns(pageRef) && (
        <div className="rounded-lg border border-border-default p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">Design this page again with AI</p>
            <button
              type="button"
              disabled={!canWrite || redo?.status === 'running'}
              onClick={onRedo}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-500 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {redoHere?.status === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {redoHere?.status === 'running' ? 'Designing…' : 'Design again'}
            </button>
          </div>
          {redoHere?.status === 'running' ? (
            <p className="text-xs text-foreground-muted">The AI is planning and writing this page afresh: a few minutes. You can work on other pages meanwhile; changes to this one are replaced when it lands.</p>
          ) : redo?.status === 'running' ? (
            <p className="text-xs text-foreground-muted">The AI is designing {redo.label} again; one page at a time.</p>
          ) : redoHere?.status === 'done' ? (
            <p className="text-xs text-foreground-secondary">Designed again.{redoHere.message ? ` ${redoHere.message}` : ''} Undo brings the old page back.</p>
          ) : redoHere?.status === 'failed' ? (
            <p className="text-xs text-red-600">{redoHere.message || 'The AI could not design this page again.'}</p>
          ) : (
            <p className="text-xs text-foreground-muted">The AI Site Studio plans this page afresh and writes every section in your site’s style, with your own products. Charged to your AI wallet like other AI changes; Undo brings the old page back.</p>
          )}
        </div>
      )}
      <div className="rounded-lg border border-border-default p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-foreground">Check this page</p>
          <div className="flex gap-1.5">
            {fixable > 0 && canWrite && (
              <button type="button" disabled={checking} onClick={() => critique(true)} className="inline-flex items-center gap-1 rounded-md bg-accent-500 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
                Fix {fixable}
              </button>
            )}
            <button type="button" disabled={checking} onClick={() => critique(false)} className="inline-flex items-center gap-1 rounded-md border border-border-default px-2 py-1 text-xs text-foreground-secondary disabled:opacity-50">
              <ClipboardCheck className="w-3.5 h-3.5" /> {checking ? 'Checking…' : check ? 'Check again' : 'Check'}
            </button>
          </div>
        </div>
        {!check && <p className="text-xs text-foreground-muted">Finds empty blocks, missing pictures, text too long for phones, hard-to-read colours and repeats.</p>}
        {check && check.findings.length === 0 && <p className="text-xs text-foreground-secondary">Nothing to fix on this page.</p>}
        {check?.findings.map((f, i) => (
          <p key={i} className="flex gap-1.5 text-xs text-foreground-secondary">
            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${f.severity === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} />
            <span>
              {f.message}
              {f.fixable ? '' : ' (needs you)'}
            </span>
          </p>
        ))}
        {check?.fixedNote && <p className="text-xs text-foreground-muted">{check.fixedNote}</p>}
      </div>
      <div className="rounded-lg border border-border-default p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-foreground">{block ? `Target: ${label}` : 'Target: the whole page'}</p>
          <button
            type="button"
            onClick={onPickMode}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${picking ? 'bg-accent-500 text-white' : 'border border-border-default text-foreground-secondary'}`}
            title="Arrow tool: click a part of the preview to target it"
          >
            <MousePointer2 className="w-3.5 h-3.5" /> {picking ? 'Arrow on' : 'Arrow off'}
          </button>
        </div>
        {block && pointed && <p className="text-xs text-foreground-muted truncate">Pointed at: “{pointed}”</p>}
        {!block && <p className="text-xs text-foreground-muted">Turn the arrow on and click a block in the preview to correct just that part.</p>}
      </div>
      <textarea
        className="w-full min-h-24 rounded-lg border border-border-secondary bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
        placeholder={block ? `What should change in ${label}?` : 'Describe the page you want'}
        value={prompt}
        maxLength={2000}
        onChange={e => setPrompt(e.target.value)}
      />
      <div className="flex flex-wrap gap-1.5">
        {(block ? BLOCK_IDEAS : canCompose ? [...PAGE_IDEAS.slice(0, 1), ...NEW_BLOCK_IDEAS] : PAGE_IDEAS).map(i => (
          <button key={i} type="button" onClick={() => setPrompt(i)} className="rounded-full border border-border-default px-2.5 py-1 text-[11px] text-foreground-secondary hover:border-accent-500">
            {i}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {block && (
          <button type="button" disabled={!canWrite || !!busy || prompt.trim().length < 3} onClick={() => run('block')} className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-lg bg-accent-500 text-white disabled:opacity-50">
            <Wand2 className="w-4 h-4" /> {busy === 'block' || (composed && busy === 'new') ? 'Correcting…' : `Correct ${label}`}
          </button>
        )}
        {canCompose && !composed && (
          <button type="button" disabled={!canWrite || !!busy || prompt.trim().length < 3} onClick={compose} className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-lg border border-border-default text-foreground disabled:opacity-50" title="The AI builds a new block from your products, categories, reviews and offers">
            <Blocks className="w-4 h-4" /> {busy === 'new' ? 'Building…' : 'Make a new block'}
          </button>
        )}
        <button type="button" disabled={!canWrite || !!busy || prompt.trim().length < 3} onClick={() => run('page')} className={`inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-lg disabled:opacity-50 ${block ? 'border border-border-default text-foreground' : 'bg-accent-500 text-white'}`}>
          <Sparkles className="w-4 h-4" /> {busy === 'page' ? 'Building…' : 'Build the whole page'}
        </button>
      </div>
      {result && <p className={`text-xs ${result.ok ? 'text-foreground-secondary' : 'text-red-600'}`}>{result.text}</p>}
    </div>
  )
}
