'use client'

import { useRef, useCallback, useEffect, useState } from 'react'

interface QuantityInputProps {
  dimension: string // 'count' | 'length' | 'weight' | 'area' | 'volume' | other
  quantity: number
  quantityRaw: string
  unitLabel: string | null
  unitKey: string
  effectiveStock: number
  qtyStep: number
  qtyMin: number
  qtyMax?: number
  onChange: (qty: number, raw: string) => void
}

// ─── Count stepper ─────────────────────────────────────────────────────────
function CountStepper({ quantity, quantityRaw, unitLabel, unitKey, effectiveStock, qtyMin, qtyMax, onChange }: QuantityInputProps) {
  const ceiling = Math.min(effectiveStock, qtyMax ?? effectiveStock)
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="flex items-center border border-border-secondary rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => {
              const next = Math.max(qtyMin, quantity - 1)
              onChange(next, String(next))
            }}
            disabled={quantity <= qtyMin}
            className="px-4 py-2 hover:bg-surface-secondary transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <input
            type="text"
            inputMode="numeric"
            value={quantityRaw}
            onChange={e => {
              const raw = e.target.value
              onChange(isNaN(parseInt(raw, 10)) ? quantity : Math.min(ceiling, Math.max(qtyMin, parseInt(raw, 10))), raw)
            }}
            onBlur={e => {
              const v = parseInt(e.target.value, 10)
              const clamped = isNaN(v) || v < qtyMin ? qtyMin : Math.min(ceiling, v)
              onChange(clamped, String(clamped))
            }}
            className="w-16 py-2 border-x border-border-secondary text-center font-semibold bg-surface text-foreground focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              const next = Math.min(ceiling, quantity + 1)
              onChange(next, String(next))
            }}
            disabled={quantity >= ceiling}
            className="px-4 py-2 hover:bg-surface-secondary transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
        {unitLabel && unitKey !== 'unit' && (
          <span className="text-sm text-foreground-secondary">{unitLabel}</span>
        )}
      </div>
    </div>
  )
}

// ─── Tape-measure ruler ────────────────────────────────────────────────────
// Scroll-only design: the tape div itself is overflow-x-scroll.
// All visual updates (readout + fill) happen via direct DOM refs — zero React
// re-renders during scroll/drag, so there is no lag or re-centering fight.
// onChange is called once on pointer-up or after touch scroll settles.
const PX_PER_UNIT = 80

