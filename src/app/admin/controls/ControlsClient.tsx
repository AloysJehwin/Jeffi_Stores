'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import AdminSelect, { SelectOption } from '@/components/admin/AdminSelect'
import GalleryPicker from '@/components/admin/GalleryPicker'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { ALL_DIMENSIONS, DIMENSION_LABEL, UNITS, type Dimension, computeAreaFactor, computeVolumeFactor } from '@/lib/units'

type SnapRow = { id: string; name?: string; before: Record<string, any> }
type OperationSnapshot = {
  products?: SnapRow[]
  variants?: SnapRow[]
  subs?: SnapRow[]
  variantUnits?: { variant_id: string; product_id: string; before: Record<string, any> | null }[]
}

interface ControlsLog {
  id: string
  operation: string
  product_count: number
  applied_by: string | null
  applied_at: string
  rolled_back_at: string | null
  is_rollback: boolean
  value: any
  // Legacy logs store SnapRow[]; current logs store OperationSnapshot.
  snapshot: SnapRow[] | OperationSnapshot | null
}

interface Category { id: string; name: string; parent_category_id: string | null }
interface Brand { id: string; name: string }

interface Product {
  id: string; name: string; sku: string; has_variants: boolean
  mrp_ex_gst: string | null; mrp: string | null; price_ex_gst: string | null; base_price: string | null
  discount_pct: string; gst_percentage: string
  grade: string | null; condition: string; target_gender: string | null
  shipping_class: string; tax_class: string; hsn_code: string | null
  handling_days: number; warranty_months: number | null
  is_featured: boolean; is_searchable: boolean; is_active: boolean
  brand_name: string | null; category_name: string | null
  variant_mrp_min: string | null; variant_mrp_max: string | null
}

function fmt(v: string | null) {
  if (!v) return '—'
  const n = parseFloat(v)
  return isNaN(n) ? '—' : `₹${n.toFixed(2)}`
}

// ── filter definitions ────────────────────────────────────────────────────────
type FilterKey = 'category_id' | 'brand_id' | 'grade' | 'condition' | 'target_gender' | 'shipping_class' | 'tax_class' | 'hsn_code' | 'is_featured' | 'is_searchable' | 'is_active'

