'use client'

import { useState, useRef, useCallback } from 'react'
import { useToast } from '@/contexts/ToastContext'
import AdminSelect from '@/components/admin/AdminSelect'
import AdminImage from '@/components/admin/AdminImage'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import Toggle from '@/components/ui/Toggle'
import { useCanWrite, RequireWrite, RequireAi } from '@/contexts/AdminScopesContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { notifyHomepageDraftChanged } from '@/components/admin/homepage/draft-events'

export interface HeroSlideRow {
  id: string
  title: string
  subtitle: string | null
  badge_text: string | null
  badge_color: string | null
  image_url: string | null
  image_url_mobile: string | null
  blurhash?: string | null
  blurhash_mobile?: string | null
  cta_label: string | null
  cta_url: string | null
  filter_category: string | null
  filter_brand: string | null
  filter_grade: string | null
  filter_material: string | null
  filter_min_price: number | null
  filter_max_price: number | null
  filter_in_stock: boolean
  filter_on_sale: boolean
  display_order: number
  is_active: boolean
}

interface Option { value: string; label: string }

interface Props {
  initialSlides: HeroSlideRow[]
  categoryOptions: Option[]
  brandOptions: Option[]
  gradeOptions: Option[]
  materialOptions: Option[]
}

const BADGE_COLORS = [
  { value: 'bg-primary-500', label: 'Primary', swatch: '#7c3aed' },
  { value: 'bg-accent-500', label: 'Accent', swatch: '#84cc16' },
  { value: 'bg-red-500', label: 'Red', swatch: '#ef4444' },
  { value: 'bg-blue-600', label: 'Blue', swatch: '#2563eb' },
  { value: 'bg-emerald-600', label: 'Emerald', swatch: '#059669' },
  { value: 'bg-orange-600', label: 'Orange', swatch: '#ea580c' },
  { value: 'bg-purple-600', label: 'Purple', swatch: '#9333ea' },
  { value: 'bg-rose-600', label: 'Rose', swatch: '#e11d48' },
  { value: 'bg-teal-600', label: 'Teal', swatch: '#0d9488' },
  { value: 'bg-yellow-600', label: 'Yellow', swatch: '#ca8a04' },
]

function buildPreviewHref(s: Partial<HeroSlideRow>): string {
  if (s.cta_url && s.cta_url.trim()) return s.cta_url.trim()
  const p = new URLSearchParams()
  if (s.filter_category) p.set('category', s.filter_category)
  if (s.filter_brand) p.set('brand', s.filter_brand)
  if (s.filter_grade) p.set('grade', s.filter_grade)
  if (s.filter_material) p.set('material', s.filter_material)
  if (s.filter_min_price != null) p.set('minPrice', String(s.filter_min_price))
  if (s.filter_max_price != null) p.set('maxPrice', String(s.filter_max_price))
  if (s.filter_in_stock) p.set('inStock', '1')
  if (s.filter_on_sale) p.set('onSale', '1')
  const qs = p.toString()
  return `/products${qs ? `?${qs}` : ''}`
}

