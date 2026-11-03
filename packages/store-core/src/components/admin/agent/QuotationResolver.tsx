'use client'

import { useState, useCallback, useRef } from 'react'
import { Package, CheckCircle, XCircle, HelpCircle, ChevronLeft, ChevronRight, Search, AlertTriangle } from 'lucide-react'
import AdminSelect from '../AdminSelect'
import CopySku from '@/components/ui/CopySku'
import { normUnit, validatePurchaseQuantity } from '@/lib/catalog/selling-unit'
import { fmtINR, fmtQty } from './format'

// Line-by-line review of a quotation request: pick the product, variant, selling unit and
// quantity, then confirm (sends __quotation_confirm__[…] to the agent).

/** factor = pieces per unit (count only); [] = sold in plain pieces. */
export interface SellUnitOption {
  unit: string
  label: string
  factor: number
  dimension: string
  minQty: number
  maxQty: number | null
  qtyStep: number
  isDefault: boolean
}

interface ResolverSubVariant {
  id: string
  name: string
  sku: string | null
  price: number
  units?: SellUnitOption[]
}
interface ResolverVariant {
  id: string
  name: string
  sku: string | null
  price: number
  subVariants?: ResolverSubVariant[]
  units?: SellUnitOption[]
}
interface ResolverCandidate {
  productId: string
  name: string
  sku: string | null
  price: number
  sim?: number
  score?: number
  imageUrl?: string | null
  variants?: ResolverVariant[]
  units?: SellUnitOption[]
}
interface ResolverLine {
  requestedText: string
  qty: number
  requestedUnit?: string | null
  status: 'matched' | 'ambiguous' | 'unmatched'
  candidates: ResolverCandidate[]
}
export interface QuotationResolverBlock {
  type: 'quotation_resolver'
  lines: ResolverLine[]
  counts: { matched: number; ambiguous: number; unmatched: number }
}

interface Confirmed {
  productId: string
  variantId?: string
  subVariantId?: string
  name: string
  price: number
  sku: string | null
  imageUrl?: string | null
  qty: number
  unit: SellUnitOption | null
}

export interface QuotationConfirmItem {
  productId?: string
  variantId?: string
  subVariantId?: string
  quantity: number
  buyUnit?: string
  skipped?: boolean
  requestedText?: string
}

const EPS = 1e-6
const round6 = (n: number) => Math.round(n * 1e6) / 1e6
const stepOf = (u: SellUnitOption) => (u.qtyStep > 0 ? u.qtyStep : 1)
const isCount = (u: SellUnitOption) => u.dimension === 'count' && u.factor > 1

function normUnits(list: unknown): SellUnitOption[] {
  if (!Array.isArray(list)) return []
  return list
    .filter(u => u && typeof u.unit === 'string' && u.unit)
    .map(u => ({
      unit: u.unit,
      label: u.label || u.unit,
      factor: Number(u.factor) > 0 ? Number(u.factor) : 1,
      dimension: u.dimension || 'count',
      minQty: Number(u.minQty) || 0,
      maxQty: u.maxQty == null || u.maxQty === '' ? null : Number(u.maxQty),
      qtyStep: Number(u.qtyStep) > 0 ? Number(u.qtyStep) : 1,
      isDefault: !!u.isDefault,
    }))
}

const canonUnit = normUnit
const unitMatches = (u: SellUnitOption, want: string) => canonUnit(u.unit) === want || canonUnit(u.label) === want
/** The unit the customer wrote, for display ('pcs' for pieces). */
const askedUnit = (w: string | null | undefined) => (!w || canonUnit(w) === 'pc' ? 'pcs' : w)

/** Rounds up to the unit's step, then into its min/max. */
function snap(qty: number, u: SellUnitOption): number {
  const step = stepOf(u)
  let q = round6(Math.ceil(round6(qty / step) - EPS) * step)
  if (q < u.minQty) q = u.minQty
  if (u.maxQty != null && q > u.maxQty) q = u.maxQty
  return q
}

