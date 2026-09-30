'use client'

import { useRef, useCallback, useEffect, useState } from 'react'

/** Round to up to 6 decimal places, then strip trailing zeros. */
function fmtQty(v: number, maxDecimals = 6): string {
  return Number(v.toFixed(maxDecimals)).toString()
}

function UnitLabel({ label }: { label: string | null | undefined }) {
  if (!label) return null
  const match = label.match(/^(.+?)2$/)
  if (match)
    return (
      <>
        {match[1]}
        <sup>2</sup>
      </>
    )
  return <>{label}</>
}

function QtyHint({
  qtyMin,
  qtyMax,
  qtyStep,
  unitLabel,
  defaultStep = 1,
}: {
  qtyMin: number
  qtyMax?: number
  qtyStep: number
  unitLabel?: string | null
  defaultStep?: number
}) {
  const parts: string[] = []
  if (qtyMin > 0) parts.push(`Min: ${fmtQty(qtyMin)}`)
  if (qtyMax != null) parts.push(`Max: ${fmtQty(qtyMax)}`)
  if (qtyStep !== defaultStep) parts.push(`Step: ${fmtQty(qtyStep)}`)
  if (parts.length === 0) return null
  const unit = unitLabel ? ` ${unitLabel}` : ''
  return (
    <p className="text-xs text-foreground-muted mt-1">
      {parts.join(' · ')}
      {unit}
    </p>
  )
}

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
function CountStepper({
  quantity,
  quantityRaw,
  unitLabel,
  unitKey,
  effectiveStock,
  qtyMin,
  qtyMax,
  qtyStep,
  onChange,
}: QuantityInputProps) {
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
            className="min-w-[44px] min-h-[44px] px-3 flex items-center justify-center hover:bg-surface-secondary transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed"
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
              onChange(
                isNaN(parseInt(raw, 10)) ? quantity : Math.min(ceiling, Math.max(qtyMin, parseInt(raw, 10))),
                raw
              )
            }}
            onBlur={e => {
              const v = parseInt(e.target.value, 10)
              const clamped = isNaN(v) || v < qtyMin ? qtyMin : Math.min(ceiling, v)
              onChange(clamped, String(clamped))
            }}
            className="w-14 sm:w-16 min-h-[44px] border-x border-border-secondary text-center font-semibold bg-surface text-foreground focus:outline-none text-base"
          />
          <button
            type="button"
            onClick={() => {
              const next = Math.min(ceiling, quantity + 1)
              onChange(next, String(next))
            }}
            disabled={quantity >= ceiling}
            className="min-w-[44px] min-h-[44px] px-3 flex items-center justify-center hover:bg-surface-secondary transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
        {unitLabel && (
          <span className="text-sm text-foreground-muted">
            <UnitLabel label={unitLabel} />
          </span>
        )}
      </div>
      <QtyHint qtyMin={qtyMin} qtyMax={qtyMax} qtyStep={qtyStep} unitLabel={unitLabel} defaultStep={1} />
    </div>
  )
}

// ─── Tape-measure ruler ────────────────────────────────────────────────────
// Design: the tape inner div has no padding. The scrollable container uses
// CSS scroll-padding-inline so the browser's snap logic anchors to the
// centre needle. scrollLeft=0 means qtyMin is under the needle.
//
// scrollLeft for value v  =  (v - qtyMin) * PX_PER_UNIT
// value from scrollLeft   =  qtyMin + scrollLeft / PX_PER_UNIT
//
// The tape inner div is wider than the container by one full container-width
// on each side (via paddingInline) so the user can actually reach qtyMin and
// qtyMax by scrolling — without any dead zone.
const PX_PER_UNIT = 80

