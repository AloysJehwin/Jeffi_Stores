'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useRef, useEffect, useCallback } from 'react'

const SORT_OPTIONS = [
  { value: 'created_at', label: 'Newest First' },
  { value: 'name', label: 'Name (A-Z)' },
  { value: 'base_price', label: 'Price: Low to High' },
  { value: 'base_price&order=desc', label: 'Price: High to Low' },
]

export default function SortDropdown() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const currentSort = searchParams.get('sort') || 'created_at'
  const currentOrder = searchParams.get('order') || 'desc'
  const currentValue = currentOrder === 'desc' && currentSort === 'base_price'
    ? `${currentSort}&order=${currentOrder}`
    : currentSort

  const selectedOption = SORT_OPTIONS.find(o => o.value === currentValue) || SORT_OPTIONS[0]

  const handleSelect = useCallback((value: string) => {
    const params = new URLSearchParams(searchParams.toString())

    if (value.includes('&order=')) {
      const [sort, order] = value.split('&order=')
      params.set('sort', sort)
      params.set('order', order)
    } else {
      params.set('sort', value)
      params.delete('order')
    }

    router.push(`/products?${params.toString()}`)
    setIsOpen(false)
  }, [searchParams, router])

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Scroll highlighted into view
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && listRef.current) {
      const items = listRef.current.children
      if (items[highlightedIndex]) {
        (items[highlightedIndex] as HTMLElement).scrollIntoView({ block: 'nearest' })
      }
    }
  }, [highlightedIndex, isOpen])

  function handleKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (isOpen && highlightedIndex >= 0) {
          handleSelect(SORT_OPTIONS[highlightedIndex].value)
        } else {
          setIsOpen(true)
          const idx = SORT_OPTIONS.findIndex(o => o.value === currentValue)
          setHighlightedIndex(idx >= 0 ? idx : 0)
        }
        break
      case 'ArrowDown':
        e.preventDefault()
        if (!isOpen) {
          setIsOpen(true)
          const idx = SORT_OPTIONS.findIndex(o => o.value === currentValue)
          setHighlightedIndex(idx >= 0 ? idx : 0)
        } else {
          setHighlightedIndex(prev => Math.min(prev + 1, SORT_OPTIONS.length - 1))
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
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-600 whitespace-nowrap">Sort by:</label>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          onClick={() => {
            setIsOpen(!isOpen)
            if (!isOpen) {
              const idx = SORT_OPTIONS.findIndex(o => o.value === currentValue)
              setHighlightedIndex(idx >= 0 ? idx : 0)
            }
          }}
          onKeyDown={handleKeyDown}
          className={`px-4 py-2 bg-white border rounded-lg text-sm text-left transition-all cursor-pointer flex items-center gap-2 min-w-[190px]
            ${isOpen ? 'border-accent-500 ring-2 ring-accent-500/20' : 'border-gray-300 hover:border-gray-400'}
          `}
        >
          <span className="text-gray-900 flex-1">{selectedOption.label}</span>
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
            className="absolute z-50 right-0 mt-1 w-full min-w-[210px] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
            style={{ animation: 'sortFadeIn 0.15s ease-out' }}
          >
            <ul ref={listRef} role="listbox" className="py-1">
              {SORT_OPTIONS.map((option, index) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === currentValue}
                    onClick={() => handleSelect(option.value)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between
                      ${highlightedIndex === index ? 'bg-accent-50 text-accent-700' : 'text-gray-700'}
                      ${option.value === currentValue ? 'font-medium text-accent-600' : ''}
                    `}
                  >
                    <span>{option.label}</span>
                    {option.value === currentValue && (
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
        @keyframes sortFadeIn {
          from {
            opacity: 0;
            transform: translateY(-4px);
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
