'use client'

import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grows with the text up to this many lines, then scrolls. */
  maxRows?: number
  minRows?: number
}

/** A textarea that grows with what's typed (and pasted), up to `maxRows`. */
const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, Props>(function AutoGrowTextarea(
  { maxRows = 8, minRows = 1, value, onChange, style, ...rest },
  ref
) {
  const inner = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement)

  const fit = useCallback(() => {
    const el = inner.current
    if (!el) return
    const cs = getComputedStyle(el)
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 20
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    el.style.height = 'auto'
    const max = line * maxRows + pad
    const min = line * minRows + pad
    const h = Math.min(Math.max(el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth), min), max)
    el.style.height = `${h}px`
    el.style.overflowY = el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) > max ? 'auto' : 'hidden'
  }, [maxRows, minRows])

  useLayoutEffect(fit, [value, fit])
  useLayoutEffect(() => {
    const el = inner.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let w = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== w) {
        w = el.clientWidth
        fit()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  return (
    <textarea
      ref={inner}
      rows={minRows}
      value={value}
      onChange={e => {
        onChange?.(e)
        if (value === undefined) fit()
      }}
      style={{ resize: 'none', ...style }}
      {...rest}
    />
  )
})

export default AutoGrowTextarea