const FILTER_OPTIONS: { key: FilterKey; label: string; type: 'select' | 'text'; options?: { value: string; label: string }[] }[] = [
  { key: 'category_id', label: 'Category', type: 'select' },
  { key: 'brand_id', label: 'Brand', type: 'select' },
  { key: 'grade', label: 'Grade', type: 'text' },
  { key: 'condition', label: 'Condition', type: 'select', options: [{ value: 'new', label: 'New' }, { value: 'used', label: 'Used' }, { value: 'refurbished', label: 'Refurbished' }] },
  { key: 'target_gender', label: 'Target Gender', type: 'select', options: [{ value: 'unisex', label: 'Unisex' }, { value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }] },
  { key: 'shipping_class', label: 'Shipping Class', type: 'select', options: [{ value: 'standard', label: 'Standard' }, { value: 'express', label: 'Express' }, { value: 'freight', label: 'Freight' }] },
  { key: 'tax_class', label: 'Tax Class', type: 'select', options: [{ value: 'standard', label: 'Standard' }, { value: 'reduced', label: 'Reduced' }, { value: 'zero', label: 'Zero' }, { value: 'exempt', label: 'Exempt' }] },
  { key: 'hsn_code', label: 'HSN Code', type: 'text' },
  { key: 'is_featured', label: 'Featured', type: 'select', options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
  { key: 'is_searchable', label: 'Searchable', type: 'select', options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
  { key: 'is_active', label: 'Active', type: 'select', options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
]

// ── operation definitions ─────────────────────────────────────────────────────
type OpKey = 'inflate_price' | 'set_discount' | 'set_mrp_ex_gst' | 'set_tax_class' | 'set_condition' | 'set_shipping_class' | 'set_handling_days' | 'set_warranty_months' | 'set_target_gender' | 'set_grade' | 'set_hsn_code' | 'set_country_of_origin' | 'set_featured' | 'set_searchable' | 'set_active' | 'set_selling_unit' | 'set_images'

interface OpDef {
  key: OpKey; label: string; group: string
  inputType: 'number' | 'text' | 'select' | 'custom' | 'images'
  placeholder?: string
  options?: { value: string; label: string }[]
  unit?: string
  danger?: boolean
}

const OPERATIONS: OpDef[] = [
  { key: 'inflate_price',       label: 'Inflate Price',        group: 'Pricing', inputType: 'number', placeholder: 'e.g. 10', unit: '%', },
  { key: 'set_discount',        label: 'Set Discount %',       group: 'Pricing', inputType: 'number', placeholder: '0–100', unit: '%' },
  { key: 'set_mrp_ex_gst',      label: 'Set MRP (Ex-GST)',     group: 'Pricing', inputType: 'number', placeholder: 'e.g. 250.00', unit: '₹' },
  { key: 'set_tax_class',       label: 'Set Tax Class',        group: 'Attributes', inputType: 'select', options: [{ value: 'standard', label: 'Standard' }, { value: 'reduced', label: 'Reduced' }, { value: 'zero', label: 'Zero' }, { value: 'exempt', label: 'Exempt' }] },
  { key: 'set_condition',       label: 'Set Condition',        group: 'Attributes', inputType: 'select', options: [{ value: 'new', label: 'New' }, { value: 'used', label: 'Used' }, { value: 'refurbished', label: 'Refurbished' }] },
  { key: 'set_shipping_class',  label: 'Set Shipping Class',   group: 'Attributes', inputType: 'select', options: [{ value: 'standard', label: 'Standard' }, { value: 'express', label: 'Express' }, { value: 'freight', label: 'Freight' }] },
  { key: 'set_handling_days',   label: 'Set Handling Days',    group: 'Logistics', inputType: 'number', placeholder: 'e.g. 0', unit: 'days' },
  { key: 'set_warranty_months', label: 'Set Warranty Months',  group: 'Logistics', inputType: 'number', placeholder: 'e.g. 12', unit: 'months' },
  { key: 'set_target_gender',   label: 'Set Target Gender',    group: 'Attributes', inputType: 'select', options: [{ value: 'unisex', label: 'Unisex' }, { value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }] },
  { key: 'set_grade',           label: 'Set Grade',            group: 'Attributes', inputType: 'text', placeholder: 'e.g. 8.8, 304, M2 HSS' },
  { key: 'set_hsn_code',        label: 'Set HSN Code',         group: 'Tax', inputType: 'text', placeholder: 'e.g. 73181500' },
  { key: 'set_country_of_origin', label: 'Set Country of Origin', group: 'Tax', inputType: 'text', placeholder: 'e.g. IN' },
  { key: 'set_featured',        label: 'Set Featured',         group: 'Visibility', inputType: 'select', options: [{ value: 'true', label: 'Yes — Featured' }, { value: 'false', label: 'No — Not Featured' }] },
  { key: 'set_searchable',      label: 'Set Searchable',       group: 'Visibility', inputType: 'select', options: [{ value: 'true', label: 'Yes — Searchable' }, { value: 'false', label: 'No — Hidden from search' }] },
  { key: 'set_active',          label: 'Set Active/Inactive',  group: 'Visibility', inputType: 'select', danger: true, options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive (delisted)' }] },
  { key: 'set_selling_unit',    label: 'Set Selling Unit',     group: 'Attributes', inputType: 'custom' },
  { key: 'set_images',          label: 'Replace Images',       group: 'Media', inputType: 'images', danger: true },
]

const inputCls = 'w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm'

export default function ControlsClient({ categories, brands }: { categories: Category[]; brands: Brand[] }) {
  const confirm = useConfirm()
  const canWrite = useCanWrite('controls:write')

  // ── filters ───────────────────────────────────────────────────────────────
  const [activeFilters, setActiveFilters] = useState<Partial<Record<FilterKey, string>>>({})
  const [addingFilter, setAddingFilter] = useState<FilterKey | ''>('')

  // ── product list ──────────────────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // ── operation ─────────────────────────────────────────────────────────────
  const [opKey, setOpKey] = useState<OpKey | ''>('')
  const [opValue, setOpValue] = useState('')
  const [inheritToVariants, setInheritToVariants] = useState(true)
  // set_images: one image replaces a chosen slot (1-based) on each product.
  // Source is either a fresh upload or an existing gallery image.
  const [imageSource, setImageSource] = useState<'upload' | 'gallery'>('upload')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageSlot, setImageSlot] = useState('1')
  const [imageAlt, setImageAlt] = useState('')
  const [imageError, setImageError] = useState<string | null>(null)
  // Gallery picker (shared component)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [selectedGallery, setSelectedGallery] = useState<{ id: string; thumbnail_url: string | null; image_url: string; file_name: string } | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applySuccess, setApplySuccess] = useState<string | null>(null)
  const [lastLogId, setLastLogId] = useState<string | null>(null)
  const [lastLogLabel, setLastLogLabel] = useState<string | null>(null)
  const [rollingBack, setRollingBack] = useState(false)
  const [rollbackError, setRollbackError] = useState<string | null>(null)
  // set_images runs as a background job we poll: track its id + progress here.
  const [imageJob, setImageJob] = useState<{ id: string; total: number; done: number; skipped: number; label: string } | null>(null)

  // ── operation history ─────────────────────────────────────────────────────
  const [logs, setLogs] = useState<ControlsLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)
  const [logsPage, setLogsPage] = useState(0)
  const LOGS_PER_PAGE = 10

  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const res = await fetch('/api/admin/controls/rollback')
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs ?? [])
        setLogsPage(0)
      }
    } finally {
      setLogsLoading(false)
    }
  }, [])

  useEffect(() => { loadLogs() }, [])

  // Poll the bulk-image job while it runs; on completion surface success + enable
  // Undo, on failure surface the error. The picker is cleared only once terminal.
  useEffect(() => {
    if (!imageJob) return
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/controls/jobs/${imageJob.id}`)
        if (!res.ok) return
        const { job } = await res.json()
        if (cancelled || !job) return
        setImageJob(prev => prev && prev.id === job.id ? { ...prev, done: job.done, skipped: job.skipped } : prev)
        if (job.status === 'completed') {
          clearInterval(timer)
          const skippedNote = job.skipped ? ` (${job.skipped} skipped — no image in that slot)` : ''
          setApplySuccess(`${imageJob.label} applied to ${job.done} product${job.done !== 1 ? 's' : ''}${skippedNote}.`)
          if (job.log_id) { setLastLogId(job.log_id); setLastLogLabel(imageJob.label) }
          setImageFile(null); setSelectedGallery(null); setImageAlt(''); setImageError(null)
          setImageJob(null)
          loadLogs()
        } else if (job.status === 'failed') {
          clearInterval(timer)
          setApplyError(job.error || 'Image update failed')
          setImageJob(null)
        }
      } catch { /* transient poll error — try again next tick */ }
    }, 1500)
    return () => { cancelled = true; clearInterval(timer) }
  }, [imageJob?.id, loadLogs])

  // ── selling unit sub-fields ───────────────────────────────────────────────
  const [suDimension, setSuDimension] = useState<Dimension>('count')
  const [suUnit, setSuUnit] = useState('pc')
  const [suIsCustom, setSuIsCustom] = useState(false)
  const [suFactor, setSuFactor] = useState('1')
  const [suLabel, setSuLabel] = useState('')
  const [suMinQty, setSuMinQty] = useState('1')
  const [suMaxQty, setSuMaxQty] = useState('')
  const [suQtyStep, setSuQtyStep] = useState('1')
  // custom measurement fields (for non-count custom units)
  const [suCustomDimUnit, setSuCustomDimUnit] = useState('m')
  const [suCustomLength, setSuCustomLength] = useState('')
  const [suCustomWidth, setSuCustomWidth] = useState('')
  const [suCustomHeight, setSuCustomHeight] = useState('')

  function defaultDimUnit(dim: Dimension): string {
    if (dim === 'length' || dim === 'area' || dim === 'volume') return 'm'
    if (dim === 'weight') return 'kg'
    return 'm'
  }

  function handleSuDimensionChange(dim: Dimension) {
    setSuDimension(dim)
    setSuUnit('')
    setSuIsCustom(false)
    setSuFactor('')
    setSuCustomDimUnit(defaultDimUnit(dim))
    setSuCustomLength(''); setSuCustomWidth(''); setSuCustomHeight('')
  }

  function handleSuUnitChange(v: string) {
    if (v === '__custom') {
      setSuIsCustom(true)
      setSuUnit('')
      setSuFactor('')
      return
    }
    setSuIsCustom(false)
    setSuUnit(v)
    if (suDimension === 'count') {
      const def = UNITS.count.find(u => u.key === v)
      setSuFactor(def?.multiplier != null ? String(def.multiplier) : '1')
    } else {
      const def = (UNITS[suDimension] || []).find(u => u.key === v)
      setSuFactor(def?.toSi != null ? String(def.toSi) : '')
    }
  }

  // derived flags matching BaseUnitForm logic
  const suDimUnits = UNITS[suDimension] || []
  const suSelectedDef = suDimUnits.find(u => u.key === suUnit)
  const suIsPredefined = suDimension === 'count'
    ? suSelectedDef?.multiplier != null
    : suSelectedDef?.toSi != null
  const suShowFactor = suDimension === 'count' && !suIsCustom

  // custom measurement preview
  const suCustomMeasureUnits = suDimension === 'weight'
    ? UNITS.weight
    : UNITS.length

  function computeSuCustomFactor(): { factor: number; label: string } | null {
    const len = parseFloat(suCustomLength)
    if (!len || len <= 0) return null
    try {
      if (suDimension === 'area') {
        const w = parseFloat(suCustomWidth)
        if (!w || w <= 0) return null
        const factor = computeAreaFactor({ length: len, width: w, dim_unit: suCustomDimUnit }, 'm2')
        return { factor, label: 'm²' }
      }
      if (suDimension === 'volume') {
        const w = parseFloat(suCustomWidth); const h = parseFloat(suCustomHeight)
        if (!w || w <= 0 || !h || h <= 0) return null
        const factor = computeVolumeFactor({ length: len, width: w, height: h, dim_unit: suCustomDimUnit }, 'L')
        return { factor, label: 'L' }
      }
      if (suDimension === 'length') {
        const def = UNITS.length.find(u => u.key === suCustomDimUnit)
        if (!def?.toSi) return null
        return { factor: len * def.toSi, label: 'm' }
      }
      if (suDimension === 'weight') {
        const def = UNITS.weight.find(u => u.key === suCustomDimUnit)
        if (!def?.toSi) return null
        return { factor: len * def.toSi, label: 'kg' }
      }
    } catch { return null }
    return null
  }

  const suCustomPreview = suIsCustom && suDimension !== 'count' ? computeSuCustomFactor() : null

  const opDef = OPERATIONS.find(o => o.key === opKey) ?? null

  // ── category / brand select options ──────────────────────────────────────
  const topCats = categories.filter(c => !c.parent_category_id)
  const subCats  = categories.filter(c => c.parent_category_id)
  const categoryOptions: SelectOption[] = topCats.flatMap(p => {
    const subs = subCats.filter(s => s.parent_category_id === p.id)
    return [
      { value: p.id, label: p.name, group: p.name },
      ...subs.map(s => ({ value: s.id, label: s.name, group: p.name, indent: true })),
    ]
  })
  const brandOptions: SelectOption[] = brands.map(b => ({ value: b.id, label: b.name }))

  const availableFilters = FILTER_OPTIONS.filter(f => !(f.key in activeFilters))

  // ── load products ─────────────────────────────────────────────────────────
  const loadProducts = useCallback(async (filters: Partial<Record<FilterKey, string>>, keepSuccess = false) => {
    if (Object.keys(filters).length === 0) { setProducts([]); setSelectedIds(new Set()); return }
    setLoading(true)
    setLoadError(null)
    if (!keepSuccess) setApplySuccess(null)
    try {
      const params = new URLSearchParams(filters as Record<string, string>)
      const res = await fetch(`/api/admin/controls?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      const list: Product[] = data.products || []
      setProducts(list)
      setSelectedIds(new Set(list.map(p => p.id)))
    } catch (e: any) {
      setLoadError(e.message)
      setProducts([])
    } finally {
      setLoading(false)
    }
  }, [])

  function setFilter(key: FilterKey, value: string) {
    const next = { ...activeFilters, [key]: value }
    setActiveFilters(next)
    setAddingFilter('')
    loadProducts(next)
  }

  function removeFilter(key: FilterKey) {
    const next = { ...activeFilters }
    delete next[key]
    setActiveFilters(next)
    loadProducts(next)
  }

  function toggleProduct(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    setApplySuccess(null)
  }

  function toggleAll() {
    const allIds = products.map(p => p.id)
    const allSelected = allIds.every(id => selectedIds.has(id))
    setSelectedIds(allSelected ? new Set() : new Set(allIds))
  }

  // ── apply operation ───────────────────────────────────────────────────────
  async function handleApply() {
    if (!canApply) return

    const label = opDef.label
    const ok = await confirm({
      title: `Apply: ${label}?`,
      message: opKey === 'set_images'
        ? `This will replace image #${imageSlot} on the selected products with the uploaded image (products without that image slot are skipped). Undoable from History. Continue?`
        : `This will update ${selectedIds.size} product${selectedIds.size !== 1 ? 's' : ''}. Are you sure?`,
      confirmLabel: 'Yes, apply',
      cancelLabel: 'Cancel',
      variant: opDef.danger ? 'danger' : 'default',
    })
    if (!ok) return

    setApplying(true)
    setApplyError(null)
    setApplySuccess(null)
    try {
      let res: Response
      if (opKey === 'set_images') {
        // Multipart: replace image slot N on every selected product, from an
        // uploaded file OR a chosen gallery image.
        const fd = new FormData()
        fd.append('operation', 'set_images')
        fd.append('product_ids', JSON.stringify([...selectedIds]))
        fd.append('slot', String(parseInt(imageSlot, 10) || 1))
        if (imageSource === 'gallery' && selectedGallery) {
          fd.append('gallery_image_id', selectedGallery.id)
        } else if (imageFile) {
          fd.append('image_count', '1')
          fd.append('image_0', imageFile)
        }
        if (imageAlt.trim()) fd.append('alt_text', imageAlt.trim())
        // No Content-Type header — the browser sets the multipart boundary.
        res = await fetch('/api/admin/controls', { method: 'POST', body: fd })
      } else {
        const value = opKey === 'set_selling_unit'
          ? { unit: suUnitKey, factor: parseFloat(suEffectiveFactor), dimension: suDimension, display_label: suLabel || null, min_qty: parseFloat(suMinQty) || 1, max_qty: suMaxQty.trim() ? parseFloat(suMaxQty) : null, qty_step: parseFloat(suQtyStep) || 1 }
          : opValue
        res = await fetch('/api/admin/controls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation: opKey, value, product_ids: [...selectedIds], inherit_to_variants: inheritToVariants }),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      if (opKey === 'set_images') {
        // Async: the server queued a job. Show progress and poll for completion;
        // don't clear the picker until the job finishes (so a retry is easy on failure).
        setImageJob({ id: data.job_id, total: data.total ?? 0, done: 0, skipped: data.skipped ?? 0, label })
        setRollbackError(null)
      } else {
        const skippedNote = data.skipped ? ` (${data.skipped} skipped — no image in that slot)` : ''
        setApplySuccess(`${label} applied to ${data.updated} product${data.updated !== 1 ? 's' : ''}${skippedNote}.`)
        if (data.log_id) { setLastLogId(data.log_id); setLastLogLabel(label) }
        setRollbackError(null)
        setOpValue('')
        loadLogs()
      }
    } catch (e: any) {
      setApplyError(e.message)
    } finally {
      setApplying(false)
    }
  }

  const suUnitKey = suIsCustom ? suUnit.trim() : suUnit

  async function handleRollback(logId: string, label: string) {
    const ok = await confirm({
      title: 'Undo operation?',
      message: `This will restore the before-values for "${label}" across all affected products.`,
      confirmLabel: 'Yes, undo',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!ok) return
    setRollingBack(true)
    setRollbackError(null)
    try {
      const res = await fetch('/api/admin/controls/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ log_id: logId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Rollback failed')
      setApplySuccess(`Rolled back "${label}" — ${data.restored} product${data.restored !== 1 ? 's' : ''} restored.`)
      setLastLogId(null)
      setLastLogLabel(null)
      loadLogs()
      loadProducts(activeFilters, true)
    } catch (e: any) {
      setRollbackError(e.message)
    } finally {
      setRollingBack(false)
    }
  }

  function handleReset() {
    setActiveFilters({})
    setProducts([])
    setSelectedIds(new Set())
    setOpKey('')
    setOpValue('')
    setApplyError(null)
    setApplySuccess(null)
    setLastLogId(null)
    setLastLogLabel(null)
    setRollbackError(null)
    setSuDimension('count')
    setSuUnit('pc')
    setSuIsCustom(false)
    setSuFactor('1')
    setSuLabel('')
    setSuMinQty('1')
    setSuMaxQty('')
    setSuQtyStep('1')
  }  const suEffectiveFactor = suIsCustom && suDimension !== 'count' && suCustomPreview
    ? String(suCustomPreview.factor)
    : suFactor
  const canApply = !!opDef && selectedIds.size > 0 && !applying && !imageJob && (
    opKey === 'set_selling_unit'
      ? !!suUnitKey && parseFloat(suEffectiveFactor) > 0
      : opKey === 'set_images'
        ? (imageSource === 'upload' ? !!imageFile : !!selectedGallery) && parseInt(imageSlot, 10) >= 1
        : !!opValue
  )

  // Validate + accept ONE picked image file (≤5MB, jpeg/png/webp — matches src/lib/s3.ts).
  const MAX_IMG = 5 * 1024 * 1024
  const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp']
  function pickImageFile(list: FileList | null) {
    if (!list || list.length === 0) return
    const f = list[0]
    setImageError(null)
    if (!IMG_TYPES.includes(f.type)) { setImageError(`"${f.name}" — only JPEG, PNG, WebP allowed.`); return }
    if (f.size > MAX_IMG) { setImageError(`"${f.name}" exceeds the 5MB limit.`); return }
    setImageFile(f)
  }

  // ── operation groups ──────────────────────────────────────────────────────
  const opGroups = useMemo(() => {
    const g: Record<string, OpDef[]> = {}
    for (const op of OPERATIONS) { g[op.group] = g[op.group] || []; g[op.group].push(op) }
    return g
  }, [])

  const opOptions: SelectOption[] = Object.entries(opGroups).flatMap(([group, ops]) =>
    ops.map(op => ({ value: op.key, label: op.label, group }))
  )

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Product Controls</h1>
        <p className="text-foreground-secondary mt-1 text-sm">Work through the steps: filter products, select a subset, then apply a bulk operation. Every change is logged and can be undone from History. Price changes derive from MRP (Ex-GST) — GST, selling price and discount recalculate automatically.</p>
      </div>

      {/* ── Step 1 · Filter ──────────────────────────────────────────── */}
      <section className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-default bg-surface">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-accent-500 text-white text-xs font-bold shrink-0">1</span>
          <h2 className="text-sm font-semibold text-foreground flex-1">Filter products</h2>
          {Object.keys(activeFilters).length > 0 && (
            <button type="button" onClick={() => { setActiveFilters({}); setProducts([]); setSelectedIds(new Set()) }}
              className="text-xs text-foreground-muted hover:text-red-500 transition-colors">Clear all</button>
          )}
        </div>
        <div className="p-4 space-y-3">

        {/* active filter chips */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(activeFilters).map(([key, value]) => {
            const fd = FILTER_OPTIONS.find(f => f.key === key)!
            const displayVal = fd.options?.find(o => o.value === value)?.label
              ?? (key === 'category_id' ? categories.find(c => c.id === value)?.name : null)
              ?? (key === 'brand_id' ? brands.find(b => b.id === value)?.name : null)
              ?? value
            return (
              <span key={key} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300 text-xs font-medium border border-accent-200 dark:border-accent-700">
                <span className="text-accent-500">{fd.label}:</span> {displayVal}
                <button type="button" onClick={() => removeFilter(key as FilterKey)} className="text-accent-400 hover:text-accent-700 dark:hover:text-accent-200 leading-none">×</button>
              </span>
            )
          })}

          {/* add filter */}
          {availableFilters.length > 0 && (
            addingFilter ? (
              <div className="flex items-center gap-2 flex-wrap">
                {(() => {
                  const fd = FILTER_OPTIONS.find(f => f.key === addingFilter)!
                  if (addingFilter === 'category_id') return (
                    <div className="w-56">
                      <AdminSelect value="" placeholder="Pick category…" options={categoryOptions}
                        onChange={v => v && setFilter('category_id', v)} />
                    </div>
                  )
                  if (addingFilter === 'brand_id') return (
                    <div className="w-48">
                      <AdminSelect value="" placeholder="Pick brand…" options={brandOptions}
                        onChange={v => v && setFilter('brand_id', v)} />
                    </div>
                  )
                  if (fd.type === 'select' && fd.options) return (
                    <div className="w-44">
                      <AdminSelect value="" placeholder={`Pick ${fd.label}…`}
                        options={fd.options.map(o => ({ value: o.value, label: o.label }))}
                        onChange={v => v && setFilter(addingFilter, v)} />
                    </div>
                  )
                  return (
                    <input autoFocus type="text" placeholder={`Enter ${fd.label}…`}
                      className="px-3 py-1.5 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                      onKeyDown={e => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) setFilter(addingFilter, v) } if (e.key === 'Escape') setAddingFilter('') }} />
                  )
                })()}
                <button type="button" onClick={() => setAddingFilter('')} className="text-xs text-foreground-muted hover:text-foreground">cancel</button>
              </div>
            ) : (
              <div className="w-44">
                <AdminSelect value="" placeholder="+ Add filter…"
                  options={availableFilters.map(f => ({ value: f.key, label: f.label }))}
                  onChange={v => v && setAddingFilter(v as FilterKey)} />
              </div>
            )
          )}
        </div>

        {loadError && <p className="text-xs text-red-500">{loadError}</p>}
        </div>
      </section>

      {/* ── Step 2 · Select ──────────────────────────────────────────── */}
      {(loading || products.length > 0) && (
        <section className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border-default bg-surface flex-wrap">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-accent-500 text-white text-xs font-bold shrink-0">2</span>
            <h2 className="text-sm font-semibold text-foreground flex-1">
              Select products
              {!loading && (
                <span className="ml-2 font-normal text-foreground-muted">
                  {selectedIds.size} of {products.length} selected
                </span>
              )}
            </h2>
            {loading ? (
              <span className="text-sm text-foreground-muted">Loading…</span>
            ) : products.length > 0 && (
              <button type="button" onClick={toggleAll}
                className="text-xs font-medium text-accent-500 hover:text-accent-600 transition-colors">
                {products.every(p => selectedIds.has(p.id)) ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>

          {loading ? (
            <div className="divide-y divide-border-default">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 animate-pulse">
                  <div className="w-4 h-4 rounded bg-surface-secondary shrink-0" />
                  <div className="h-3.5 bg-surface-secondary rounded flex-1" />
                  <div className="h-3 bg-surface-secondary rounded w-24" />
                </div>
              ))}
            </div>
          ) : (
            <div className="max-h-[28rem] overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-x-4 [&>label]:border-b [&>label]:border-border-default">
              {products.map(p => (
                <label key={p.id} className="flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-surface transition-colors">
                  <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleProduct(p.id)}
                    className="mt-0.5 w-4 h-4 accent-accent-500 rounded shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-foreground">{p.name}</span>
                    {p.grade && <span className="ml-2 text-xs text-foreground-muted">Grade: {p.grade}</span>}
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <p className="text-xs text-foreground-muted">{p.category_name ?? '—'} {p.brand_name ? `· ${p.brand_name}` : ''}</p>
                    <p className="text-xs text-foreground">
                      {p.mrp_ex_gst
                        ? `${fmt(p.mrp_ex_gst)} ex-GST · ${p.discount_pct}% off`
                        : p.variant_mrp_min
                          ? p.variant_mrp_min === p.variant_mrp_max
                            ? `${fmt(p.variant_mrp_min)} ex-GST (variant)`
                            : `${fmt(p.variant_mrp_min)}–${fmt(p.variant_mrp_max)} ex-GST (variants)`
                          : '—'
                      }
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Step 3 · Operation ─────────────────────────────────────────── */}
      {products.length > 0 && (
        <section className={`bg-surface-elevated rounded-xl border border-border-default overflow-hidden transition-opacity ${selectedIds.size === 0 ? 'opacity-60' : ''}`}>
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border-default bg-surface">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-accent-500 text-white text-xs font-bold shrink-0">3</span>
            <h2 className="text-sm font-semibold text-foreground flex-1">Choose operation</h2>
            {selectedIds.size === 0 && <span className="text-xs text-foreground-muted">Select products first</span>}
          </div>
          <div className="p-4 space-y-4">

          <div className={`grid grid-cols-1 gap-3 items-end ${
            opDef && opDef.inputType !== 'custom' && opDef.inputType !== 'images'
              ? 'sm:grid-cols-[1fr_1fr_auto]'   // Operation · Value · Apply
              : 'sm:grid-cols-2'                 // Operation · Apply (equal halves)
          }`}>
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1.5">Operation</label>
              <AdminSelect
                value={opKey}
                placeholder="Choose operation…"
                options={opOptions}
                onChange={v => { setOpKey(v as OpKey); setOpValue(''); setApplyError(null); setApplySuccess(null) }}
              />
            </div>

            {opDef && opDef.inputType !== 'custom' && opDef.inputType !== 'images' && (
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1.5">
                  Value {opDef.unit ? <span className="text-foreground-muted">({opDef.unit})</span> : null}
                </label>
                {opDef.inputType === 'select' && opDef.options ? (
                  <AdminSelect value={opValue} placeholder="Select…"
                    options={opDef.options.map(o => ({ value: o.value, label: o.label }))}
                    onChange={setOpValue} />
                ) : (
                  <input type={opDef.inputType} value={opValue}
                    onChange={e => setOpValue(e.target.value)}
                    placeholder={opDef.placeholder}
                    className={inputCls} />
                )}
              </div>
            )}

            <button type="button" onClick={handleApply} disabled={!canApply}
              className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${
                opDef?.danger
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-accent-500 hover:bg-accent-600 text-white'
              } ${!canWrite ? 'hidden' : ''}`}>
              {imageJob ? 'Replacing images…' : applying ? 'Applying…' : `Apply to ${selectedIds.size} product${selectedIds.size !== 1 ? 's' : ''}`}
            </button>

            {imageJob && (
              <div className="mt-2 rounded-lg border border-border-default bg-surface p-3">
                <div className="flex items-center justify-between text-xs text-foreground-secondary mb-1.5">
                  <span>Replacing image #{imageSlot}… {imageJob.done} of {imageJob.total}{imageJob.skipped ? ` · ${imageJob.skipped} skipped` : ''}</span>
                  <span>{imageJob.total ? Math.round((imageJob.done / imageJob.total) * 100) : 0}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-surface-secondary overflow-hidden">
                  <div className="h-full bg-accent-500 transition-all" style={{ width: `${imageJob.total ? (imageJob.done / imageJob.total) * 100 : 0}%` }} />
                </div>
              </div>
            )}
          </div>

          {opKey === 'set_selling_unit' && (() => {
            const lockedCls = 'flex items-center px-3 py-2 border border-border-secondary rounded-lg bg-surface-secondary text-sm'
            return (
              <div className="bg-surface border border-border-default rounded-lg p-3 space-y-3">
                {/* Row 1: Dimension / Unit / Factor / Label */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                  <div>
                    <label className="block text-[10px] text-foreground-muted mb-0.5">Dimension</label>
                    <AdminSelect
                      value={suDimension}
                      options={ALL_DIMENSIONS.map(d => ({ value: d, label: DIMENSION_LABEL[d] }))}
                      onChange={v => handleSuDimensionChange(v as Dimension)}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] text-foreground-muted mb-0.5">Unit name *</label>
                    {suIsCustom ? (
                      <div className="flex gap-1">
                        <input
                          autoFocus
                          value={suUnit}
                          onChange={e => setSuUnit(e.target.value)}
                          placeholder="e.g. carton"
                          className={`${inputCls} flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() => { setSuIsCustom(false); setSuUnit(''); setSuFactor('') }}
                          className="px-2 text-[10px] text-foreground-muted hover:text-foreground border border-border-secondary rounded shrink-0"
                          title="Pick from list"
                        >&#x25C4;</button>
                      </div>
                    ) : (
                      <AdminSelect
                        value={suUnit}
                        placeholder="— pick —"
                        options={[
                          ...suDimUnits.map(u => ({ value: u.key, label: u.label })),
                          { value: '__custom', label: 'Custom…' },
                        ]}
                        onChange={handleSuUnitChange}
                      />
                    )}
                  </div>

                  {suShowFactor ? (
                    <div>
                      <label className="block text-[10px] text-foreground-muted mb-0.5">
                        {suIsPredefined ? 'Pcs per unit (locked)' : 'Pcs per unit *'}
                      </label>
                      {suIsPredefined ? (
                        <div className={lockedCls} title="Predefined — value is fixed">
                          <span className="font-mono text-foreground">{suFactor}</span>
                          <span className="ml-2 text-[10px] text-foreground-muted">(fixed)</span>
                        </div>
                      ) : (
                        <input type="number" step="0.0001" min="0.0001" value={suFactor}
                          onChange={e => setSuFactor(e.target.value)}
                          className={inputCls} placeholder="e.g. 12" />
                      )}
                    </div>
                  ) : (
                    <div className="invisible" aria-hidden />
                  )}

                  <div>
                    <label className="block text-[10px] text-foreground-muted mb-0.5">Display label</label>
                    <input value={suLabel} onChange={e => setSuLabel(e.target.value)}
                      className={inputCls} placeholder="e.g. Box of 100" />
                  </div>
                </div>

                {/* Row 2: Min / Max / Qty step */}
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="block text-[10px] text-foreground-muted mb-0.5">Min qty *</label>
                    <input type="number" step="any" min="0.000001" value={suMinQty}
                      onChange={e => setSuMinQty(e.target.value)}
                      className={inputCls} placeholder="1" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-foreground-muted mb-0.5">Max qty (blank = unlimited)</label>
                    <input type="number" step="any" min="0.000001" value={suMaxQty}
                      onChange={e => setSuMaxQty(e.target.value)}
                      className={inputCls} placeholder="e.g. 50" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-foreground-muted mb-0.5">
                      {suDimension === 'count' ? 'Qty step (locked to 1)' : 'Qty step *'}
                    </label>
                    {suDimension === 'count' ? (
                      <div className={lockedCls}>
                        <span className="font-mono text-foreground">1</span>
                        <span className="ml-2 text-[10px] text-foreground-muted">(fixed)</span>
                      </div>
                    ) : (
                      <input type="number" step="any" min="0.000001" value={suQtyStep}
                        onChange={e => setSuQtyStep(e.target.value)}
                        className={inputCls} placeholder="e.g. 0.25" />
                    )}
                  </div>
                </div>

                {/* Custom measurement panel (non-count custom units only) */}
                {suIsCustom && suDimension !== 'count' && (
                  <div className="border border-dashed border-border-secondary rounded p-2 space-y-1">
                    <p className="text-[10px] text-foreground-muted uppercase tracking-wide">Measurements</p>
                    <div className="grid grid-cols-4 gap-2 items-end">
                      <div>
                        <label className="block text-[10px] text-foreground-muted mb-0.5">Unit</label>
                        <AdminSelect
                          value={suCustomDimUnit}
                          options={suCustomMeasureUnits.map(u => ({ value: u.key, label: u.label }))}
                          onChange={v => setSuCustomDimUnit(v)}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-foreground-muted mb-0.5">
                          {suDimension === 'weight' ? 'Weight *' : 'Length *'}
                        </label>
                        <input type="number" step="0.001" min="0.001" value={suCustomLength}
                          onChange={e => setSuCustomLength(e.target.value)}
                          className={inputCls} placeholder="e.g. 3" />
                      </div>
                      {(suDimension === 'area' || suDimension === 'volume') && (
                        <div>
                          <label className="block text-[10px] text-foreground-muted mb-0.5">Width *</label>
                          <input type="number" step="0.001" min="0.001" value={suCustomWidth}
                            onChange={e => setSuCustomWidth(e.target.value)}
                            className={inputCls} placeholder="e.g. 2" />
                        </div>
                      )}
                      {suDimension === 'volume' && (
                        <div>
                          <label className="block text-[10px] text-foreground-muted mb-0.5">Height *</label>
                          <input type="number" step="0.001" min="0.001" value={suCustomHeight}
                            onChange={e => setSuCustomHeight(e.target.value)}
                            className={inputCls} placeholder="e.g. 1" />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Custom factor preview */}
                {suCustomPreview && (
                  <p className="text-[11px] text-accent-600 font-medium">
                    1 {suUnit || 'unit'} = {suCustomPreview.factor.toLocaleString('en-IN', { maximumFractionDigits: 4 })} {suCustomPreview.label}
                  </p>
                )}

                {/* Inherit toggle */}
                <div className="flex items-center gap-3 pt-1 border-t border-border-default">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={inheritToVariants} onChange={e => setInheritToVariants(e.target.checked)}
                      className="w-4 h-4 accent-accent-500 rounded" />
                    <span className="text-sm text-foreground">Inherit to all active variants</span>
                  </label>
                  <span className="text-xs text-foreground-muted">
                    {inheritToVariants ? 'Unit row upserted on product + all active variants' : 'Product-level only'}
                  </span>
                </div>
              </div>
            )
          })()}

          {/* set_images — slot selector + single-image picker */}
          {opKey === 'set_images' && (
            <div className="bg-surface border border-border-default rounded-lg p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-3 items-start">
                {/* Which image slot to replace */}
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1.5">Replace image #</label>
                  <AdminSelect
                    value={imageSlot}
                    options={Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: `Image ${i + 1}${i === 0 ? ' (primary)' : ''}` }))}
                    onChange={setImageSlot}
                  />
                  <p className="text-[10px] text-foreground-muted mt-1">Products without this slot are skipped.</p>
                </div>

                {/* Picker / preview */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium text-foreground-secondary">New image</label>
                    {/* Source toggle: Upload / Gallery */}
                    <div className="inline-flex rounded-md border border-border-secondary overflow-hidden text-xs">
                      <button type="button" onClick={() => setImageSource('upload')}
                        className={`px-2.5 py-1 ${imageSource === 'upload' ? 'bg-accent-500 text-white' : 'bg-surface text-foreground-secondary hover:bg-surface-secondary'}`}>Upload</button>
                      <button type="button" onClick={() => setImageSource('gallery')}
                        className={`px-2.5 py-1 border-l border-border-secondary ${imageSource === 'gallery' ? 'bg-accent-500 text-white' : 'bg-surface text-foreground-secondary hover:bg-surface-secondary'}`}>Gallery</button>
                    </div>
                  </div>

                  {/* Selected preview (shared for both sources) */}
                  {(imageSource === 'upload' && imageFile) || (imageSource === 'gallery' && selectedGallery) ? (
                    <div className="flex items-center gap-3">
                      <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-border-default shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imageSource === 'upload' && imageFile ? URL.createObjectURL(imageFile) : (selectedGallery!.thumbnail_url || selectedGallery!.image_url)}
                          alt={imageSource === 'upload' && imageFile ? imageFile.name : selectedGallery!.file_name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-foreground truncate">{imageSource === 'upload' && imageFile ? imageFile.name : selectedGallery!.file_name}</p>
                        <p className="text-xs text-foreground-muted">{imageSource === 'upload' ? 'Uploaded file' : 'From gallery'}</p>
                        <button type="button" onClick={() => { if (imageSource === 'upload') setImageFile(null); else setSelectedGallery(null) }} className="text-xs text-red-500 hover:underline mt-0.5">Remove</button>
                      </div>
                    </div>
                  ) : imageSource === 'upload' ? (
                    <>
                      <label
                        htmlFor="bulk-image-input"
                        className="flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-border-secondary rounded-lg py-6 px-4 cursor-pointer hover:border-accent-500 transition-colors text-center"
                      >
                        <svg className="w-6 h-6 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-sm text-foreground font-medium">Click to add an image</span>
                        <span className="text-xs text-foreground-muted">JPEG · PNG · WebP · up to 5MB</span>
                      </label>
                      <input
                        id="bulk-image-input" type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                        onChange={e => { pickImageFile(e.target.files); e.target.value = '' }}
                      />
                    </>
                  ) : (
                    <button type="button" onClick={() => setGalleryOpen(true)}
                      className="flex flex-col items-center justify-center gap-1.5 w-full border-2 border-dashed border-border-secondary rounded-lg py-6 px-4 hover:border-accent-500 transition-colors text-center">
                      <svg className="w-6 h-6 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm2 10l3.5-4.5 2.5 3 3.5-4.5L20 16" />
                      </svg>
                      <span className="text-sm text-foreground font-medium">Choose from gallery</span>
                      <span className="text-xs text-foreground-muted">Reuse an existing uploaded image</span>
                    </button>
                  )}
                </div>
              </div>

              {imageError && <p className="text-xs text-red-500">{imageError}</p>}

              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1.5">Alt text <span className="text-foreground-muted">(optional)</span></label>
                <input type="text" value={imageAlt} onChange={e => setImageAlt(e.target.value)} placeholder="Describes the image for accessibility & SEO" className={inputCls} />
              </div>

              <p className="text-xs text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 rounded p-2.5 border border-orange-200 dark:border-orange-800">
                Replaces image #{imageSlot} on the selected products with this image{imageSlot === '1' ? ' and makes it the primary image' : ''}. Other images are untouched. Undoable from History.
              </p>

              {/* Gallery picker — shared component, single-select */}
              {galleryOpen && (
                <GalleryPicker
                  mode="single"
                  onClose={() => setGalleryOpen(false)}
                  onConfirm={imgs => {
                    const g = imgs[0]
                    if (g) setSelectedGallery({ id: g.id, thumbnail_url: g.thumbnail_url, image_url: g.image_url, file_name: g.custom_name || g.file_name })
                    setGalleryOpen(false)
                  }}
                />
              )}
            </div>
          )}

          {/* operation hint */}
          {opKey === 'inflate_price' && (
            <p className="text-xs text-foreground-muted bg-surface rounded p-2.5 border border-border-default">
              Increases MRP (Ex-GST) by the given %, then recalculates MRP incl. GST, selling price (Ex-GST), and selling price incl. GST using each product&apos;s existing discount % and GST rate.
            </p>
          )}
          {opKey === 'set_discount' && (
            <p className="text-xs text-foreground-muted bg-surface rounded p-2.5 border border-border-default">
              Sets the discount % and recalculates selling prices from the existing MRP (Ex-GST).
            </p>
          )}
          {opKey === 'set_mrp_ex_gst' && (
            <p className="text-xs text-foreground-muted bg-surface rounded p-2.5 border border-border-default">
              Sets a flat MRP (Ex-GST) for all selected products and recalculates all derived prices. Use for products with a fixed price.
            </p>
          )}

          {applyError && <p className="text-sm text-red-600 dark:text-red-400">{applyError}</p>}
          {applySuccess && (
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-sm text-green-600 dark:text-green-400 font-medium flex-1">{applySuccess}</p>
              {lastLogId && lastLogLabel && canWrite && (
                <button
                  type="button"
                  onClick={() => handleRollback(lastLogId, lastLogLabel)}
                  disabled={rollingBack}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 text-xs font-medium hover:bg-orange-100 dark:hover:bg-orange-900/30 disabled:opacity-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                  {rollingBack ? 'Undoing…' : 'Undo'}
                </button>
              )}
            </div>
          )}
          {rollbackError && <p className="text-sm text-red-600 dark:text-red-400">{rollbackError}</p>}
          </div>
        </section>
      )}

      {Object.keys(activeFilters).length > 0 && !loading && products.length === 0 && (
        <p className="text-sm text-foreground-muted bg-surface-elevated border border-border-default rounded-lg px-4 py-3">
          No active products match the current filters.
        </p>
      )}

      {Object.keys(activeFilters).length === 0 && (
        <div className="bg-surface-elevated border border-border-default rounded-lg px-4 py-6 text-center">
          <p className="text-sm text-foreground-muted">Add one or more filters above to load products.</p>
          <p className="text-xs text-foreground-muted mt-1">Example: filter by <strong>Grade = 12.9</strong>, select all, then apply <strong>Inflate Price +5%</strong>.</p>
        </div>
      )}

      {/* ── Operation History ─────────────────────────────────────────────── */}
      <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default bg-surface">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-surface-secondary text-foreground-secondary text-xs font-bold shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </span>
            <h2 className="text-sm font-semibold text-foreground">Operation History</h2>
          </div>
          <button type="button" onClick={loadLogs} disabled={logsLoading}
            className="text-xs text-foreground-muted hover:text-foreground disabled:opacity-50 transition-colors">
            {logsLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {logsLoading && logs.length === 0 ? (
          <p className="px-4 py-3 text-sm text-foreground-muted">Loading…</p>
        ) : logs.length === 0 ? (
          <p className="px-4 py-3 text-sm text-foreground-muted">No operations recorded yet.</p>
        ) : (() => {
          const totalPages = Math.ceil(logs.length / LOGS_PER_PAGE)
          const pageLogs = logs.slice(logsPage * LOGS_PER_PAGE, (logsPage + 1) * LOGS_PER_PAGE)
          return (
            <>
              <div className="divide-y divide-border-default">
                {pageLogs.map(log => {
                  const opLabel = OPERATIONS.find(o => o.key === log.operation)?.label ?? log.operation
                  // Human-readable value: strings shown as-is; the selling-unit object
                  // is summarised (e.g. "set (×5)"); other objects are skipped.
                  let valueStr: string | null = null
                  if (log.value != null) {
                    if (typeof log.value === 'object') {
                      const v = log.value as any
                      if (v.unit) valueStr = `${v.unit}${v.factor ? ` (×${v.factor})` : ''}`
                      else if (v.slot != null) valueStr = `image #${v.slot}`
                    } else {
                      valueStr = String(log.value)
                    }
                  }
                  const isExpanded = expandedLogId === log.id
                  // Normalise both snapshot shapes for display.
                  const snap = log.snapshot
                  const productRows: SnapRow[] = Array.isArray(snap) ? snap : (snap?.products ?? [])
                  const variantCount = Array.isArray(snap) ? 0 : (snap?.variants?.length ?? 0)
                  const subCount = Array.isArray(snap) ? 0 : (snap?.subs?.length ?? 0)
                  const unitCount = Array.isArray(snap) ? 0 : (snap?.variantUnits?.length ?? 0)
                  const childSummary = [
                    variantCount ? `${variantCount} variant${variantCount !== 1 ? 's' : ''}` : null,
                    subCount ? `${subCount} sub-variant${subCount !== 1 ? 's' : ''}` : null,
                    unitCount ? `${unitCount} variant unit${unitCount !== 1 ? 's' : ''}` : null,
                  ].filter(Boolean).join(', ')
                  return (
                    <div key={log.id} className={log.rolled_back_at ? 'opacity-50' : ''}>
                      <button
                        type="button"
                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface transition-colors"
                      >
                        <svg className={`w-3.5 h-3.5 shrink-0 text-foreground-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground">
                            {opLabel}{valueStr ? <span className="text-foreground-muted ml-1">— {valueStr}</span> : null}
                          </p>
                          <p className="text-xs text-foreground-muted mt-0.5">
                            {log.product_count} product{log.product_count !== 1 ? 's' : ''}
                            {childSummary ? ` (+ ${childSummary})` : ''}
                            {log.applied_by ? ` · ${log.applied_by}` : ''}
                            {' · '}{new Date(log.applied_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                            {log.rolled_back_at ? ' · Rolled back' : ''}
                          </p>
                        </div>
                        {!log.rolled_back_at && canWrite && (
                          <span
                            role="button"
                            onClick={e => { e.stopPropagation(); handleRollback(log.id, opLabel) }}
                            className="shrink-0 px-2.5 py-1 rounded border border-border-secondary text-xs text-foreground-secondary hover:border-red-400 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
                          >
                            Rollback
                          </span>
                        )}
                      </button>

                      {isExpanded && productRows.length > 0 && (
                        <div className="px-4 pb-3 space-y-1 bg-surface">
                          {productRows.map(row => (
                            <div key={row.id} className="text-xs border border-border-default rounded p-2 space-y-0.5">
                              <p className="font-medium text-foreground">{row.name || row.id}</p>
                              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-foreground-muted">
                                {Object.entries(row.before).map(([k, v]) => (
                                  <span key={k}><span className="text-foreground-secondary">{k}:</span> {v == null ? '—' : String(v)}</span>
                                ))}
                              </div>
                            </div>
                          ))}
                          {childSummary && (
                            <p className="text-[11px] text-foreground-muted pt-1">
                              Rollback also restores {childSummary}.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-2 border-t border-border-default bg-surface">
                  <button
                    type="button"
                    onClick={() => setLogsPage(p => p - 1)}
                    disabled={logsPage === 0}
                    className="text-xs text-foreground-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    Prev
                  </button>
                  <span className="text-xs text-foreground-muted">
                    Page {logsPage + 1} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLogsPage(p => p + 1)}
                    disabled={logsPage >= totalPages - 1}
                    className="text-xs text-foreground-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  >
                    Next
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              )}
            </>
          )
        })()}
      </div>
    </div>
  )
}
