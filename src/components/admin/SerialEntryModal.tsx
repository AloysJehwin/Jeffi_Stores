'use client'

import { useState, useEffect, useRef, useMemo } from 'react'

export interface SerialItem {
  order_item_id: string
  product_name: string
  variant_name: string | null
  /** BASE units this line consumes — what batch allocation draws down. */
  required_qty: number
  /** Serial rows that covers: base / qty_step. Differs from required_qty
   *  whenever the grain's selling unit has qty_step != 1. */
  required_serials?: number
  qty_step?: number
  already_assigned: boolean
  /** Serials already assigned to this line (e.g. auto-recorded from a serial scan).
   *  The modal pre-fills these as selected and treats them as VALID even if the
   *  in-stock availability query no longer returns them (a reserved serial). The
   *  operator can still untick/swap them (editable). Only the delta is collected. */
  preassigned?: string[]
  // optional — used to fetch available serials
  product_id?: string
  variant_id?: string | null
  sub_variant_id?: string | null
}

export interface SerialAssignment {
  order_item_id: string
  serial_number: string
}

/** Serial rows a line needs. Falls back to base units for callers that predate
 *  required_serials, where qty_step is 1 and the two are equal. */
function serialsNeeded(item: SerialItem): number {
  return item.required_serials ?? item.required_qty
}

interface AvailableSerial {
  serial_number: string
  batch_id: string | null
  lot_number: string | null
}

interface Props {
  items: SerialItem[]
  onConfirm: (assignments: SerialAssignment[]) => void
  onCancel: () => void
}

