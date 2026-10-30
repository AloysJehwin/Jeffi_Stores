'use client'

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { portalRoot } from '@/lib/shared/portal-root'

export interface SelectOption {
  value: string
  label: string
  group?: string
  indent?: boolean
  /** Shown but not selectable; `hint` explains why. */
  disabled?: boolean
  /** Secondary line under the label (e.g. why an option is disabled). */
  hint?: string
}

interface AdminSelectProps {
  id?: string
  name?: string
  label?: string
  hint?: string
  error?: string
  value?: string
  defaultValue?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
  options: SelectOption[]
  onChange?: (value: string) => void
  className?: string
  compact?: boolean
  sm?: boolean
  xs?: boolean
  md?: boolean
}

export default function AdminSelect({
  id,
  name,
  label,
  hint,
  error,
  value: controlledValue,
  defaultValue = '',
  required,
  disabled,
  placeholder = 'Select...',
  options,
  onChange,
  className = '',
  compact = false,
  sm = false,
  xs = false,
  md = false,
}: AdminSelectProps) {
  const [internalValue, setInternalValue] = useState(defaultValue)
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropUp, setDropUp] = useState(false)
  const [dropRect, setDropRect] = useState<{ top: number; bottom: number; left: number; width: number } | null>(null)

  const isControlled = controlledValue !== undefined
  const currentValue = isControlled ? controlledValue : internalValue

  const selectedOption = options.find(o => o.value === currentValue)
  const displayLabel = selectedOption?.label || placeholder

  const handleSelect = useCallback(
    (optionValue: string) => {
      if (!isControlled) setInternalValue(optionValue)
      onChange?.(optionValue)
      setIsOpen(false)
    },
    [isControlled, onChange]
  )

  const openDropdown = useCallback((fromKeyboard = false) => {
    if (disabled || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setDropUp(false)
    setDropRect({ top: rect.bottom, bottom: rect.top, left: rect.left, width: rect.width })
    setIsOpen(true)
    const idx = options.findIndex(o => o.value === currentValue)
    setHighlightedIndex(fromKeyboard ? Math.max(idx, 0) : -1)
  }, [disabled, options, currentValue])

  // Flip from the rendered list's real height, so rows with a hint aren't under-counted.
  useLayoutEffect(() => {
    if (!isOpen || !dropRect || !dropdownRef.current) return
    const h = dropdownRef.current.offsetHeight
    const spaceBelow = window.innerHeight - dropRect.top
    setDropUp(spaceBelow < h + 8 && dropRect.bottom > spaceBelow)
    const sel = listRef.current?.querySelector('[aria-selected="true"]')
    if (sel instanceof HTMLElement && typeof sel.scrollIntoView === 'function') sel.scrollIntoView({ block: 'nearest' })
  }, [isOpen, dropRect])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        !(e.target as Element).closest('[data-adminselect-dropdown]')
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    function onScroll(e: Event) {
      const dropdown = document.querySelector('[data-adminselect-dropdown]')
      if (dropdown && dropdown.contains(e.target as Node)) return
      setIsOpen(false)
    }
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => window.removeEventListener('scroll', onScroll, { capture: true })
  }, [isOpen])

  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && listRef.current) {
      const items = listRef.current.children
      if (items[highlightedIndex]) {
        ;(items[highlightedIndex] as HTMLElement).scrollIntoView?.({ block: 'nearest' })
      }
    }
  }, [highlightedIndex, isOpen])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (isOpen && highlightedIndex >= 0) {
          if (!options[highlightedIndex].disabled) handleSelect(options[highlightedIndex].value)
        } else if (!isOpen) {
          openDropdown(true)
        }
        break
      case 'ArrowDown':
        e.preventDefault()
        if (!isOpen) {
          openDropdown(true)
        } else {
          setHighlightedIndex(prev => Math.min(prev + 1, options.length - 1))
        }
        break
      case 'ArrowUp':
        e.preventDefault()
        if (isOpen) setHighlightedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Escape':
        setIsOpen(false)
        break
      case 'Tab':
        setIsOpen(false)
        break
    }
  }

  let lastGroup: string | undefined

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-foreground-secondary mb-2">
          {label}
        </label>
      )}

      {name && <input type="hidden" name={name} value={currentValue} />}

      <div ref={containerRef} className="relative">
        <button
          ref={buttonRef}
          type="button"
          id={id}
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          disabled={disabled}
          onClick={() => (isOpen ? setIsOpen(false) : openDropdown())}
          onKeyDown={handleKeyDown}
          className={`w-full bg-surface border text-left transition-all cursor-pointer flex items-center justify-between
            ${compact || xs ? 'rounded' : 'rounded-lg'}
            ${compact ? 'px-2 py-0.5 text-xs gap-1 leading-none' : xs ? 'field-xs gap-1' : sm ? 'field-sm gap-2' : 'field-md gap-2'}
            ${isOpen ? 'border-accent-500 ring-2 ring-accent-500' : 'border-border-secondary hover:border-border-default'}
            focus:outline-none focus-visible:border-accent-500 focus-visible:ring-2 focus-visible:ring-accent-500/40
            ${error ? 'border-red-400 ring-red-500' : ''}
            ${disabled ? 'opacity-50 cursor-not-allowed bg-surface-secondary' : ''}
          `}
        >
          <span className={`truncate min-w-0 ${selectedOption ? 'text-foreground' : 'text-foreground-muted'}`}>
            {displayLabel}
          </span>
          <svg
            className={`text-foreground-muted shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''} ${compact || xs || md ? 'w-3 h-3' : 'w-4 h-4'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen &&
          dropRect &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={dropdownRef}
              data-adminselect-dropdown
              className="fixed z-[9999] bg-surface-elevated border border-border-default rounded-lg shadow-xl overflow-hidden"
              style={{
                top: dropUp ? undefined : dropRect.top + 4,
                bottom: dropUp ? window.innerHeight - dropRect.bottom + 4 : undefined,
                left: dropRect.left,
                width: dropRect.width,
                animation: 'adminSelectFadeIn 0.12s ease-out',
              }}
            >
              <ul ref={listRef} role="listbox" className="max-h-[280px] overflow-y-auto py-1">
                {options.map((option, index) => {
                  const showGroupHeader = option.group && option.group !== lastGroup
                  if (option.group) lastGroup = option.group

                  return (
                    <li key={`${option.value}-${index}`}>
                      {showGroupHeader && (
                        <div
                          className={`font-semibold text-foreground-muted uppercase tracking-wider bg-surface-secondary border-t border-border-default first:border-t-0 ${compact || xs ? 'px-2.5 py-1 text-[9px]' : sm ? 'px-3 py-1 text-[10px]' : 'px-4 py-1.5 text-xs'}`}
                        >
                          {option.group}
                        </div>
                      )}
                      <button
                        type="button"
                        role="option"
                        aria-selected={option.value === currentValue}
                        data-highlighted={highlightedIndex === index || undefined}
                        disabled={option.disabled}
                        onClick={() => !option.disabled && handleSelect(option.value)}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        onMouseLeave={() => setHighlightedIndex(-1)}
                        className={`w-full text-left transition-colors flex items-center justify-between
                        ${compact || xs ? 'px-2.5 py-1 text-xs' : sm ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm'}
                        ${option.indent ? (compact || xs ? 'pl-5' : sm ? 'pl-6' : 'pl-8') : ''}
                        ${highlightedIndex === index ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300' : 'text-foreground-secondary'}
                        ${option.value === currentValue ? 'font-semibold text-accent-600 dark:text-accent-400' : ''}
                        ${option.disabled ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{option.label}</span>
                          {option.hint && <span className="block text-[10px] text-foreground-muted truncate">{option.hint}</span>}
                        </span>
                        {option.value === currentValue && (
                          <svg
                            className={`text-accent-500 shrink-0 ${compact || xs ? 'w-3 h-3' : 'w-4 h-4'}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>,
            portalRoot()
          )}
      </div>

      {hint && !error && <p className="text-xs text-foreground-muted mt-1.5">{hint}</p>}
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{error}</p>}
    </div>
  )
}