function SlideCard({ slide, categoryOptions, brandOptions, gradeOptions, materialOptions, canWrite, onChange, onDelete }: {
  slide: HeroSlideRow
  categoryOptions: Option[]
  brandOptions: Option[]
  gradeOptions: Option[]
  materialOptions: Option[]
  canWrite: boolean
  onChange: (patch: Partial<HeroSlideRow>) => void
  onDelete: () => void
}) {
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadingMobile, setUploadingMobile] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generatingAll, setGeneratingAll] = useState(false)
  const storeName = useStoreConfig().identity.name || 'an online store'
  const fileRef = useRef<HTMLInputElement>(null)
  const fileMobileRef = useRef<HTMLInputElement>(null)

  // Debounced-ish save: persist a field to the server
  const save = useCallback(async (patch: Partial<Record<string, unknown>>) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/hero-slides/${slide.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      })
      if (!res.ok) { showToast('Failed to save', 'error'); return }
      notifyHomepageDraftChanged()
    } catch { showToast('Failed to save', 'error') } finally { setSaving(false) }
  }, [slide.id, showToast])

  async function onFile(
    e: React.ChangeEvent<HTMLInputElement>,
    field: 'image_url' | 'image_url_mobile' = 'image_url',
  ) {
    const file = e.target.files?.[0]
    if (!file) return
    const isMobile = field === 'image_url_mobile'
    const setBusy = isMobile ? setUploadingMobile : setUploading
    const inputRef = isMobile ? fileMobileRef : fileRef
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('field', field)
      const res = await fetch(`/api/admin/hero-slides/${slide.id}/image`, { method: 'POST', body: form, credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.url) {
        const hashField = isMobile ? 'blurhash_mobile' : 'blurhash'
        onChange({ [field]: data.url, [hashField]: data.blurhash ?? null } as Partial<HeroSlideRow>)
        showToast(isMobile ? 'Mobile image saved to draft' : 'Image saved to draft', 'success')
        notifyHomepageDraftChanged()
      }
      else showToast(data.error || 'Upload failed', 'error')
    } catch { showToast('Upload failed', 'error') } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  // Clearing falls the slide back to the desktop image on phones.
  function clearMobileImage() {
    field({ image_url_mobile: null, blurhash_mobile: null }, { imageUrlMobile: null })
  }

  async function generateImage(promptOverride?: string) {
    const prompt = (promptOverride ?? aiPrompt).trim()
    if (!prompt || generating) return
    setGenerating(true)
    try {
      const res = await fetch(`/api/admin/hero-slides/${slide.id}/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt, field: 'image_url' }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.url) { onChange({ image_url: data.url, blurhash: data.blurhash ?? null }); showToast('Image generated and saved to draft', 'success'); notifyHomepageDraftChanged() }
      else showToast(data.error || 'Image generation failed', 'error')
    } catch { showToast('Image generation failed', 'error') } finally { setGenerating(false) }
  }

  // Generate ALL fields from one scenario: text via ai-fill-form, then the image.
  async function generateAll() {
    const scenario = aiPrompt.trim()
    if (!scenario || generatingAll || generating) return
    setGeneratingAll(true)
    try {
      // 1. Text fields (title, subtitle, badge) in one AI call
      const res = await fetch('/api/admin/ai-fill-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          scenario: `Homepage hero banner slide for ${storeName}. Scenario: ${scenario}`,
          fields: [
            { name: 'title', label: 'Hero title (1-3 punchy words)', type: 'text' },
            { name: 'subtitle', label: 'Supporting line, one concise sentence', type: 'text' },
            { name: 'badge_text', label: 'Tiny uppercase promo badge, 1-2 words e.g. New Arrivals', type: 'text' },
          ],
          scope: 'settings:write',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.fields) {
        const f = data.fields as Record<string, unknown>
        const patch: Partial<HeroSlideRow> = {}
        const savePatch: Record<string, unknown> = {}
        if (typeof f.title === 'string' && f.title.trim()) { patch.title = f.title.trim(); savePatch.title = f.title.trim() }
        if (typeof f.subtitle === 'string' && f.subtitle.trim()) { patch.subtitle = f.subtitle.trim(); savePatch.subtitle = f.subtitle.trim() }
        if (typeof f.badge_text === 'string' && f.badge_text.trim()) { patch.badge_text = f.badge_text.trim(); savePatch.badgeText = f.badge_text.trim() }
        if (Object.keys(patch).length) { onChange(patch); await save(savePatch) }
        showToast('Text generated — creating image…', 'success')
      } else {
        showToast(data.error || 'Text generation failed', 'error')
      }
    } catch { showToast('Text generation failed', 'error') } finally { setGeneratingAll(false) }
    // 2. Image (uses the same scenario)
    await generateImage(scenario)
  }

  function field(patch: Partial<HeroSlideRow>, savePatch: Partial<Record<string, unknown>>) {
    onChange(patch)
    save(savePatch)
  }

  const href = buildPreviewHref(slide)

  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${slide.is_active ? 'border-border-default bg-surface-elevated' : 'border-dashed border-border-strong bg-surface-secondary/30'}`}>
      {/* Header row — controls stay fully opaque even when the slide is hidden */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-default">
        {/* Thumbnail (dimmed when hidden) */}
        <div className={`w-16 h-10 rounded-lg bg-surface-secondary border border-border-default overflow-hidden shrink-0 ${slide.is_active ? '' : 'opacity-40 grayscale'}`}>
          {slide.image_url
            ? <AdminImage src={slide.image_url} alt="" blurhash={slide.blurhash} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-foreground-muted/40 text-[10px]">No image</div>}
        </div>
        <div className={`flex-1 min-w-0 ${slide.is_active ? '' : 'opacity-60'}`}>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground truncate">{slide.title || 'Untitled slide'}</p>
            {!slide.is_active && (
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-secondary text-foreground-muted border border-border-default">Hidden</span>
            )}
          </div>
          <p className="text-[11px] text-foreground-muted truncate">{href}</p>
        </div>
        {saving && <span className="text-[10px] text-foreground-muted">Saving…</span>}
        {/* Active toggle — shared admin Toggle component */}
        <div className="shrink-0" title={slide.is_active ? 'Active — showing on homepage' : 'Hidden — not shown on homepage'}>
          <Toggle
            checked={slide.is_active}
            onChange={next => field({ is_active: next }, { isActive: next })}
            disabled={!canWrite}
          />
        </div>
        <button type="button" onClick={() => setExpanded(v => !v)}
          className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-muted shrink-0">
          <svg viewBox="0 0 20 20" className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Image — upload or AI generate */}
          <div>
            <label className="block text-xs font-medium text-foreground-secondary mb-1.5">Banner image — desktop</label>
            <div className="flex items-center gap-3 mb-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => onFile(e, 'image_url')} className="hidden" />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || generating || !canWrite}
                className="px-3 py-1.5 rounded-lg border border-border-default text-sm hover:bg-surface-secondary disabled:opacity-50">
                {uploading ? 'Uploading…' : slide.image_url ? 'Replace image' : 'Upload image'}
              </button>
              {slide.image_url && !uploading && !generating && <span className="text-[11px] text-foreground-muted">Image set</span>}
            </div>

            {/* The storefront swaps to this below 1024px. Optional — it falls back to the
                desktop image, which crops badly on a narrow screen. */}
            <label className="block text-xs font-medium text-foreground-secondary mb-1.5">Banner image — mobile</label>
            <div className="flex items-center gap-3 mb-2">
              <input ref={fileMobileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => onFile(e, 'image_url_mobile')} className="hidden" />
              <button type="button" onClick={() => fileMobileRef.current?.click()} disabled={uploadingMobile || generating || !canWrite}
                className="px-3 py-1.5 rounded-lg border border-border-default text-sm hover:bg-surface-secondary disabled:opacity-50">
                {uploadingMobile ? 'Uploading…' : slide.image_url_mobile ? 'Replace mobile image' : 'Upload mobile image'}
              </button>
              {slide.image_url_mobile && !uploadingMobile
                ? (
                  <>
                    <div className="w-10 h-10 rounded overflow-hidden border border-border-default shrink-0">
                      <AdminImage src={slide.image_url_mobile} alt="" blurhash={slide.blurhash_mobile} className="w-full h-full object-cover" />
                    </div>
                    {canWrite && (
                      <button type="button" onClick={clearMobileImage}
                        className="text-[11px] text-foreground-muted hover:text-red-500 underline">
                        Clear
                      </button>
                    )}
                  </>
                )
                : <span className="text-[11px] text-foreground-muted">Falls back to the desktop image</span>}
            </div>
            {/* AI generation — one scenario fills every field */}
            <RequireAi scope="settings:write">
            <div className="rounded-lg border border-violet-200 dark:border-violet-800/50 bg-violet-50 dark:bg-violet-900/10 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">Generate with AI</span>
                <span className="text-[11px] text-violet-500 dark:text-violet-400">Describe the slide — AI writes the copy AND creates the image</span>
              </div>
              <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={2}
                placeholder="e.g. 'Fasteners range — bolts, nuts and screws, precision engineered, dramatic industrial lighting'"
                className="w-full px-3 py-2 rounded-lg border border-violet-200 dark:border-violet-700 bg-surface text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" />
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={generateAll} disabled={generatingAll || generating || !aiPrompt.trim()}
                  className="flex-1 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {(generatingAll || generating)
                    ? (<><span className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" /> {generatingAll ? 'Writing copy…' : 'Creating image…'}</>)
                    : 'Generate everything'}
                </button>
                <button type="button" onClick={() => generateImage()} disabled={generating || generatingAll || !aiPrompt.trim()}
                  title="Only regenerate the banner image"
                  className="px-3 py-2 rounded-lg border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 text-sm font-medium hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
                  Image only
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-violet-500/80 dark:text-violet-400/80">Image generation can take up to a minute.</p>
            </div>
            </RequireAi>
          </div>

          {/* Title + Subtitle */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">Title</label>
              <AIEnrichButton fieldLabel="Hero slide title" value={slide.title} scope="settings:write"
                context={`Homepage hero banner for the ${slide.filter_category || 'store'} category. Keep it punchy, 1-3 words.`}
                onChange={v => field({ title: v }, { title: v })}>
                <input type="text" value={slide.title}
                  onChange={e => onChange({ title: e.target.value })}
                  onBlur={e => save({ title: e.target.value })}
                  disabled={!canWrite}
                  className="w-full pr-9 px-3 py-2 rounded-lg border border-border-default bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60" />
              </AIEnrichButton>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">Subtitle</label>
              <AIEnrichButton fieldLabel="Hero slide subtitle" value={slide.subtitle ?? ''} scope="settings:write"
                context={`Short supporting line under the hero title "${slide.title}" for the ${slide.filter_category || 'store'} category. One concise sentence.`}
                onChange={v => field({ subtitle: v }, { subtitle: v })}>
                <input type="text" value={slide.subtitle ?? ''}
                  onChange={e => onChange({ subtitle: e.target.value })}
                  onBlur={e => save({ subtitle: e.target.value })}
                  disabled={!canWrite}
                  className="w-full pr-9 px-3 py-2 rounded-lg border border-border-default bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60" />
              </AIEnrichButton>
            </div>
          </div>

          {/* Badge */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">Badge text</label>
              <AIEnrichButton fieldLabel="Hero slide badge" value={slide.badge_text ?? ''} scope="settings:write"
                context={`Tiny uppercase promo badge (1-2 words) for the ${slide.filter_category || 'store'} hero slide, e.g. "New Arrivals", "Top Picks".`}
                onChange={v => field({ badge_text: v }, { badgeText: v })}>
                <input type="text" value={slide.badge_text ?? ''}
                  onChange={e => onChange({ badge_text: e.target.value })}
                  onBlur={e => save({ badgeText: e.target.value })}
                  placeholder="New Arrivals"
                  disabled={!canWrite}
                  className="w-full pr-9 px-3 py-2 rounded-lg border border-border-default bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60" />
              </AIEnrichButton>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">Badge color</label>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {BADGE_COLORS.map(c => (
                  <button key={c.value} type="button" title={c.label}
                    onClick={() => field({ badge_color: c.value }, { badgeColor: c.value })}
                    disabled={!canWrite}
                    className={`w-6 h-6 rounded-full border-2 transition-all disabled:opacity-60 ${slide.badge_color === c.value ? 'border-foreground scale-110' : 'border-transparent'}`}
                    style={{ background: c.swatch }} />
                ))}
              </div>
            </div>
          </div>

          {/* CTA target — filters OR manual URL */}
          <div className="rounded-lg border border-border-default p-3 space-y-3">
            <p className="text-xs font-semibold text-foreground">Where does this slide link to?</p>
            <p className="text-[11px] text-foreground-muted -mt-2">Assign product filters below, or type a manual URL. Filters build a <code>/products?…</code> link automatically.</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-foreground-muted mb-1">Category</label>
                <AdminSelect value={slide.filter_category ?? ''} placeholder="Any"
                  options={[{ value: '', label: 'Any' }, ...categoryOptions]}
                  disabled={!canWrite}
                  onChange={v => field({ filter_category: v || null }, { filterCategory: v || null })} />
              </div>
              <div>
                <label className="block text-[11px] text-foreground-muted mb-1">Brand</label>
                <AdminSelect value={slide.filter_brand ?? ''} placeholder="Any"
                  options={[{ value: '', label: 'Any' }, ...brandOptions]}
                  disabled={!canWrite}
                  onChange={v => field({ filter_brand: v || null }, { filterBrand: v || null })} />
              </div>
              <div>
                <label className="block text-[11px] text-foreground-muted mb-1">Grade</label>
                <AdminSelect value={slide.filter_grade ?? ''} placeholder="Any"
                  options={[{ value: '', label: 'Any' }, ...gradeOptions]}
                  disabled={!canWrite}
                  onChange={v => field({ filter_grade: v || null }, { filterGrade: v || null })} />
              </div>
              <div>
                <label className="block text-[11px] text-foreground-muted mb-1">Material</label>
                <AdminSelect value={slide.filter_material ?? ''} placeholder="Any"
                  options={[{ value: '', label: 'Any' }, ...materialOptions]}
                  disabled={!canWrite}
                  onChange={v => field({ filter_material: v || null }, { filterMaterial: v || null })} />
              </div>
              <div>
                <label className="block text-[11px] text-foreground-muted mb-1">Min price ₹</label>
                <input type="number" defaultValue={slide.filter_min_price ?? ''}
                  onBlur={e => field({ filter_min_price: e.target.value ? Number(e.target.value) : null }, { filterMinPrice: e.target.value ? Number(e.target.value) : null })}
                  disabled={!canWrite}
                  className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60" />
              </div>
              <div>
                <label className="block text-[11px] text-foreground-muted mb-1">Max price ₹</label>
                <input type="number" defaultValue={slide.filter_max_price ?? ''}
                  onBlur={e => field({ filter_max_price: e.target.value ? Number(e.target.value) : null }, { filterMaxPrice: e.target.value ? Number(e.target.value) : null })}
                  disabled={!canWrite}
                  className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60" />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-foreground-secondary cursor-pointer">
                <input type="checkbox" checked={slide.filter_in_stock}
                  onChange={e => field({ filter_in_stock: e.target.checked }, { filterInStock: e.target.checked })}
                  disabled={!canWrite}
                  className="rounded border-border-strong text-accent-500 focus:ring-accent-400" />
                In stock only
              </label>
              <label className="flex items-center gap-2 text-xs text-foreground-secondary cursor-pointer">
                <input type="checkbox" checked={slide.filter_on_sale}
                  onChange={e => field({ filter_on_sale: e.target.checked }, { filterOnSale: e.target.checked })}
                  disabled={!canWrite}
                  className="rounded border-border-strong text-accent-500 focus:ring-accent-400" />
                On sale
              </label>
            </div>

            <div>
              <label className="block text-[11px] text-foreground-muted mb-1">Manual URL (overrides filters)</label>
              <input type="text" defaultValue={slide.cta_url ?? ''} placeholder="/categories/fasteners or https://…"
                onBlur={e => field({ cta_url: e.target.value || null }, { ctaUrl: e.target.value || null })}
                disabled={!canWrite}
                className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60" />
            </div>

            <p className="text-[11px] text-foreground-muted">Links to: <span className="font-mono text-accent-600 dark:text-accent-400">{href}</span></p>
          </div>

          {/* Delete */}
          <RequireWrite scope="settings:write">
            <div className="flex justify-end pt-1">
              <button type="button" onClick={onDelete}
                className="px-3 py-1.5 rounded-lg text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                Delete slide
              </button>
            </div>
          </RequireWrite>
        </div>
      )}
    </div>
  )
}

