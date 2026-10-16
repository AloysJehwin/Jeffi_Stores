'use client'

import { useRef, type ComponentType, type KeyboardEvent, type ReactNode } from 'react'
import { Check } from 'lucide-react'

// One selection vocabulary for the ecom portal (tokens in ecom.css): selected = ink, hover = sand, focus-visible = terracotta ring.

export const focusRing = 'ecom-focus'
export const fieldCls = 'ecom-field border-border-default'
export const currentRowCls = 'ecom-current'
export const choiceCardCls = (on: boolean, radius = 'rounded-2xl') =>
  `org-square relative ${radius} border text-left transition-colors ${focusRing} ${on ? 'border-[var(--sel-bg)] shadow-[0_0_0_1px_var(--sel-bg)]' : 'border-border-default hover:border-foreground-muted'}`

export function SelectedMark({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden className={`pointer-events-none flex h-5 w-5 items-center justify-center rounded-full ecom-sel ${className}`}>
      <Check className="h-3 w-3" strokeWidth={3} />
    </span>
  )
}

export interface Choice<T extends string> {
  value: T
  label: ReactNode
  description?: ReactNode
  icon?: ComponentType<{ className?: string }>
  count?: ReactNode
  disabled?: boolean
  title?: string
}

type Selection<T extends string> =
  | { multiple?: false; value: T | null; onChange: (v: T) => void }
  | { multiple: true; value: T[]; onChange: (v: T[]) => void }

const isOn = <T extends string>(p: Selection<T>, v: T) => (p.multiple ? p.value.includes(v) : p.value === v)
const choose = <T extends string>(p: Selection<T>, v: T) => {
  if (p.multiple) p.onChange(p.value.includes(v) ? p.value.filter(x => x !== v) : [...p.value, v])
  else p.onChange(v)
}

function useRoving<T extends string>(options: Choice<T>[], onPick: (v: T) => void) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const enabled = options.map((o, j) => (o.disabled ? -1 : j)).filter(j => j >= 0)
    const at = enabled.indexOf(i)
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? enabled[(at + 1) % enabled.length]
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? enabled[(at - 1 + enabled.length) % enabled.length]
      : e.key === 'Home' ? enabled[0]
      : e.key === 'End' ? enabled[enabled.length - 1]
      : undefined
    if (next === undefined) return
    e.preventDefault()
    refs.current[next]?.focus()
    onPick(options[next].value)
  }
  return { refs, onKeyDown }
}

/** Page-level tabs: sand track, ink active pill; scrolls sideways on narrow screens instead of wrapping. */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel, size = 'md', className = '' }: {
  options: Choice<T>[]
  value: T
  onChange: (v: T) => void
  ariaLabel?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const { refs, onKeyDown } = useRoving(options, onChange)
  const pad = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-1.5 text-sm'
  return (
    <div role="tablist" aria-label={ariaLabel}
      className={`ecom-scroll-x inline-flex max-w-full snap-x gap-0.5 overflow-x-auto rounded-full org-sand p-1 ${className}`}>
      {options.map((o, i) => {
        const on = o.value === value
        const Icon = o.icon
        return (
          <button key={o.value} ref={el => { refs.current[i] = el }} type="button" role="tab" aria-selected={on}
            tabIndex={on ? 0 : -1} disabled={o.disabled} title={o.title}
            onClick={() => onChange(o.value)} onKeyDown={e => onKeyDown(e, i)}
            className={`inline-flex shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition-colors disabled:opacity-40 ${pad} ${focusRing} ${on ? 'ecom-sel shadow-sm' : 'text-foreground-secondary hover:bg-[var(--org-sand-deep)] hover:text-foreground'}`}>
            {Icon && <Icon className="h-4 w-4" />}
            {o.label}
            {o.count != null && <span className={`text-xs font-medium tabular-nums ${on ? 'opacity-70' : 'text-foreground-muted'}`}>{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Toggle chips (single or multi): ink + ✓ when on, outline + sand hover when off. */
export function ChoiceChips<T extends string>(props: { options: Choice<T>[]; ariaLabel?: string; size?: 'sm' | 'md'; className?: string } & Selection<T>) {
  const { options, ariaLabel, size = 'sm', className = '' } = props
  const pad = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
  return (
    <div role="group" aria-label={ariaLabel} className={`flex flex-wrap gap-2 ${className}`}>
      {options.map(o => {
        const on = isOn(props, o.value)
        return (
          <button key={o.value} type="button" aria-pressed={on} disabled={o.disabled} title={o.title} onClick={() => choose(props, o.value)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold transition-colors disabled:opacity-40 ${pad} ${focusRing} ${on ? 'ecom-sel border-transparent' : 'border-border-secondary text-foreground-secondary ecom-hover hover:text-foreground'}`}>
            {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Radio cards (or toggle cards with `multiple`) in a responsive grid; ink border + ✓ corner when selected. */
export function ChoiceCards<T extends string>(props: {
  options: Array<Choice<T> & { content?: ReactNode }>
  ariaLabel?: string
  columns?: string
  cardClassName?: string
  className?: string
} & Selection<T>) {
  const { options, ariaLabel, columns = 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3', cardClassName = 'p-4', className = '' } = props
  const single = !props.multiple
  const { refs, onKeyDown } = useRoving(options, v => choose(props, v))
  const selectedIdx = options.findIndex(o => isOn(props, o.value))
  return (
    <div role={single ? 'radiogroup' : 'group'} aria-label={ariaLabel} className={`grid gap-3 ${columns} ${className}`}>
      {options.map((o, i) => {
        const on = isOn(props, o.value)
        const Icon = o.icon
        const a11y = single
          ? { role: 'radio', 'aria-checked': on, tabIndex: on || (selectedIdx < 0 && i === 0) ? 0 : -1, onKeyDown: (e: KeyboardEvent) => onKeyDown(e, i) }
          : { 'aria-pressed': on }
        return (
          <button key={o.value} ref={el => { refs.current[i] = el }} type="button" disabled={o.disabled} title={o.title}
            onClick={() => choose(props, o.value)} {...a11y}
            className={`${choiceCardCls(on, /\brounded-/.test(cardClassName) ? '' : undefined)} disabled:cursor-not-allowed disabled:opacity-50 ${cardClassName}`}>
            {o.content ?? (
              <>
                {Icon && <Icon className="mb-2 h-5 w-5 text-foreground-secondary" />}
                <div className="pr-6 text-sm font-semibold text-foreground">{o.label}</div>
                {o.description && <div className="mt-1 text-xs text-foreground-secondary">{o.description}</div>}
              </>
            )}
            {on && <SelectedMark className="absolute right-3 top-3" />}
          </button>
        )
      })}
    </div>
  )
}
