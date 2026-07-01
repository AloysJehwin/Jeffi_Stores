'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

export interface SelectOption {
  value: string
  label: string
  group?: string
  indent?: boolean
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
  const [dropUp, setDropUp] = useState(false)
  const [dropRect, setDropRect] = useState<{ top: number; bottom: number; left: number; width: number } | null>(null)

  const isControlled = controlledValue !== undefined
  const currentValue = isControlled ? controlledValue : internalValue

  const selectedOption = options.find(o => o.value === currentValue)
  const displayLabel = selectedOption?.label || placeholder

  const handleSelect = useCallback((optionValue: string) => {
    if (!isControlled) setInternalValue(optionValue)
    onChange?.(optionValue)
    setIsOpen(false)
  }, [isControlled, onChange])

  const openDropdown = useCallback(() => {
    if (disabled || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const rowH = compact ? 28 : xs ? 26 : sm ? 34 : 42
    const dropdownHeight = Math.min(options.length * rowH + 8, 280)
    const spaceBelow = window.innerHeight - rect.bottom
    const up = spaceBelow < dropdownHeight && rect.top > spaceBelow
    setDropUp(up)
    setDropRect({ top: rect.bottom, bottom: rect.top, left: rect.left, width: rect.width })
    setIsOpen(true)
    const idx = options.findIndex(o => o.value === currentValue)
    setHighlightedIndex(idx >= 0 ? idx : 0)
  }, [disabled, compact, xs, sm, options, currentValue])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current && !containerRef.current.contains(e.target as Node) &&
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
        (items[highlightedIndex] as HTMLElement).scrollIntoView({ block: 'nearest' })
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
          handleSelect(options[highlightedIndex].value)
        } else {
          openDropdown()
        }
        break
      case 'ArrowDown':
        e.preventDefault()
        if (!isOpen) {
          openDropdown()
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

  const rowH = compact ? 28 : xs ? 26 : sm ? 34 : 42
  const maxDropdownH = Math.min(options.length * rowH + 8, 280)

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
          onClick={() => isOpen ? setIsOpen(false) : openDropdown()}
          onKeyDown={handleKeyDown}
          className={`w-full bg-surface border text-left transition-all cursor-pointer flex items-center justify-between
            ${compact || xs ? 'rounded' : 'rounded-lg'}
            ${compact ? 'px-2 py-0.5 text-xs gap-1 leading-none' : xs ? 'px-1.5 py-1 text-xs gap-1 leading-none h-[26px]' : sm ? 'px-2 py-1.5 text-sm gap-2' : md ? 'px-3 py-2 text-sm gap-2' : 'px-3 py-2 text-sm gap-2'}
            ${isOpen ? 'border-accent-500 ring-2 ring-accent-500' : 'border-border-secondary hover:border-border-default'}
            ${error ? 'border-red-400 ring-red-500' : ''}
            ${disabled ? 'opacity-50 cursor-not-allowed bg-surface-secondary' : ''}
          `}
        >
          <span className={`truncate min-w-0 ${selectedOption ? 'text-foreground' : 'text-foreground-muted'}`}>
            {displayLabel}
          </span>
          <svg
            className={`text-foreground-muted shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''} ${compact || xs || md ? 'w-3 h-3' : 'w-4 h-4'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && dropRect && typeof document !== 'undefined' && createPortal(
          <div
            data-adminselect-dropdown
            className="fixed z-[9999] bg-surface-elevated border border-border-default rounded-lg shadow-xl overflow-hidden"
            style={{
              top: dropUp ? undefined : dropRect.top + 4,
              bottom: dropUp ? window.innerHeight - dropRect.bottom + 4 : undefined,
              left: dropRect.left,
              width: dropRect.width,
              maxHeight: maxDropdownH,
              animation: 'adminSelectFadeIn 0.12s ease-out',
            }}
          >
            <ul ref={listRef} role="listbox" className="overflow-y-auto py-1" style={{ maxHeight: maxDropdownH }}>
              {options.map((option, index) => {
                const showGroupHeader = option.group && option.group !== lastGroup
                if (option.group) lastGroup = option.group

                return (
                  <li key={`${option.value}-${index}`}>
                    {showGroupHeader && (
                      <div className={`font-semibold text-foreground-muted uppercase tracking-wider bg-surface-secondary border-t border-border-default first:border-t-0 ${compact || xs ? 'px-2.5 py-1 text-[9px]' : sm ? 'px-3 py-1 text-[10px]' : 'px-4 py-1.5 text-xs'}`}>
                        {option.group}
                      </div>
                    )}
                    <button
                      type="button"
                      role="option"
                      aria-selected={option.value === currentValue}
                      onClick={() => handleSelect(option.value)}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      className={`w-full text-left transition-colors flex items-center justify-between
                        ${compact || xs ? 'px-2.5 py-1 text-xs' : sm ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm'}
                        ${option.indent ? (compact || xs ? 'pl-5' : sm ? 'pl-6' : 'pl-8') : ''}
                        ${highlightedIndex === index ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300' : 'text-foreground-secondary'}
                        ${option.value === currentValue ? 'font-medium text-accent-600 dark:text-accent-400' : ''}
                      `}
                    >
                      <span>{option.label}</span>
                      {option.value === currentValue && (
                        <svg className={`text-accent-500 shrink-0 ${compact || xs ? 'w-3 h-3' : 'w-4 h-4'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>,
          document.body
        )}
      </div>

      {hint && !error && <p className="text-xs text-foreground-muted mt-1.5">{hint}</p>}
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{error}</p>}
    </div>
  )
}