export function SerialPicker({
  item,
  selected,
  onChange,
  scanEnabled = true,
  autoFill = true,
}: {
  item: SerialItem
  selected: Set<string>
  onChange: (next: Set<string>) => void
  scanEnabled?: boolean
  /** Top the line up to the required count from in-stock serials. True for the
   *  modal (pick-from-list). False inline, where padding a line with serials the
   *  operator never scanned would silently assign the wrong physical units. */
  autoFill?: boolean
}) {
  const [available, setAvailable] = useState<AvailableSerial[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set())
  const [scanMsg, setScanMsg] = useState<{ text: string; kind: 'ok' | 'err' | 'info' } | null>(null)

  useEffect(() => {
    if (!item.product_id) return
    setLoading(true)
    const params = new URLSearchParams({ product_id: item.product_id })
    if (item.variant_id) params.set('variant_id', item.variant_id)
    if (item.sub_variant_id) params.set('sub_variant_id', item.sub_variant_id)
    fetch(`/api/admin/inventory/serials/available?${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const list: AvailableSerial[] = data.serials || []
        setAvailable(list)
        // Keep any pre-assigned serials already in `selected` (seeded by the parent
        // from a scan), then auto-fill the REMAINING delta from the in-stock list —
        // skipping serials already selected. Never exceed the required count.
        if (!autoFill) return
        const keep = new Set(selected)
        for (const s of list) {
          if (keep.size >= serialsNeeded(item)) break
          if (!keep.has(s.serial_number)) keep.add(s.serial_number)
        }
        onChange(keep)
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.product_id, item.variant_id, item.sub_variant_id])

  function toggle(sn: string) {
    const next = new Set(selected)
    if (next.has(sn)) {
      next.delete(sn)
    } else {
      if (next.size >= serialsNeeded(item)) return
      next.add(sn)
    }
    onChange(next)
  }

  // ── Scan mode: N plain fields (one per required unit) ──────────────────────
  // When scan is on we render one text input per required serial. The scanner types a
  // serial into the focused field and its trailing Enter advances to the next
  // empty field (same reliable pattern as PO-receive / bootstrap — no global
  // keystroke interception, so it works with any USB/Bluetooth HID scanner).
  // Entries are validated against the available in-stock list on change; only
  // valid, unique serials flow into `selected` (which drives confirm).
  const [entries, setEntries] = useState<string[]>([])
  const fieldRefs = useRef<Record<number, HTMLInputElement | null>>({})
  // Raw per-field text as the DOM accumulates a scan burst (uncontrolled inputs).
  // We only read/validate this on the terminator, never per keystroke.
  const dirtyRef = useRef<Record<number, string>>({})
  // Bumping this key remounts the scan fields so their defaultValue resets to ''
  // (uncontrolled inputs otherwise keep stale DOM text across a mode reset).
  const [scanFieldsKey, setScanFieldsKey] = useState(0)
  // Pre-assigned serials (e.g. auto-recorded from a scan) count as VALID even if the
  // in-stock availability query no longer returns them (a reserved serial).
  const preassignedSet = useMemo(() => new Set((item.preassigned ?? []).map(s => s.toLowerCase())), [item.preassigned])
  const availSet = useMemo(
    () => new Set([...available.map(s => s.serial_number.toLowerCase()), ...preassignedSet]),
    [available, preassignedSet]
  )

  // Switching modes:
  //  • → scan: start with empty fields so the operator scans each unit fresh, and
  //    clear `selected` (a half-scanned capture must not confirm with stale picks).
  //  • → click: re-apply the auto-select-first-N so the checkbox mode isn't blank
  //    (the earlier scan-mode clear emptied `selected`).
  useEffect(() => {
    if (scanEnabled) {
      // Pre-fill the first fields with any pre-assigned serials (editable); the rest
      // are empty for the operator to scan the delta. Keeps `selected` in sync so a
      // fully-preassigned line already confirms without a re-scan.
      // Seed from what this line already holds (scanned serials arrive as
      // `preassigned`), falling back to the live selection so switching modes
      // never discards work.
      const held = (item.preassigned ?? []).length > 0 ? (item.preassigned ?? []) : Array.from(selected)
      const pre = held.slice(0, serialsNeeded(item))
      const seeded = Array.from({ length: serialsNeeded(item) }, (_, i) => pre[i] ?? '')
      setEntries(seeded)
      dirtyRef.current = {}
      setScanFieldsKey(k => k + 1) // remount fields → reset stale DOM text
      onChange(new Set(pre))
    } else if (autoFill && available.length > 0 && selected.size === 0) {
      const pre = (item.preassigned ?? []).slice(0, serialsNeeded(item))
      const autoSelected = new Set(pre)
      for (const s of available) {
        if (autoSelected.size >= serialsNeeded(item)) break
        autoSelected.add(s.serial_number)
      }
      onChange(autoSelected)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanEnabled, item.required_serials, item.required_qty, available.length])

  // Put the cursor in the first field once scan mode is active and serials loaded,
  // so the operator can scan immediately without clicking.
  useEffect(() => {
    if (!scanEnabled || loading || available.length === 0) return
    const el = fieldRefs.current[0]
    if (el) el.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanEnabled, loading, available.length])

  // Sync valid+unique entries into `selected` so confirm sees them.
  function commitEntries(next: string[]) {
    setEntries(next)
    const seen = new Set<string>()
    const valid = new Set<string>()
    for (const raw of next) {
      const sn = raw.trim()
      if (!sn) continue
      const match = available.find(s => s.serial_number.toLowerCase() === sn.toLowerCase())
      // Accept a serial that's in stock OR already pre-assigned to this line (a
      // reserved serial may no longer be in the in-stock list but is still valid).
      const canonical = match?.serial_number ?? (item.preassigned ?? []).find(p => p.toLowerCase() === sn.toLowerCase())
      if (!canonical) continue // invalid — not in stock and not pre-assigned
      if (seen.has(canonical)) continue // duplicate
      seen.add(canonical)
      valid.add(canonical)
    }
    onChange(valid)
  }

  // Terminator/blur handler for the uncontrolled scan fields: read the field's
  // full DOM value ONCE (the whole scanned burst), write it into entries[i], and
  // run the single validation/commit. No per-keystroke work → no dropped chars.
  function commitFieldFromDom(i: number) {
    const domVal = fieldRefs.current[i]?.value ?? dirtyRef.current[i] ?? ''
    if ((entries[i] ?? '') === domVal) {
      commitEntries([...entries])
      return
    }
    const next = [...entries]
    next[i] = domVal
    delete dirtyRef.current[i]
    commitEntries(next)
  }

  function focusNextEntry(from: number) {
    for (let step = 1; step <= serialsNeeded(item); step++) {
      const idx = (from + step) % serialsNeeded(item)
      const el = fieldRefs.current[idx]
      if (el && !el.value) {
        el.focus()
        return
      }
    }
  }

  useEffect(() => {
    if (!scanMsg) return
    const t = setTimeout(() => setScanMsg(null), 2000)
    return () => clearTimeout(t)
  }, [scanMsg])

  function toggleBatch(lotKey: string) {
    setCollapsedBatches(prev => {
      const next = new Set(prev)
      if (next.has(lotKey)) next.delete(lotKey)
      else next.add(lotKey)
      return next
    })
  }

  // Group by lot_number (null lot = "No Lot"). Include any pre-assigned serial that
  // is no longer in-stock (reserved) as a pseudo-row so click mode can still show +
  // untick it — otherwise a reserved preassigned serial would be uneditable.
  const availableWithPre: AvailableSerial[] = [...available]
  for (const sn of item.preassigned ?? []) {
    if (!available.some(s => s.serial_number.toLowerCase() === sn.toLowerCase())) {
      availableWithPre.push({ serial_number: sn, batch_id: null, lot_number: null })
    }
  }
  const filtered = search
    ? availableWithPre.filter(
        s =>
          s.serial_number.toLowerCase().includes(search.toLowerCase()) ||
          (s.lot_number || '').toLowerCase().includes(search.toLowerCase())
      )
    : availableWithPre

  const batches: { lotKey: string; lotLabel: string; serials: AvailableSerial[] }[] = []
  for (const s of filtered) {
    const lotKey = s.lot_number || '__no_lot__'
    const lotLabel = s.lot_number || 'No Lot'
    const existing = batches.find(b => b.lotKey === lotKey)
    if (existing) existing.serials.push(s)
    else batches.push({ lotKey, lotLabel, serials: [s] })
  }

  const isOk = selected.size === serialsNeeded(item)
  const isOver = selected.size > serialsNeeded(item)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-foreground">
          {item.product_name}
          {item.variant_name ? ` / ${item.variant_name}` : ''}
        </p>
        <div className="flex items-center gap-2">
          {scanMsg && (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded ${
                scanMsg.kind === 'ok'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : scanMsg.kind === 'err'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-secondary-100 text-secondary-700 dark:bg-secondary-900/30 dark:text-secondary-400'
              }`}
            >
              {scanMsg.text}
            </span>
          )}
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded ${
              isOver
                ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                : isOk
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
            }`}
          >
            {selected.size} / {serialsNeeded(item)} selected
          </span>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-foreground-muted py-4 text-center">Loading serials…</div>
      ) : available.length === 0 && !(item.preassigned && item.preassigned.length > 0) ? (
        <div className="text-xs text-red-500 py-3 text-center">No in-stock serials found for this product</div>
      ) : scanEnabled ? (
        <>
          {/* Scan mode: one field per required unit. Scan a serial → its Enter jumps
              to the next empty field. Each field validates against the in-stock list. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Array.from({ length: serialsNeeded(item) }, (_, i) => {
              const val = entries[i] ?? ''
              const trimmed = val.trim()
              const valid = !trimmed || availSet.has(trimmed.toLowerCase())
              const dup = !!trimmed && entries.filter(e => e.trim().toLowerCase() === trimmed.toLowerCase()).length > 1
              const bad = !!trimmed && (!valid || dup)
              return (
                <div key={`${scanFieldsKey}-${i}`} className="flex items-center gap-1.5">
                  <span className="text-xs text-foreground-muted w-5 shrink-0 text-right">{i + 1}.</span>
                  <input
                    ref={el => {
                      fieldRefs.current[i] = el
                    }}
                    type="text"
                    defaultValue={val}
                    onInput={e => {
                      // Uncontrolled: the DOM accumulates the scanner burst. Do NO
                      // per-keystroke validation/commit here (that re-render race is
                      // what drops characters). Just track dirtiness for styling.
                      dirtyRef.current[i] = (e.target as HTMLInputElement).value
                    }}
                    onKeyDown={e => {
                      // Commit + validate + advance ONLY on the terminator (scanner
                      // sends Enter/CR; some send Tab). One validation per serial.
                      if (e.key === 'Enter' || e.key === 'Tab') {
                        e.preventDefault()
                        commitFieldFromDom(i)
                        focusNextEntry(i)
                      }
                    }}
                    onBlur={() => commitFieldFromDom(i)}
                    placeholder={`Scan serial ${i + 1}`}
                    className={`flex-1 min-w-0 px-2.5 py-1.5 text-sm rounded-lg border bg-surface text-foreground font-mono focus:outline-none focus:ring-1 ${
                      bad ? 'border-red-400 focus:ring-red-400' : 'border-border-default focus:ring-secondary-500'
                    }`}
                  />
                </div>
              )
            })}
          </div>
          <p className="text-xs text-foreground-muted mt-2">
            Scan or type each serial. Must match an in-stock serial for this product ({available.length} available).
            {(() => {
              const bad = entries.some(e => e.trim() && !availSet.has(e.trim().toLowerCase()))
              const dups =
                new Set(entries.map(e => e.trim().toLowerCase()).filter(Boolean)).size !==
                entries.filter(e => e.trim()).length
              if (bad) return <span className="text-red-500 font-medium"> Some serials are not in stock.</span>
              if (dups) return <span className="text-red-500 font-medium"> Duplicate serials entered.</span>
              return null
            })()}
          </p>
        </>
      ) : (
        <>
          {available.length > 8 && (
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter serials or lot…"
              className="w-full mb-2 px-3 py-1.5 text-sm rounded-lg border border-border-default bg-surface text-foreground focus:outline-none focus:ring-1 focus:ring-secondary-500 font-mono"
            />
          )}
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border-default">
            {batches.map(batch => {
              const collapsed = collapsedBatches.has(batch.lotKey)
              const batchSelected = batch.serials.filter(s => selected.has(s.serial_number)).length
              return (
                <div key={batch.lotKey}>
                  <button
                    type="button"
                    onClick={() => toggleBatch(batch.lotKey)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-surface-secondary hover:bg-surface-secondary/80 transition-colors text-left border-b border-border-default"
                  >
                    <div className="flex items-center gap-2">
                      <svg
                        className={`w-3 h-3 text-foreground-muted transition-transform ${collapsed ? '-rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      <span className="text-xs font-semibold text-foreground">{batch.lotLabel}</span>
                      <span className="text-xs text-foreground-muted">
                        {batch.serials.length} serial{batch.serials.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {batchSelected > 0 && (
                      <span className="text-xs font-semibold text-secondary-600 dark:text-secondary-400">
                        {batchSelected} selected
                      </span>
                    )}
                  </button>
                  {!collapsed &&
                    batch.serials.map(s => {
                      const checked = selected.has(s.serial_number)
                      const disabled = !checked && selected.size >= serialsNeeded(item)
                      return (
                        <label
                          key={s.serial_number}
                          className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors border-b border-border-default last:border-0 ${
                            checked
                              ? 'bg-secondary-50 dark:bg-secondary-900/20'
                              : disabled
                                ? 'opacity-40'
                                : 'hover:bg-surface-secondary'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggle(s.serial_number)}
                            className="accent-secondary-500 shrink-0"
                          />
                          <span className="text-sm font-mono text-foreground flex-1">{s.serial_number}</span>
                        </label>
                      )
                    })}
                </div>
              )
            })}
          </div>
          <p className="text-xs text-foreground-muted mt-1.5">
            {available.length} serial{available.length !== 1 ? 's' : ''} in stock across {batches.length} batch
            {batches.length !== 1 ? 'es' : ''} — select exactly {serialsNeeded(item)}
          </p>
        </>
      )}
    </div>
  )
}