/** Starting unit and quantity: the requested unit when the line sells in it, otherwise qty is pieces converted to the selling unit. */
function initialQty(line: ResolverLine, units: SellUnitOption[]): { unit: string | null; qty: number; note: string | null } {
  const requested = Number(line.qty) || 0
  if (!units.length) return { unit: null, qty: requested, note: null }
  const want = line.requestedUnit ? canonUnit(line.requestedUnit) : ''
  const hit = want ? units.find(u => unitMatches(u, want)) : undefined
  if (hit) return { unit: hit.unit, qty: requested, note: null }
  // Pieces: a 1-pc unit takes them as is, else they convert to the default unit.
  const piece = !want || want === 'pc' ? units.find(x => x.dimension === 'count' && x.factor === 1) : undefined
  const u = piece ?? units.find(x => x.isDefault) ?? units[0]
  const qty = snap(isCount(u) ? requested / u.factor : requested, u)
  const asked = `${fmtQty(requested)} ${askedUnit(line.requestedUnit)} requested`
  let note: string | null = null
  if (isCount(u)) {
    const pcs = round6(qty * u.factor)
    if (Math.abs(pcs - requested) > EPS) note = `${asked} → ${fmtQty(qty)} ${u.label} = ${fmtQty(pcs)} pcs`
  } else if (Math.abs(qty - requested) > EPS) note = `${asked} → ${fmtQty(qty)} ${u.label}`
  return { unit: u.unit, qty, note }
}

function qtyError(raw: string, u: SellUnitOption | null): string | null {
  if (!raw.trim()) return 'Enter a quantity.'
  const qty = Number(raw)
  if (!u) return Number.isFinite(qty) && qty > 0 ? null : 'Quantity must be greater than zero.'
  const r = validatePurchaseQuantity(qty, {
    unit: u.label,
    factor: u.factor,
    dimension: u.dimension,
    qty_step: stepOf(u),
    min_qty: u.minQty,
    max_qty: u.maxQty,
  })
  return r.ok ? null : r.reason || 'Invalid quantity.'
}

const unitOptionLabel = (u: SellUnitOption) => (isCount(u) ? `${u.label} (${fmtQty(u.factor)} pcs)` : u.label)

function qtyLabel(qty: number, u: SellUnitOption | null): string {
  if (!u) return `${fmtQty(qty)} pcs`
  return `${fmtQty(qty)} ${u.label}${isCount(u) ? ` = ${fmtQty(round6(qty * u.factor))} pcs` : ''}`
}

type ManualPickResult = ResolverCandidate

