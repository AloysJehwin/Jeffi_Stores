'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface SelectOption {
  value: string
  label: string
}

interface CustomSelectProps {
  id?: string
  label?: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
}

export default function CustomSelect({
  id,
  label,
  value,
  options,
  onChange,
  placeholder = 'Select...',
  required,
  disabled,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [dropUp, setDropUp] = useState(false)

  const selectedOption = options.find(o => o.value === value)
  const displayLabel = selectedOption?.label || placeholder

  const handleSelect = useCallback((optionValue: string) => {
    onChange(optionValue)
    setIsOpen(false)
  }, [onChange])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      const dropdownHeight = Math.min(options.length * 40 + 8, 280)
      setDropUp(spaceBelow < dropdownHeight && spaceAbove > spaceBelow)
    }
  }, [isOpen, options.length])

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
          setIsOpen(true)
          const idx = options.findIndex(o => o.value === value)
          setHighlightedIndex(idx >= 0 ? idx : 0)
        }
        break
      case 'ArrowDown':
        e.preventDefault()
        if (!isOpen) {
          setIsOpen(true)
          const idx = options.findIndex(o => o.value === value)
          setHighlightedIndex(idx >= 0 ? idx : 0)
        } else {
          setHighlightedIndex(prev => Math.min(prev + 1, options.length - 1))
        }
        break
      case 'ArrowUp':
        e.preventDefault()
        if (isOpen) {
          setHighlightedIndex(prev => Math.max(prev - 1, 0))
        }
        break
      case 'Escape':
      case 'Tab':
        setIsOpen(false)
        break
    }
  }

  return (
    <div>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-2">
          {label}
        </label>
      )}
      <div ref={containerRef} className="relative">
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-required={required}
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              setIsOpen(!isOpen)
              if (!isOpen) {
                const idx = options.findIndex(o => o.value === value)
                setHighlightedIndex(idx >= 0 ? idx : 0)
              }
            }
          }}
          onKeyDown={handleKeyDown}
          className={`w-full px-4 py-2.5 bg-white border rounded-lg text-sm text-left transition-all cursor-pointer flex items-center justify-between gap-2
            ${isOpen ? 'border-accent-500 ring-2 ring-accent-500/20' : 'border-gray-300 hover:border-gray-400'}
            ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-100' : ''}
          `}
        >
          <span className={selectedOption ? 'text-gray-900' : 'text-gray-400'}>
            {displayLabel}
          </span>
          <svg
            className={`w-4 h-4 text-gray-500 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div
            className={`absolute z-50 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden
              ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}
            `}
            style={{ animation: 'customSelectFadeIn 0.15s ease-out' }}
          >
            <ul ref={listRef} role="listbox" className="max-h-[264px] overflow-y-auto py-1">
              {options.map((option, index) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    onClick={() => handleSelect(option.value)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between
                      ${highlightedIndex === index ? 'bg-accent-50 text-accent-700' : 'text-gray-700'}
                      ${option.value === value ? 'font-medium text-accent-600' : ''}
                    `}
                  >
                    <span>{option.label}</span>
                    {option.value === value && (
                      <svg className="w-4 h-4 text-accent-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes customSelectFadeIn {
          from {
            opacity: 0;
            transform: translateY(${dropUp ? '4px' : '-4px'});
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}