function LengthRuler({ quantity, unitLabel, effectiveStock, qtyMin, qtyMax, qtyStep, onChange }: QuantityInputProps) {
  // Cap the ruler window: if no explicit qtyMax, show qtyMin to qtyMin + 20 steps.
  // This prevents thousands of tick nodes when stock is large and no max is set.
  const rulerMax = qtyMax ?? Math.min(effectiveStock, qtyMin + 20 * qtyStep)
  const max = Math.max(Math.min(effectiveStock, rulerMax), qtyMin)

  // Scale so each qtyStep spans at least 20px — prevents sub-pixel tick collapse
  // when qtyStep is small (e.g. 0.01 m).
  const pxPerUnit = Math.max(PX_PER_UNIT, Math.ceil(20 / qtyStep))

  const trackRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)

  const isDragging = useRef(false)
  const lastX = useRef(0)
  const liveValue = useRef(quantity)
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const programmatic = useRef(false)
  const programmaticTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const snap = (v: number) => Math.round((v - qtyMin) / qtyStep) * qtyStep + qtyMin
  const toScrollLeft = (v: number) => (v - qtyMin) * pxPerUnit
  const fromScrollLeft = (sl: number) => qtyMin + sl / pxPerUnit

  const updateDOM = (v: number) => {
    liveValue.current = v
    if (readoutRef.current) readoutRef.current.textContent = fmtQty(v)
    if (fillRef.current) fillRef.current.style.width = `${(v - qtyMin) * pxPerUnit}px`
  }

  const commit = (v: number) => onChange(v, fmtQty(v))

  const scrollToValue = (v: number, smooth = false) => {
    const el = trackRef.current
    if (!el) return
    programmatic.current = true
    if (programmaticTimer.current) clearTimeout(programmaticTimer.current)
    el.scrollTo({ left: toScrollLeft(v), behavior: smooth ? 'smooth' : 'instant' })
    programmaticTimer.current = setTimeout(
      () => {
        programmatic.current = false
      },
      smooth ? 600 : 30
    )
  }

  // initial scroll
  useEffect(() => {
    updateDOM(quantity)
    scrollToValue(quantity, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // external quantity change (e.g. variant switch)
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

  const onScroll = useCallback(() => {
    if (programmatic.current) return
    const el = trackRef.current
    if (!el) return
    const raw = fromScrollLeft(el.scrollLeft)
    const v = Math.round(snap(Math.min(max, Math.max(qtyMin, raw))) * 1000) / 1000
    updateDOM(v)
    if (!isDragging.current) {
      if (commitTimer.current) clearTimeout(commitTimer.current)
      commitTimer.current = setTimeout(() => {
        prevQty.current = liveValue.current
        commit(liveValue.current)
        scrollToValue(liveValue.current, false)
      }, 150)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [max, qtyMin, qtyStep])

  // Mouse-only drag (touch uses native scroll)
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
    scrollToValue(v, false)
  }

  // tick marks
  const ticks: { pos: number; label: string | null; kind: 'major' | 'mid' | 'minor' }[] = []
  const subStep = qtyStep <= 0.1 ? qtyStep : 0.1
  const totalSteps = Math.round((max - qtyMin) / subStep)
  let lastMajorLabel: string | null = null
  for (let i = 0; i <= totalSteps; i++) {
    const v = Math.round((qtyMin + i * subStep) * 1000) / 1000
    const pos = (v - qtyMin) * pxPerUnit
    const stepsFromMin = (v - qtyMin) / qtyStep
    const isMajor = Math.abs(stepsFromMin - Math.round(stepsFromMin)) < 0.001
    const isMid = !isMajor && Math.abs((stepsFromMin * 2) % 1) < 0.01
    const snappedLabel: string | null = isMajor
      ? String(Math.round((qtyMin + Math.round(stepsFromMin) * qtyStep) * 1000) / 1000)
      : null
    const label: string | null = snappedLabel !== null && snappedLabel !== lastMajorLabel ? snappedLabel : null
    if (label !== null) lastMajorLabel = label
    ticks.push({ pos, label, kind: isMajor ? 'major' : isMid ? 'mid' : 'minor' })
  }

  // ResizeObserver sets paddingInline = clientWidth/2 so qtyMin/qtyMax reach the needle
  const innerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = trackRef.current
    const inner = innerRef.current
    if (!el || !inner) return
    const ro = new ResizeObserver(() => {
      const half = el.clientWidth / 2
      inner.style.paddingInline = `${half}px`
      el.scrollLeft = toScrollLeft(liveValue.current)
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Long-press step buttons
  const stepInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const stepTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stepBy = useCallback(
    (dir: 1 | -1) => {
      const next = Math.min(max, Math.max(qtyMin, Math.round((liveValue.current + dir * qtyStep) * 1000) / 1000))
      updateDOM(next)
      prevQty.current = next
      commit(next)
      scrollToValue(next, false)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [max, qtyMin, qtyStep]
  )

  const startLongPress = (dir: 1 | -1) => {
    stepBy(dir)
    stepTimeout.current = setTimeout(() => {
      stepInterval.current = setInterval(() => stepBy(dir), 80)
    }, 400)
  }

  const stopLongPress = () => {
    if (stepTimeout.current) {
      clearTimeout(stepTimeout.current)
      stepTimeout.current = null
    }
    if (stepInterval.current) {
      clearInterval(stepInterval.current)
      stepInterval.current = null
    }
  }

  useEffect(() => stopLongPress, [])

  const ticksWidth = Math.round((max - qtyMin) * pxPerUnit)

  return (
    <div className="space-y-3">
      {/* readout */}
      <div className="flex items-baseline gap-1.5">
        <span ref={readoutRef} className="text-2xl font-bold text-primary-600 dark:text-primary-400 tabular-nums">
          {fmtQty(quantity)}
        </span>
        {unitLabel && (
          <span className="text-sm text-foreground-secondary">
            <UnitLabel label={unitLabel} />
          </span>
        )}
      </div>

      {/* tape box */}
      <div
        className="relative rounded-xl border border-border-secondary overflow-hidden bg-amber-50 dark:bg-amber-950/20 select-none"
        style={{ height: 80 }}
      >
        {/* fixed centre needle */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 z-10 pointer-events-none flex flex-col items-center">
          <div className="w-0.5 h-full bg-primary-600 dark:bg-primary-400 opacity-80" />
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0"
            style={{
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '8px solid var(--color-primary-600, #2563eb)',
            }}
          />
        </div>

        {/* scrollable track — touch scrolls natively; mouse uses pointer drag */}
        <div
          ref={trackRef}
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute inset-0 overflow-x-scroll cursor-grab active:cursor-grabbing touch-pan-x"
          style={
            { scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties
          }
        >
          <div ref={innerRef} style={{ display: 'inline-block', height: '100%' }}>
            <div style={{ width: ticksWidth, height: '100%', position: 'relative' }}>
              {/* fill bar */}
              <div
                ref={fillRef}
                className="absolute top-0 bottom-0 left-0 bg-primary-100 dark:bg-primary-900/30"
                style={{ width: (quantity - qtyMin) * pxPerUnit }}
              />
              {/* ticks */}
              {ticks.map((t, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: t.pos,
                    top: 0,
                    width: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      width: 1,
                      height: t.kind === 'major' ? 30 : t.kind === 'mid' ? 20 : 12,
                      background: t.kind === 'major' ? '#92400e' : '#d97706',
                      opacity: t.kind === 'minor' ? 0.4 : 0.7,
                      marginTop: t.kind === 'major' ? 0 : t.kind === 'mid' ? 5 : 8,
                    }}
                  />
                  {t.label && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 33,
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#92400e',
                        transform: 'translateX(-50%)',
                        whiteSpace: 'nowrap',
                        userSelect: 'none',
                        fontFamily: 'monospace',
                      }}
                    >
                      {t.label}
                    </span>
                  )}
                </div>
              ))}
              {/* max label */}
              <span
                style={{
                  position: 'absolute',
                  left: ticksWidth + 8,
                  top: 36,
                  fontSize: 11,
                  color: '#b45309',
                  fontWeight: 600,
                  userSelect: 'none',
                }}
              >
                <UnitLabel label={unitLabel} /> max
              </span>
            </div>
          </div>
        </div>

        {/* ‹ — left overlay, full height for easy tap */}
        <button
          type="button"
          onPointerDown={e => {
            e.stopPropagation()
            startLongPress(-1)
          }}
          onPointerUp={stopLongPress}
          onPointerLeave={stopLongPress}
          onPointerCancel={stopLongPress}
          disabled={quantity <= qtyMin}
          className="absolute left-0 inset-y-0 z-20 w-11 flex items-center justify-center bg-amber-100/80 dark:bg-amber-900/40 hover:bg-amber-200/90 dark:hover:bg-amber-800/60 active:bg-amber-300/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-amber-900 dark:text-amber-200 text-xl font-bold"
          style={{ backdropFilter: 'blur(2px)', touchAction: 'none' }}
        >
          ‹
        </button>

        {/* › — right overlay */}
        <button
          type="button"
          onPointerDown={e => {
            e.stopPropagation()
            startLongPress(1)
          }}
          onPointerUp={stopLongPress}
          onPointerLeave={stopLongPress}
          onPointerCancel={stopLongPress}
          disabled={quantity >= max}
          className="absolute right-0 inset-y-0 z-20 w-11 flex items-center justify-center bg-amber-100/80 dark:bg-amber-900/40 hover:bg-amber-200/90 dark:hover:bg-amber-800/60 active:bg-amber-300/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-amber-900 dark:text-amber-200 text-xl font-bold"
          style={{ backdropFilter: 'blur(2px)', touchAction: 'none' }}
        >
          ›
        </button>
      </div>

      <p className="text-xs text-foreground-muted">Swipe the tape or hold ‹ › to adjust</p>
      <QtyHint qtyMin={qtyMin} qtyMax={qtyMax} qtyStep={qtyStep} unitLabel={unitLabel} defaultStep={0.001} />
    </div>
  )
}

// ─── Slider (weight / volume) ───────────────────────────────────────────────
function SliderInput({
  quantity,
  quantityRaw,
  unitLabel,
  effectiveStock,
  qtyMax,
  qtyStep,
  qtyMin,
  onChange,
}: QuantityInputProps) {
  const ceiling = Math.min(effectiveStock, qtyMax ?? effectiveStock)

  function dec() {
    const next = Math.max(qtyMin, Math.round((quantity - qtyStep) * 1000) / 1000)
    onChange(next, next % 1 === 0 ? String(next) : fmtQty(next))
  }
  function inc() {
    const next = Math.min(ceiling, Math.round((quantity + qtyStep) * 1000) / 1000)
    onChange(next, next % 1 === 0 ? String(next) : fmtQty(next))
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="flex items-center border border-border-secondary rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={dec}
            disabled={quantity <= qtyMin}
            className="min-w-[44px] min-h-[44px] px-3 flex items-center justify-center text-lg hover:bg-surface-secondary transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            −
          </button>
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
              let clamped = isNaN(v) || v < qtyMin ? qtyMin : Math.min(ceiling, v)
              clamped = Math.round((clamped - qtyMin) / qtyStep) * qtyStep + qtyMin
              clamped = Math.max(qtyMin, Math.min(ceiling, parseFloat(clamped.toFixed(6))))
              onChange(clamped, fmtQty(clamped))
            }}
            className="w-20 sm:w-24 min-h-[44px] border-x border-border-secondary text-center font-semibold bg-surface text-foreground focus:outline-none text-base"
          />
          <button
            type="button"
            onClick={inc}
            disabled={quantity >= ceiling}
            className="min-w-[44px] min-h-[44px] px-3 flex items-center justify-center text-lg hover:bg-surface-secondary transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            +
          </button>
        </div>
        {unitLabel && <span className="text-sm text-foreground-secondary">{unitLabel}</span>}
      </div>
      <QtyHint qtyMin={qtyMin} qtyMax={qtyMax} qtyStep={qtyStep} unitLabel={unitLabel} defaultStep={0.001} />
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

function DimStepper({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  step: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  const [raw, setRaw] = useState(fmtQty(value))

  useEffect(() => {
    setRaw(fmtQty(value))
  }, [value])

  function snap(v: number) {
    const snapped = Math.round(v / step) * step
    return Math.min(max, Math.max(min, Math.round(snapped * 1000) / 1000))
  }

  function commit(s: string) {
    const parsed = parseFloat(s)
    if (!isNaN(parsed) && parsed > 0) {
      const snapped = snap(parsed)
      setRaw(fmtQty(snapped))
      onChange(snapped)
    } else {
      setRaw(fmtQty(value))
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
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-foreground-muted hover:text-foreground hover:bg-surface-elevated disabled:opacity-30 text-lg select-none"
        >
          −
        </button>
        <input
          type="text"
          inputMode="decimal"
          value={raw}
          onChange={e => setRaw(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
          }}
          className="flex-1 text-center font-semibold text-foreground bg-transparent text-base min-h-[44px] focus:outline-none min-w-0"
        />
        <button
          type="button"
          onClick={() => onChange(snap(value + step))}
          disabled={value >= max}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-foreground-muted hover:text-foreground hover:bg-surface-elevated disabled:opacity-30 text-lg select-none"
        >
          +
        </button>
      </div>
    </div>
  )
}

function AreaInput({ quantity, unitLabel, effectiveStock, qtyMin, qtyMax, qtyStep, onChange }: AreaInputProps) {
  const ceiling = Math.min(effectiveStock, qtyMax ?? effectiveStock)

  // Strip trailing "2" or "²" to get the linear unit for width/height labels (e.g. "ft2" → "ft", "m²" → "m")
  const linearUnit = unitLabel ? unitLabel.replace(/²$/, '').replace(/2$/, '') : ''

  function initDims(qty: number): [number, number] {
    const sqrtQ = Math.sqrt(Math.max(qty, qtyMin))
    const isSquare = Math.abs(sqrtQ - Math.round(sqrtQ * 100) / 100) < 0.01
    const w0 = isSquare ? Math.round(sqrtQ * 100) / 100 : qtyStep
    const h0 = isSquare ? Math.round(sqrtQ * 100) / 100 : Math.round((qty / w0) * 1000) / 1000
    return [Math.max(qtyStep, w0), Math.max(qtyStep, h0)]
  }

  const [w, setW] = useState(() => initDims(quantity)[0])
  const [h, setH] = useState(() => initDims(quantity)[1])

  // Reset dimensions when quantity is reset externally (e.g. sub-variant switch resets to qtyMin)
  useEffect(() => {
    const expected = Math.round(w * h * 1000) / 1000
    if (Math.abs(quantity - expected) > 0.001) {
      const [nw, nh] = initDims(quantity)
      setW(nw)
      setH(nh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantity])

  const dimMax = Math.sqrt(ceiling)
  const dimMin = qtyStep

  function emit(newW: number, newH: number) {
    const area = Math.round(newW * newH * 1000) / 1000
    const clamped = Math.min(ceiling, Math.max(qtyMin, area))
    onChange(clamped, String(clamped))
  }

  function handleW(v: number) {
    setW(v)
    emit(v, h)
  }
  function handleH(v: number) {
    setH(v)
    emit(w, v)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-end gap-2">
        <div className="flex-1">
          <DimStepper
            label={linearUnit ? `Width (${linearUnit})` : 'Width'}
            value={w}
            step={qtyStep}
            min={dimMin}
            max={dimMax}
            onChange={handleW}
          />
        </div>
        <span className="text-foreground-muted sm:pb-3 text-lg text-center">×</span>
        <div className="flex-1">
          <DimStepper
            label={linearUnit ? `Height (${linearUnit})` : 'Height'}
            value={h}
            step={qtyStep}
            min={dimMin}
            max={dimMax}
            onChange={handleH}
          />
        </div>
      </div>
      <p className="text-sm text-foreground-secondary">
        Area:{' '}
        <span className="font-semibold text-foreground">
          {fmtQty(quantity)}{' '}
          {linearUnit ? (
            <>
              {linearUnit}
              <sup>2</sup>
            </>
          ) : (
            unitLabel
          )}
        </span>
      </p>
      <QtyHint qtyMin={qtyMin} qtyMax={qtyMax} qtyStep={qtyStep} unitLabel={unitLabel} defaultStep={0.001} />
    </div>
  )
}

// ─── Main export ────────────────────────────────────────────────────────────
export default function QuantityInput(props: QuantityInputProps) {
  const { dimension } = props
  if (dimension === 'length') return <LengthRuler {...props} />
  if (dimension === 'weight' || dimension === 'volume') return <SliderInput {...props} />
  if (dimension === 'area')
    return (
      <AreaInput
        quantity={props.quantity}
        unitLabel={props.unitLabel}
        effectiveStock={props.effectiveStock}
        qtyMin={props.qtyMin}
        qtyMax={props.qtyMax}
        qtyStep={props.qtyStep}
        onChange={props.onChange}
      />
    )
  return <CountStepper {...props} />
}