function ProductSearchPicker({ onPick }: { onPick: (p: ManualPickResult) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ManualPickResult[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}&limit=8`)
        const json = await res.json()
        const products = (Array.isArray(json) ? json : json.products || json.results || []) as Array<{
          id: string
          name: string
          sku?: string | null
          base_price?: number
          price?: number
          image_url?: string | null
          thumbnail_url?: string | null
        }>
        setResults(
          products.map(p => ({
            productId: p.id,
            name: p.name,
            sku: p.sku ?? null,
            price: p.price ?? p.base_price ?? 0,
            imageUrl: p.thumbnail_url || p.image_url || null,
          }))
        )
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [])

  return (
    <div className="mt-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted pointer-events-none" />
        <input
          type="text"
          value={query}
          placeholder="Search product catalog…"
          onChange={e => {
            setQuery(e.target.value)
            search(e.target.value)
          }}
          className="w-full rounded-md border border-border-default bg-surface pl-7 pr-2 h-control-sm text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-accent-500"
        />
      </div>
      {loading && <p className="text-[10px] text-foreground-muted mt-1">Searching…</p>}
      {results.length > 0 && (
        <div className="mt-1 rounded-md border border-border-default divide-y divide-border-default overflow-hidden">
          {results.map(p => (
            <button
              key={p.productId}
              type="button"
              onClick={() => {
                onPick(p)
                setQuery('')
                setResults([])
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-surface-secondary text-left"
            >
              <Thumb src={p.imageUrl} size="w-8 h-8" icon="w-3.5 h-3.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                {p.sku && (
                  <p className="text-[10px] text-foreground-muted font-mono">
                    <span className="inline-flex items-center gap-1">
                      {p.sku}
                      <CopySku sku={p.sku} />
                    </span>
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Thumb({ src, size, icon }: { src?: string | null; size: string; icon: string }) {
  return src ? (
    <img
      src={src}
      alt=""
      className={`${size} rounded object-cover shrink-0`}
      onError={e => {
        ;(e.target as HTMLImageElement).style.display = 'none'
      }}
    />
  ) : (
    <div className={`${size} rounded bg-surface-secondary flex items-center justify-center shrink-0`}>
      <Package className={`${icon} text-foreground-muted`} />
    </div>
  )
}

export default function QuotationResolver({
  block,
  onSendMessage,
}: {
  block: QuotationResolverBlock
  onSendMessage?: (msg: string) => void
}) {
  const lines = Array.isArray(block.lines) ? block.lines : []
  const counts = block.counts || { matched: 0, ambiguous: 0, unmatched: 0 }

  const [cardIndex, setCardIndex] = useState(0)
  const [candidateIndex, setCandidateIndex] = useState<Record<number, number>>({})
  const [confirmedByLine, setConfirmedByLine] = useState<Record<number, Confirmed>>({})
  const [variantSel, setVariantSel] = useState<Record<string, string>>({})
  const [subVariantSel, setSubVariantSel] = useState<Record<string, string>>({})
  // Unit + typed quantity per line and product/variant/sub-variant scope.
  const [qtySel, setQtySel] = useState<Record<string, { unit: string | null; qty: string }>>({})
  // manualPick[lineIdx] = manually searched product (overrides candidates)
  const [manualPick, setManualPick] = useState<Record<number, ManualPickResult>>({})
  const [showSearch, setShowSearch] = useState<Record<number, boolean>>({})
  const [skippedLines, setSkippedLines] = useState<Record<number, boolean>>({})

  /** The product, variant, sub-variant, unit and quantity currently chosen for a line. */
  function scopeOf(i: number) {
    const line = lines[i]
    const cidx = candidateIndex[i] ?? 0
    const manPick = manualPick[i]
    const candidate: ResolverCandidate | null = manPick ?? line.candidates[cidx] ?? null
    const vKey = `${i}-${cidx}`
    const variants = candidate?.variants ?? []
    const variant = variants.find(v => v.id === variantSel[vKey]) ?? variants[0]
    const subVariants = variant?.subVariants ?? []
    const subVariant = subVariants.find(sv => sv.id === subVariantSel[vKey]) ?? subVariants[0]
    const units = normUnits(subVariant?.units ?? variant?.units ?? candidate?.units)
    const key = `${i}|${candidate?.productId ?? ''}|${variant?.id ?? ''}|${subVariant?.id ?? ''}`
    const init = initialQty(line, units)
    const sel = qtySel[key]
    const unit = units.find(u => u.unit === (sel ? sel.unit : init.unit)) ?? null
    const qtyStr = sel ? sel.qty : String(init.qty)
    const untouched = !sel || (sel.unit === init.unit && Number(sel.qty) === init.qty)
    return {
      line,
      cidx,
      manPick,
      candidate,
      vKey,
      variants,
      variant,
      subVariants,
      subVariant,
      units,
      unit,
      key,
      qtyStr,
      qty: Number(qtyStr),
      error: qtyError(qtyStr, unit),
      note: untouched ? init.note : null,
      price: subVariant?.price ?? variant?.price ?? candidate?.price ?? 0,
      sku: subVariant?.sku ?? variant?.sku ?? candidate?.sku ?? null,
    }
  }
  type Scope = ReturnType<typeof scopeOf>

  const isReview = (l: ResolverLine) => l.status === 'ambiguous' || l.status === 'unmatched'
  const needsReviewCount = lines.filter(l => l.status === 'ambiguous').length
  const resolvedCount = lines.filter((l, i) => isReview(l) && (confirmedByLine[i] !== undefined || skippedLines[i])).length
  const allPicked = lines.every((l, i) => l.status !== 'ambiguous' || !!confirmedByLine[i] || !!skippedLines[i])
  const qtyIssues = lines.map((l, i) => (l.status === 'matched' && l.candidates[0] && scopeOf(i).error ? i : -1)).filter(i => i >= 0)
  const rounded = lines.map((l, i) => (l.status === 'matched' && l.candidates[0] && scopeOf(i).note ? i : -1)).filter(i => i >= 0)
  const canCreate = allPicked && qtyIssues.length === 0

  function itemFrom(s: Scope, extra: { requestedText: string }): QuotationConfirmItem {
    return {
      productId: s.candidate!.productId,
      variantId: s.variant?.id,
      subVariantId: s.subVariant?.id,
      quantity: s.qty,
      ...(s.unit ? { buyUnit: s.unit.unit } : {}),
      requestedText: extra.requestedText,
    }
  }

  function submitQuotation() {
    const items = lines
      .map((l, i): QuotationConfirmItem | null => {
        if (l.status === 'matched' && l.candidates[0]) return itemFrom(scopeOf(i), l)
        const c = confirmedByLine[i]
        if (c) {
          return {
            productId: c.productId,
            variantId: c.variantId,
            subVariantId: c.subVariantId,
            quantity: c.qty,
            ...(c.unit ? { buyUnit: c.unit.unit } : {}),
            requestedText: l.requestedText,
          }
        }
        if (skippedLines[i]) return { skipped: true, requestedText: l.requestedText, quantity: l.qty }
        return null
      })
      .filter((x): x is QuotationConfirmItem => !!x)
    if (!items.length) return
    onSendMessage?.(`__quotation_confirm__${JSON.stringify(items)}`)
  }

  const scoreColor = (score: number) =>
    score >= 80
      ? 'text-green-600 dark:text-green-400'
      : score >= 60
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-500 dark:text-red-400'

  const scoreBg = (score: number) =>
    score >= 80
      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
      : score >= 60
        ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
        : 'border-border-default'

  if (!lines[cardIndex]) return null

  const cur = scopeOf(cardIndex)
  const { line: currentLine, cidx, manPick, candidate, vKey, variants, subVariants } = cur
  const confirmed = confirmedByLine[cardIndex]
  const isAmbiguous = currentLine.status === 'ambiguous'
  const isMatched = currentLine.status === 'matched'
  const isUnmatched = currentLine.status === 'unmatched'
  const isResolved = confirmed !== undefined
  const isSkipped = !!skippedLines[cardIndex]

  const setQty = (unit: string | null, qty: string) => setQtySel(prev => ({ ...prev, [cur.key]: { unit, qty } }))

  function changeUnit(next: string) {
    const to = cur.units.find(u => u.unit === next)
    if (!to) return
    const from = cur.unit
    let qty = Number.isFinite(cur.qty) && cur.qty > 0 ? cur.qty : 1
    if (from?.dimension === 'count' && to.dimension === 'count') qty = (qty * from.factor) / to.factor
    setQty(to.unit, String(snap(qty, to)))
  }

  function nextOpen(after: number, alsoSkip?: number) {
    return lines.findIndex(
      (l, i) => i > after && isReview(l) && !confirmedByLine[i] && !skippedLines[i] && i !== alsoSkip
    )
  }

  function useCurrentCandidate() {
    if (!candidate || cur.error) return
    setConfirmedByLine(prev => ({
      ...prev,
      [cardIndex]: {
        productId: candidate.productId,
        variantId: cur.variant?.id,
        subVariantId: cur.subVariant?.id,
        name: candidate.name,
        price: cur.price,
        sku: cur.sku,
        imageUrl: candidate.imageUrl,
        qty: cur.qty,
        unit: cur.unit,
      },
    }))
    setShowSearch(prev => ({ ...prev, [cardIndex]: false }))
    const next = nextOpen(cardIndex)
    if (next >= 0) setCardIndex(next)
  }

  function handleManualPick(p: ManualPickResult) {
    setManualPick(prev => ({ ...prev, [cardIndex]: p }))
    setVariantSel(prev => {
      const n = { ...prev }
      delete n[vKey]
      return n
    })
    setSubVariantSel(prev => {
      const n = { ...prev }
      delete n[vKey]
      return n
    })
    setShowSearch(prev => ({ ...prev, [cardIndex]: false }))
  }

  function lineDot(l: ResolverLine, i: number) {
    if (l.status === 'matched') return qtyIssues.includes(i) ? 'bg-red-400' : 'bg-green-500'
    if (skippedLines[i]) return 'bg-slate-400 dark:bg-slate-500'
    if (l.status === 'unmatched' && !confirmedByLine[i]) return 'bg-red-400'
    if (confirmedByLine[i]) return 'bg-accent-500'
    return 'bg-amber-400'
  }

  const jump = (list: number[]) =>
    list.map((i, k) => (
      <button key={i} type="button" onClick={() => setCardIndex(i)} className="underline decoration-dotted underline-offset-2 hover:decoration-solid">
        {k > 0 ? ', ' : ''}item {i + 1}
      </button>
    ))

  return (
    <div className="rounded-lg border border-border-default overflow-hidden text-xs">
      {/* Header */}
      <div className="px-3 py-2 bg-surface-secondary border-b border-border-default flex items-center justify-between gap-2">
        <p className="font-semibold text-foreground text-xs">
          {counts.matched} matched · {needsReviewCount} need review · {counts.unmatched} not found
          {needsReviewCount > 0 && (
            <span className="ml-2 text-foreground-muted font-normal">
              ({resolvedCount}/{needsReviewCount} resolved)
            </span>
          )}
        </p>
        {allPicked && (counts.matched > 0 || resolvedCount > 0) && (
          <button
            type="button"
            onClick={submitQuotation}
            disabled={!canCreate}
            title={canCreate ? undefined : 'Fix the highlighted quantities first'}
            className="px-2.5 h-control-sm rounded bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:hover:bg-accent-500 text-white font-semibold shrink-0 text-xs"
          >
            Create quotation
          </button>
        )}
      </div>

      {(qtyIssues.length > 0 || rounded.length > 0) && (
        <div className="px-3 py-1.5 border-b border-border-default space-y-0.5 text-[10px]">
          {qtyIssues.length > 0 && <p className="text-red-600 dark:text-red-400">Check the quantity on {jump(qtyIssues)}</p>}
          {rounded.length > 0 && <p className="text-amber-700 dark:text-amber-400">Rounded to the selling unit: {jump(rounded)}</p>}
        </div>
      )}

      {/* Dot strip */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border-default overflow-x-auto">
        {lines.map((l, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setCardIndex(i)}
            title={`${i + 1}. ${l.requestedText}`}
            className={`w-2 h-2 rounded-full shrink-0 transition-all ${lineDot(l, i)} ${
              i === cardIndex ? 'ring-2 ring-offset-1 ring-foreground-muted scale-125' : 'opacity-60 hover:opacity-100'
            }`}
          />
        ))}
      </div>

      {/* Card */}
      <div className="p-3">
        {/* Card header: item nav + admin input */}
        <div className="flex items-center gap-2 mb-3">
          <button
            type="button"
            disabled={cardIndex === 0}
            onClick={() => setCardIndex(c => c - 1)}
            className="p-0.5 rounded hover:bg-surface-secondary disabled:opacity-30 shrink-0"
            aria-label="Previous item"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {isMatched && <CheckCircle className="w-3.5 h-3.5 text-green-600 dark:text-green-400 shrink-0" />}
              {isAmbiguous && !isResolved && !isSkipped && <HelpCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
              {(isAmbiguous || isUnmatched) && isResolved && <CheckCircle className="w-3.5 h-3.5 text-accent-500 shrink-0" />}
              {isUnmatched && !isResolved && !isSkipped && <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
              {isSkipped && <span className="text-[10px] text-foreground-muted font-medium shrink-0">skipped</span>}
              <span className="font-medium text-foreground truncate">{currentLine.requestedText}</span>
              <span className="text-foreground-muted shrink-0 tabular-nums">
                × {fmtQty(currentLine.qty)}
                {currentLine.requestedUnit ? ` ${askedUnit(currentLine.requestedUnit)}` : ''}
              </span>
            </div>
            <p className="text-[10px] text-foreground-muted mt-0.5">
              Item {cardIndex + 1} of {lines.length}
            </p>
          </div>

          <button
            type="button"
            disabled={cardIndex === lines.length - 1}
            onClick={() => setCardIndex(c => c + 1)}
            className="p-0.5 rounded hover:bg-surface-secondary disabled:opacity-30 shrink-0"
            aria-label="Next item"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Resolved — show locked choice */}
        {isResolved && (
          <div className="rounded-lg border border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/10 p-2">
            <div className="flex gap-2.5">
              <Thumb src={confirmed.imageUrl} size="w-12 h-12" icon="w-5 h-5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground truncate">{confirmed.name}</p>
                <p className="text-[10px] font-mono text-foreground-muted">
                  <span className="inline-flex items-center gap-1">
                    {confirmed.sku || '—'}
                    {confirmed.sku && <CopySku sku={confirmed.sku} />}
                  </span>{' '}
                  · {fmtINR(confirmed.price)}
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-foreground tabular-nums">{qtyLabel(confirmed.qty, confirmed.unit)}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setConfirmedByLine(prev => {
                    const n = { ...prev }
                    delete n[cardIndex]
                    return n
                  })
                  setManualPick(prev => {
                    const n = { ...prev }
                    delete n[cardIndex]
                    return n
                  })
                }}
                className="text-[10px] text-foreground-muted underline shrink-0 self-start"
              >
                change
              </button>
            </div>
          </div>
        )}

        {/* Skipped — show undo option */}
        {isSkipped && (
          <div className="rounded-lg border border-dashed border-border-secondary bg-surface-secondary p-3 flex items-center justify-between gap-2">
            <p className="text-xs text-foreground-muted">Skipped — will be added to quotation as a pending item</p>
            <button
              type="button"
              onClick={() =>
                setSkippedLines(prev => {
                  const n = { ...prev }
                  delete n[cardIndex]
                  return n
                })
              }
              className="text-xs text-accent-600 dark:text-accent-400 hover:underline shrink-0"
            >
              Undo
            </button>
          </div>
        )}

        {/* Active card (matched, ambiguous unresolved, or unmatched unresolved) */}
        {!isResolved && !isSkipped && (
          <div>
            {/* Candidate slider nav (ambiguous with multiple candidates, no manual pick) */}
            {isAmbiguous && !manPick && currentLine.candidates.length > 1 && (
              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  disabled={cidx === 0}
                  onClick={() => setCandidateIndex(prev => ({ ...prev, [cardIndex]: cidx - 1 }))}
                  className="flex items-center gap-0.5 text-[10px] text-foreground-muted hover:text-foreground disabled:opacity-30"
                >
                  <ChevronLeft className="w-3 h-3" /> Prev
                </button>
                <span className="text-[10px] text-foreground-muted">
                  {cidx + 1} / {currentLine.candidates.length} matches
                </span>
                <button
                  type="button"
                  disabled={cidx >= currentLine.candidates.length - 1}
                  onClick={() => setCandidateIndex(prev => ({ ...prev, [cardIndex]: cidx + 1 }))}
                  className="flex items-center gap-0.5 text-[10px] text-foreground-muted hover:text-foreground disabled:opacity-30"
                >
                  Next <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Product card — shown for matched/ambiguous when candidate exists */}
            {candidate ? (
              <div className={`rounded-lg border p-2 ${isMatched ? scoreBg(candidate.score ?? 0) : 'border-border-default'}`}>
                <div className="flex gap-2.5 mb-2">
                  <Thumb src={candidate.imageUrl} size="w-14 h-14" icon="w-6 h-6" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <p className="font-semibold text-foreground leading-snug text-sm">{candidate.name}</p>
                      {!manPick && candidate.score != null && (
                        <span className={`font-bold tabular-nums shrink-0 text-sm ${scoreColor(candidate.score)}`}>{candidate.score}</span>
                      )}
                    </div>
                    <p className="text-[10px] font-mono text-foreground-muted mt-0.5">
                      {cur.sku || '—'} · {fmtINR(cur.price)}
                    </p>
                  </div>
                </div>

                {/* Variant selector */}
                {variants.length > 0 && (
                  <div className="mb-2">
                    <label className="block text-[10px] text-foreground-muted mb-1">Variant</label>
                    <AdminSelect
                      sm
                      value={cur.variant?.id ?? ''}
                      options={variants.map(v => ({
                        value: v.id,
                        label: `${v.name}${v.sku ? ` (${v.sku})` : ''} — ${fmtINR(v.price)}`,
                      }))}
                      onChange={val => {
                        setVariantSel(prev => ({ ...prev, [vKey]: val }))
                        setSubVariantSel(prev => {
                          const n = { ...prev }
                          delete n[vKey]
                          return n
                        })
                      }}
                    />
                  </div>
                )}

                {/* Sub-variant selector */}
                {subVariants.length > 0 && (
                  <div className="mb-2">
                    <label className="block text-[10px] text-foreground-muted mb-1">Sub-variant</label>
                    <AdminSelect
                      sm
                      value={cur.subVariant?.id ?? ''}
                      options={subVariants.map(sv => ({
                        value: sv.id,
                        label: `${sv.name}${sv.sku ? ` (${sv.sku})` : ''} — ${fmtINR(sv.price)}`,
                      }))}
                      onChange={val => setSubVariantSel(prev => ({ ...prev, [vKey]: val }))}
                    />
                  </div>
                )}

                <QtyField scope={cur} onQty={qty => setQty(cur.unit?.unit ?? null, qty)} onUnit={changeUnit} />

                {/* Use this / Skip this (non-matched lines) */}
                {!isMatched && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={useCurrentCandidate}
                      disabled={!!cur.error}
                      className="flex-1 h-control-sm rounded-md bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:hover:bg-accent-500 text-white font-semibold text-xs"
                    >
                      Use this
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSkippedLines(prev => ({ ...prev, [cardIndex]: true }))
                        const next = nextOpen(cardIndex, cardIndex)
                        if (next >= 0) setCardIndex(next)
                        else if (cardIndex + 1 < lines.length) setCardIndex(cardIndex + 1)
                      }}
                      className="px-3 h-control-sm rounded-md border border-border-secondary text-foreground-muted hover:text-foreground hover:border-border-default text-xs font-medium"
                    >
                      Skip
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Unmatched with no manual pick yet */
              <div className="rounded-lg border border-dashed border-border-default p-3 text-center text-foreground-muted">
                <XCircle className="w-5 h-5 mx-auto mb-1 text-red-400" />
                <p className="text-xs">No catalog match found</p>
                <p className="text-[10px] mt-0.5">Search below to add manually</p>
              </div>
            )}

            {/* Manual search toggle — available for all non-matched lines */}
            {!isMatched && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowSearch(prev => ({ ...prev, [cardIndex]: !prev[cardIndex] }))}
                  className="flex items-center gap-1 text-[10px] text-foreground-muted hover:text-foreground"
                >
                  <Search className="w-3 h-3" />
                  {showSearch[cardIndex] ? 'Hide search' : manPick ? 'Search different product' : 'Search product catalog'}
                </button>
                {showSearch[cardIndex] && <ProductSearchPicker onPick={handleManualPick} />}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function QtyField({
  scope,
  onQty,
  onUnit,
}: {
  scope: { units: SellUnitOption[]; unit: SellUnitOption | null; qtyStr: string; qty: number; error: string | null; note: string | null }
  onQty: (qty: string) => void
  onUnit: (unit: string) => void
}) {
  const { units, unit, qtyStr, qty, error, note } = scope
  const pcs = unit && isCount(unit) && !error ? round6(qty * unit.factor) : null
  return (
    <div className="mb-2">
      <label className="block text-[10px] text-foreground-muted mb-1">Quantity</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={qtyStr}
          min={unit ? unit.minQty || undefined : undefined}
          max={unit?.maxQty ?? undefined}
          step={unit ? stepOf(unit) : 'any'}
          onChange={e => onQty(e.target.value)}
          aria-invalid={!!error}
          aria-label="Quantity"
          className={`w-24 shrink-0 rounded-md border bg-surface px-2 h-control-sm text-sm tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent-500 ${
            error ? 'border-red-400 dark:border-red-500' : 'border-border-default'
          }`}
        />
        {units.length > 1 ? (
          <div className="min-w-0 flex-1">
            <AdminSelect
              sm
              value={unit?.unit ?? ''}
              options={units.map(u => ({ value: u.unit, label: unitOptionLabel(u) }))}
              onChange={onUnit}
            />
          </div>
        ) : (
          <span className="text-xs text-foreground-muted">{unit ? unitOptionLabel(unit) : 'pcs'}</span>
        )}
      </div>
      {pcs != null && !note && <p className="mt-1 text-[10px] text-foreground-muted tabular-nums">= {fmtQty(pcs)} pcs</p>}
      {note && (
        <p className="mt-1 flex items-start gap-1 text-[10px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
          <span>{note}</span>
        </p>
      )}
      {error && <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