export default function HeroSlideManager({ initialSlides, categoryOptions, brandOptions, gradeOptions, materialOptions }: Props) {
  const { showToast, showConfirm } = useToast()
  const canWrite = useCanWrite('settings:write')
  const [slides, setSlides] = useState<HeroSlideRow[]>(initialSlides)
  const [creating, setCreating] = useState(false)

  async function addSlide() {
    setCreating(true)
    try {
      const res = await fetch('/api/admin/hero-slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: 'New slide', badgeColor: 'bg-primary-500' }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.slide) { setSlides(prev => [...prev, data.slide]); showToast('Slide added to draft', 'success'); notifyHomepageDraftChanged() }
      else showToast(data.error || 'Failed to add slide', 'error')
    } catch { showToast('Failed to add slide', 'error') } finally { setCreating(false) }
  }

  function patchSlide(id: string, patch: Partial<HeroSlideRow>) {
    setSlides(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  function deleteSlide(id: string) {
    showConfirm({
      title: 'Delete slide?',
      message: 'The slide will be removed from the draft. It stays live until you publish.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      type: 'danger',
      onConfirm: async () => {
        const res = await fetch(`/api/admin/hero-slides/${id}`, { method: 'DELETE', credentials: 'include' })
        if (res.ok) { setSlides(prev => prev.filter(s => s.id !== id)); showToast('Slide removed from draft', 'success'); notifyHomepageDraftChanged() }
        else showToast('Failed to delete', 'error')
      },
    })
  }

  async function move(id: string, dir: -1 | 1) {
    const idx = slides.findIndex(s => s.id === id)
    const target = idx + dir
    if (target < 0 || target >= slides.length) return
    const next = [...slides]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setSlides(next)
    const res = await fetch('/api/admin/hero-slides', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ order: next.map(s => s.id) }),
    }).catch(() => null)
    if (res?.ok) notifyHomepageDraftChanged()
  }

  return (
    <div className="space-y-3">
      {slides.length === 0 && (
        <p className="text-sm text-foreground-muted py-4 text-center">No hero slides yet. Add one to get started.</p>
      )}
      {slides.map((slide, i) => (
        <div key={slide.id} className="flex items-start gap-2">
          {/* Reorder controls */}
          <RequireWrite scope="settings:write">
            <div className="flex flex-col gap-1 pt-3">
              <button type="button" onClick={() => move(slide.id, -1)} disabled={i === 0}
                className="p-0.5 rounded text-foreground-muted hover:text-foreground disabled:opacity-30" title="Move up">
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 10l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button type="button" onClick={() => move(slide.id, 1)} disabled={i === slides.length - 1}
                className="p-0.5 rounded text-foreground-muted hover:text-foreground disabled:opacity-30" title="Move down">
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          </RequireWrite>
          <div className="flex-1 min-w-0">
            <SlideCard slide={slide}
              categoryOptions={categoryOptions} brandOptions={brandOptions}
              gradeOptions={gradeOptions} materialOptions={materialOptions}
              canWrite={canWrite}
              onChange={patch => patchSlide(slide.id, patch)}
              onDelete={() => deleteSlide(slide.id)} />
          </div>
        </div>
      ))}
      <RequireWrite scope="settings:write">
        <button type="button" onClick={addSlide} disabled={creating}
          className="w-full py-2.5 rounded-xl border-2 border-dashed border-border-default text-sm font-medium text-foreground-secondary hover:border-accent-400 hover:text-accent-600 dark:hover:text-accent-400 transition-colors disabled:opacity-50">
          {creating ? 'Adding…' : '+ Add hero slide'}
        </button>
      </RequireWrite>
    </div>
  )
}