export default function SerialEntryModal({ items, onConfirm, onCancel }: Props) {
  const itemsNeedingEntry = items.filter(i => !i.already_assigned)
  // Default ON: scanner mode is the primary path — N fields, cursor in the first.
  // Toggle off to fall back to the click/checkbox picker.
  const [scanEnabled, setScanEnabled] = useState(true)

  const [selections, setSelections] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(
      itemsNeedingEntry.map(i => [
        i.order_item_id,
        // Seed with any pre-assigned serials (e.g. auto-recorded from a scan), capped
        // at the required serial count. The SerialPicker fills the remaining delta.
        new Set<string>((i.preassigned ?? []).slice(0, serialsNeeded(i))),
      ])
    )
  )

  const canConfirm = itemsNeedingEntry.every(item => selections[item.order_item_id]?.size === serialsNeeded(item))

  function handleConfirm() {
    const assignments: SerialAssignment[] = []
    for (const item of itemsNeedingEntry) {
      for (const sn of selections[item.order_item_id] || []) {
        assignments.push({ order_item_id: item.order_item_id, serial_number: sn })
      }
    }
    onConfirm(assignments)
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50">
      <div className="bg-surface-elevated rounded-xl shadow-xl border border-border-default w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border-default flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Select Serial Numbers</h2>
            <p className="text-sm text-foreground-muted mt-0.5">
              Serials grouped by batch — top{' '}
              {(itemsNeedingEntry[0] ? serialsNeeded(itemsNeedingEntry[0]) : undefined) ?? 'N'} pre-selected
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setScanEnabled(v => !v)}
              title={
                scanEnabled
                  ? 'Scanner mode on — scan a serial to select it'
                  : 'Click to select manually, or turn on scanner mode'
              }
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                scanEnabled
                  ? 'border-secondary-500 bg-secondary-50 dark:bg-secondary-900/20 text-secondary-700 dark:text-secondary-400'
                  : 'border-border-default text-foreground-muted hover:bg-surface-secondary'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 5v14M8 5v14M12 5v14M16 5v14M20 5v14"
                />
              </svg>
              {scanEnabled ? 'Scan: on' : 'Scan: off'}
            </button>
            <button
              onClick={onCancel}
              className="text-foreground-muted hover:text-foreground transition-colors text-xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-6">
          {itemsNeedingEntry.map(item => (
            <SerialPicker
              key={item.order_item_id}
              item={item}
              selected={selections[item.order_item_id] || new Set()}
              onChange={next => setSelections(s => ({ ...s, [item.order_item_id]: next }))}
              scanEnabled={scanEnabled}
            />
          ))}
        </div>

        <div className="px-6 py-4 border-t border-border-default flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-foreground border border-border-default rounded-lg hover:bg-surface transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 text-sm font-medium bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            Confirm Serials
          </button>
        </div>
      </div>
    </div>
  )
}