function LengthRuler({ quantity, unitLabel, effectiveStock, qtyMin, qtyMax, qtyStep, onChange }: QuantityInputProps) {
  const max = Math.max(Math.min(effectiveStock, qtyMax ?? effectiveStock), qtyMin)
  const PADDING = 200
  const tapeWidth = Math.round((max - qtyMin) * PX_PER_UNIT) + PADDING * 2

  const trackRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)

  const isDragging = useRef(false)
  const lastX = useRef(0)
  const liveValue = useRef(quantity) // current value without triggering re-render
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const programmatic = useRef(false)
  const programmaticTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const snap = (v: number) => Math.round((v - qtyMin) / qtyStep) * qtyStep + qtyMin

  const getScrollLeft = (v: number) => {
    const el = trackRef.current
    if (!el) return 0
    return (v - qtyMin) * PX_PER_UNIT + PADDING - el.clientWidth / 2
  }

  const getValueFromScroll = (scrollLeft: number) => {
    const el = trackRef.current
    if (!el) return qtyMin
    return qtyMin + (scrollLeft + el.clientWidth / 2 - PADDING) / PX_PER_UNIT
  }

  // update DOM readout + fill directly — no React re-render
  const updateDOM = (v: number) => {
    liveValue.current = v
    if (readoutRef.current) {
      readoutRef.current.textContent = v % 1 === 0 ? String(v) : v.toFixed(2)
    }
    if (fillRef.current) {
      fillRef.current.style.width = `${(v - qtyMin) * PX_PER_UNIT}px`
    }
  }

  // commit to React state (called once, not on every scroll tick)
  const commit = (v: number) => {
    onChange(v, v % 1 === 0 ? String(v) : v.toFixed(2))
  }

  const scrollToValue = (v: number, smooth = false) => {
    const el = trackRef.current
    if (!el) return
    programmatic.current = true
    if (programmaticTimer.current) clearTimeout(programmaticTimer.current)
    el.scrollTo({ left: Math.max(0, getScrollLeft(v)), behavior: smooth ? 'smooth' : 'instant' })
    programmaticTimer.current = setTimeout(() => { programmatic.current = false }, smooth ? 700 : 50)
  }

  // mount: scroll to initial quantity
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      updateDOM(quantity)
      scrollToValue(quantity, false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // external quantity change (variant switch etc.) — re-centre
  const prevQty = useRef(quantity)
  useEffect(() => {
    if (isDragging.current) return
    if (Math.abs(quantity - prevQty.current) > 0.0001) {
      prevQty.current = quantity
      updateDOM(quantity)
      scrollToValue(quantity, true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantity])

  // scroll handler — update DOM only, debounce commit for touch scroll settle
  const onScroll = useCallback(() => {
    if (programmatic.current) return
    const el = trackRef.current
    if (!el) return
    const raw = getValueFromScroll(el.scrollLeft)
    const v = Math.round(snap(Math.min(max, Math.max(qtyMin, raw))) * 1000) / 1000
    updateDOM(v)
    // for touch scroll: commit after scroll settles
    if (!isDragging.current) {
      if (commitTimer.current) clearTimeout(commitTimer.current)
      commitTimer.current = setTimeout(() => {
        prevQty.current = liveValue.current
        commit(liveValue.current)
        // snap tape to grid after touch settle
        scrollToValue(liveValue.current, true)
      }, 150)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [max, qtyMin, qtyStep])

  // pointer drag — mouse only (touch uses native scroll)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return
    isDragging.current = true
    lastX.current = e.clientX
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return
    const el = trackRef.current
    if (!el) return
    el.scrollLeft += lastX.current - e.clientX
    lastX.current = e.clientX
  }
  const onPointerUp = () => {
    if (!isDragging.current) return
    isDragging.current = false
    const v = liveValue.current
    prevQty.current = v
    commit(v)
    scrollToValue(v, true)
  }

  // tick marks — computed once per render (max/qtyStep rarely change)
  const ticks: { pos: number; label: string | null; kind: 'major' | 'mid' | 'minor' }[] = []
  const subStep = qtyStep <= 0.1 ? qtyStep : 0.1
  const totalSteps = Math.round((max - qtyMin) / subStep)
  for (let i = 0; i <= totalSteps; i++) {
    const v = Math.round((qtyMin + i * subStep) * 1000) / 1000
    const pos = PADDING + (v - qtyMin) * PX_PER_UNIT
    const stepsFromMin = (v - qtyMin) / qtyStep
    const isMajor = Math.abs(stepsFromMin - Math.round(stepsFromMin)) < 0.001
    const isMid = !isMajor && Math.abs((stepsFromMin * 2) % 1) < 0.01
    ticks.push({ pos, label: isMajor ? String(Math.round(v)) : null, kind: isMajor ? 'major' : isMid ? 'mid' : 'minor' })
  }

  return (
    <div className="space-y-3">
      {/* value readout — updated via DOM ref, not re-render */}
      <div className="flex items-baseline gap-1.5">
        <span ref={readoutRef} className="text-2xl font-bold text-primary-600 dark:text-primary-400 tabular-nums">
          {quantity % 1 === 0 ? String(quantity) : quantity.toFixed(2)}
        </span>
        {unitLabel && <span className="text-sm text-foreground-secondary">{unitLabel}</span>}
      </div>

      {/* tape box */}
      <div className="relative rounded-xl border border-border-secondary overflow-hidden bg-amber-50 dark:bg-amber-950/20 select-none" style={{ height: 72 }}>
        {/* fixed centre needle */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 z-10 pointer-events-none flex flex-col items-center">
          <div className="w-0.5 h-full bg-primary-600 dark:bg-primary-400 opacity-80" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0"
            style={{ borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '8px solid var(--color-primary-600, #2563eb)' }} />
        </div>

        {/* scrollable tape */}
        <div
          ref={trackRef}
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute inset-0 overflow-x-scroll cursor-grab active:cursor-grabbing"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
        >
          <div style={{ width: tapeWidth, height: '100%', position: 'relative' }}>
            {/* fill — updated via DOM ref */}
            <div
              ref={fillRef}
              className="absolute top-0 bottom-0 bg-primary-100 dark:bg-primary-900/30"
              style={{ left: PADDING, width: (quantity - qtyMin) * PX_PER_UNIT }}
            />

            {/* tick marks */}
            {ticks.map((t, i) => (
              <div key={i} style={{ position: 'absolute', left: t.pos, top: 0, width: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{
                  width: 1,
                  height: t.kind === 'major' ? 28 : t.kind === 'mid' ? 18 : 10,
                  background: t.kind === 'major' ? '#92400e' : '#d97706',
                  opacity: t.kind === 'minor' ? 0.4 : 0.7,
                  marginTop: t.kind === 'major' ? 0 : t.kind === 'mid' ? 5 : 8,
                }} />
                {t.label && (
                  <span style={{
                    position: 'absolute',
                    top: 30,
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#92400e',
                    transform: 'translateX(-50%)',
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    fontFamily: 'monospace',
                  }}>
                    {t.label}
                  </span>
                )}
              </div>
            ))}

            {/* unit label at the end */}
            <span style={{
              position: 'absolute',
              left: PADDING + (max - qtyMin) * PX_PER_UNIT + 8,
              top: 34,
              fontSize: 11,
              color: '#b45309',
              fontWeight: 600,
              userSelect: 'none',
            }}>
              {unitLabel} max
            </span>
          </div>
        </div>
      </div>

      <p className="text-xs text-foreground-muted">Drag the tape to set length</p>
    </div>
  )
}

// ─── Slider (weight / volume) ───────────────────────────────────────────────
function SliderInput({ quantity, quantityRaw, unitLabel, effectiveStock, qtyMax, qtyStep, qtyMin, onChange }: QuantityInputProps) {
  const ceiling = Math.min(effectiveStock, qtyMax ?? effectiveStock)

  function dec() {
    const next = Math.max(qtyMin, Math.round((quantity - qtyStep) * 1000) / 1000)
    onChange(next, next % 1 === 0 ? String(next) : next.toFixed(3))
  }
  function inc() {
    const next = Math.min(ceiling, Math.round((quantity + qtyStep) * 1000) / 1000)
    onChange(next, next % 1 === 0 ? String(next) : next.toFixed(3))
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center border border-border-secondary rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={dec}
          disabled={quantity <= qtyMin}
          className="px-3 py-1.5 text-sm hover:bg-surface-secondary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >−</button>
        <input
          type="text"
          inputMode="decimal"
          value={quantityRaw}
          onChange={e => {
            const raw = e.target.value
            const v = parseFloat(raw)
            onChange(isNaN(v) ? quantity : Math.min(ceiling, Math.max(qtyMin, v)), raw)
          }}
          onBlur={e => {
            const v = parseFloat(e.target.value)
            const clamped = isNaN(v) || v < qtyMin ? qtyMin : Math.min(ceiling, v)
            onChange(clamped, clamped.toFixed(3))
          }}
          className="w-24 py-1.5 border-x border-border-secondary text-center font-semibold bg-surface text-foreground focus:outline-none text-sm"
        />
        <button
          type="button"
          onClick={inc}
          disabled={quantity >= ceiling}
          className="px-3 py-1.5 text-sm hover:bg-surface-secondary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >+</button>
      </div>
      {unitLabel && <span className="text-sm text-foreground-secondary">{unitLabel}</span>}
    </div>
  )
}

// ─── Area input (W × H) ────────────────────────────────────────────────────
interface AreaInputProps {
  quantity: number
  unitLabel: string | null
  effectiveStock: number
  qtyMin: number
  qtyMax?: number
  qtyStep: number
  onChange: (qty: number, raw: string) => void
}

function DimStepper({ label, value, step, min, max, onChange }: {
  label: string; value: number; step: number; min: number; max: number
  onChange: (v: number) => void
}) {
  const [raw, setRaw] = useState(value.toFixed(2))

  useEffect(() => { setRaw(value.toFixed(2)) }, [value])

  function snap(v: number) {
    const snapped = Math.round(v / step) * step
    return Math.min(max, Math.max(min, Math.round(snapped * 1000) / 1000))
  }

  function commit(s: string) {
    const parsed = parseFloat(s)
    if (!isNaN(parsed) && parsed > 0) {
      const snapped = snap(parsed)
      setRaw(snapped.toFixed(2))
      onChange(snapped)
    } else {
      setRaw(value.toFixed(2))
    }
  }

  return (
    <div className="space-y-1">
      <label className="text-xs text-foreground-muted">{label}</label>
      <div className="flex items-center border border-border-secondary rounded-lg overflow-hidden bg-surface">
        <button
          type="button"
          onClick={() => onChange(snap(value - step))}
          disabled={value <= min}
          className="px-2.5 py-2 text-foreground-muted hover:text-foreground hover:bg-surface-elevated disabled:opacity-30 text-sm select-none"
        >
          −
        </button>
        <input
          type="text"
          inputMode="decimal"
          value={raw}
          onChange={e => setRaw(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value) }}
          className="flex-1 text-center font-semibold text-foreground bg-transparent text-sm py-2 focus:outline-none min-w-0"
        />
        <button
          type="button"
          onClick={() => onChange(snap(value + step))}
          disabled={value >= max}
          className="px-2.5 py-2 text-foreground-muted hover:text-foreground hover:bg-surface-elevated disabled:opacity-30 text-sm select-none"
        >
          +
        </button>
      </div>
    </div>
  )
}

function AreaInput({ quantity, unitLabel, effectiveStock, qtyMin, qtyMax, qtyStep, onChange }: AreaInputProps) {
  const ceiling = Math.min(effectiveStock, qtyMax ?? effectiveStock)
  const sqrtQty = Math.sqrt(Math.max(quantity, qtyMin))
  const isSquare = Math.abs(sqrtQty - Math.round(sqrtQty * 100) / 100) < 0.01
  const initW = isSquare ? Math.round(sqrtQty * 100) / 100 : qtyStep
  const initH = isSquare ? Math.round(sqrtQty * 100) / 100 : Math.round((quantity / initW) * 1000) / 1000

  const [w, setW] = useState(Math.max(qtyStep, initW))
  const [h, setH] = useState(Math.max(qtyStep, initH))

  const dimMax = Math.sqrt(ceiling)
  const dimMin = qtyStep

  function emit(newW: number, newH: number) {
    const area = Math.round(newW * newH * 1000) / 1000
    const clamped = Math.min(ceiling, Math.max(qtyMin, area))
    onChange(clamped, String(clamped))
  }

  function handleW(v: number) { setW(v); emit(v, h) }
  function handleH(v: number) { setH(v); emit(w, v) }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <DimStepper
          label={`Width (${unitLabel ?? ''})`}
          value={w} step={qtyStep} min={dimMin} max={dimMax}
          onChange={handleW}
        />
        <span className="text-foreground-muted pb-2.5">×</span>
        <DimStepper
          label={`Height (${unitLabel ?? ''})`}
          value={h} step={qtyStep} min={dimMin} max={dimMax}
          onChange={handleH}
        />
      </div>
      <p className="text-sm text-foreground-secondary">
        Area: <span className="font-semibold text-foreground">{quantity.toFixed(3)} {unitLabel}²</span>
      </p>
    </div>
  )
}

// ─── Main export ────────────────────────────────────────────────────────────
export default function QuantityInput(props: QuantityInputProps) {
  const { dimension } = props
  if (dimension === 'length') return <LengthRuler {...props} />
  if (dimension === 'weight' || dimension === 'volume') return <SliderInput {...props} />
  if (dimension === 'area') return <AreaInput quantity={props.quantity} unitLabel={props.unitLabel} effectiveStock={props.effectiveStock} qtyMin={props.qtyMin} qtyMax={props.qtyMax} qtyStep={props.qtyStep} onChange={props.onChange} />
  return <CountStepper {...props} />
}
